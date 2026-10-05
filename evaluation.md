# Evaluation of fast-jev-compaction

**Status: revised protocol; empirical results are TBD.** This is a source/design review, not a report of executed benchmarks or passing tests.

## 1. Review verdict

**Archetype: method/system. Stage 4 verdict: REVISE.** The paired-task and official-grader approach is sound, but reproducibility, baseline fairness, and contribution attribution need correction. The strongest alternative explanation is that savings come from more deletion or the summary fallback rather than Jev's selection.

**First fix:** freeze and release the sample IDs, runnable adapters, and complete comparison configuration before collecting results.

| Priority | Area | Current weakness | Required correction |
| --- | --- | --- | --- |
| P0 | Reproducibility | “67 cases per evaluation condition” are called frozen; selection files and benchmark runners are absent from the ZIP. | Label sizes planned until IDs, hashes, and runners are available. |
| P0 | Fairness | Masking's fallback is optional; J includes one. Actor/episode limits remain TBD. | Give M/J the same fallback and all policies the same actor, host, and limits. |
| P0 | Benchmark strength | 8/9/50 cases provide pilot evidence; LOCA 8K may never compact. | Add pressure controls, exposure counts, and uncertainty; restrict claims. |
| P0 | Cost validity | Pi excludes Jev from general usage; missing usage becomes zero and fallback paths omit details. | Capture every billable attempt externally; unavailable usage is not zero. |
| P1 | Attribution | No comparison isolates selection, call deletion, or fallback. | Add small matched-checkpoint ablations. |
| P1 | Readability | “R, M, S, J — separate rows” leaves results underspecified. | Use complete condition rows, metric units, denominators, and separate result tables. |

Inspection identity: archive comment `097fb15bfb3f04464b40c17af335d8aaa1c12397`; the old document's `f8a6558…` inspection revision differs. Unit checks cannot establish live selection quality or benchmark performance.

## 2. Benchmarks and pilot size

These suites serve complementary purposes [1–3]. Their small samples support feasibility and failure analysis, not full-suite or model-general conclusions.

| ID | Benchmark / setting | Population | Planned cases | Purpose | Limitation |
| --- | --- | ---: | ---: | --- | --- |
| L8 | LOCA-bench 8K | 75 | 8 | Integration control | May never trigger compaction |
| L32 | LOCA-bench 32K | 75 | Same 8 family/seed IDs | Controlled context pressure | Related families; environment size differs from actor window |
| TB2 | Terminal-Bench 2.0 | 89 | 9 | Terminal tasks with verifiers | Limited coverage and wide uncertainty |
| SWE-V | SWE-bench Verified, test | 500 | 50 | Real issue repair | Public-task contamination and repository clustering |

**Minimum run:** one actor × four policies × one repetition. Main comparison L32/TB2/SWE-V: **268 episodes**. L8 adds 32: **300 total**, covering 67 unique cases and 75 task/setting combinations. Checkpoints, controls, and repetitions are separately budgeted. Do not pool benchmark success rates; repetitions do not add independent task coverage.

**Selection:** recover and preserve the earlier draw if available. Otherwise explicitly create a new draw: seed `20261004`; SHA-256 of `master_seed:benchmark_key`, first eight bytes as a big-endian integer; sorted stable IDs; uniform `ceil(0.10N)` sampling without replacement. Freeze keys, IDs, Python version, revisions, and hashes before outcomes. Reuse L8 IDs in L32; never replace difficult or unsupported cases.

**Grading:** use pinned official LOCA success/accuracy fields without inventing a threshold, Harbor/task verifiers for TB2, and the official SWE patch harness. Record ungraded/setup failures. Gold answers, patches, hidden tests, and evaluation feedback remain evaluator-only; disable benchmark-owned context management in the portable comparison.

| Preparation gate | Status in this ZIP |
| --- | --- |
| Population snapshots, sample IDs/hashes, actor-safe task records | TBD — not bundled |
| R/M/S/J adapters and three official benchmark runners | TBD — not bundled |
| Grader controls and environment-restoration checks | TBD — not measured |

The prior plan's benchmark pins require validation against recovered population files:

```text
LOCA:  8b6fac49d9edd92922593e703b74ea255357c3ec
TB2:   2fd12b88aafdd04a52c298e3940bcb189f9766d6
SWE-V: c104f840cc67f8b6eec6f759ebc8b2693d585d4a
```

## 3. Baselines and fairness

