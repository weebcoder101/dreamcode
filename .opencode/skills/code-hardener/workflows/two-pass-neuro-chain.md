# Full hardening chain — 10 NEURO + 5 Code-Hardener + Final Review

## Required sequence

1. Read `PROJECT_CONTEXT.md`.
2. Inspect `git status --short` and current branch.
3. Gather relevant files.
4. Write current user prompt to `.neuro/chains/latest/<RUN_ID>_user_prompt.md`.
5. Generate unique run ID: `RUN_ID=$(date +%s)`

### Phase 1: NEURO 10 Iterations

6. Execute NEURO iteration 1 (direct analysis).
7. Save to `.neuro/chains/latest/<RUN_ID>_neuro_iter_1.json`.
8. Execute NEURO iteration 2 (deepened analysis, includes iter 1 output).
9. Save to `.neuro/chains/latest/<RUN_ID>_neuro_iter_2.json`.
10. Execute NEURO iteration 3 (innovation, includes iter 1-2 output).
11. Save to `.neuro/chains/latest/<RUN_ID>_neuro_iter_3.json`.
12. Execute NEURO iteration 4 (cross-reference, includes iter 1-3 output).
13. Save to `.neuro/chains/latest/<RUN_ID>_neuro_iter_4.json`.
14. Execute NEURO iteration 5 (edge-case hunt, includes iter 1-4 output).
15. Save to `.neuro/chains/latest/<RUN_ID>_neuro_iter_5.json`.
16. Execute NEURO iteration 6 (performance/scalability, includes iter 1-5 output).
17. Save to `.neuro/chains/latest/<RUN_ID>_neuro_iter_6.json`.
18. Execute NEURO iteration 7 (security/integrity, includes iter 1-6 output).
19. Save to `.neuro/chains/latest/<RUN_ID>_neuro_iter_7.json`.
20. Execute NEURO iteration 8 (backward compatibility, includes iter 1-7 output).
21. Save to `.neuro/chains/latest/<RUN_ID>_neuro_iter_8.json`.
22. Execute NEURO iteration 9 (testability/validation, includes iter 1-8 output).
23. Save to `.neuro/chains/latest/<RUN_ID>_neuro_iter_9.json`.
24. Execute NEURO iteration 10 (final synthesis, includes iter 1-9 output).
25. Save to `.neuro/chains/latest/<RUN_ID>_neuro_iter_10.json`.
26. Produce synthesis: `.neuro/chains/latest/<RUN_ID>_neuro_synthesis.json`.

### Phase 2: Code-Hardener 5 Iterations

27. Execute hardener iteration 1 (grounding filter, includes all 10 NEURO outputs).
28. Save to `.neuro/chains/latest/<RUN_ID>_hardener_iter_1.json`.
29. Execute hardener iteration 2 (scope/contract audit, includes iter 1 output).
30. Save to `.neuro/chains/latest/<RUN_ID>_hardener_iter_2.json`.
31. Execute hardener iteration 3 (security/performance audit, includes iter 1-2 output).
32. Save to `.neuro/chains/latest/<RUN_ID>_hardener_iter_3.json`.
33. Execute hardener iteration 4 (test/validation coverage, includes iter 1-3 output).
34. Save to `.neuro/chains/latest/<RUN_ID>_hardener_iter_4.json`.
35. Execute hardener iteration 5 (final gate/manifest, includes iter 1-4 output).
36. Save to `.neuro/chains/latest/<RUN_ID>_hardener_iter_5.json`.
37. Produce implementation manifest: `.neuro/chains/latest/<RUN_ID>_implementation_manifest.md`.

### Phase 3: 15-Iteration Final Review Gate

38. Produce final review consuming ALL 15 accumulated outputs:
    `.neuro/chains/latest/<RUN_ID>_15_iter_final_review.md`
39. Final review must include:
    - Consolidated diff/change plan
    - ALLOW/DENY file list
    - Rollback strategy
    - Explicit approval statement
40. Only then may opencode edit production code.

## Blocking conditions

Stop if:

- NEURO API key is missing.
- NEURO base URL is missing.
- Live NEURO cannot be reached.
- Cache is used when live transport is required.
- Any NEURO iteration output is empty.
- Any hardener iteration output is empty.
- Final review cannot be produced.
- The task is architectural and NEURO is unavailable.
- Fewer than 10 NEURO iterations completed.
- Fewer than 5 code-hardener iterations completed.

## Non-bypass rule

opencode must not replace the chain with its own reasoning.

opencode may reason about how to execute the chain, but may not implement non-trivial source-code changes until ALL chain outputs are present.

## Required output files

The chain must produce:

```text
.neuro/chains/latest/<RUN_ID>_user_prompt.md
.neuro/chains/latest/<RUN_ID>_neuro_iter_1.json
.neuro/chains/latest/<RUN_ID>_neuro_iter_2.json
.neuro/chains/latest/<RUN_ID>_neuro_iter_3.json
.neuro/chains/latest/<RUN_ID>_neuro_iter_4.json
.neuro/chains/latest/<RUN_ID>_neuro_iter_5.json
.neuro/chains/latest/<RUN_ID>_neuro_iter_6.json
.neuro/chains/latest/<RUN_ID>_neuro_iter_7.json
.neuro/chains/latest/<RUN_ID>_neuro_iter_8.json
.neuro/chains/latest/<RUN_ID>_neuro_iter_9.json
.neuro/chains/latest/<RUN_ID>_neuro_iter_10.json
.neuro/chains/latest/<RUN_ID>_neuro_synthesis.json
.neuro/chains/latest/<RUN_ID>_hardener_iter_1.json
.neuro/chains/latest/<RUN_ID>_hardener_iter_2.json
.neuro/chains/latest/<RUN_ID>_hardener_iter_3.json
.neuro/chains/latest/<RUN_ID>_hardener_iter_4.json
.neuro/chains/latest/<RUN_ID>_hardener_iter_5.json
.neuro/chains/latest/<RUN_ID>_implementation_manifest.md
.neuro/chains/latest/<RUN_ID>_15_iter_final_review.md
```
