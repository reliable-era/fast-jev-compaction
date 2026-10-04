# Evaluation protocol for fast-jev-compaction

**Status: protocol and result templates; benchmark results are TBD.**

This document evaluates fast-Jev as a context-management component inside a tool-using agent. It does not claim that the compactor solves benchmark tasks, that retained text is sufficient evidence, or that smaller histories necessarily make completed tasks cheaper.

## 1. Objective and evidence boundary

The primary question is:

> Does fast-Jev reduce the end-to-end cost of verified task completion compared with cheap observation masking and summarization, while preserving task success?

Separate three kinds of evidence:

| Evidence level | What it establishes | What it does not establish |
| --- | --- | --- |
| Unit/type/build checks and scripted host tests | Decision application, serialization, fallback, cancellation, package wiring, and selected lifecycle behavior | Live Jev scoring quality or general task success |
| Offline checkpoint replay and synthetic controls | Which known evidence survives particular decisions; local processing overhead | The effect on a real agent's future actions or official task success |
| Live task execution with official graders | Task outcomes, recovery work, operational latency, and total cost | Full-suite or population claims from a small pilot |

Three public benchmark subsets have been frozen: **67 cases per evaluation condition**. No official episodes, paid model comparisons, or measured benchmark tables have been completed for these subsets. All result cells and plot outputs below remain **TBD** until backed by run artifacts. Use `N/A` for a metric that is genuinely inapplicable and `null` for unavailable data in machine-readable reports; neither means zero.

Documentation/source inspection baseline: reliable-era commit `f8a6558e1b1700139843d4fdcc32bca0f0bbad70`. This is not a scored benchmark revision. Freeze the actual code commit and dirty-tree hashes again before each measured run; do not combine evidence from different checkout revisions without labeling it.

### Implementation risks to test

- Jev sees conversation text and tool metadata, including output length and error status, but **not the full tool-output payload**. Equal metadata can conceal very different decisive facts.
- A dropped result normally keeps a bounded head plus an omission note. Facts after that head can be lost.
- Assistant narration can survive deletion of the observations supporting or contradicting it.
- Re-reading a changed file or re-running a transient tool does not necessarily recover a historical observation.
- Every request batch repeats the fitted state. Selector overhead and summary fallback can offset actor-context savings.
- Pi reconstructs the append-only raw branch on later compactions. Measure repeated processing and possible reintroduction of previously removed outputs.
- Character-reduction gates omit some serialized-request overhead. Measure the rebuilt actor request independently.

## 2. Benchmarks and random sampling

### 2.1 Smallest-first selection

“Smallest first” means ascending eligible task count among the three selected suites. Start LOCA with its smallest published environment-size preset.

