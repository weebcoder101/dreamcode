# Compaction Protocol — RIT-Compliant Context Compression

## Overview

This document defines the compaction protocol used by the `context-compactor`
skill. It is the operational implementation of RIT Axiom 0 for LLM context
management.

## Theoretical Foundation

**RIT Axiom 0:** S = Σᵢ Δ_ref,i

Information content equals the sum of reference frame differentials. A context
window contains relational differentials — what changed, who said what, the
delta from prior state. The minimal representation preserving all differentials
IS informationally equivalent to the full context.

**Key insight:** Context compaction is NOT lossy compression. It is finding the
minimal RIT basis that spans the same informational space.

## Protocol Steps

### Step 1: Context Assembly

Sources (in priority order):
1. **PROJECT_CONTEXT.md** — Project identity, goals, architecture
2. **AGENTS.md** — Orchestrator rules, skill registry, routing logic
3. **Git diff (HEAD)** — What changed since last commit
4. **LTM summaries** — Last 3 Pieces MCP workstream summaries
5. **Active task** — Current user request
6. **Compaction history** — Last 5 compaction runs (meta-context)

Each source is labeled with `## <Source Name>` headers so NEURO can
identify provenance of differentials.

### Step 2: NEURO Compaction

NEURO receives:
- System prompt defining RIT compaction rules
- Token budget (target max for compact output)
- Fidelity floor (minimum acceptable score, default 0.98)
- Full context bundle

NEURO must produce JSON with:
- `compact_context`: The compacted text
- `differentials_preserved`: List of what was kept and why
- `differentials_removed`: List of what was eliminated and why
- `fidelity_score`: Self-reported 0.0-1.0
- `original_token_estimate` / `compact_token_estimate` / `compression_ratio`

### Step 3: Fidelity Verification

Two-layer check (belt + suspenders):
1. **NEURO self-check:** If fidelity < floor, NEURO re-attempts with stricter
   instructions (max 2 retries)
2. **Harness check:** `verify_fidelity()` confirms score ≥ floor AND
   compact_context is non-empty

### Step 4: Output

- Write compact context to `.opencode/context_cache/session_<id>.md`
- Append JSONL log entry to `.opencode/compaction_log.jsonl`
- Print human-readable summary

## What Gets Preserved (Differentals)

| Differential Type | Example | Preservation Rule |
|-------------------|---------|-------------------|
| Named decisions | "We chose Flask over FastAPI because..." | Verbatim |
| Open loops | "TODO: need to handle auth before deploy" | Verbatim |
| Blocking deps | "Waiting on NEURO API key from Ankur" | Verbatim |
| Error traces | Full stack traces, error messages | Verbatim |
| File paths | `src/project_q/risk/rit_geometry.py` | Verbatim |
| API contracts | `GET /api/rit/market-analysis` | Verbatim |
| Config values | `window=21, threshold=0.01` | Verbatim |
| Causal chains | "X caused Y which led to Z" | Collapsed to skeleton |
| Temporal ordering | "First we did X, then Y" | Preserved if order matters |

## What Gets Removed (Zero-Differential Tokens)

| Token Type | Example | Removal Rule |
|------------|---------|--------------|
| Restated conclusions | "As I mentioned earlier..." | Remove |
| Duplicate code blocks | Same function shown twice | Keep once |
| Filler prose | "It's worth noting that..." | Remove |
| Boilerplate | Standard imports, license headers | Remove |
| Formatting overhead | excessive blank lines, decorative headers | Collapse |

## Compression Ratio Expectations

| Context Type | Expected Ratio | Notes |
|-------------|---------------|-------|
| Code-heavy (diffs, implementations) | 1.5-2.5x | Code is already dense |
| Narrative-heavy (discussions, plans) | 3-5x | Lots of redundancy |
| Mixed (typical session) | 2-3x | Blend of above |
| LTM-heavy (many summaries) | 2-4x | Summaries are already compressed |

## Threshold

Default compaction threshold: **150,000 tokens**. Below this, context is passed
raw unless `--force` is used.

## Error Handling

| Failure | Action |
|---------|--------|
| NEURO API timeout | Retry once, then pass raw context |
| NEURO returns invalid JSON | Retry once, then pass raw context |
| Fidelity below floor after retries | Pass raw context with warning |
| Token budget exceeded | Re-run with tighter budget |
| Empty compact context | Pass raw context with warning |

## Self-Improvement Loop

Every compaction run logs to `compaction_log.jsonl`. The compaction history
section includes the last 5 entries, so NEURO can see compression ratios
trending over time and calibrate accordingly. This closes the
self-improvement loop.
