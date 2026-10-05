import { describe, expect, it } from 'vitest';
import {
  applyDecisions, batchCalls, collectToolCalls, compact, decideCall, estimateTokens, fitState, JevClient,
  JevRequestError, isTokenLimitError, noulAnswer, parseJevResponse, questionsFor, resolveOptions,
  type CompactionState, type HistoryToolCall, type JevAsker, type JevQuestions,
  type JevResponse, type Message, type ToolCall,
} from '../src/index.js';

const message = (role: Message['role'], text: string): Message => ({ role, text, toolUses: [] });
const answers = (questions: JevQuestions, score = 1): JevResponse => ({
  answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { noul: score }])),
});
const oversized = (): JevRequestError => new JevRequestError(400,
  '{"detail":{"error_type":"max_tokens_exceeded"}}');

// Adapted from upstream PR #119's fixture. IDs/indices must remain global.
function long(n: number): Message[] {
  const out = [message('user', 'Fix the failing build; never touch src/generated.')];
  for (let i = 0; i < n; i++) {
    out.push(message('assistant', `Step ${i}: ${'checking the next module and its callers '.repeat(6)}`));
    out.push({ role: 'assistant', text: '', toolUses: [{ tool_use_id: `w${i}`, tool: 'Bash', input: { command: `npm test -- module${i}` } }] });
    out.push({ role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: `w${i}`, text: `module${i}: failed\n${'x'.repeat(400)}` }] });
  }
  out.push(message('user', 'go on'));
  return out;
}

function candidate(i: number): ToolCall {
  return { id: `t${i}`, tool_use_id: `w${i}`, tool: 'Read', input: {}, callIndex: i * 2 + 1,
    resultIndex: i * 2 + 2, resultChars: 100, isError: false, pinned: false };
}

function assertLimits(state: unknown, questions: JevQuestions, requestLimit: number): void {
  const stateTokens = estimateTokens(JSON.stringify(state));
  const longest = Math.max(...Object.values(questions).map((q) => estimateTokens(JSON.stringify(q))));
  expect(stateTokens + longest).toBeLessThanOrEqual(32_000);
  expect(estimateTokens(JSON.stringify({ model: 'jev-latest', state, questions })))
    .toBeLessThanOrEqual(requestLimit);
}

describe('token estimator (upstream PR #85)', () => {
  it('charges dense base64, UUIDs and hashes without changing prose/filler pricing', () => {
    const blob = 'c3RhcnQgdGhlIGNvbXBhY3Rpb24gZnJvbSB0aGUgaG9vayBhbmQga2VlcCBpdCBydW5uaW5n';
    expect(estimateTokens(blob)).toBeGreaterThanOrEqual(Math.ceil(blob.length / 3));
    const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(estimateTokens(uuid)).toBeGreaterThanOrEqual(Math.ceil(uuid.replace(/-/g, '').length / 3));
    const sha = 'd41d8cd98f00b204e9800998ecf8427e';
    expect(estimateTokens(sha)).toBeGreaterThanOrEqual(Math.ceil(sha.length / 3));
    expect(estimateTokens('internationalization')).toBe(4);
    expect(estimateTokens('estimateTokens')).toBe(3);
    expect(estimateTokens('12345678')).toBe(4);
    expect(estimateTokens('utf8 base64')).toBeLessThan(6);
    expect(estimateTokens('x'.repeat(200))).toBe(34);
  });

  it('does not price Han text below one token per character', () => {
    expect(estimateTokens('中文测试'.repeat(200))).toBe(800);
    expect(estimateTokens('😀')).toBe(2);
  });
});

