# Code Hardener logic filter — Iteration 1 grounding

Use this checklist on the accumulated NEURO 10-iteration output before allowing any implementation.

## Grounding checks

- Every referenced file must exist or be explicitly marked as new.
- Every referenced function/class must exist or be explicitly marked as new.
- Every referenced API endpoint must exist or be explicitly marked as new.
- Every referenced dataset/artifact must exist or be explicitly marked required.
- Every referenced test must exist or be explicitly marked new.
- Every project claim must be grounded in repo files, `PROJECT_CONTEXT.md`, Git, tests, or current command output.

## Scope checks

- Patch must be minimal.
- No broad rewrite unless explicitly required.
- No unrelated files edited.
- No generated caches committed.
- No secrets printed or committed.
- No hiding validation failures.

## Architecture checks

- Public interfaces are preserved unless intentionally changed.
- Data contracts are documented.
- UI/API boundary is stable.
- Failure modes are actionable.
- Existing working features are protected.
- Project phase/day constraints are respected.
- Quant/modeling assumptions are explicit.

## Validation checks

- Tests are identified.
- Lint/build commands are identified.
- Manual verification steps are identified if UI/API work is involved.
- Rollback risk is documented.
- Existing behavior preservation checks are included.

## Decision labels

Classify each NEURO recommendation (across all 10 iterations) as:

- `ACCEPT`
- `ACCEPT_WITH_MODIFICATION`
- `REJECT_UNGROUNDED`
- `REJECT_TOO_BROAD`
- `REJECT_BREAKS_CONTRACT`
- `DEFER_NEEDS_HUMAN_CONFIRMATION`

## Output

Produce `.neuro/chains/latest/<RUN_ID>_hardener_iter_1.json` containing:
- Classification of every NEURO recommendation
- Rejected items with justification
- Accepted items with modification notes
- Grounding verification results
