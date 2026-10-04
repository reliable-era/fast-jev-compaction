# fast-jev-compaction — reliable-era Pi extension fork

This fork adapts [`tamaratran/fast-jev-compaction`](https://github.com/tamaratran/fast-jev-compaction) for the **Pi coding-agent harness** while keeping the original library and Claude Code plugin intact.

The important delta is not a new summarizer. It is a Pi extension that lets Pi compaction preserve old context as a Jev-pruned, mostly-verbatim transcript instead of relying only on an LLM-written summary.

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

This preserves exact user/assistant text, commands, paths, errors, constraints, and retained tool outputs better than a normal lossy summary, while still reducing context size.

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

or run the explicit command registered by the extension:

```text
/fast-jev-compact
```

## How we evaluated it

### Static/type checks

```sh
npm run typecheck
```

This runs:

```text
tsc --noEmit
tsc -p tsconfig.hooks.json
tsc -p tsconfig.pi.json
```

### Offline tests

```sh
npm test
```

Current result:

```text
Test Files  4 passed
Tests       48 passed
```

Coverage includes:

- original library behavior;
- Claude Code hook adapter behavior;
- Pi branch conversion and old/kept-region splitting;
- Jev decision application for Pi;
- verbatim old-region serialization;
- fallback behavior when Jev fails or reduction is too small;
- config precedence;
- reliable-era package/README wiring.

### Pi package/load check

The extension was installed into Pi:

```sh
pi install git:github.com/reliable-era/fast-jev-compaction
pi update --extensions
```

And load-checked with:

```sh
pi --no-extensions -e git:github.com/reliable-era/fast-jev-compaction --list-models __fast_jev_load_check__
```

Expected/observed successful behavior:

```text
No models matching "__fast_jev_load_check__"
exit code 0
```

That command does not need the extension to provide a model; it verifies Pi can install and load the package without crashing.

### tmux dispatch

The validation run was dispatched in the `pi_plugin` tmux session/window:

```text
session: pi_plugin-32
window:  fastjev-test
```

It ran:

```sh
npm run typecheck
npm test
pi --no-extensions -e git:github.com/reliable-era/fast-jev-compaction --list-models __fast_jev_load_check__
```

and completed successfully.

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

`npm run e2e:pi` requires `@earendil-works/pi-coding-agent` to be available in the local development environment.
