import { isTokenLimitError, noulAnswer } from './request.js';
import { collectToolCalls, estimateTokens, fitState, goalFromMessages, HistoryTooLargeError, isPinned } from './state.js';
import type {
  CallAnswer,
  CallDecision,
  CompactOptions,
  CompactResult,
  CompactionState,
  JevAsker,
  JevQuestions,
  Message,
  ResolvedCompactOptions,
  ToolCall,
  ToolUse,
} from './types.js';

// Jev has two independent limits (upstream PR #55). Defaults leave margin;
// recursive windows, rather than unlimited payloads, handle longer histories.
export const JEV_MAX_STATE_QUESTION_TOKENS = 32_000;
export const JEV_MAX_REQUEST_TOKENS = 64_000;
export const DEFAULT_OPTIONS: ResolvedCompactOptions = {
  goal: '',
  keepThreshold: 0.5,
  preserveRecentMessages: 6,
  maxStateTokens: 28_000,
  maxRequestTokens: 56_000,
  maxTokenRetries: 3,
  maxConcurrentRequests: 4,
  truncateHeadChars: 300,
};

/** Conservative allowance for request/model/question envelopes. */
const REQUEST_OVERHEAD_TOKENS = 64;

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function resolveOptions(options: CompactOptions = {}): ResolvedCompactOptions {
  const keepThreshold = finite(options.keepThreshold, DEFAULT_OPTIONS.keepThreshold);
  if (keepThreshold < 0 || keepThreshold > 1) {
    throw new RangeError('keepThreshold must be between 0 and 1');
  }
  return {
    goal: options.goal ?? DEFAULT_OPTIONS.goal,
    keepThreshold,
    preserveRecentMessages: Math.max(
      0,
      Math.floor(
        finite(options.preserveRecentMessages, DEFAULT_OPTIONS.preserveRecentMessages),
      ),
    ),
    maxStateTokens: Math.min(
      JEV_MAX_STATE_QUESTION_TOKENS,
      Math.max(1, finite(options.maxStateTokens, DEFAULT_OPTIONS.maxStateTokens)),
    ),
    maxRequestTokens: Math.min(
      JEV_MAX_REQUEST_TOKENS,
      Math.max(1, finite(options.maxRequestTokens, DEFAULT_OPTIONS.maxRequestTokens)),
    ),
    maxTokenRetries: Math.min(8, Math.max(0, Math.floor(
      finite(options.maxTokenRetries, DEFAULT_OPTIONS.maxTokenRetries),
    ))),
    maxConcurrentRequests: Math.min(16, Math.max(1, Math.floor(
      finite(options.maxConcurrentRequests, DEFAULT_OPTIONS.maxConcurrentRequests),
    ))),
    signal: options.signal,
    truncateHeadChars: Math.max(
      0,
      Math.floor(finite(options.truncateHeadChars, DEFAULT_OPTIONS.truncateHeadChars)),
    ),
  };
}

/** The two `noul` questions asked about one call: keep the call, keep its result. */
export function questionsFor(call: ToolCall): JevQuestions {
  return {
    [`call_${call.id}`]: {
      type: 'noul',
      instructions: `Tool call ${call.id} (${call.tool}) should stay in the history: knowing this call was made, with its input, still matters for what the assistant does next`,
    },
    [`result_${call.id}`]: {
      type: 'noul',
      instructions: `The full output of tool call ${call.id} (${call.tool}, ${call.resultChars} chars) should stay in the history verbatim: the assistant still needs its contents and re-running the tool would not do`,
    },
  };
}

function questionTokens(call: ToolCall): { pair: number; longest: number } {
  const questions = questionsFor(call);
  return {
    pair: estimateTokens(JSON.stringify(questions)),
    longest: Math.max(...Object.values(questions).map((q) => estimateTokens(JSON.stringify(q)))),
  };
}