describe('provider budgets (upstream PR #49/#55)', () => {
  it('defaults to finite budgets and clamps overrides, Infinity and retry/concurrency bounds', () => {
    expect(resolveOptions({ maxStateTokens: Infinity, maxRequestTokens: Infinity }))
      .toMatchObject({ maxStateTokens: 28_000, maxRequestTokens: 56_000 });
    expect(resolveOptions({ maxStateTokens: 100_000, maxRequestTokens: 200_000,
      maxTokenRetries: 50, maxConcurrentRequests: 100 }))
      .toMatchObject({ maxStateTokens: 32_000, maxRequestTokens: 64_000,
        maxTokenRetries: 8, maxConcurrentRequests: 16 });
    expect(resolveOptions({ maxTokenRetries: -1, maxConcurrentRequests: 0 }))
      .toMatchObject({ maxTokenRetries: 0, maxConcurrentRequests: 1 });
  });

  it('rejects thresholds that could delete unscored candidates even with a default keep answer', () => {
    expect(() => resolveOptions({ keepThreshold: 1.1 })).toThrow(/keepThreshold/);
    expect(() => resolveOptions({ keepThreshold: -0.1 })).toThrow(/keepThreshold/);
  });

  it('enforces state plus the longest single question, independently of the total budget', () => {
    expect(() => batchCalls([candidate(1)], 31_990, { maxRequestTokens: 64_000 }))
      .toThrow(/longest question/);
  });

  it('does not let an unlimited batch override bypass the 64K limit', () => {
    const calls = Array.from({ length: 500 }, (_, i) => candidate(i + 1));
    const batches = batchCalls(calls, 25_000, { maxRequestTokens: Infinity });
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toEqual(calls);
    for (const batch of batches) {
      const questionCost = batch.reduce((n, call) => n + estimateTokens(JSON.stringify(questionsFor(call))), 0);
      expect(25_000 + questionCost + 64).toBeLessThanOrEqual(64_000);
    }
  });

  it('fits with question headroom before dispatch, preserving the original transcript', async () => {
    const input = long(2);
    input.splice(3, 0, message('assistant', 'word '.repeat(2000)));
    const original = structuredClone(input);
    let asks = 0;
    const output = await compact(input, { ask: async (state, questions) => {
      asks++;
      assertLimits(state, questions, 1000);
      return answers(questions);
    } }, { maxRequestTokens: 1000, maxStateTokens: 25_000, preserveRecentMessages: 1, goal: 'finish' });
    expect(asks).toBeGreaterThan(0);
    expect(output.messages).toEqual(original);
    expect(input).toEqual(original);
  });

  it('fails impossible budgets without making any request', async () => {
    let asks = 0;
    await expect(compact(long(2), { ask: async (_s, q) => { asks++; return answers(q); } },
      { maxRequestTokens: 1, preserveRecentMessages: 0 })).rejects.toThrow(/no room/);
    expect(asks).toBe(0);
  });
});

