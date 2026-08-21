# Self-Evolution Protocol

## Mandate

After EVERY complete run of the exhaustive-crosscheck skill, the skill MUST update itself. This is not optional. A run that does not produce a self-evolution entry is an incomplete run.

## Evolution Vectors

There are exactly 8 evolution vectors. A run MUST modify at least 1. A run SHOULD modify 2+.

### Vector 1: Cursor Confidence Tables

**Target:** `workflows/cursor-decomposition.md`
**Trigger:** A cursor consistently underperformed (confidence delta > 0.3 from expected vs actual)
**Action:** Update that cursor's confidence scoring table with new empirical data

Example: If Temporal extracted "yesterday" but LTM returned nothing, add a note:
```
| "yesterday" but no LTM data | 0.60 | Time computation succeeded, but LTM had no coverage |
```

### Vector 2: Activation Criteria

**Target:** `SKILL.md` → Activation Criteria table
**Trigger:** A prompt type was encountered that didn't fit existing categories
**Action:** Add new row to the activation table

Example: If user asked "summarize my week" and it was a new pattern:
```
| Weekly summary | YES (light LTM) | 0 iter | 0 iter | 0 loops | YES |
```

### Vector 3: Threshold Calibration

**Target:** `SKILL.md` → Threshold & Pagination Defaults
**Trigger:** Pagination completed all 5 cycles without reaching threshold, or reached threshold in 1 cycle
**Action:** Adjust `CONFIDENCE_THRESHOLD` or `MAX_PAGINATION_CYCLES`

Algorithm:
```
If avg_pagination_cycles > 4 AND threshold_never_reached:
    DECREASE threshold by 0.05 (min 0.40)
If avg_pagination_cycles == 1 AND confidence > 0.90:
    INCREASE threshold by 0.02 (max 0.80)
If any cursor consistently missing:
    DECREASE min_cursor_confidence to 0.20
```

### Vector 4: Tool Mapping Discovery

**Target:** `SKILL.md` → Phase 1 tool tables
**Trigger:** A Pieces MCP tool was discovered that maps better to a cursor
**Action:** Update the tool mapping table

Example: If `pieces_workstream_events_full_text_search` was more effective than `pieces_search_memory` for Gesture:
```
| 3 | Gesture | pieces_workstream_events_full_text_search | Action verbs with context_type filter |
```

### Vector 5: Prompt Pattern Library

**Target:** `evolution/patterns.jsonl`
**Trigger:** Every run
**Action:** Append the prompt pattern, cursor decomposition, and confidence results

```jsonl
{"prompt": "what questions did Bhuwin ask", "cursors": {...}, "confidence": 0.87, "cycles": 4}
{"prompt": "fix the tail kurtosis bug", "cursors": {...}, "confidence": 0.0, "cycles": 0, "note": "no LTM needed — pure code change"}
```

### Vector 6: Integration Bug Fix

**Target:** Any skill file
**Trigger:** A phase failed or produced incorrect output due to integration error
**Action:** Fix the integration logic

Example: If neuro harness wasn't found at expected path:
```
Update SKILL.md Phase 2 to point to the correct harness path
```

### Vector 7: Cross-Population Note

**Target:** `evolution/cross-populate/`
**Trigger:** A discovery in this run should be applied to neuro, code-hardener, or lint-fixer
**Action:** Write a note file in `evolution/cross-populate/` for human review

### Vector 8: Version Bump

**Target:** `SKILL.md` → `EVOLUTION_VERSION`
**Trigger:** Every time any other vector is applied
**Action:** Increment `EVOLUTION_VERSION` by 1

## Evolution Sequence

```
After Phase 5 completes successfully:
   │
   ▼
┌─────────────────────────────────────────────┐
│  Step A: Collect run metrics                 │
│  - pagination_cycles, confidence, cursor_perf│
│  - lint_exit_code, neuro_api_status          │
└─────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────┐
│  Step B: Identify improvement vectors        │
│  - Which vector(s) apply? (min 1)            │
│  - What empirical data supports change?      │
└─────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────┐
│  Step C: Apply modifications                 │
│  - Edit target file(s)                       │
│  - Keep changes minimal and focused          │
└─────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────┐
│  Step D: Append to evolution log             │
│  evolution/run_log.jsonl                     │
└─────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────┐
│  Step E: Verify skill integrity              │
│  - SKILL.md reads coherently                 │
│  - Cross-references still valid              │
│  - No broken links                           │
└─────────────────────────────────────────────┘
```

## Evolution Log Format

File: `evolution/run_log.jsonl` (append-only, one JSON object per line)

```json
{
  "evolved_at": "2026-05-24T18:30:00Z",
  "evolution_version": 2,
  "run_id": 1716563400,
  "vectors_applied": ["cursor_confidence_tables", "version_bump"],
  "files_modified": ["workflows/cursor-decomposition.md", "SKILL.md"],
  "summary": "Adjusted Gesture cursor confidence for 'asking' from 0.75→0.60 based on over-match in audio transcripts",
  "aggregate_confidence": 0.87,
  "pagination_cycles": 4,
  "threshold_adjustment": null
}
```

## Failure Mode

If self-evolution fails (e.g., file write error, disk full):
1. Log the failure to `evolution/failed_evolutions.log`
2. Continue with output — the run is still valid
3. Flag the failure in the response to the user

## Self-Evolution is NOT Optional

A run that skips self-evolution is considered INCOMPLETE. The skill is designed to improve every single time it fires. If it doesn't evolve, it stagnates. If it stagnates, it's useless.

**Every run → at least 1 evolution vector → every time.**