| ID | Policy | Fixed behavior | Role |
| --- | --- | --- | --- |
| R | Raw history | No proactive compaction; overflow at the shared actor limit is an outcome. | Equal-window reference |
| M | Age masking + summary fallback | Mask eligible results oldest first; retain 300-character heads/omission notes and call inputs/prose. Invoke S if the target cannot be reached. | **Primary cheap competitor** |
| S | LLM summary | Summarize the eligible old region with a fixed model, prompt, and output cap. | Compression competitor |
| J | Jev selection + summary fallback | Existing keep/truncate/drop decisions, threshold 0.5; invoke the same S on errors or missed target. | Proposed deployment |

M adapts the observation-masking/hybrid family [4]; its head retention and trigger differ from that paper, so this is not an exact reproduction. Include placeholder-only masking in the diagnostic. Raw history alone is too weak a comparator when it overflows.

| Shared control | Proposed portable registration |
| --- | --- |
| Actor | **TBD:** exact checkpoint/endpoint, tokenizer, generation settings, and output reserve; one actor across policies |
| Window / trigger / target | `W = 32,768` actor tokens if supported; trigger at `0.60W` before an actor request; target ≤`0.40W`; input + reserved output must fit |
| Protected region | Immutable system/original task; first normalized message and newest six; preserve both endpoints of protected/pending tool pairs |
| Fallback | Same S for M/J, operating on the current pre-attempt region; **TBD:** model, prompt hash, cap, retries |
| Resources | **TBD:** actor-token, turn, wall-time, compute/spend, retry, concurrency caps; selector/summary work counts toward shared limits |
| Tuning / execution | Disjoint calibration data and equal search budgets; paired task/seeds, fresh environments, randomized policy order |
| History access | Current effective history only; identical retrieval permissions; no hidden restoration of deleted observations |

These controls need runner implementation; `compact()` alone does not enforce them. Preserve tool IDs and mixed content, and report infeasible/unsupported inputs. Native Pi/Claude Code are separate host studies with their own tail/summary semantics. Pi's branch reconstruction requires measurement of repeated processing and reintroduced outputs; keep changing goal supervisors out of the comparison.

**Source correction:** library/Pi defaults are finite **28,000 state / 56,000 request** estimated tokens; Claude manifest defaults are **25,000 / 30,000**. Threshold/head defaults are 0.5/300 characters; library tail/retry/concurrency defaults are 6/3/4. Pi's character-reduction gate is 0.25. Freeze resolved options and Jev response revision/date; `jev-latest` is mutable. `pi/e2e.ts` still expects populated `result.usage`, while the adapter deliberately returns undefined: correct that check before host validation.

## 4. Metric definitions

| Metric | Definition and unit | Reporting rule |
| --- | --- | --- |
| Success ↑ | Official passes / assigned episodes, % | Ungraded is not passed; counts, grader coverage, 95% CI |
| LOCA accuracy ↑ | Official accuracy field | Separate mean and observed coverage; no invented threshold |
| Δ success ↑ | `100(success_J − success_M)`, pp | Paired CI and discordant outcomes |
| Cost/assigned ↓ | All episode charges / assigned episodes, USD | Include failures, actor/selector/summary, retries, execution, recovery |
| Cost/solved ↓ | All episode charges / passes, USD | Undefined if passes = 0 |
| Cost reduction ↑ | `100(1 − total_J/total_M)`, % | Paired ratio CI; complete accounting and positive denominator required |
| Context reduction ↑ | `100(1 − tokens_after/tokens_before)`, % | Full serialized actor request; median, absolute sizes, event count |
| Trigger coverage | Episodes with ≥1 attempted compaction / assigned | Counts/%; failures included; secondary analysis only |
| Latency ↓ | Episode wall time through grading; full policy-event wall time | p50/p95, seconds/milliseconds; setup/grading separately logged |
| Evidence/recovery | Necessary-fact recall %; trace-linked recovery actions/cost | Evaluator-only labels; duplicated-fact policy; recovery already in total cost |
| Reliability/usage | Failures/violations per attempted event; priced-usage coverage % | Include cancellations/retries, missing calls, selector-only events, and fallbacks |

Use provider-specific, non-overlapping input/cache/output categories and dated rates. Do not double-count reasoning or aggregate different tokenizers as universal compute. Character reduction is diagnostic. Log batching, state repetition, fitting windows, unasked candidates, and resizing retries.

**Missing is not zero.** Capture every selector attempt outside Pi, including rejected calls and failed compactions. For local inference, report GPU/CPU seconds; total USD requires a registered compute rate. Otherwise show partial charges and leave total cost unavailable.

## 5. Result tables — TBD

`TBD` = unmeasured; `N/A` = structurally inapplicable; machine-readable unavailable values use `null`. Planned denominators are not completed runs. No events means N/A for compaction latency/reduction.

### Table 1. Official quality and exposure

One repetition. Outcome ledgers also report started, unsupported, infrastructure-error, timeout, and overflow counts.