describe('history windows (upstream PR #119)', () => {
  it('scores every fitting candidate once, with stable IDs, goal and pinned context', async () => {
    const input = long(400);
    const original = structuredClone(input);
    const calls = collectToolCalls(input, 2);
    const options = { maxStateTokens: 3000, maxRequestTokens: 6000, preserveRecentMessages: 2 };
    expect(() => fitState(input, calls, { ...options, goal: 'build' })).toThrow(/too large/);
    const asked: string[] = [];
    const output = await compact(input, { ask: async (raw, questions) => {
      const state = raw as CompactionState;
      assertLimits(state, questions, 6000);
      expect(state.goal).toContain('never touch src/generated');
      expect(state.history.find((entry) => entry.i === 0)?.text).toBe(input[0]!.text);
      expect(state.history.at(-1)?.text).toBe('go on');
      const visible = new Set(state.history.flatMap((entry) =>
        (entry.tool_calls ?? []).map((call) => (call as HistoryToolCall).id)));
      for (const key of Object.keys(questions).filter((key) => key.startsWith('call_'))) {
        const id = key.slice(5);
        expect(visible.has(id)).toBe(true);
        const call = calls.find((call) => call.id === id)!;
        expect(state.history.some((entry) => entry.i === call.callIndex)).toBe(true);
        asked.push(id);
      }
      return answers(questions, 0.1);
    } }, options);
    expect(output.stats.stateStage).toMatch(/^windows:/);
    expect(output.stats.windows).toBeGreaterThan(1);
    expect(output.stats.unasked).toBe(0);
    expect(new Set(asked).size).toBe(calls.filter((call) => !call.pinned).length);
    expect(asked.length).toBe(new Set(asked).size);
    expect(output.decisions.filter((d) => d.reason === 'pinned').every((d) => d.action === 'keep')).toBe(true);
    expect(input).toEqual(original);
    const keptUses = new Set(output.messages.flatMap((m) => m.toolUses.map((t) => t.tool_use_id)));
    expect(output.messages.flatMap((m) => m.toolResults ?? []).every((r) => keptUses.has(r.tool_use_id))).toBe(true);
  });

  it('keeps all candidates when even singleton windows cannot fit', async () => {
    let asks = 0;
    const input = long(5);
    const output = await compact(input, { ask: async (_s, q) => { asks++; return answers(q, 0); } },
      { maxStateTokens: 200, maxRequestTokens: 6000, preserveRecentMessages: 2, goal: 'g'.repeat(5000) });
    expect(asks).toBe(0);
    expect(output.stats.unasked).toBeGreaterThan(0);
    expect(output.decisions.every((d) => d.action === 'keep')).toBe(true);
    expect(output.messages).toEqual(input);
  });

  it('windows instead of scoring against a locally fitting but collapsed global state', async () => {
    const input = long(40);
    const calls = collectToolCalls(input, 1);
    const full = fitState(input, calls, { maxStateTokens: Infinity, preserveRecentMessages: 1, goal: 'build' });
    const maxStateTokens = Math.floor(full.tokens * 0.45);
    const global = fitState(input, calls, { maxStateTokens, preserveRecentMessages: 1, goal: 'build' });
    expect(global.stage).toMatch(/collapsed|compacted|left out|merged/);
    const output = await compact(input, { ask: async (raw, q) => {
      for (const entry of (raw as CompactionState).history) {
        expect(entry.text).not.toMatch(/^\[… \d+ chars omitted …\]$/);
        expect((entry.tool_calls ?? []).every((call) => typeof call !== 'string')).toBe(true);
      }
      return answers(q);
    } }, { maxStateTokens, maxRequestTokens: 6000, preserveRecentMessages: 1, goal: 'build' });
    expect(output.stats.windows).toBeGreaterThan(0);
  });

  it('isolates an oversized question instead of blocking fitting sibling windows', async () => {
    const input = long(2);
    input[2]!.toolUses[0]!.tool = 'x'.repeat(10_000);
    const original = structuredClone(input);
    const asked: string[] = [];
    const output = await compact(input, { ask: async (state, q) => {
      assertLimits(state, q, 1000);
      asked.push(...Object.keys(q));
      return answers(q, 0);
    } }, { maxStateTokens: 500, maxRequestTokens: 1000, preserveRecentMessages: 1, goal: 'g' });
    expect(asked).toEqual(['call_t2', 'result_t2']);
    expect(output.stats).toMatchObject({ unasked: 1, requests: 1, windows: 1 });
    expect(output.decisions.map((d) => d.action)).toEqual(['keep', 'drop_call']);
    expect(output.messages.flatMap((m) => m.toolUses.map((t) => t.tool_use_id))).toEqual(['w0']);
    expect(output.messages.flatMap((m) => (m.toolResults ?? []).map((r) => r.tool_use_id))).toEqual(['w0']);
    expect(input).toEqual(original);
  });

  it('keeps a singleton whose questions alone exceed the provider ceiling', async () => {
    const input = long(1);
    input[2]!.toolUses[0]!.tool = 'x'.repeat(400_000);
    let asks = 0;
    const output = await compact(input, { ask: async (_s, q) => { asks++; return answers(q, 0); } },
      { preserveRecentMessages: 1, goal: 'g' });
    expect(asks).toBe(0);
    expect(output.stats.unasked).toBe(1);
    expect(output.decisions[0]?.action).toBe('keep');
    expect(output.messages).toEqual(input);
  });

  it('keeps an unsafe singleton while still scoring the other window', async () => {
    const input = long(2);
    input[2]!.text = 'important historical facts '.repeat(4000);
    const output = await compact(input, { ask: async (_s, q) => answers(q, 0) },
      { maxStateTokens: 300, maxRequestTokens: 1000, preserveRecentMessages: 1, goal: 'g' });
    expect(output.stats.unasked).toBe(1);
    expect(output.decisions[0]?.action).toBe('keep');
    expect(output.decisions[1]?.action).toBe('drop_call');
  });
});

