# Exhaustive Cross-Check Protocol — Full Chain Execution

## Entry Gate

This skill is loaded FIRST for every non-trivial prompt. The 6-phase chain MUST execute in order. No phase may be skipped.

## Phase 1 — Cursor Decomposition & LTM Cross-Check

### 1a. Parse prompt into 5 cursors
Use direct analysis (not NEURO — this is fast-path). Output:

```json
{
  "temporal": {"phrases": [...], "confidence": 0.0-1.0, "bounds": null},
  "source": {"apps": [...], "confidence": 0.0-1.0},
  "gesture": {"verbs": [...], "confidence": 0.0-1.0},
  "topic": {"keywords": [...], "confidence": 0.0-1.0},
  "people": {"names": [...], "confidence": 0.0-1.0}
}
```

### 1b. Resolve temporal bounds
If temporal confidence > 0.3:
```javascript
time = pieces_time_compute("now")
// or
bounds = pieces_extract_temporal_range({query: "<time phrases>"})
```

### 1c. Fire parallel searches
For each cursor with confidence > 0.3, call `pieces_search_memory` in a single batch.

ALWAYS include ALL cursor values in EVERY call — this maximizes cross-reference matching.

```javascript
// Each cursor gets its OWN call, but ALL share the full context
for each cursor c where c.confidence > 0.3:
    result = await pieces_search_memory({
        persons: all_names,      // from people cursor
        hints: all_keywords,     // from topic cursor  
        sources: all_sources,    // from source + gesture cursors
        created: temporal_bounds // from temporal cursor
    })
```

### 1d. Merge and score
- Collect all unique events from all cursor calls
- For each event, count how many cursors matched it
- `aggregate_confidence = matched_cursor_confidence_sum / total_cursor_confidence_sum`

### 1e. Pagination gate
```python
cycle = 0
best = 0.0
stagnant = 0

while cycle < MAX_PAGINATION_CYCLES:
    if aggregate_confidence >= THRESHOLD:
        break
    if stagnant >= STAGNANT_LIMIT:
        break
    
    # Fetch next page
    next_page = pieces_ask_memory(cursor=next_cursor)
    pool.merge(next_page)
    aggregate_confidence = recompute(pool)
    
    if aggregate_confidence > best + 0.02:
        best = aggregate_confidence
        stagnant = 0
    else:
        stagnant += 1
    
    cycle += 1
```

### 1f. Write enriched context
Save to `.neuro/chains/latest/enriched_ltm_context.json`

## Phase 2 → Phase 3 → Phase 4 → Phase 5

These phases follow the exact protocols from:
- NEURO: `.opencode/skills/neuro/SKILL.md` (10 iterations)
- Code-Hardener: `.opencode/skills/code-hardener/SKILL.md` (5 iterations)
- Lint-Fixer: `.opencode/skills/lint-fixer/SKILL.md` (5 loops)

The exhaustive-crosscheck skill does NOT re-document them — it delegates to them. The key difference is that EVERY phase receives the `enriched_ltm_context.json` as additional input.

## Phase 6 — Self-Evolution

See `workflows/self-evolution.md` for full protocol.

## Parallel Execution Optimization

Phase 1 cursor searches fire in a SINGLE message with multiple tool calls.

```javascript
// ALL in one message
const batch = [
    pieces_search_memory({...temporal}),
    pieces_search_memory({...source}),
    pieces_search_memory({...gesture}),
    pieces_search_memory({...topic}),
    pieces_search_memory({...people})
];
const results = await Promise.all(batch);
```

If Pieces LTM is unavailable:
- Log: "LTM unavailable — skipping Phase 1, proceeding with blank context"
- Set `enriched_ltm_context = {}`
- Continue to Phase 2

## Edge Case Handling

| Condition | Action |
|-----------|--------|
| All cursors < 0.3 confidence | Skip Phase 1 entirely, proceed to Phase 2 with empty context |
| Pieces search returns 0 results | Mark cursor as "no evidence", reduce its weight to 0.1 |
| NEURO API unavailable | Block. Do not fake. Report blocker. |
| Lint fixer can't auto-fix | Flag remaining errors, do not block output |
| Self-evolution file write fails | Log failure, continue |