| Benchmark | Policy | Graded / assigned | Passed / assigned | Success % ↑ [95% CI] | Triggered / assigned | LOCA accuracy ↑ |
| --- | --- | --- | --- | --- | --- | --- |
| L32 | R | TBD / 8 | TBD / 8 | TBD | N/A | TBD |
| L32 | M | TBD / 8 | TBD / 8 | TBD | TBD / 8 | TBD |
| L32 | S | TBD / 8 | TBD / 8 | TBD | TBD / 8 | TBD |
| L32 | J | TBD / 8 | TBD / 8 | TBD | TBD / 8 | TBD |
| TB2 | R | TBD / 9 | TBD / 9 | TBD | N/A | N/A |
| TB2 | M | TBD / 9 | TBD / 9 | TBD | TBD / 9 | N/A |
| TB2 | S | TBD / 9 | TBD / 9 | TBD | TBD / 9 | N/A |
| TB2 | J | TBD / 9 | TBD / 9 | TBD | TBD / 9 | N/A |
| SWE-V | R | TBD / 50 | TBD / 50 | TBD | N/A | N/A |
| SWE-V | M | TBD / 50 | TBD / 50 | TBD | TBD / 50 | N/A |
| SWE-V | S | TBD / 50 | TBD / 50 | TBD | TBD / 50 | N/A |
| SWE-V | J | TBD / 50 | TBD / 50 | TBD | TBD / 50 | N/A |

### Table 2. End-to-end efficiency

Include unsuccessful episodes. Latency cells contain **p50 / p95**; event counts accompany event-level summaries.

| Benchmark | Policy | USD/assigned ↓ | USD/solved ↓ | Episode s ↓ | Compaction ms ↓ | Context reduction % ↑ |
| --- | --- | --- | --- | --- | --- | --- |
| L32 | R | TBD | TBD | TBD / TBD | N/A | N/A |
| L32 | M | TBD | TBD | TBD / TBD | TBD / TBD | TBD |
| L32 | S | TBD | TBD | TBD / TBD | TBD / TBD | TBD |
| L32 | J | TBD | TBD | TBD / TBD | TBD / TBD | TBD |
| TB2 | R | TBD | TBD | TBD / TBD | N/A | N/A |
| TB2 | M | TBD | TBD | TBD / TBD | TBD / TBD | TBD |
| TB2 | S | TBD | TBD | TBD / TBD | TBD / TBD | TBD |
| TB2 | J | TBD | TBD | TBD / TBD | TBD / TBD | TBD |
| SWE-V | R | TBD | TBD | TBD / TBD | N/A | N/A |
| SWE-V | M | TBD | TBD | TBD / TBD | TBD / TBD | TBD |
| SWE-V | S | TBD | TBD | TBD / TBD | TBD / TBD | TBD |
| SWE-V | J | TBD | TBD | TBD / TBD | TBD / TBD | TBD |

### Table 3. Primary paired comparison: J − M

Positive success/cost-reduction values favor J. Discordance = **J-only passes / M-only passes**. Coverage is shown separately for J/M.

| Benchmark | Unique cases | Δ success pp ↑ [CI] | Cost reduction % ↑ [CI] | Discordance n | Usage J/M % | Conclusion |
| --- | ---: | --- | --- | --- | --- | --- |
| L32 | 8 | TBD | TBD | TBD / TBD | TBD / TBD | TBD |
| TB2 | 9 | TBD | TBD | TBD / TBD | TBD / TBD | TBD |
| SWE-V | 50 | TBD | TBD | TBD / TBD | TBD / TBD | TBD |

### Table 4. L8 integration controls — separate from pressure results

| Policy | Passed / assigned | LOCA accuracy ↑ | Triggered / assigned | USD/assigned ↓ | Integrity violations n |
| --- | --- | --- | --- | --- | --- |
| R | TBD / 8 | TBD | N/A | TBD | TBD |
| M | TBD / 8 | TBD | TBD / 8 | TBD | TBD |
| S | TBD / 8 | TBD | TBD / 8 | TBD | TBD |
| J | TBD / 8 | TBD | TBD / 8 | TBD | TBD |

## 6. Small attribution and failure study

Select three task IDs per main suite by frozen hash order. Use each R run's first eligible trigger; restore the prefix/environment for independent continuations. Record unavailable checkpoints without outcome-based replacement. Prerecorded future actions do not measure continued success. R-prefix findings are local; whole-system attribution also requires J/M-context sensitivity checks.

For matched-size diagnostics, target `0.25W`, `0.40W`, `0.55W`; preserve identical protected items, log actual sizes and ±2% target deviation. Mark infeasible points. These budget-constrained variants do not replace the deployment algorithm. Fix heuristic rules on calibration data and charge every selector call.

### Table 5. Attribution at controlled checkpoints