// Focused safety guards from upstream PR #40/#41/#42/#49, not threshold changes.
describe('fail-closed pairing and probabilities', () => {
  it.each(['duplicate use', 'duplicate result', 'result before call'] as const)(
    'rejects %s before dispatch, without changing the original transcript', async (kind) => {
      const input = long(2);
      let error: RegExp;
      if (kind === 'duplicate use') {
        input[5]!.toolUses[0]!.tool_use_id = 'w0';
        // The first call cannot be safely scored; the second would vote to
        // delete it via the shared ID if this validation were missing.
        input[2]!.text = 'important historical facts '.repeat(4000);
        error = /Duplicate tool_use_id/;
      } else if (kind === 'duplicate result') {
        input[6]!.toolResults![0]!.tool_use_id = 'w0';
        error = /Duplicate tool_result/;
      } else {
        [input[2], input[3]] = [input[3]!, input[2]!];
        error = /result precedes its call/;
      }
      const original = structuredClone(input);
      let asks = 0;
      await expect(compact(input, { ask: async (_s, q) => { asks++; return answers(q, 0); } },
        { maxStateTokens: 300, maxRequestTokens: 1000, preserveRecentMessages: 1, goal: 'g' }))
        .rejects.toThrow(error);
      expect(asks).toBe(0);
      expect(input).toEqual(original);
    },
  );

  it('rejects duplicate use IDs even when one call is pending', async () => {
    const input = long(1);
    input.push({ role: 'assistant', text: '', toolUses: [{ tool_use_id: 'w0', tool: 'Read', input: {} }] });
    let asks = 0;
    await expect(compact(input, { ask: async (_s, q) => { asks++; return answers(q, 0); } },
      { preserveRecentMessages: 0 })).rejects.toThrow(/Duplicate tool_use_id/);
    expect(asks).toBe(0);
  });

  it.each([-1, 1.1, NaN, Infinity])('rejects invalid probability %s without resizing or deletion', async (score) => {
    const input = long(2);
    const original = structuredClone(input);
    let asks = 0;
    await expect(compact(input, { ask: async (_s, q) => { asks++; return answers(q, score); } },
      { preserveRecentMessages: 1 })).rejects.toThrow(/Invalid Jev answer/);
    expect(asks).toBe(1);
    expect(input).toEqual(original);
    expect(() => decideCall(candidate(1), { keepCall: score, keepResult: 0 }, { keepThreshold: 0.5 }))
      .toThrow(/Invalid keep probabilities/);
    expect(() => decideCall(candidate(1), { keepCall: 0, keepResult: score }, { keepThreshold: 0.5 }))
      .toThrow(/Invalid keep probabilities/);
  });

  it.each([
    ['null', null], ['number', 0], ['string', 'no'], ['array', []],
    ['wrong discriminator', { type: 'choice', noul: 0 }],
    ['inherited probability', Object.create({ noul: 0 })],
  ])('rejects an invalid answer shape: %s', (_name, answer) => {
    expect(() => noulAnswer({ x: answer } as never, 'x')).toThrow(/Invalid Jev answer/);
  });

  it('rejects inherited answers and array-shaped response maps', () => {
    expect(() => noulAnswer(Object.create({ x: { noul: 0 } }), 'x')).toThrow(/Invalid Jev answer/);
    expect(() => parseJevResponse(200, true, '{"answers":[]}')).toThrow(/missing answers/);
    expect(() => parseJevResponse(200, true, '[]')).toThrow(/missing answers/);
  });

  it.each([-1, 1.1, NaN, Infinity])('guards exported decideCall against invalid threshold %s', (threshold) => {
    expect(() => decideCall(candidate(1), { keepCall: 1, keepResult: 1 }, { keepThreshold: threshold }))
      .toThrow(/keepThreshold/);
  });

  it('accepts exact probability endpoints', async () => {
    for (const score of [0, 1]) {
      const output = await compact(long(1), { ask: async (_s, q) => answers(q, score) }, { preserveRecentMessages: 1 });
      expect(output.decisions[0]?.action).toBe(score === 0 ? 'drop_call' : 'keep');
    }
  });

  it('does not let exported applyDecisions delete a pinned call', () => {
    const input = long(1);
    const calls = collectToolCalls(input, input.length);
    const decisions = calls.map((c) => ({ id: c.id, tool: c.tool, keepCall: 0, keepResult: 0,
      action: 'drop_call' as const, reason: 'call_dropped' as const }));
    expect(applyDecisions(input, decisions, calls, 0)).toEqual(input);
  });
});

