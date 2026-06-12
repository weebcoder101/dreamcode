# Implementation gate — 15-iteration final review

## Pre-gate verification

Before editing production code, verify ALL 15 iteration artifacts exist:

```bash
# NEURO 10 iterations
test -s .neuro/chains/latest/*_neuro_iter_1.json
test -s .neuro/chains/latest/*_neuro_iter_2.json
test -s .neuro/chains/latest/*_neuro_iter_3.json
test -s .neuro/chains/latest/*_neuro_iter_4.json
test -s .neuro/chains/latest/*_neuro_iter_5.json
test -s .neuro/chains/latest/*_neuro_iter_6.json
test -s .neuro/chains/latest/*_neuro_iter_7.json
test -s .neuro/chains/latest/*_neuro_iter_8.json
test -s .neuro/chains/latest/*_neuro_iter_9.json
test -s .neuro/chains/latest/*_neuro_iter_10.json
test -s .neuro/chains/latest/*_neuro_synthesis.json

# Code-hardener 5 iterations
test -s .neuro/chains/latest/*_hardener_iter_1.json
test -s .neuro/chains/latest/*_hardener_iter_2.json
test -s .neuro/chains/latest/*_hardener_iter_3.json
test -s .neuro/chains/latest/*_hardener_iter_4.json
test -s .neuro/chains/latest/*_hardener_iter_5.json

# Implementation manifest
test -s .neuro/chains/latest/*_implementation_manifest.md
```

## 15-Iteration Final Review

STRICT: NO production code may be edited until the final review artifact exists:

```bash
test -s .neuro/chains/latest/*_15_iter_final_review.md
```

The final review MUST:

1. Consume ALL 15 accumulated iteration outputs (10 NEURO + 5 code-hardener)
2. Include a consolidated diff/change plan
3. Include ALLOW/DENY file list
4. Include a rollback strategy
5. Include explicit approval statement
6. Be produced by the reviewer (opencode or worker agent)

Then inspect:

```bash
cat .neuro/chains/latest/*_15_iter_final_review.md
cat .neuro/chains/latest/*_implementation_manifest.md
```

## Gate conditions

opencode may edit production code only if the manifest says:

```text
Implementation allowed: true
```

opencode may edit only files explicitly listed as allowed.

opencode must not edit files listed as forbidden.

## Post-implementation

After implementation, run the validation commands listed in the final plan.

If validation fails:

1. Read the failure.
2. Fix the root cause.
3. Re-run validation.
4. Repeat until green or blocked.

After validation, run the lint-fixer skill (5 loops as defined in its SKILL.md).

After lint-fixer, update `PROJECT_CONTEXT.md` with:

- Date/time
- Branch
- User task
- NEURO iteration count and status
- Code-hardener iteration count and status
- Final review status
- Files changed
- Validation commands and results
- Lint-fixer results
- Remaining blockers
- Next action
