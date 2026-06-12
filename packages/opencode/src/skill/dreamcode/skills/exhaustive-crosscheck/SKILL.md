---
name: exhaustive-crosscheck
description: "META-SKILL — mandatory entry point for EVERY non-trivial prompt. Decomposes prompt into 5 orthogonal cursors (Temporal, Source, Gesture, Topic, People), fires parallel Pieces LTM searches with pagination until confidence >= threshold, then orchestrates the full neuro (10 iter) -> code-hardener (5 iter) -> implementation -> lint-fixer (5 loop) chain. Self-evolutionary: after every run, analyzes outcomes and updates its own structure. Integrates, wraps, and supersedes neuro, code-hardener, and lint-fixer."
chains_with: [neuro, code-hardener, lint-fixer, pieces-ltm, automated-learning]
---

## MANDATE

This is the **ONLY entry point** for all non-trivial prompts. It replaces the AGENTS.md routing. Every prompt that is not TRIVIAL MUST enter here first.

It integrates ALL prior skills into a single evolutionary meta-orchestrator:

```
exhaustive-crosscheck (this skill)
  ├── Phase 1: Cursor Decomposition + LTM Cross-Check
  ├── Phase 2: NEURO (10 iterations)         ← integrated from neuro skill
  ├── Phase 3: Code-Hardener (5 iterations)  ← integrated from code-hardener skill
  ├── Phase 4: Implementation Gate
  ├── Phase 5: Lint-Fixer (5 loops)          ← integrated from lint-fixer skill
  └── Phase 6: Self-Evolution                ← NEW: updates this skill itself
```

## Architecture

```
                        User Prompt
                             │
                             ▼
              ┌──────────────────────────────┐
              │  PHASE 1: CURSOR DECOMPOSITION │
              │  (5 cursors → LTM → paginate)  │
              └──────────────┬───────────────┘
                             │ enriched_ltm_context.json
                             ▼
              ┌──────────────────────────────┐
              │  PHASE 2: NEURO              │
              │  10 progressive iterations   │
              │  + LTM context enrichment    │
              └──────────────┬───────────────┘
                             │ neuro_iter_1-10.json
                             ▼
              ┌──────────────────────────────┐
              │  PHASE 3: CODE-HARDENER      │
              │  5 hardening iterations      │
              │  Validates vs LTM + repo     │
              └──────────────┬───────────────┘
                             │ implementation_manifest.md
                             ▼
              ┌──────────────────────────────┐
              │  PHASE 4: IMPLEMENTATION      │
              │  Execute manifest only        │
              └──────────────┬───────────────┘
                             │ edited files
                             ▼
              ┌──────────────────────────────┐
              │  PHASE 5: LINT-FIXER         │
              │  5 fix loops (ruff→mypy→...) │
              └──────────────┬───────────────┘
                             │ verified code
                             ▼
              ┌──────────────────────────────┐
              │  PHASE 6: SELF-EVOLUTION      │
              │  Analyze → Learn → Update     │
              │  SKILL.md improves every run  │
              └──────────────────────────────┘
                             │
                             ▼
                        Final Output
```

## Phase 1 — Cursor Decomposition & Pieces LTM Cross-Check

### 5 Cursor Dimensions

| # | Cursor | Pieces Tool | Extracted From Prompt |
|---|--------|-------------|----------------------|
| 1 | **Temporal** | `pieces_time_compute` + `pieces_search_memory` | Time phrases: "yesterday", "May 23", "last week" |
| 2 | **Source** | `pieces_search_memory` / `pieces_workstream_events_full_text_search` | Apps: "Chrome", "VS Code", "Meet", "Terminal" |
| 3 | **Gesture** | `pieces_search_memory` (via sources) | Verbs: "asked", "presented", "coded", "debugged" |
| 4 | **Topic** | `pieces_search_memory` / `pieces_annotations_full_text_search` | Subjects: "quantum POC", "VaR", "GARCH" |
| 5 | **People** | `pieces_search_memory` / `pieces_persons_full_text_search` | Names: "Bhuwin", "Ankur", "Sunil" |