/** Splits questions against a global or windowed state, enforcing both Jev limits. */
export function batchCalls(
  calls: readonly ToolCall[],
  stateTokens: number,
  options: Pick<ResolvedCompactOptions, 'maxRequestTokens'>,
): ToolCall[][] {
  const requestLimit = Math.min(options.maxRequestTokens, JEV_MAX_REQUEST_TOKENS);
  const budget = requestLimit - stateTokens - REQUEST_OVERHEAD_TOKENS;
  const batches: ToolCall[][] = [];
  let current: ToolCall[] = [];
  let currentTokens = 0;
  for (const call of calls) {
    const { pair: tokens, longest } = questionTokens(call);
    if (stateTokens + longest + REQUEST_OVERHEAD_TOKENS > JEV_MAX_STATE_QUESTION_TOKENS) {
      throw new Error('state plus longest question exceeds Jev\'s 32000-token limit');
    }
    if (current.length > 0 && currentTokens + tokens > budget) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    if (current.length === 0 && tokens > budget) {
      throw new Error(
        `state leaves no room for questions (~${stateTokens} of ${options.maxRequestTokens} tokens)`,
      );
    }
    current.push(call);
    currentTokens += tokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function decideCall(
  call: Pick<ToolCall, 'id' | 'tool' | 'pinned'>,
  answer: CallAnswer,
  options: Pick<ResolvedCompactOptions, 'keepThreshold'>,
): CallDecision {
  // Upstream PR #49: malformed probabilities must not become deletion votes.
  if (!Number.isFinite(options.keepThreshold) || options.keepThreshold < 0 || options.keepThreshold > 1) {
    throw new RangeError('keepThreshold must be between 0 and 1');
  }
  if (![answer.keepCall, answer.keepResult].every((value) =>
    Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new Error('Invalid keep probabilities');
  }
  const base = { id: call.id, tool: call.tool, ...answer };
  if (call.pinned) return { ...base, action: 'keep', reason: 'pinned' };
  if (answer.keepResult >= options.keepThreshold) {
    return { ...base, action: 'keep', reason: 'kept' };
  }
  if (answer.keepCall >= options.keepThreshold) {
    return { ...base, action: 'drop_result', reason: 'result_dropped' };
  }
  return { ...base, action: 'drop_call', reason: 'call_dropped' };
}

async function askBatch(
  asker: JevAsker,
  state: CompactionState,
  batch: readonly ToolCall[],
): Promise<Map<string, CallAnswer>> {
  const questions: JevQuestions = Object.assign({}, ...batch.map(questionsFor));
  const { answers } = await asker.ask(state, questions);
  return new Map(
    batch.map((call) => [
      call.id,
      {
        keepCall: noulAnswer(answers, `call_${call.id}`),
        keepResult: noulAnswer(answers, `result_${call.id}`),
      },
    ]),
  );
}

type StateGroup = { state: ReturnType<typeof fitState>; calls: ToolCall[] };

/**
 * Adapted from upstream PR #119 (windowing), #49 (question headroom), and
 * #52/#70 (do not score against collapsed context). Original message indices
 * and call IDs survive every window. Unfittable single candidates stay unasked.
 */
export function stateGroups(
  messages: readonly Message[],
  calls: readonly ToolCall[],
  candidates: readonly ToolCall[],
  options: ResolvedCompactOptions,
): { groups: StateGroup[]; unasked: ToolCall[]; stage: string; windows: number } {
  if (options.maxRequestTokens <= REQUEST_OVERHEAD_TOKENS) {
    throw new Error('request budget leaves no room for state and questions');
  }
  const goal = options.goal || goalFromMessages(messages);
  const fitOptionsFor = (group: readonly ToolCall[]): ResolvedCompactOptions => {
    const largest = group.reduce((size, call) => {
      const next = questionTokens(call);
      return { pair: Math.max(size.pair, next.pair), longest: Math.max(size.longest, next.longest) };
    }, { pair: 0, longest: 0 });
    return {
      ...options,
      goal,
      maxStateTokens: Math.min(
        options.maxStateTokens,
        options.maxRequestTokens - REQUEST_OVERHEAD_TOKENS - largest.pair,
        JEV_MAX_STATE_QUESTION_TOKENS - REQUEST_OVERHEAD_TOKENS - largest.longest,
      ),
    };
  };
  const visible = (state: ReturnType<typeof fitState>): boolean =>
    state.stage === 'full' || state.stage.startsWith('inputs<=') || state.stage === 'texts abridged';
  const globalOptions = fitOptionsFor(candidates);
  if (globalOptions.maxStateTokens >= 1) {
    try {
      const state = fitState(messages, calls, globalOptions);
      if (visible(state)) {
        return { groups: [{ state, calls: [...candidates] }], unasked: [], stage: state.stage, windows: 0 };
      }
    } catch (error) {
      if (!(error instanceof HistoryTooLargeError)) throw error;
    }
  }

  const groups: StateGroup[] = [];
  const unasked: ToolCall[] = [];
  const fit = (group: ToolCall[]): void => {
    options.signal?.throwIfAborted();
    const lo = group.reduce((n, call) => Math.min(n, call.callIndex), messages.length);
    const hi = group.reduce((n, call) => Math.max(n, call.resultIndex), -1);
    const inWindow = new Set(group.map((call) => call.id));
    const view = messages.map((message, i) =>
      (i >= lo && i <= hi) || isPinned(i, messages.length, options.preserveRecentMessages)
        ? message
        : { ...message, text: '' },
    );
    // Headroom is local to this group: an oversized question in a sibling
    // must not poison otherwise fitting candidates. Split until it is isolated.
    const fitOptions = fitOptionsFor(group);
    if (fitOptions.maxStateTokens >= 1) {
      try {
        const state = fitState(view, calls.filter((call) => call.pinned || inWindow.has(call.id)), fitOptions);
        if (visible(state)) {
          groups.push({ state, calls: group });
          return;
        }
      } catch (error) {
        if (!(error instanceof HistoryTooLargeError)) throw error;
      }
    }
    if (group.length === 1) {
      unasked.push(group[0]!);
      return;
    }
    const half = Math.ceil(group.length / 2);
    fit(group.slice(0, half));
    fit(group.slice(half));
  };
  if (candidates.length > 0) {
    const half = Math.ceil(candidates.length / 2);
    fit(candidates.slice(0, half));
    if (candidates.length > half) fit(candidates.slice(half));
  }
  const stage = `windows:${groups.length}${unasked.length > 0 ? ` unasked:${unasked.length}` : ''}`;
  return { groups, unasked, stage, windows: groups.length };
}

type AskJob = { state: CompactionState; calls: ToolCall[] };

/** Bounded worker queue adapted from upstream #44/#49; no partial transcript. */
async function askJobs(
  asker: JevAsker,
  jobs: readonly AskJob[],
  options: ResolvedCompactOptions,
  dispatched: () => void,
  oversized: (stateTokens: number, requestTokens: number) => void,
): Promise<Map<string, CallAnswer>> {
  const answers = new Map<string, CallAnswer>();
  let cursor = 0;
  const failures: unknown[] = [];
  const worker = async (): Promise<void> => {
    while (failures.length === 0 && cursor < jobs.length) {
      const job = jobs[cursor++]!;
      try {
        options.signal?.throwIfAborted();
        dispatched();
        const found = await askBatch(asker, job.state, job.calls);
        for (const [id, answer] of found) answers.set(id, answer);
      } catch (error) {
        if (isTokenLimitError(error)) {
          const stateTokens = estimateTokens(JSON.stringify(job.state));
          const requestTokens = stateTokens + REQUEST_OVERHEAD_TOKENS
            + job.calls.reduce((n, call) => n + questionTokens(call).pair, 0);
          oversized(stateTokens, requestTokens);
        }
        failures.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.maxConcurrentRequests, jobs.length) }, worker));
  options.signal?.throwIfAborted();
  if (failures.length > 0) {
    // Never mask authentication, malformed-answer or abort errors with a size retry.
    throw failures.find((error) => !isTokenLimitError(error)) ?? failures[0];
  }
  return answers;
}

function truncatedResultText(text: string, isError: boolean, headChars: number): string {
  if (text.length <= headChars + 120) return text;
  const head = headChars > 0 ? `${text.slice(0, headChars)}\n` : '';
  return `${head}[fast-jev-compaction truncated ${text.length - headChars} chars of this tool result${
    isError ? ' (error)' : ''
  }; re-run the tool if needed]`;
}

/**
 * Rebuilds the conversation from the decisions. A dropped call disappears
 * together with its result; a dropped result keeps a bounded head and note.
 * Messages that lose all their content are removed; untouched messages are
 * returned as the same objects they came in as.
 */
export function applyDecisions(
  messages: readonly Message[],
  decisions: readonly CallDecision[],
  calls: readonly ToolCall[],
  headChars: number,
): Message[] {
  const byId = new Map(calls.map((call) => [call.id, call]));
  const actions = new Map<string, CallDecision['action']>();
  for (const decision of decisions) {
    const call = byId.get(decision.id);
    if (call && !call.pinned && decision.action !== 'keep') actions.set(call.tool_use_id, decision.action);
  }
  const kept: Message[] = [];
  for (const message of messages) {
    const touched =
      message.toolUses.some((tool) => actions.has(tool.tool_use_id)) ||
      (message.toolResults ?? []).some((result) => actions.has(result.tool_use_id));
    if (!touched) {
      kept.push(message);
      continue;
    }
    const toolUses = message.toolUses
      .filter((tool) => actions.get(tool.tool_use_id) !== 'drop_call')
      .map((tool) => {
        if (actions.get(tool.tool_use_id) !== 'drop_result') return tool;
        const text = truncatedResultText(
          tool.text ?? '',
          tool.isError ?? false,
          headChars,
        );
        if ((tool.text ?? '') === text) return tool;
        const copy: ToolUse = {
          tool_use_id: tool.tool_use_id,
          tool: tool.tool,
          input: tool.input,
          text,
        };
        if (tool.isError) copy.isError = true;
        return copy;
      });
    const toolResults = (message.toolResults ?? [])
      .filter((result) => actions.get(result.tool_use_id) !== 'drop_call')
      .map((result) => {
        if (actions.get(result.tool_use_id) !== 'drop_result') return result;
        const text = truncatedResultText(result.text, result.isError ?? false, headChars);
        return text === result.text
          ? result
          : {
              tool_use_id: result.tool_use_id,
              text,
              isError: result.isError,
            };
      });
    if (
      !message.toolUses.some(
        (tool) => actions.get(tool.tool_use_id) === 'drop_call',
      ) &&
      !(message.toolResults ?? []).some(
        (result) => actions.get(result.tool_use_id) === 'drop_call',
      ) &&
      toolUses.every((tool, index) => tool === message.toolUses[index]) &&
      toolResults.every(
        (result, index) => result === message.toolResults?.[index],
      )
    ) {
      kept.push(message);
      continue;
    }
    if (message.text.trim().length === 0 && toolUses.length === 0 && toolResults.length === 0) {
      continue;
    }
    const rebuilt: Message = { role: message.role, text: message.text, toolUses };
    if (toolResults.length > 0) rebuilt.toolResults = toolResults;
    kept.push(rebuilt);
  }
  return kept;
}

/** Characters of text, tool input and tool output a message holds. */
export function messageChars(message: Message): number {
  let total = message.text.length;
  for (const tool of message.toolUses) {
    try {
      total += JSON.stringify(tool.input).length;
    } catch {
      total += 20;
    }
  }
  for (const result of message.toolResults ?? []) total += result.text.length;
  return total;
}

export function reductionRatio(result: Pick<CompactResult, 'stats'>): number {
  const { charsBefore, charsAfter } = result.stats;
  return charsBefore === 0 ? 0 : (charsBefore - charsAfter) / charsBefore;
}

function count(decisions: readonly CallDecision[], reason: CallDecision['reason']): number {
  return decisions.filter((decision) => decision.reason === reason).length;
}

/**
 * Compacts a transcript by asking Jev, for every tool call outside the pinned
 * first and newest messages, whether the call and whether its result must
 * stay. Use a global state when it fits safely, otherwise recursive windows.
 * On a structured max_tokens_exceeded rejection, halve both budgets and
 * rebuild the plan, with bounded retries. Other failures still throw for the
 * host's summary fallback. Never modify the input or apply partial answers.
 */
export async function compact(
  messages: readonly Message[],
  asker: JevAsker,
  options: CompactOptions = {},
): Promise<CompactResult> {
  const started = Date.now();
  let resolved = resolveOptions(options);
  resolved.signal?.throwIfAborted();
  const calls = collectToolCalls(messages, resolved.preserveRecentMessages);
  const candidates = calls.filter((call) => !call.pinned);
  const charsBefore = messages.reduce((sum, message) => sum + messageChars(message), 0);

  let fitted: { tokens: number; stage: string } = { tokens: 0, stage: '' };
  let requests = 0;
  let retries = 0;
  let windows = 0;
  let unasked = 0;
  let answers = new Map<string, CallAnswer>();
  let lastSizeError: unknown;
  if (candidates.length > 0) {
    for (;;) {
      resolved.signal?.throwIfAborted();
      const plan = stateGroups(messages, calls, candidates, resolved);
      fitted = { tokens: plan.groups.reduce((n, group) => Math.max(n, group.state.tokens), 0), stage: plan.stage };
      windows = plan.windows;
      unasked = plan.unasked.length;
      const jobs = plan.groups.flatMap((group) =>
        batchCalls(group.calls, group.state.tokens, resolved).map((batch) => ({ state: group.state.state, calls: batch })),
      );
      if (jobs.length === 0 && lastSizeError) throw lastSizeError;
      let rejectedStateTokens = resolved.maxStateTokens;
      let rejectedRequestTokens = resolved.maxRequestTokens;
      try {
        answers = await askJobs(asker, jobs, resolved, () => { requests++; }, (state, request) => {
          rejectedStateTokens = Math.min(rejectedStateTokens, state);
          rejectedRequestTokens = Math.min(rejectedRequestTokens, request);
        });
        break;
      } catch (error) {
        resolved.signal?.throwIfAborted();
        if (!isTokenLimitError(error) || retries >= resolved.maxTokenRetries) throw error;
        retries++;
        lastSizeError = error;
        resolved = {
          ...resolved,
          // Size from the rejected payload, not only configured ceilings: a
          // request far below those ceilings must not be resent unchanged.
          maxStateTokens: Math.max(1, Math.floor(rejectedStateTokens / 2)),
          maxRequestTokens: Math.max(1, Math.floor(rejectedRequestTokens / 2)),
        };
        // Retry from the original transcript; discard all answers from the failed plan.
      }
    }
  }
  resolved.signal?.throwIfAborted();

  const decisions = calls.map((call) =>
    decideCall(call, answers.get(call.id) ?? { keepCall: 1, keepResult: 1 }, resolved),
  );
  const kept = applyDecisions(
    messages,
    decisions,
    calls,
    resolved.truncateHeadChars,
  );
  return {
    messages: kept,
    decisions,
    stats: {
      messagesBefore: messages.length,
      messagesAfter: kept.length,
      charsBefore,
      charsAfter: kept.reduce((sum, message) => sum + messageChars(message), 0),
      calls: calls.length,
      kept: count(decisions, 'kept'),
      resultsDropped: count(decisions, 'result_dropped'),
      callsDropped: count(decisions, 'call_dropped'),
      pinned: count(decisions, 'pinned'),
      stateTokens: fitted.tokens,
      stateStage: fitted.stage,
      requests,
      retries,
      windows,
      unasked,
      ms: Date.now() - started,
    },
  };
}