Differences are **J minus comparator**. Negative recovery differences favor J. Report paired checkpoint counts alongside each result.

| Comparator | Alternative explanation | Δ success pp [CI] | Δ recall pp | Δ recovery actions |
| --- | --- | --- | --- | --- |
| Age masking, matched size | More deletion explains the gain | TBD | TBD | TBD |
| Placeholder-only masking, matched size | Head retention changes the comparison | TBD | TBD | TBD |
| Fixed recency/error/size heuristic, same actions | Cheap metadata rules suffice | TBD | TBD | TBD |
| J with call deletion disabled | Output truncation alone suffices | TBD | TBD | TBD |
| J without summary fallback | Fallback explains the gain | TBD | TBD | TBD |

Matched-size variants share fallback rules; the explicit no-fallback ablation records fit failures as outcomes. Jev omits full output payloads (`src/state.ts`), and its prompt assumes tools/files can always be re-read. Test that assumption, not just memory volume.

### Table 6. Evidence and implementation controls

Use solvable full-context positive and deliberately erased-evidence negative controls. Necessary-fact labels remain diagnostic, not official benchmark scores.

| Control | Required result | Status |
| --- | --- | --- |
| Identical metadata, different decisive output facts | Retained-fact recall and continued outcome by policy | TBD |
| Changed files, transient values, exact identifiers | Exact historical recovery by policy | TBD |
| Assistant narration contradicting observations | Source preservation and action correctness by policy | TBD |
| Protected/pending pairs and mixed content | Violations / checked events | TBD |
| Cancellation, malformed replies, selector failures | Correct handling / injected cases; fallback counts/reasons | TBD |
| Repeated compaction/restart | Reintroduced outputs, lost facts, requests, context sizes | TBD |

## 7. Analysis, decision rules, and figures

Analyze paired tasks separately by suite. Use paired risk-difference score/exact CIs; exact McNemar discordance tests are secondary. Bootstrap cost ratios by paired task; cluster LOCA by semantic family across pressure settings and report SWE repository-cluster sensitivity. Aggregate repetitions within task. Tiny cluster counts warrant descriptive results, not precise-looking inference; zero discordance does not justify zero-width intervals.

**Confirmatory rule:** lower 95% success-difference bound >−5 pp and upper 95% total-cost-ratio bound <1; target ≥10% point-estimate savings. Apply Holm-adjusted tests/inverted intervals across the three benchmark claims. These samples are not powered to certify this rule: one task changes rates by 12.5/11.1/2 pp in L32/TB2/SWE-V. Register held-out expansion size from discordance/cost variability before confirmation. Non-significance is not equivalence.

**Pilot screening:** advance only if integrity/instrumentation pass, L32 M/J trigger coverage ≥50%, costs are complete, and SWE-V shows ≥10% savings with observed success loss ≤5 pp. Otherwise diagnose/redesign. This screening rule does not establish preserved population performance.

| Figure | Axes and grouping | Status |
| --- | --- | --- |
| F1: Quality–cost scatter | X: USD/assigned; Y: success %; one panel/suite, R/M/S/J, uncertainty and counts | TBD |
| F2: Matched-size curves | X: retained actor tokens; Y: recall/continued success; separate suite panels | TBD |
| F3: Cost decomposition | Actor/Jev/summary charges; failures included; recovery tagged without double-counting; fallback counts | TBD |

Use consistent policy colors, units, exposure, and uncertainty. Do not fabricate charts or average benchmark scores.

**Required artifacts:** version/config/sample manifests; official outcomes and final artifact hashes; complete per-attempt usage/rates; compaction sizes, decisions, timing, fallback/retry reasons; evaluator-only evidence/recovery labels. Validate graders, normalization, accounting, cancellation, and restoration before scoring. Use unique SWE harness run IDs per policy/configuration/repetition to avoid stale grades [3]. Register infrastructure retries, retain original failures and all costs, and report graded-only/paired infrastructure sensitivity separately.

All configuration TBDs must be resolved before execution; result TBDs require measured artifacts before replacement.

## References

1. [LOCA-bench paper](https://arxiv.org/html/2602.07962v1); [official repository](https://github.com/hkust-nlp/LOCA-bench).
2. [Terminal-Bench 2.0 paper](https://arxiv.org/abs/2601.11868); [official task repository](https://github.com/harbor-framework/terminal-bench-2).
3. [SWE-bench datasets](https://www.swebench.com/SWE-bench/guides/datasets/); [official evaluation/cache guide](https://www.swebench.com/SWE-bench/guides/evaluation/).
4. [The Complexity Trap: masking, summarization, and hybrid baselines](https://arxiv.org/html/2508.21433v3). This protocol adapts the baseline families rather than reproducing their reported scores.