### Decomposition Protocol

**Step 1a — Extract cursors from prompt:**
Parse the prompt for each cursor dimension. Score initial confidence (0.0–1.0) per cursor.

**Step 1b — Resolve temporal bounds:**
If Temporal confidence > 0.3, call `pieces_time_compute` or `pieces_extract_temporal_range` to get ISO 8601 bounds.

**Step 1c — Fire parallel Pieces searches:**
For each cursor with confidence > 0.3, call `pieces_search_memory` with mapped parameters. Fire ALL cursor searches in a single parallel batch.

Each call includes ALL cursors' data for richer matching, weighted by confidence.

**Step 1d — Cross-reference & confidence merge:**
Build unified candidate pool. For each candidate, count cursor matches and compute aggregate confidence.

**Step 1e — Pagination gate:**
- If `aggregate_confidence ≥ THRESHOLD` (0.60) → proceed to Phase 2
- If below threshold → paginate: call `pieces_search_memory` with `cursor` parameter, re-merge, re-score
- Max 5 pagination cycles
- Stagnant for 3 cycles → force proceed (best-effort)

**Step 1f — Write enriched context:**
Write `enriched_ltm_context.json` to the `.neuro/chains/latest/` directory. This feeds into Phase 2.

### Threshold & Pagination Defaults

| Parameter | Default | Notes |
|-----------|---------|-------|
| CONFIDENCE_THRESHOLD | 0.60 | Minimum aggregate to skip pagination |
| MAX_PAGINATION_CYCLES | 5 | Hard cap per invocation |
| STAGNANT_LIMIT | 3 | Force proceed if no improvement |
| MIN_CURSOR_CONFIDENCE | 0.30 | Below this, cursor is excluded |

## Phase 2 — NEURO Integration (10 iterations)

This phase EXACTLY follows the `neuro` skill protocol (`SKILL.md` in `.opencode/skills/neuro/`).

### Pre-Phase 2 Setup
Before starting NEURO:

1. Read `enriched_ltm_context.json` from Phase 1
2. Read `PROJECT_CONTEXT.md`
3. Inspect repo state: `git status`, `git branch`
4. Identify target files
5. Read each target file fully
6. Read neighboring contracts (tests, APIs, schemas, docs, pipeline scripts)
7. Generate run ID: `RUN_ID=$(date +%s)`
8. Write original prompt to `.neuro/chains/latest/${RUN_ID}_user_prompt.md`

### Iteration Protocol (copied from neuro skill)

Execute exactly **10 iterations**, each building on all previous:

| Iter | Focus | Artifact |
|------|-------|----------|
| 1 | Direct Analysis | `*_neuro_iter_1.json` |
| 2 | Deepened Analysis | `*_neuro_iter_2.json` |
| 3 | Innovation | `*_neuro_iter_3.json` |
| 4 | Cross-Reference | `*_neuro_iter_4.json` |
| 5 | Edge-Case Hunt | `*_neuro_iter_5.json` |
| 6 | Performance & Scalability | `*_neuro_iter_6.json` |
| 7 | Security & Data Integrity | `*_neuro_iter_7.json` |
| 8 | Backward Compatibility | `*_neuro_iter_8.json` |
| 9 | Testability & Validation | `*_neuro_iter_9.json` |
| 10 | Final Synthesis | `*_neuro_iter_10.json` + `*_neuro_synthesis.json` |

**Each iteration prompt MUST include:**
- Original user prompt
- LTM enriched context from Phase 1
- ALL previous iteration outputs (full JSON, not summaries)
- New files discovered since last iteration
- Instruction: "Go deeper. Find more. Add new innovations."

**NEURO Call:** Use the neuro harness at `.opencode/skills/neuro/scripts/neuro_harness.py` with:
```bash
export NEURO_API_BASE_URL=https://api.neurometric.ai/v1
# NEURO_API_KEY must be set in your environment (via .env.secret or shell)

python .opencode/skills/neuro/scripts/neuro_harness.py \
    --task "<description>" \
    --user-context-file ".neuro/chains/latest/enriched_ltm_context.json" \
    --file "<target_file>" \
    --phase pre_patch
```

