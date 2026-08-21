---
name: code-hardener
description: Mandatory second-stage logic filter and architectural hardening skill that runs after NEURO for ANY code change, bug fix, new feature, refactor, API change, data contract change, performance optimization, security fix, architectural decision, configuration change, test modification, integration work, debugging, analysis, planning, or implementation. Executes exactly 5 mandatory iterations. Validates NEURO recommendations against repo truth, calls NEURO with filtered critique, then emits the only implementation plan opencode may follow. Use after any neuro skill usage. Use when code is about to be edited. Use for every non-trivial code modification.
chains_with: [lint-fixer, automated-learning]
---

## Purpose

`code-hardener` is the second skill in the mandatory hardening chain.

It consumes all 10 NEURO iteration outputs, filters them against repository truth and project context across 5 progressive hardening iterations, and produces the final implementation plan.

The chain is:

User prompt + repo context
→ `neuro` (10 iterations)
→ `code-hardener` (5 iterations)
→ 15-iteration final review gate
→ opencode implementation
→ validation
→ `PROJECT_CONTEXT.md` update

## Activation

Activate this skill automatically:

- After any `neuro` skill usage (all 10 iterations complete)
- When `.neuro/chains/latest/*_neuro_iter_*.json` files exist for the current task
- When the user asks for code hardening
- When the user asks for architectural improvement
- When the user asks to apply NEURO recommendations
- During non-trivial code review or implementation
- Whenever opencode is about to edit production code after NEURO review

## Mandatory iteration count

Code-hardener MUST execute exactly **5 iterations** for every activation. No exception. No shortcut. Every single time.

## Iteration protocol

Each iteration has a distinct focus and produces a numbered artifact:

### Iteration 1 — Grounding Filter
Check every file/function/dataset NEURO referenced across all 10 iterations.
- Do referenced files exist?
- Do functions/classes/endpoints exist?
- Does advice match current repo state?
- Does advice conflict with PROJECT_CONTEXT.md?
- Would advice delete or break working behavior?
- Are there missing tests?
- Are there hidden data-contract changes?
- Are there security/secrets risks?
- Are there performance regressions?
- Are there UI/API compatibility risks?
- Are there generated files or caches that must not be edited?

Reject ungrounded recommendations. Classify each as:
- `ACCEPT`
- `ACCEPT_WITH_MODIFICATION`
- `REJECT_UNGROUNDED`
- `REJECT_TOO_BROAD`
- `REJECT_BREAKS_CONTRACT`
- `DEFER_NEEDS_HUMAN_CONFIRMATION`

Produce: `.neuro/chains/latest/<RUN_ID>_hardener_iter_1.json`

### Iteration 2 — Scope & Contract Audit
Build on iteration 1 output. Check:
- Patch minimality (no broad rewrite unless required)
- Public interface preservation
- Data contract documentation
- UI/API boundary stability
- Failure mode actionability
- Existing working feature protection
- Project phase/day constraint respect
- Quant/modeling assumption explicitness

Produce: `.neuro/chains/latest/<RUN_ID>_hardener_iter_2.json`

### Iteration 3 — Security & Performance Audit
Build on iterations 1-2 output. Check:
- Secret exposure or injection risks
- Resource exhaustion (unbounded loops, memory leaks)
- Thread safety and race conditions
- Performance regression analysis
- Big-O impact of proposed changes
- Subprocess security
- Input validation gaps
- Temporary file leaks

Produce: `.neuro/chains/latest/<RUN_ID>_hardener_iter_3.json`

### Iteration 4 — Test & Validation Coverage
Build on iterations 1-3 output. Check:
- Missing tests for new code paths
- Flaky test identification
- Validation gap analysis
- Rollback plan completeness
- Benchmark strategy for performance changes
- Regression detection coverage
- Manual verification steps for UI/API

Produce: `.neuro/chains/latest/<RUN_ID>_hardener_iter_4.json`

### Iteration 5 — Final Gate & Manifest
Build on iterations 1-4 output. Consolidate ALL prior hardening iterations. Produce:
- Files explicitly allowed to edit
- Files explicitly forbidden to edit
- Exact intended changes (file-by-file)
- Changes explicitly rejected
- Required tests/lint/build commands
- Rollback risks
- Post-change verification steps
- PROJECT_CONTEXT.md update requirements

Produce: `.neuro/chains/latest/<RUN_ID>_hardener_iter_5.json`
Produce: `.neuro/chains/latest/<RUN_ID>_implementation_manifest.md`

## Progressive accumulation rule

Each iteration MUST receive:
- The original user prompt
- ALL 10 NEURO iteration outputs
- ALL previous code-hardener iteration outputs (iter 1 through iter N-1)
- Current repo state verification

The context grows larger every iteration.

## Final implementation gate

opencode may only edit source code after these files exist:

- `.neuro/chains/latest/<RUN_ID>_neuro_iter_1.json` through `10.json` (NEURO 10 iterations)
- `.neuro/chains/latest/<RUN_ID>_neuro_synthesis.json`
- `.neuro/chains/latest/<RUN_ID>_hardener_iter_1.json` through `5.json` (code-hardener 5 iterations)
- `.neuro/chains/latest/<RUN_ID>_implementation_manifest.md`
- `.neuro/chains/latest/<RUN_ID>_15_iter_final_review.md`

The final manifest must include:

- Files allowed to edit
- Files forbidden to edit
- Exact intended changes
- Changes explicitly rejected
- Required tests/lint/build commands
- Rollback risks
- Post-change verification steps
- `PROJECT_CONTEXT.md` update requirements

If the final manifest is missing, stale, empty, or unrelated to the current task, editing is forbidden.

## Implementation discipline

opencode must:

- Implement only the final manifest
- Preserve existing behavior unless the plan explicitly changes it
- Prefer small patches over rewrites
- Run validation
- Fix validation failures
- Never claim tests pass unless they pass
- Update `PROJECT_CONTEXT.md`

## Progressive disclosure

Keep this `SKILL.md` concise. Detailed workflow is in:

- `workflows/logic-filter.md`
- `workflows/two-pass-neuro-chain.md`
- `workflows/implementation-gate.md`