| Order | Benchmark | Frozen population | Random sample | Actual fraction | Evaluation role |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | [LOCA-bench](https://github.com/hkust-nlp/LOCA-bench), 8K preset | 75 task/environment-seed cases | 8 | 10.67% | Controlled context growth; integration first |
| 2 | [Terminal-Bench 2.0](https://github.com/harbor-framework/terminal-bench-2) | 89 tasks | 9 | 10.11% | Terminal/tool work with executable verification |
| 3 | [SWE-bench Verified](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified), `test` split | 500 issues | 50 | 10.00% | Real issue repair with official patch grading |

**Total: 67 cases per condition; four conditions and one repetition require 268 episodes.** A LOCA pressure follow-up or model repetitions add episodes and must be registered separately. Do not pool the three suites into one success percentage.

ContextBench is deferred as a larger evidence-retention diagnostic; Letta Context-Bench is deferred because its released task population was not verified. Neither is an additional selected suite.

### 2.2 Frozen sources

| Benchmark | Revision | Population definition |
| --- | --- | --- |
| LOCA-bench | `8b6fac49d9edd92922593e703b74ea255357c3ec` | `task-configs/final_8k_set_config.json` |
| Terminal-Bench 2.0 | `2fd12b88aafdd04a52c298e3940bcb189f9766d6` | Top-level task directories containing `task.toml` |
| SWE-bench Verified | `c104f840cc67f8b6eec6f759ebc8b2693d585d4a` | Complete 500-row `default/test` split; dataset-server revision headers validated |

Sampling policy:

1. Master random seed: **`20261004`**. Derive a separate 64-bit seed from SHA-256 of `master_seed:benchmark_key` for each suite.
2. Sort the complete population by stable task ID.
3. Draw `ceil(0.10 × population_size)` cases uniformly **without replacement** using Python `random.Random(derived_seed).sample`.
4. Freeze IDs before inspecting task outcomes. Do not reroll for success, difficulty, resource availability, or family coverage.
5. Preserve original LOCA environment seeds; the sampling seed and model repetition seed are different concepts.
6. Reuse exactly the same task IDs across compared policies. Report unsupported tasks rather than silently replacing them.

The frozen LOCA draw covers 7 of 15 families, and the SWE draw covers 10 repositories. These are coverage descriptions, not guarantees of balanced or statistically representative sampling.

Workspace-only preparation artifacts, outside this package repository:

```text
../evaluation/sample_benchmarks.py
../evaluation/selection/manifest.json
../evaluation/selection/loca-8k.sample.json
../evaluation/selection/terminal-bench-2.sample.json
../evaluation/selection/swe-bench-verified.sample.jsonl
../evaluation/selection/verification.json
```

From the parent workspace, cached selection can be verified without network access:

```sh
python3 evaluation/sample_benchmarks.py
```

These preparation files are not bundled benchmark runners or npm package resources. Keep evaluator-only cached gold data out of the actor's and compactor's workspace.

### 2.3 How each suite evaluates the compactor

**LOCA-bench:** adapt MCP tool calls/results into the compactor's message model and apply the registered context policy during execution. Record the official accuracy output and any documented success threshold. The eight 8K cases are low-pressure integration controls and may never compact. A separately enabled **32K condition using the same eight family/seed IDs** is available for pressure testing. An environment-size preset is not an actor context-window size. Non-triggered tasks stay in the denominator.

**Terminal-Bench:** apply context management to accumulated shell commands, file reads, build/test outputs, and other agent observations. Run tasks in isolated environments using the pinned Harbor runner and each task's verifier. Historical errors and failed attempts are useful evidence-loss diagnoses. Record container/setup failures separately from verifier failures. Task code is not trusted host code; do not run it directly in the development checkout.

**SWE-bench Verified:** give the actor the issue description and repository at its frozen base commit, then compact its investigation/edit/test history. Grade the final patch using the official SWE-bench harness. Reference patches, test patches, PASS/FAIL test labels, and grading feedback must not enter actor or Jev inputs before grading. Sampled task records already exclude gold solution fields.

## 3. Compared policies and integration

### 3.1 Initial four conditions

| ID | Policy | Fixed definition |
| --- | --- | --- |
| R | Raw history | No proactive compaction. Use the same actor window and record overflow as an outcome. |
| M | Age-based output masking | At the common trigger, retain old call inputs/prose and replace eligible results with a bounded head plus an explicit omission note. |
| S | LLM summary | At the common trigger, summarize the old region using a pinned summarizer, fixed prompt/output cap, and common protected region. |
| J | Fast-Jev deployment policy | At the common trigger, apply Jev decisions; invoke the registered summary fallback on errors, insufficient reduction, or inability to fit the actor request. |

Register whether M also uses the same summary fallback when masking is insufficient. Label it “masking + fallback” if so. Report selective-only events and fallback events separately. A larger-window raw reference is a separate diagnostic, not an equal-window competitor.

Use **J versus M** as the initial primary comparison; J versus S and R are secondary. This choice is prospective, not a result.

### 3.2 Common agent pipeline

```text
Frozen task and environment
  -> actor chooses tools
  -> tools return observations
  -> context reaches registered trigger
  -> R / M / S / J policy is applied
  -> actor continues with that rebuilt context
  -> official grader checks the final artifact
  -> task, cost, latency, recovery, and event ledgers are recorded
```

The library entry point is `compact(messages, asker, options)`. An adapter must preserve tool-call IDs, call/result ordering, error flags, pending calls, system instructions, and mixed-content handling. Images and unsupported roles need explicit treatment, not silent disappearance. Validate protected-pair boundaries and keep pending calls intact.

For the portable library comparison, use identical prefix/tail protection across policies: protect the first message and the newest six normalized messages, and protect a pair if either endpoint is protected. Pi instead uses the host's real kept window. Native Pi and Claude Code profiles must preserve their host semantics and be reported separately rather than described as the same six-message experiment.

Do not substitute a fixed prerecorded future trajectory for live continuation. Causal checkpoint comparisons require the same prefix **and a restorable environment snapshot**, with each policy branch resumed independently. Offline replay alone cannot measure downstream task success.

### 3.3 Configuration to freeze before execution

| Item | Required registration |
| --- | --- |
| Actor | Exact model/checkpoint/endpoint, generation settings, context window, tool schemas/permissions |
| Trigger | Same measured-context trigger across managed policies; proposed initial value: 60% of actor window |
| Limits | Per-episode turn, token, wall-time, resource, retry, and concurrency limits; live values TBD |
| Jev | Requested model, response model/revision when exposed, service date, rates, and resolved options |
| Summary | Model, prompt, output cap, retries, usage accounting, and fallback policy |
| Host | Portable runner or native adapter; exact Pi/Claude Code/Harbor/SWE harness version |
| Reproducibility | Code commit, dirty-tree/config hashes, task revision/ID/base commit, environment seed, repetition ID |

Current library/Pi defaults include `keepThreshold = 0.5`, `truncateHeadChars = 300`, and **unlimited local state/request ceilings when unset**. Pi's default minimum old-region character reduction is `0.25`. The Claude Code plugin manifest declares finite `25000` / `30000` budgets. Record resolved values, not historical defaults copied from another revision. Unlimited local ceilings do not imply an unlimited service request size, actor window, or spending budget. `jev-latest` is a moving alias; capture response metadata and execution date if an immutable revision cannot be requested.

Standalone compactor experiments must not simultaneously enable a changing goal supervisor or other continuation policy. Keep pi-goal evaluation separate; combined interaction experiments are a later, separately controlled study.

## 4. Metrics

### 4.1 Task quality and exposure

| ID | Metric | Definition and denominator | Interpretation |
| --- | --- | --- | --- |
| Q1 | Verified task success | `passed / assigned` using the official task grader. Show assigned, started, graded, passed, failed, timed-out, overflowed, unsupported, and infrastructure-error counts. Ungraded cases are not passes. | Primary pilot quality outcome; not a full-suite leaderboard score |
| Q2 | LOCA accuracy | Report the official per-task accuracy and documented threshold, if used; disclose missing/ungraded values and coverage. Do not invent a binary threshold. | Preserve partial correctness information |
| Q3 | Paired success difference | `success_rate(J) - success_rate(M)` in percentage points on the same assigned IDs; show all discordant pairs. | Task-level trade-off, with uncertainty |
| Q4 | Trigger coverage | `tasks with >=1 compaction / assigned`; separately report compactions per task and candidate counts. | Establish whether tasks actually tested compaction |
| Q5 | Timeout/overflow rates | Each cause divided by assigned tasks; distinguish actor overflow, selector limits, and episode deadlines. | Raw history can fail at the same context limit |

Report grader outcomes among graded cases as a secondary diagnostic, with its different denominator explicit. Keep setup/infrastructure errors visible and provide a sensitivity analysis rather than silently dropping them. Safe stopping, an assistant's completion claim, and a correct final artifact are different outcomes.

### 4.2 End-to-end cost and model usage

| ID | Metric | Definition | Required accounting |
| --- | --- | --- | --- |
| C1 | Total cost per task | Sum every actor, selector, summary, retry, recovery, and separately billed execution charge for the assigned episode. | Include failed tasks and fallback calls |
| C2 | Cost per solved task | `sum(cost over all assigned tasks) / number passed`; undefined if no task passes. | Do not calculate using only successful episodes |
| C3 | Paired cost reduction | Compare J and M on the same tasks; report absolute differences and aggregate `1 - total_cost(J)/total_cost(M)` when the denominator is positive. | Lower cost from abandonment is not evidence of efficiency |
| C4 | Usage ledger | Per service/model: uncached input, cache reads, cache writes, output, and reasoning usage when available. | Avoid double-counting provider totals or reasoning already included in output |
| C5 | Selector/fallback overhead | Separate Jev and summary tokens/cost, request batches, retries, and fallback reasons. | A cheaper actor request may still yield a more expensive episode |
| C6 | Cache behavior | Provider-reported cache categories and, if available, prefill time/hardware utilization. | A changed prefix is only a diagnostic unless actual cache impact is measured |

For each call, use the provider's billing semantics and rates on the execution date:

```text
call_cost = uncached_input * input_rate
          + cache_read * cache_read_rate
          + cache_write * cache_write_rate
          + generated_output * output_rate
          + separately_billed_items

episode_cost = sum(call_cost) + separately_billed_execution
```

Convert per-million-token rates consistently. Do not add reasoning twice, sum overlapping “input” and cache fields, or treat different tokenizers as one universal compute measure. Missing usage/rates make the affected total unavailable; expose partial ledgers with coverage rather than inventing zero. In particular, zero-valued cost fields in a host adapter are not proof that Jev requests are free. For local inference, report runtime/hardware consumption and only calculate money if a defensible rate is registered.

### 4.3 Context reduction and state fitting

| ID | Metric | Definition | Caveat |
| --- | --- | --- | --- |
| T1 | Actor-request token reduction | At each event, `1 - tokens_after/tokens_before` for the fully serialized actor request, including system text, tools, labels, separators, summary header, and retained tail. | Use the target actor tokenizer or clearly label estimates; report negative reductions |
| T2 | Retained-context size | Absolute tokens before/after plus p50/p95 and peak context over the episode. | Compression ratio alone hides different starting sizes |
| T3 | Character reduction | Library/adapter character statistic, reported separately from T1. | Not billed-token savings; adapter formatting may be uncounted |
| T4 | Decision distribution | Counts of kept pairs, truncated results, dropped pairs, and protected pairs. | Preserve denominators: candidates versus all pairs |
| T5 | State-fitting/batch overhead | Fitting stage, state estimate, batches, and total estimated repeated-state tokens `sum(state_tokens_per_request)`. | Estimated repeated-state tokens are not provider-exact billing |
| T6 | Token-estimation error | Compare heuristic and observed/tokenizer counts for the same serialized input; report signed and absolute relative error. | No calibration claim without matched observations |

For compression-versus-quality curves, compare methods at matched **retained actor-context token budgets** with identical protected items, and record actual size plus target deviation. Threshold variants need not hit the same size. Any early payload-only or character-budget study must be labeled a derived diagnostic, not an equal-provider-token comparison.

### 4.4 Latency and recovery

| ID | Metric | Definition | Reporting |
| --- | --- | --- | --- |
| L1 | Episode latency | Wall time from episode start through grading; separate setup/build time. | Median, p95, sample count, and timeouts |
| L2 | Compaction latency | Full policy-event wall time: preparation, Jev/summary network and inference, rebuilding, and fallback. | p50/p95 by policy/benchmark and selective/fallback path |
| L3 | Actor latency | Prefill/first-token and generation time where exposed. | Unavailable if serving telemetry is absent |
| L4 | Recovery actions | Trace-linked re-reads/repeated commands needed because evidence was removed or truncated. | Distinguish necessary recovery from normal repeated testing |
| L5 | Recovery burden | Recovery tokens/cost/time and extra actor turns per task. | Recovery cost is already included in C1, not added twice |

Local microbenchmarks with an immediately resolving scripted asker measure only local processing overhead. They must not be presented as Jev service latency. Parallel batch durations are not summed to obtain event wall time; still count the usage/cost of every batch.

### 4.5 Evidence preservation and reliability

| ID | Metric | Definition | Evidence requirement |
| --- | --- | --- | --- |
| E1 | Critical-evidence recall | `retained necessary facts/spans / necessary facts/spans observed before the checkpoint` on a labeled subset. | Evaluator-only labels; exclude facts already duplicated in other retained content when studying output-only loss |
| E2 | Exact historical-value recovery | Correct answers/artifacts for non-repeatable values, changed file versions, and exact identifiers. | Full-context positive control must be solvable |
| E3 | Constraint/attempt retention | Whether the continued agent respects task constraints and avoids forgotten failed approaches. | Grade executable actions/artifacts, not narrative assurances |
| R1 | Fallback/error rates | Fallback events and selector/parse failures divided by compaction attempts, categorized by cause. | Attempt denominator includes canceled/failed attempts, with categories shown |
| R2 | Pair/serialization integrity | Orphan, duplicate, invalid-order, or protected-pair violations per checked event. | Allow legitimate pending calls; do not fabricate missing results |
| R3 | Cancellation/stop correctness | No accepted compaction after cancellation and no unauthorized continuation. | Fault injection or real host observation, labeled separately |
| R4 | Repeated compaction/restart behavior | Requests, context size, retained evidence, and prior-output reintroduction across later rounds/reopen. | Freeze scorer responses for determinism tests; live variability is a different experiment |

The selected suites do not automatically provide gold memory labels. E1 requires synthetic controls or additional evaluator-only annotations and is **diagnostic**, not an official LOCA/Terminal/SWE score. A removed relevant item does not by itself prove a downstream failure; trace-link that loss to continued actions and the grader outcome. Do not infer a hallucination rate from message-record counts or injected bad decisions.

## 5. Result tables — TBD

### Table A. Task quality and compaction exposure

| Benchmark | Policy | Assigned | Graded | Passed | Verified success | LOCA accuracy | Tasks compacted | Timeouts/overflows |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| LOCA 8K | R | 8 | TBD | TBD | TBD | TBD | TBD | TBD |
| LOCA 8K | M | 8 | TBD | TBD | TBD | TBD | TBD | TBD |
| LOCA 8K | S | 8 | TBD | TBD | TBD | TBD | TBD | TBD |
| LOCA 8K | J | 8 | TBD | TBD | TBD | TBD | TBD | TBD |
| Terminal-Bench 2.0 | R | 9 | TBD | TBD | TBD | N/A | TBD | TBD |
| Terminal-Bench 2.0 | M | 9 | TBD | TBD | TBD | N/A | TBD | TBD |
| Terminal-Bench 2.0 | S | 9 | TBD | TBD | TBD | N/A | TBD | TBD |
| Terminal-Bench 2.0 | J | 9 | TBD | TBD | TBD | N/A | TBD | TBD |
| SWE-bench Verified | R | 50 | TBD | TBD | TBD | N/A | TBD | TBD |
| SWE-bench Verified | M | 50 | TBD | TBD | TBD | N/A | TBD | TBD |
| SWE-bench Verified | S | 50 | TBD | TBD | TBD | N/A | TBD | TBD |
| SWE-bench Verified | J | 50 | TBD | TBD | TBD | N/A | TBD | TBD |

“Assigned” is the planned sample size, not a count of completed runs. Add unsupported and infrastructure-error counts alongside this table. Add LOCA 32K rows only if that condition is explicitly enabled.

### Table B. End-to-end efficiency

Fill one row per benchmark/policy; do not mix service-token counts or average different suites into a universal score.

| Benchmark / policy | Total cost | Cost/solved | Actor usage | Jev usage | Summary usage | Episode p50/p95 | Compaction p50/p95 | Actor-request token reduction |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LOCA 8K / R, M, S, J — separate rows | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Terminal-Bench 2.0 / R, M, S, J — separate rows | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| SWE-bench Verified / R, M, S, J — separate rows | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

### Table C. Evidence, recovery, and operational failures

| Benchmark / policy | Labeled checkpoints | Critical recall | Recovery actions/cost | Compaction attempts | Fallbacks/reasons | Integrity violations | Restart/repeated-compaction outcomes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LOCA / each managed policy | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Terminal-Bench / each managed policy | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| SWE-bench / each managed policy | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Explicitly synthetic controls | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

### Table D. Paired primary comparison: J versus M

| Benchmark | Paired tasks | Success difference, pp [CI] | Absolute cost difference [CI] | Relative total-cost reduction [CI] | Discordant outcomes | Conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| LOCA, by pressure setting | TBD | TBD | TBD | TBD | TBD | TBD |
| Terminal-Bench 2.0 | TBD | TBD | TBD | TBD | TBD | TBD |
| SWE-bench Verified | TBD | TBD | TBD | TBD | TBD | TBD |

## 6. Planned plots — TBD

| Figure | Plot | Axes / grouping | Status |
| --- | --- | --- | --- |
| 1 | Correctness–compression curve | X: actual retained actor-context tokens; Y: verified success or labeled evidence recall; separate panels by benchmark and policy | TBD |
| 2 | Cost–quality trade-off | X: end-to-end cost per assigned task; Y: verified success; show uncertainty and raw totals | TBD |
| 3 | Cost breakdown | Stacked actor/Jev/summary/retry usage or cost; recovery tagged without double-counting | TBD |
| 4 | Compaction latency distribution | Event wall-time ECDF or box plot; distinguish selective and fallback paths; show event counts | TBD |
| 5 | LOCA pressure response | X: registered environment-size preset; Y: accuracy, trigger coverage, and cost; same family/seed pairs | TBD |
| 6 | Evidence-loss and recovery | Critical recall versus actual retained size; companion recovery counts/cost | TBD |
| 7 | Reliability/state-fitting breakdown | Fallback reasons, fitting stages, batch counts, and repeated-state overhead | TBD |

No plots are generated from fabricated numbers. A setting with no compaction events has an inapplicable compaction-latency distribution, not zero latency.

## 7. Execution, logging, and analysis

### 7.1 Staged execution

1. **Warm up the benchmark machinery:** known-correct and deliberately failing grader controls, message round trips, protected/pending pairs, token accounting, and canceled/fallback events. Do not expose reference solutions to the actor or Jev.
2. Preserve the requested project order: evaluate **pi-goal first**, then **fast-jev-compaction**. Earlier offline extension checks are not official results for these subsets.
3. Start the fast-Jev task pilot with the **eight LOCA 8K cases**. Register trigger exposure and enable a paired pressure condition separately if justified.
4. Continue with **nine Terminal-Bench tasks**, then **50 SWE-bench issues**, using frozen comparison conditions and IDs.
5. Inspect failures and telemetry coverage before expanding or tuning. If tuning on pilot cases, label the results exploratory; a later confirmatory study requires disjoint held-out cases.

Official runs require a specified actor/endpoint, approved API spend or local compute budget, isolated runner/dependency setup, and safe task sandboxes. Do not resume private research jobs, change shared servers, or interpret existing credentials as approval. Unsupported tasks and blocked setup paths remain recorded outcomes, not replacement opportunities.

### 7.2 Required run artifacts

Store, with secrets removed:

- Run manifest: code/dirty-tree hashes, benchmark and harness revisions, sample IDs, actor/selector/summarizer configuration, rates, limits, seeds, and timestamps.
- Episode outcome ledger: assignment/start/grade status, official grader outputs, final artifact identifier, errors, and exit reason.
- Per-call usage/cost ledger: service/model, mutually exclusive usage categories, retry/fallback links, and availability flags.
- Per-compaction events: trigger, protected boundary, candidate/decision counts, fitted-state stage, batches, actor-request sizes, wall time, fallback/cancel reason, and context hashes.
- Trace-linked recovery and evaluator-only evidence labels, with the checkpoint prefix identified.
- Restart/repeated-compaction artifacts and known-control results where relevant.

Avoid public private-session uploads and credential-bearing traces. Gold labels, reference solutions, and future turns stay evaluator-only. Hashes can identify protected artifacts without publishing their contents.

### 7.3 Statistical interpretation

Use paired task-level analysis on the frozen samples. If repetitions are added, aggregate within an issue/task before bootstrapping. For LOCA, resample **semantic families**, retaining their related seeds and pressure settings; do not treat them as independent issues. Report paired confidence intervals and discordant outcomes separately for each benchmark.

The pilot sizes are small. A non-significant success difference is not proof of equivalence. A non-inferiority margin, cost-reduction target, confidence level, and repetition/expansion rule are **TBD and must be registered before a confirmatory run**. Leave conclusions inconclusive when the data cannot support them. Triggered-task analyses are secondary and never replace the full assigned-task denominator.

The intended favorable finding is **cheaper verified completion with a defensibly bounded quality loss**, not merely aggressive deletion, a green mocked test suite, or inexpensive unsuccessful episodes.