**NEURO API key persistence:** Set via `NEURO_API_KEY` environment variable. Create a `.env.secret` file (DO NOT COMMIT) with `NEURO_API_KEY=your_key_here` and source it: `set -a; source .env.secret; set +a`.

**NEURO output size limit:** The harness output is capped at ~53KB. For large iteration prompts, the response may be truncated. When this happens, extract the structured JSON from the partial response and save it as the iteration artifact — the key findings are typically captured before truncation.

If NEURO API is unavailable: do NOT fake output. If task is risky, stop and report blocker.

### LTM Context Injection

The `enriched_ltm_context.json` is passed to NEURO as additional context so every iteration benefits from:
- Historical work patterns from Pieces LTM
- Past decisions, discussions, and code changes
- Person profiles (who did what)
- Meeting transcripts and decisions

## Phase 3 — Code-Hardener Integration (5 iterations)

This phase EXACTLY follows the `code-hardener` skill protocol (`SKILL.md` in `.opencode/skills/code-hardener/`).

Consumes ALL 10 NEURO iteration outputs + LTM context. Filters against repo truth across 5 progressive iterations.

| Iter | Focus | Artifact |
|------|-------|----------|
| 1 | Grounding Filter | `*_hardener_iter_1.json` |
| 2 | Scope & Contract Audit | `*_hardener_iter_2.json` |
| 3 | Security & Performance | `*_hardener_iter_3.json` |
| 4 | Test & Validation | `*_hardener_iter_4.json` |
| 5 | Final Gate & Manifest | `*_hardener_iter_5.json` + `*_implementation_manifest.md` |

### Classification per recommendation:
- `ACCEPT`
- `ACCEPT_WITH_MODIFICATION`
- `REJECT_UNGROUNDED`
- `REJECT_TOO_BROAD`
- `REJECT_BREAKS_CONTRACT`
- `DEFER_NEEDS_HUMAN_CONFIRMATION`

### Final Implementation Gate

opencode may only edit source code AFTER these exist:
- `*_neuro_iter_1.json` through `10.json`
- `*_neuro_synthesis.json`
- `*_hardener_iter_1.json` through `5.json`
- `*_implementation_manifest.md`
- `*_15_iter_final_review.md`

The manifest must include:
- Files allowed to edit
- Files forbidden to edit
- Exact intended changes (file-by-file)
- Changes explicitly rejected
- Required tests/lint/build commands
- Rollback risks
- Post-change verification steps

## Phase 4 — Implementation

Execute ONLY what the implementation manifest approves.

Rules:
- Preserve existing behavior unless the plan explicitly changes it
- Prefer small patches over rewrites
- Never claim tests pass unless they pass
- Run validation after every change
- Fix validation failures immediately

## Phase 5 — Lint-Fixer Integration (5 loops)

This phase EXACTLY follows the `lint-fixer` skill protocol (`SKILL.md` in `.opencode/skills/lint-fixer/`).

### Loop 1: Ruff Check & Fix
```bash
ruff check src/ tests/ benchmarks/
ruff check --fix src/ tests/ benchmarks/
```

### Loop 2: Mypy Type Check & Fix
```bash
mypy src/
```
Fix: NDArray annotations, Optional null checks, DataFrame value types.

### Loop 3: Import Order & Format
```bash
ruff check --select I src/ tests/
```
Fix import ordering, remove unused imports.

### Loop 4: Complex Pattern Detection
Scan for: `np.array` reassignment, `Optional` without null check, `pd.DataFrame.values` without type, list comprehensions with numpy.

### Loop 5: NEURO Validation
Call NEURO with all fixes applied. If approved → done. If rejected → iterate back to Loop 1.

### Exit Criteria
- `ruff check`: All checks passed
- `mypy src/`: Success: no issues found
- No new warnings introduced
- NEURO sign-off

## Phase 6 — Self-Evolution

