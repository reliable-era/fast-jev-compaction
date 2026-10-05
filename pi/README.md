# fast-jev-compaction for pi

A [pi](https://github.com/earendil-works/pi-mono) extension that takes over
pi's context compaction the same way the Claude Code plugin does: instead of
asking the conversation model to write a lossy summary of old turns, it asks
TypeSafe's Jev model whether each tool call and each tool result still needs
to stay. Stale calls/results are removed or truncated; everything else is
kept verbatim.

## How it maps onto pi

pi's compaction replaces the context with
`summary + real messages from firstKeptEntryId`. The extension keeps pi's
kept window (the recent ~20k tokens) untouched as real messages and writes
the **old region into the summary as a verbatim serialized transcript**,
minus what Jev drops:

- Each fitting `tool_use`/`tool_result` pair before the kept window is scored
  by Jev (two `noul` questions each). Pairs that cannot fit safely remain unscored
  and are kept.
- Dropped calls disappear together with their results; dropped results keep
  a bounded head plus a re-run note; everything kept is reproduced
  word-for-word (user text, assistant text, assistant thinking, tool inputs
  and kept tool outputs).
- The whole branch is re-examined on every compaction, so tool results that
  were kept in an earlier round can be pruned in a later one — nothing is
  ever frozen as text. (pi's session entries are append-only; the extension
  reconstructs from them each time.)
- Jev token usage and the decision log are stored in the compaction entry's
  `details.fastJev`; Jev usage is not added to Pi's model-spend ledger.

**Long histories and oversized requests:** the shared core first tries a global
state with question capacity reserved. If it cannot fit, or would require
collapsed text/one-line calls, it recursively scores smaller history windows.
Each window carries the task goal, first message, recent pinned context and
its own history span. Unfittable singleton candidates stay untouched. On HTTP
400 `max_tokens_exceeded`, it rebuilds with smaller budgets (up to three
resizing retries). Only this structured size error is retried; other errors
still fall back. The compaction AbortSignal stops queued work and retries.
Jev requests run with at most four concurrent batches.

The library and Pi defaults are 28000 state / 56000 whole-request estimated
tokens. Both Jev limits are enforced independently: 32k for state plus the
longest question, 64k for the entire request. Overrides cannot bypass them.
Estimates and windowing do not guarantee downstream evidence preservation.
Recovery diagnostics are stored in `details.fastJev.jev`: `requests` counts
all dispatched attempts, `retries` counts resizing rounds, `windows` counts
final-plan windows (zero for a global state), and `unasked` counts candidates
kept without scoring. Retry/concurrency options are currently library-only.

**Fallback:** when the API key is missing, when Jev fails, or when the old
region cannot be reduced by at least `minOldReduction` (default 25%), the
extension returns nothing and pi runs its built-in LLM summary — the same
fallback semantics as the Claude Code hook.

## Install

### As a pi package (recommended)

```sh
pi install git:github.com/reliable-era/fast-jev-compaction
```

or in `~/.pi/agent/settings.json`:

```json
{
  "packages": ["git:github.com/reliable-era/fast-jev-compaction"]
}
```

The package manifest (`"pi": { "extensions": ["./pi/index.ts"] }` in
`package.json`) registers `pi/index.ts`. No npm dependencies; pi loads the
TypeScript directly.

### Manual copy

Copy this directory next to `src/` into
`~/.pi/agent/extensions/fast-jev-compaction/` (the extension imports
`../src/index.js`, so the library sources must sit next to it), or use
`pi -e /path/to/repo/pi/index.ts` for a quick test.

### Gallery listing

[pi.dev/packages](https://pi.dev/packages) is generated from the npm registry:
published packages tagged with the `pi-package` keyword appear there
automatically, with the install line taken from the package name and the repo
link from `repository.url`. Both the keyword and the `pi` manifest are already
declared in `package.json`, so publishing is the only remaining step — there is
no submission form.

## Configuration

The API key is read from the environment (`TYPESAFE_API_KEY`) and is **never
written to the session or any repo file**. Options come from, in increasing
precedence:

1. `~/.pi/agent/fast-jev-compaction.json` (global)
2. `<project>/.pi/fast-jev-compaction.json` (project)
3. Environment variables

```jsonc
{
  "apiKey": "optional; overrides the environment",
  "model": "jev-latest",
  "keepThreshold": 0.5,
  "maxStateTokens": 28000,
  "maxRequestTokens": 56000,
  "truncateHeadChars": 300,
  "minOldReduction": 0.25,
  "dropThinking": false,
  "notify": true,
  "disabled": false
}
```

| Environment variable | Effect |
| --- | --- |
| `TYPESAFE_API_KEY` | API key (fallback) |
| `FAST_JEV_API_KEY` | API key (wins over `TYPESAFE_API_KEY`, loses to file) |
| `FAST_JEV_MODEL` / `FAST_JEV_BASE_URL` / `FAST_JEV_GOAL` | Overrides |
| `FAST_JEV_KEEP_THRESHOLD` / `FAST_JEV_TRUNCATE_HEAD_CHARS` / `FAST_JEV_MIN_OLD_REDUCTION` | Numeric overrides |
| `FAST_JEV_MAX_STATE_TOKENS` / `FAST_JEV_MAX_REQUEST_TOKENS` | Request ceilings; Pi defaults to 28000/56000. Jev 1.13 documents 64k tokens per request and 32k for state plus the longest question, so these defaults keep margin for estimator error. |
| `FAST_JEV_DROP_THINKING=1` | Omit assistant thinking from the transcript |
| `FAST_JEV_NOTIFY=0` | Silence toasts |
| `FAST_JEV_DISABLE=1` | Kill switch: use pi's built-in compaction |

## Verifying

- `npm test` — offline unit tests (fake Jev, no network).
- `npm run typecheck` — includes `tsc -p tsconfig.pi.json` against
  `types/pi.d.ts` (the ambient pi surface, mirroring `types/claude-code.d.ts`).
- `pi/e2e.ts` — manual live check that drives the extension through pi's
  real compaction machinery with one real Jev call. Requires
  `npm install @earendil-works/pi-coding-agent` and `TYPESAFE_API_KEY`:

  ```sh
  npx tsx pi/e2e.ts
  ```
