---
name: context-compactor
id: context-compactor
version: 1.0.0
description: >
  Mandatory Phase 0 skill. Feeds the TOTAL available context (codebase,
  LTM snapshots, conversation history, file trees) to NEURO for
  RIT-compliant compaction before the main agent session begins.
  Output is a compact context bundle that preserves perfect
  informational fidelity at reduced token count.
chains_with: [exhaustive-crosscheck]
---

# Context Compactor — RIT-Compliant Token Compression

## Purpose

Your token bill on frontier models is dominated by **input context**, not output.
If NEURO can compactify that input context *before* the main agent reads it —
preserving perfect informational fidelity — you get the same output quality at
a fraction of the cost.

**RIT gives you the mathematical warrant.** Axiom 0 states:

> *S = Σᵢ Δ_ref,i* — total information equals the sum of reference frame differentials.

A context window is not a flat sequence of tokens. It is a set of *relational
differentials* — what changed, who said what, what was the delta from prior state.
The **minimal RIT basis** that spans the same informational space as the full
context is *always smaller* than the raw context itself. NEURO's job is to find
that basis. This is not lossy compression; it is the *Axiom 0-compliant
representation* of the same information.

## Activation

MANDATORY on every session where input context exceeds 150,000 tokens.
OPTIONAL below 150,000 tokens (use `--force` to override).

### Context Replacement (like opencode's /compact)

When the compactor runs, it REPLACES the entire context:
1. Old context is deleted
2. Compacted context becomes the ONLY context going forward
3. Agent continues workflow with the compacted context

This is the same behavior as opencode's `/compact` command.

In the `/automation` chain, this skill fires as **Phase 0** — BEFORE any other
skill loads context. The agent never reads the raw context. It reads the
compacted context.

### Chain Position

```
Phase 0 (NEW): context-compactor   ← RUNS FIRST, before any other skill
Phase 1: exhaustive-crosscheck
Phase 2: neuro (architecture review)
Phase 3: code-hardener
Phase 4: lint-fixer
Phase 5: automated-learning
```

## Phase Protocol

### Phase 1: Context Assembly
Collect all available context:
- Full repo file tree + modified files (git diff HEAD)
- PROJECT_CONTEXT.md
- Last 3 LTM summaries (from Pieces MCP)
- Current AGENTS.md
- Active task description

### Phase 2: NEURO Compaction
Send assembled context to NEURO with the compaction prompt (see
`workflows/compaction-protocol.md`). Receive compact context bundle.

### Phase 3: Fidelity Verification
Calculate fidelity score using RIT differential coverage:
  fidelity = |differentials_preserved| / |differentials_in_original|
Accept if fidelity >= fidelity_floor (default 0.98).
Reject and re-attempt if below floor.

### Phase 4: Output
Write compact_context to `.opencode/context_cache/session_<timestamp>.md`
Log compression_ratio and fidelity_score to `.opencode/compaction_log.jsonl`

## CLI Usage

```bash
# Standard compaction (auto-threshold at 50k tokens)
python .opencode/skills/context-compactor/scripts/compactor_harness.py

# Force compaction on small contexts
python .opencode/skills/context-compactor/scripts/compactor_harness.py --force

# Custom token budget
python .opencode/skills/context-compactor/scripts/compactor_harness.py --token-budget 20000

# Include extra files
python .opencode/skills/context-compactor/scripts/compactor_harness.py --extra spec.md migration.md

# Print compacted output to stdout
python .opencode/skills/context-compactor/scripts/compactor_harness.py --print-output
```

## Output Artifacts

| Artifact | Location | Purpose |
|----------|----------|---------|
| Compact context | `.opencode/context_cache/session_<id>.md` | Fed to main agent |
| Compaction log | `.opencode/compaction_log.jsonl` | Audit trail + self-improvement |
| Delta log | Embedded in NEURO response | What was preserved vs removed |

## Failure Behavior

- If NEURO API unavailable: do NOT compact. Pass raw context.
- If fidelity below floor after retries: pass raw context with warning.
- Never silently drop information.