**THIS IS WHAT MAKES THIS SKILL DIFFERENT FROM ALL OTHERS.**

After every complete run, the skill MUST evolve itself.

### Step 6a — Analyze run outcomes

Record in `evolution/run_log.jsonl`:
```json
{
  "run_id": "<timestamp>",
  "prompt_summary": "Bhuwin questions from meeting",
  "pagination_cycles": 4,
  "aggregate_confidence": 0.87,
  "threshold_reached": true,
  "cursor_performance": {
    "temporal": {"confidence": 0.95, "pages": 4, "value": "high"},
    "source": {"confidence": 0.85, "pages": 4, "value": "high"},
    "gesture": {"confidence": 0.72, "pages": 3, "value": "medium"},
    "topic": {"confidence": 0.83, "pages": 4, "value": "high"},
    "people": {"confidence": 0.98, "pages": 4, "value": "high"}
  },
  "was_ltm_available": true,
  "was_neuro_api_available": true,
  "lint_exit_clean": true,
  "self_evolution": "Updated cursor weights for Gesture dimension"
}
```

### Step 6b — Identify improvement vectors

Analyze each phase for improvement:

| Phase | Question to answer | Update target |
|-------|-------------------|---------------|
| 1 — Cursors | Which cursor had lowest confidence? Why? | `cursor-decomposition.md` confidence tables |
| 1 — Pagination | How many cycles needed? Was threshold appropriate? | `THRESHOLD`, `MAX_PAGINATION_CYCLES` defaults |
| 2 — NEURO | Did LTM context help NEURO produce better output? | Prompt templates |
| 3 — Hardener | Did it reject valid changes or accept bad ones? | Classification thresholds |
| 5 — Lint | Were there unexpected lint patterns? | `lint-fixer` patterns section |
| All | What new prompt patterns appeared? | Activation criteria |

### Step 6c — Update SKILL.md

Apply at least ONE structural improvement per run:

- ✅ **Cursor refinement**: Add missing cursor values or adjust confidence tables
- ✅ **Pattern addition**: Add new prompt patterns to the activation criteria
- ✅ **Threshold tuning**: Adjust `CONFIDENCE_THRESHOLD`, `MAX_PAGINATION_CYCLES` based on empirical data
- ✅ **Integration improvement**: Add missing tool mappings or fix broken pipeline links
- ✅ **Evolution log**: Append to `evolution/run_log.jsonl`
- ✅ **Version bump**: Increment `EVOLUTION_VERSION` in this file

### Step 6d — Cross-populate to other skills

If improvements to neuro, code-hardener, or lint-fixer are discovered:
- Write a patch note to `evolution/cross-populate/`
- Flag for human review before applying to the other skills' files

## Activation Criteria

**MANDATORY for EVERY non-trivial prompt.** This is the default entry point.

| Prompt type | Crosscheck? | Neuro? | Code-hardener? | Lint-fixer? | Self-evolve? |
|-------------|-------------|--------|----------------|-------------|--------------|
| Code change | YES | 10 iter | 5 iter | 5 loops | YES |
| Bug fix | YES | 10 iter | 5 iter | 5 loops | YES |
| New feature | YES | 10 iter | 5 iter | 5 loops | YES |
| Refactor | YES | 10 iter | 5 iter | 5 loops | YES |
| Historical question about people/meetings | YES (heavy LTM, 5 cursors) | 0 iter | 0 iter | 0 loops | YES |
| Historical question about code/work | YES (LTM + Phase 2) | per neuro | per hardener | per lint | YES |
| LTM context needed for code change | YES (Phase 1 heavy) | 10 iter | 5 iter | 5 loops | YES |
| Simple answer | NO | NO | NO | NO | NO |
| Codebase audit / presentation readiness | YES (light LTM) | 10 iter | 5 iter | 5 loops | YES |

**When in doubt: fire the full chain.** Over-application is safer than under-application.

## Version

**EVOLUTION_VERSION: 4**
**Last evolved:** 2026-05-29
**Evolution log:** `evolution/run_log.jsonl`
