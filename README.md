# fast-jev-compaction — reliable-era Pi extension fork

This fork adapts [`tamaratran/fast-jev-compaction`](https://github.com/tamaratran/fast-jev-compaction) for the **Pi coding-agent harness** while keeping the original library and Claude Code plugin intact.

The important delta is not a new summarizer. It is a Pi extension that lets Pi compaction preserve old context as a Jev-pruned, mostly-verbatim transcript instead of relying only on an LLM-written summary.

**Evaluation status:** three public benchmark subsets have been selected, but official task episodes and live Jev quality/cost comparisons have not been run. Benchmark results below are **TBD**, not measured scores. See [the evaluation protocol and metric definitions](evaluation.md).

## What we updated

### 1. Added Pi extension support

This fork includes the Pi integration from upstream PR #22 and publishes it through the package manifest:

```json
{
  "pi": {
    "extensions": ["./pi/index.ts"]
  }
}
```

Main files:

```text
pi/index.ts       # Pi extension hook registration
pi/core.ts        # Pi-specific conversion, config, Jev orchestration, serialization
types/pi.d.ts     # Ambient Pi type surface for offline typecheck/tests
pi/README.md      # Pi-specific behavior/config docs
tests/pi.test.ts  # Offline Pi compaction behavior tests
```

### 2. Adapted package metadata for reliable-era

The package metadata now points to this fork:

```text
https://github.com/reliable-era/fast-jev-compaction
```

Pi install command:

```sh
pi install git:github.com/reliable-era/fast-jev-compaction
```

### 3. Added fork/package wiring tests

Added:

```text
tests/pi-package.test.ts
```

It verifies that:

- the package is discoverable as a Pi package;
- `pi.extensions` points to `./pi/index.ts`;
- `pi/` and `src/` are shipped;
- Pi host packages are optional peers, not bundled runtime dependencies;
- README/package metadata point to `reliable-era`, not the original install path.

### 4. Kept upstream functionality intact

The original pieces remain available:

- npm library under `src/`;
- Claude Code plugin under `hooks/` and `.claude-plugin/`;
- existing compaction algorithm and tests.

## Why we did this

Pi's compaction model is different from Claude Code's.

Claude Code can return a pruned message list from the hook. Pi compaction instead replaces old context with:

```text
compaction summary + real messages from firstKeptEntryId onward
```

So the Pi extension cannot simply hand Pi a filtered message array. The practical extension-only solution is:

1. keep Pi's recent kept window untouched as real session messages;
2. convert the older region into the fast-jev message model;
3. ask Jev which tool calls/results remain useful;
4. write the old region into the compaction summary as a **verbatim serialized transcript**, with stale tool calls/results removed or truncated;
5. fall back to Pi's built-in compaction if Jev is unavailable or reduction is insufficient.

On the selective path, retained user/assistant text, tool inputs, and kept tool outputs are serialized without LLM rewriting. Removed or truncated outputs can still contain necessary evidence, and summary fallback does not have this verbatim property. Whether this improves task success or total cost over a normal summary is an evaluation question, not an established result.

Jev's decision state includes conversation text, tool metadata, and output length/error status, but **not the full tool-output payload**. Re-running a tool or re-reading a file may not recover an earlier observation after the source changes.

## How to use in Pi

Install/update the extension:

```sh
pi install git:github.com/reliable-era/fast-jev-compaction
# later updates:
pi update --extensions
```

Make sure a TypeSafe key is available by one of:

```sh
export TYPESAFE_API_KEY=...
```

or Pi auth/config as described in [`pi/README.md`](pi/README.md).

Then use Pi normally:

```text
/compact
```

The current Pi entry point intercepts Pi's compaction event; it does not register a separate `/fast-jev-compact` command. Pi's kept window remains real messages, while the pruned older region is stored in the compaction summary.

## Evaluation

We evaluate fast-Jev as a **context-management component inside a tool-using agent**, not as a standalone task-solving model. The primary question is whether it reduces the total cost of verified task completion without unacceptable loss of task success or critical evidence.

### Small-first benchmark pilot

At most three representative benchmarks are selected. Each uses a uniform random 10% sample without replacement, with fractional counts rounded up and master seed `20261004`.

| Order | Benchmark | Population | Selected | Purpose | Task results |
| --- | --- | ---: | ---: | --- | --- |
| 1 | [LOCA-bench](https://github.com/hkust-nlp/LOCA-bench), 8K preset | 75 task/environment-seed cases | 8 | Controlled context growth; smallest integration setting first | TBD |
| 2 | [Terminal-Bench 2.0](https://github.com/harbor-framework/terminal-bench-2) | 89 tasks | 9 | Shell/tool workflows with executable verifiers | TBD |
| 3 | [SWE-bench Verified](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified), test split | 500 issues | 50 | Real repository repair with official patch grading | TBD |

This is **67 cases per condition**, or 268 episodes for four conditions and one repetition. Those episodes have not been run. The 8K LOCA setting may not trigger compaction; a separately registered 32K pressure condition can reuse the same eight family/seed IDs. A uniform pilot is not a balanced sample or an official full-suite score.

Compare raw history, cheap age-based output masking, LLM summarization, and fast-Jev with its recorded summary fallback. Keep the actor model, tools, task IDs, context window, and episode limits fixed. Evaluate the portable library and native Pi/Claude Code integrations as separately identified profiles.

### Metrics and result placeholders

| Metric group | Main measurements | Results |
| --- | --- | --- |
| Task quality | Official success/accuracy, paired success difference, timeout/overflow outcomes | TBD |
| End-to-end efficiency | Total cost, cost per solved task, actor/selector/summary usage, cache effects | TBD |
| Context reduction | Fully serialized actor-request tokens before/after; character reduction reported separately | TBD |
| Latency | Episode wall time and compaction p50/p95, including network/scoring time | TBD |
| Evidence and recovery | Critical-evidence recall on labeled checkpoints, re-reads, repeated commands, extra turns | TBD |
| Reliability | Trigger coverage, fallback/error rates, pair integrity, cancellation and restart behavior | TBD |

[**evaluation.md**](evaluation.md) defines denominators, formulas, logging requirements, result tables, and planned plots. A smaller transcript or an agent's self-reported completion is not proof of task success. Missing measurements remain unavailable, not zero.

### Offline engineering verification

```sh
npm test
npm run typecheck
npm run build
```

These checks exercise the library, hook adapter, Pi conversion/serialization/fallback logic, configuration, and package wiring. Type checks use the checked-in host declarations; mocked decisions do not establish live Jev scoring quality, benchmark task success, or production host compatibility.

Benchmark preparation and offline checks must be kept separate from paid/live evaluation.

## Configuration notes

Pi-specific config is documented in:

```text
pi/README.md
```

Important controls:

- `TYPESAFE_API_KEY` / `FAST_JEV_API_KEY`
- `FAST_JEV_MODEL`
- `FAST_JEV_KEEP_THRESHOLD`
- `FAST_JEV_MIN_OLD_REDUCTION`
- `FAST_JEV_TRUNCATE_HEAD_CHARS`
- `FAST_JEV_DROP_THINKING`
- `FAST_JEV_DISABLE=1` kill switch

The current library defaults `maxStateTokens` and `maxRequestTokens` to **unlimited** when called directly, but the Pi adapter defaults to `28000` / `56000`. TypeSafe's Models documentation for Jev 1.13 says the official limits are 64k tokens per request and 32k tokens for `state` plus the longest question; the Pi defaults leave margin for estimator error to avoid `max_tokens_exceeded` failures. Explicit finite values still apply. Record the resolved configuration for the evaluated integration rather than assuming all adapters share the same budgets. Pi's real kept window is host-controlled, not necessarily the library's six-message tail.

## Upstream/original behavior

<details>
<summary>Original project summary and inherited behavior</summary>

The upstream project is a Claude Code plugin and npm library that replaces normal compaction summaries with Jev decisions. Every tool call/result is scored; stale ones are dropped or truncated; retained content stays verbatim.

High-level algorithm:

1. Pair each tool call with its tool result by `tool_use_id`.
2. Send Jev a compact state representing the whole conversation.
3. Ask two `noul` questions per non-pinned tool call: whether the call still matters and whether the result still matters verbatim.
4. Apply decisions against `keepThreshold`:
   - keep call and result;
   - keep call but truncate result;
   - or drop call and result.
5. Rebuild the transcript without summarizing user/assistant text.

The npm library exports helpers such as:

- `compactMessages`
- `compact`
- `reductionRatio`
- `collectToolCalls`
- `fitState`
- `batchCalls`
- `decideCall`
- `applyDecisions`

Claude Code plugin files remain under:

```text
hooks/
.claude-plugin/
```

</details>

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

Optional/manual checks:

```sh
npm run validate:plugin
TYPESAFE_API_KEY=... npm run demo
npm run e2e:pi
```

`npm run e2e:pi` requires `@earendil-works/pi-coding-agent` to be available in the local development environment **and makes a real Jev API call**. The demo also uses a live service; they are not part of the offline benchmark warm-up.
