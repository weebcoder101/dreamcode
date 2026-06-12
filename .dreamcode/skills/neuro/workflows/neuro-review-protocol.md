# NEURO review protocol — 10-iteration progressive chain

## Required sequence

1. Read `PROJECT_CONTEXT.md`.
2. Inspect current repo state:
   - `pwd`
   - `git status --short`
   - `git branch --show-current`
3. Identify target files.
4. Read each target file fully if reasonably sized.
5. Read neighboring contracts:
   - tests
   - API clients
   - data schemas
   - docs
   - pipeline scripts
6. Generate a unique run ID: `RUN_ID=$(date +%s)`
7. Write original user prompt to `.neuro/chains/latest/${RUN_ID}_user_prompt.md`
8. Execute 10 NEURO iterations (see iteration protocol below).
9. Save all 10 iteration outputs under `.neuro/chains/latest/`.
10. Produce synthesis artifact.
11. Hand ALL 10 outputs to `code-hardener`.

## Iteration protocol

Each iteration MUST follow this exact sequence:

### Step A: Build cumulative prompt
Concatenate:
1. Original user prompt
2. Full JSON content of ALL previous iteration outputs (iter 1 through iter N-1)
3. Any new files discovered since last iteration
4. Explicit instruction: "Go deeper. Find more. Add new innovations. The prompt grows larger each round."

### Step B: Call NEURO
Call live NEURO through the harness with the cumulative prompt.

### Step C: Save output
Save response to `.neuro/chains/latest/${RUN_ID}_neuro_iter_<N>.json`

### Step D: Verify
Ensure the output is non-empty, well-formed JSON, and contains new insights beyond previous iterations.

## NEURO request must include (iteration 1)

- User's exact prompt
- Current task classification
- Project context
- Git branch and status
- Target files with full contents
- Relevant neighboring files
- Expected validation commands
- Known blockers
- Explicit "do not break" constraints

## NEURO request must include (iterations 2-10)

- Everything from iteration 1
- PLUS full content of ALL prior iteration JSON outputs
- PLUS instruction to go deeper and add new innovations

## NEURO must answer (each iteration)

Ask NEURO for:

- `verdict`
- `risk_level`
- `summary`
- `must_fix`
- `should_fix`
- `do_not_touch`
- `implementation_plan`
- `tests_required`
- `edge_cases`
- `architecture_notes`
- `regression_risks`
- `final_instruction_to_gemini`
- `new_innovations` (iterations 3+)

## Non-bypass rule

opencode must not implement from any single NEURO iteration output.

All 10 iterations must complete before handoff to code-hardener.

## Cache policy

For risky/non-trivial code work, prefer live transport and cache bypass.

If cache is used, the artifact must clearly say it is cached.

If `--force-live` is used, cache is forbidden.

## Secret policy

Never put API keys into:

- source code
- `GEMINI.md`
- `OPENCODE.md`
- `PROJECT_CONTEXT.md`
- `SKILL.md`
- logs
- committed files

Use environment variables only.

## Required output files

After all 10 iterations:

```text
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
```
