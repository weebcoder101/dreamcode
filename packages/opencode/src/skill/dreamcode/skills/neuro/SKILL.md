---
name: neuro
description: "Mandatory external architectural and code-review harness for ANY non-trivial task including code changes, bug fixes, new features, refactors, API changes, data contract changes, performance optimizations, security fixes, architectural decisions, configuration changes, test modifications, integration work, debugging, analysis, planning, and implementation. Use when the user requests any modification, analysis, debugging, testing, integration, or planning work. Use for EVERY prompt that involves understanding or changing code, data, or configuration. When in doubt, ALWAYS use this skill. Skip only for trivial changes: typo fixes, formatting-only changes, one-line lint fixes, comment cleanup, simple unused import removal."
chains_with: [code-hardener, lint-fixer, automated-learning]
---

## Purpose

`neuro` routes non-trivial engineering work through NEURO / Neurometric before opencode makes code changes.

opencode is not the first architectural authority. NEURO provides first-pass architectural review, risk analysis, minimal patch strategy, edge cases, and validation guidance.

NEURO is still advisory. It is not final truth. The current repository, tests, `PROJECT_CONTEXT.md`, and user instructions remain authoritative.

For non-trivial work, this skill is always step 1 of a two-skill chain:

`neuro` (10 iterations) → `code-hardener` (5 iterations) → final review gate → opencode implementation.

## Activation

Use this skill for:

- New modules
- Architectural changes
- Cross-file refactors
- API or data-contract changes
- Dashboard/API integration
- Modeling/statistical/quantitative logic
- Performance-sensitive code
- Security-sensitive code
- Code review
- PR review
- Bug fixes that could affect existing behavior
- Any task where the user asks to use NEURO
- Any task where opencode is uncertain whether a change is trivial

Skip only for trivial changes:

- Typo fixes
- Formatting-only changes
- One-line lint fixes
- Comment cleanup
- Simple unused import removal

If unsure, use NEURO.

## Mandatory iteration count

Unless the user explicitly overrides with a specific number, NEURO MUST execute exactly **10 iterations** for every non-trivial activation.

Each iteration builds on ALL previous iteration output. The prompt grows larger every round. The user prompt for iteration N includes the full accumulated output from iterations 1 through N-1.

## Iteration protocol

Each iteration has a distinct focus and produces a numbered artifact:

1. **Iteration 1 — Direct Analysis:** Gather context, identify files, surface immediate risks. Produce `01_neuro_iter_1.json`.
2. **Iteration 2 — Deepened Analysis:** Repeat with iter 1 output appended. Surface missed risks, hidden dependencies. Produce `02_neuro_iter_2.json`.
3. **Iteration 3 — Innovation:** Add approaches NOT previously considered. Lateral thinking. Alternative architectures. Produce `03_neuro_iter_3.json`.
4. **Iteration 4 — Cross-Reference:** Cross-reference with PROJECT_CONTEXT.md, tests, neighboring files, API contracts. Produce `04_neuro_iter_4.json`.
5. **Iteration 5 — Edge-Case Hunt:** What breaks in prod? NaN, empty data, race conditions, timeouts, memory pressure. Produce `05_neuro_iter_5.json`.
6. **Iteration 6 — Performance & Scalability:** Profile each component. Big-O analysis. Bottleneck identification. Produce `06_neuro_iter_6.json`.
7. **Iteration 7 — Security & Data Integrity:** Injection, secrets, resource exhaustion, thread safety, temp file leaks. Produce `07_neuro_iter_7.json`.
8. **Iteration 8 — Backward Compatibility:** API contracts, data schemas, UI consumers, migration impact, deprecation strategy. Produce `08_neuro_iter_8.json`.
9. **Iteration 9 — Testability & Validation:** Missing tests, flaky tests, benchmark strategy, regression detection, rollback plan. Produce `09_neuro_iter_9.json`.
10. **Iteration 10 — Final Synthesis:** Consolidate ALL 9 prior iterations. Produce priority-ordered action plan with impact/effort ranking. Produce `10_neuro_iter_10.json` and `10_neuro_synthesis.json`.

## Progressive disclosure rule

Each iteration's prompt MUST include:
- The original user prompt
- ALL previous iteration JSON outputs (full content, not summaries)
- Any new files or context discovered since the last iteration
- An explicit instruction to go deeper, find more, and add new innovations

The prompt literally grows larger every iteration.

## Required inputs

Before calling NEURO, gather:

- Original user prompt
- Current `PROJECT_CONTEXT.md`
- Current branch and git status
- Relevant full file contents
- Neighboring files/contracts
- Existing tests touching the area
- Intended change scope
- Known constraints
- Failure modes to avoid

## Required NEURO output per iteration

Request NEURO to return:

- Problem summary (updated with new findings)
- Affected files (cumulative)
- Minimal patch strategy (refined)
- Architectural risks (expanded)
- Edge cases (new ones discovered)
- Interface/data-contract risks
- Backward compatibility risks
- Tests to run
- Changes to avoid
- Confidence level
- Open questions
- New innovations (iterations 3+)

## Artifact output

Each iteration writes to:
`.neuro/chains/latest/<run_id>_neuro_iter_<N>.json`

After iteration 10, produce:
`.neuro/chains/latest/<run_id>_neuro_synthesis.json`

## Mandatory handoff

After NEURO completes all 10 iterations, opencode must not edit source code.

opencode must activate `code-hardener` and pass ALL 10 NEURO iteration outputs into it.

The code-hardener will execute its 5 mandatory iterations.

After code-hardener completes, the 15-iteration final review gate must produce:
`.neuro/chains/latest/<run_id>_15_iter_final_review.md`

No production source file may be edited until that artifact exists and matches the current user request.

## Failure behavior

If live NEURO is unavailable:

- Do not fake NEURO output.
- Do not silently use stale cache.
- If the task is risky or architectural, stop and report the blocker.
- If the task is trivial, classify it as trivial and proceed with normal validation.

## Progressive disclosure

Keep this `SKILL.md` concise. Detailed workflow is in:

- `workflows/neuro-review-protocol.md`

Executable harness is in:

- `scripts/neuro_harness.py`

Configuration (API key, base URL, status) is in:

- `CONTEXT.md`