describe('structured oversize recovery', () => {
  it('recognizes only a structured HTTP 400 max_tokens_exceeded', () => {
    expect(isTokenLimitError(oversized())).toBe(true);
    expect(isTokenLimitError(new JevRequestError(400, 'max_tokens_exceeded'))).toBe(false);
    expect(isTokenLimitError(new JevRequestError(500, '{"detail":{"error_type":"max_tokens_exceeded"}}'))).toBe(false);
    expect(isTokenLimitError(new Error('max_tokens_exceeded'))).toBe(false);
    const error = new JevRequestError(400, JSON.stringify({ padding: 'x'.repeat(400), detail: { error_type: 'max_tokens_exceeded' } }));
    expect(isTokenLimitError(error)).toBe(true);
    expect(() => parseJevResponse(400, false, '{"detail":{"error_type":"max_tokens_exceeded"}}')).toThrow(JevRequestError);
  });

  it('rebuilds smaller payloads through the actual HTTP client, then applies complete answers', async () => {
    const bodies: Array<{ tokens: number; rejected: boolean }> = [];
    const input = long(40);
    const original = structuredClone(input);
    const client = new JevClient({ apiKey: 'offline-test', fetch: (async (_url, init) => {
      const body = String(init?.body);
      const payload = JSON.parse(body);
      assertLimits(payload.state, payload.questions, 64_000);
      const tokens = estimateTokens(body);
      const rejected = tokens > 2000;
      bodies.push({ tokens, rejected });
      return rejected
        ? new Response('{"detail":{"error_type":"max_tokens_exceeded"}}', { status: 400 })
        : new Response(JSON.stringify(answers(payload.questions)), { status: 200 });
    }) as typeof fetch });
    const output = await compact(input, client, { preserveRecentMessages: 1 });
    expect(output.stats.retries).toBeGreaterThan(0);
    expect(output.stats.retries).toBeLessThanOrEqual(3);
    expect(output.stats.requests).toBe(bodies.length);
    expect(bodies.some((body) => body.rejected)).toBe(true);
    expect(bodies.some((body) => !body.rejected)).toBe(true);
    expect(bodies.at(-1)!.tokens).toBeLessThan(bodies[0]!.tokens);
    expect(output.messages).toEqual(original);
    expect(input).toEqual(original);
  });

  it('stops after the configured retry bound without changing input', async () => {
    const input = long(40);
    const original = structuredClone(input);
    let asks = 0;
    await expect(compact(input, { ask: async () => { asks++; throw oversized(); } },
      { preserveRecentMessages: 1, maxTokenRetries: 1, maxConcurrentRequests: 1 }))
      .rejects.toThrow(/max_tokens_exceeded/);
    expect(asks).toBe(2);
    expect(input).toEqual(original);
  });

  it('supports opting out of payload retries', async () => {
    let asks = 0;
    await expect(compact(long(2), { ask: async () => { asks++; throw oversized(); } },
      { preserveRecentMessages: 1, maxTokenRetries: 0 })).rejects.toThrow(/max_tokens_exceeded/);
    expect(asks).toBe(1);
  });

  it.each([401, 403, 500, 429, 400])('does not retry unrelated HTTP %i failures', async (status) => {
    let asks = 0;
    await expect(compact(long(2), { ask: async () => {
      asks++;
      throw new JevRequestError(status, '{"detail":{"error_type":"other_error"}}');
    } }, { preserveRecentMessages: 1 })).rejects.toThrow(`(${status})`);
    expect(asks).toBe(1);
  });

  it('does not retry malformed answers', async () => {
    let asks = 0;
    await expect(compact(long(2), { ask: async () => { asks++; return { answers: {} }; } },
      { preserveRecentMessages: 1 })).rejects.toThrow(/Invalid Jev answer/);
    expect(asks).toBe(1);
  });
});

describe('bounded dispatch and cancellation', () => {
  it('bounds concurrency and waits for rejected work before rebuilding', async () => {
    let asks = 0;
    let active = 0;
    let peak = 0;
    let rejectedActive = 0;
    const output = await compact(long(100), { ask: async (_state, q) => {
      const number = ++asks;
      if (number > 2) expect(rejectedActive).toBe(0);
      active++;
      peak = Math.max(peak, active);
      if (number <= 2) rejectedActive++;
      await new Promise((resolve) => setTimeout(resolve, number === 1 ? 1 : 5));
      active--;
      if (number <= 2) { rejectedActive--; throw oversized(); }
      return answers(q);
    } }, { maxStateTokens: 1000, maxRequestTokens: 1500, preserveRecentMessages: 1, maxConcurrentRequests: 2 });
    expect(peak).toBe(2);
    expect(active).toBe(0);
    expect(output.stats.retries).toBe(1);
    expect(output.stats.requests).toBe(asks);
  });

  it('stops queued work on failure and does not return partial decisions', async () => {
    const input = long(100);
    const original = structuredClone(input);
    let asks = 0;
    await expect(compact(input, { ask: async (_state, q) => {
      const number = ++asks;
      await new Promise((resolve) => setTimeout(resolve, number === 1 ? 1 : 10));
      if (number === 1) throw new JevRequestError(401, 'bad key');
      return answers(q, 0);
    } }, { maxStateTokens: 1000, maxRequestTokens: 1500, preserveRecentMessages: 1, maxConcurrentRequests: 2 }))
      .rejects.toThrow(/401/);
    expect(asks).toBe(2);
    expect(input).toEqual(original);
  });

  it('does not hide a simultaneous authentication failure behind size recovery', async () => {
    let asks = 0;
    await expect(compact(long(100), { ask: async () => {
      const number = ++asks;
      await new Promise((resolve) => setTimeout(resolve, number === 1 ? 1 : 5));
      if (number === 1) throw oversized();
      throw new JevRequestError(401, 'bad key');
    } }, { maxStateTokens: 1000, maxRequestTokens: 1500, preserveRecentMessages: 1, maxConcurrentRequests: 2 }))
      .rejects.toThrow(/401/);
    expect(asks).toBe(2);
  });

  it('discards successful partial answers from a failed plan before retrying', async () => {
    const input = long(100);
    const original = structuredClone(input);
    let asks = 0;
    const output = await compact(input, { ask: async (_s, q) => {
      const number = ++asks;
      if (number === 2) throw oversized();
      return answers(q, number === 1 ? 0 : 1);
    } }, { maxStateTokens: 1000, maxRequestTokens: 1500, preserveRecentMessages: 1, maxConcurrentRequests: 1 });
    expect(output.stats.retries).toBe(1);
    expect(asks).toBeGreaterThan(2);
    expect(output.decisions.every((d) => d.action === 'keep')).toBe(true);
    expect(output.messages).toEqual(original);
    expect(input).toEqual(original);
  });

  it('never dispatches for an already-aborted operation', async () => {
    const controller = new AbortController();
    controller.abort();
    let asks = 0;
    await expect(compact(long(2), { ask: async (_s, q) => { asks++; return answers(q); } },
      { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(asks).toBe(0);
  });

  it('does not retry a size error when cancellation arrives during the request', async () => {
    const controller = new AbortController();
    let asks = 0;
    await expect(compact(long(2), { ask: async () => {
      asks++;
      controller.abort();
      throw oversized();
    } }, { signal: controller.signal, preserveRecentMessages: 1 }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(asks).toBe(1);
  });

  it('does not apply successful answers after cancellation', async () => {
    const controller = new AbortController();
    const input = long(2);
    const original = structuredClone(input);
    await expect(compact(input, { ask: async (_s, q) => {
      controller.abort();
      return answers(q, 0);
    } }, { signal: controller.signal, preserveRecentMessages: 1 }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(input).toEqual(original);
  });

  it('forwards the AbortSignal through JevClient to fetch', async () => {
    const controller = new AbortController();
    const client = new JevClient({ apiKey: 'offline-test', signal: controller.signal,
      fetch: (async (_url, init) => {
        expect(init?.signal).toBe(controller.signal);
        return new Response('{"answers":{}}');
      }) as typeof fetch });
    await client.ask('state', {});
  });
});
