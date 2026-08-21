# TOTAL LOG — Everything, Fully Explained

Complete chronological record of the DreamCode harness work: what was built,
why, how it works internally, and how to verify it. For reference-style
architecture detail see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 2026-08-20 — Harness Improvement Program

A 47-item improvement plan was executed against the agent loop
(`docs/HARNESS-IMPROVEMENT-PLAN.md`). Highlights, fully explained:

### KV-cache-aware system prompt (§3)
The system prompt was split into a stable cached prefix and a dynamic tail.
Rationale: any byte change in the prefix re-bills ~250k tokens at cache-miss
price. Dynamic content (date, taste, knowledge, historical context) moved to
the tail so per-turn changes cost only the small tail re-bill.

### Tiered tool-output compression (§4)
`compactToolOutputMax()` compresses by content type: errors keep 200 chars
(error messages are dense signal), reads/bash 800, grep/glob 500. Based on
ACON research showing tiered limits preserve more information per token than a
flat cap.

### Memory index without embeddings (§3.6)
`memory-index.ts` — compaction summaries indexed to disk, retrieved with a
BM25-lite scorer (idf-weighted term overlap + recency boost). Deliberate
trade-off: deterministic, offline, free; embeddings can be swapped in later by
replacing only the scorer. Injected as `<historical-context>` in the SYSTEM
TAIL, once per user message — KV-cache-safe.

### Session checkpoints (§7.1)
`checkpoint.ts` — debounced best-effort writes of loop state (step, toolCalls,
compacting flag, resume hint) before risky operations. On crash/resume, a
`<checkpoint-resume>` block tells the next turn to continue, not restart.
Cleared on normal completion so hints never fire spuriously.

### Taste-weighted model routing (§2.5, §6.4)
`.dreamcode/taste.md` → tier adjustment (+1/0/−1) via regex signals, cached
5 minutes. Combined with per-workflow routing: compaction/exploration→cheap,
research→balanced, implementation/testing/debugging→capable. `adjustTier()`
clamps to the valid range.

### Hierarchical subagent decomposition (§6.1)
Complex task descriptions ("and then", "step 2", "first…finally") are split
into ordered subtasks so no single subagent overflows context.

### Warm system prompt (§3.1)
`warmPrefix()` forces computation of env/skills/knowledge at session start so
the first user message hits a warm cache instead of paying a full-prefix miss.

---

## 2026-08-21 — Parent Agent Model Isolation Fix

**Symptom**: after subagent completion, the parent TUI switched to the
subagent's model; `SessionTable.model` showed the wrong model.

**Root cause**: `queueSynthetic`/`inject` in `task.ts` used
`parentMsgModel ?? model`. When `parentMsgModel` was undefined (compacted
messages, DB races), the fallback was the SUBAGENT's model, leaked via
`ModelSwitched` events.

**Fix**: `guaranteedParentModel` — 3-tier fallback (parent assistant message
model → `SessionTable.model` → first user message model) used on all three
injection paths.

**Key rule**: `parentMsgModel ?? model` is ALWAYS wrong in injection paths;
`model` in task.ts scope is the subagent's model.

Docs: `PARENT-MODEL-ISOLATION-FIX.md`, `HANDOVER-PARENT-MODEL-FIX.md`,
`CHANGELOG-2026-08-21.md`.

---

## 2026-08-21 — Security Hardening Pass

Full scan of all 89 changed files for exec/eval/secrets/injection patterns.
Two real vulnerabilities found and fixed:

### V1: Path traversal in checkpoints (`checkpoint.ts`)
`checkpointPath(sessionID)` interpolated raw session IDs into file paths — a
crafted ID (`../../evil`) could write/read/delete outside the checkpoint dir.
**Fix**: sanitize to `[A-Za-z0-9_-]`. Verified: traversal attempt contained
(`sanitize-ok`).

### V2: Unvalidated index deserialization (`memory-index.ts`)
`loadIndex()` blind-cast parsed JSON into `MemoryEntry[]`; tampered entries
flowed unbounded into the system prompt. **Fix**: shape-validate every entry
(required string fields, finite ts number) and cap lengths (id/sessionID ≤200,
title ≤120, text ≤2000). Verified module loads + guard works (`guard-ok`).

No other issues: `dream-gate-learn.ts` and `dev-watch.ts` write only fixed
0o600-mode paths.

---

## 2026-08-21 — Dream Gate Teaching Feedback

**Discovery**: identical plans passed or blocked depending on ORDER. The gate
reads `processor.accumulatedText`, which contains only text accumulated after
the most recent tool result — every tool result flushes the buffer. Plan
before correlation call → invisible → block. Correlation → plan → edit → pass.

**Decision**: keep strict enforcement (a stale plan from before a tool result
is exactly the drift the gate exists to catch); improve knowledge instead:

1. `DREAM_GATE_ERROR` now includes "Why you were blocked": explains the flush
   mechanism and gives the recovery recipe (correlation → fresh full plan →
   edit, one message).
2. AGENTS.md Dream Gate Workflow gained the critical ordering rule up front:
   *plan text must be the LAST text before the edit*.

Verified: bun build passes; message exports correctly.

---

## 2026-08-21 — Command Code Mod Sync

The Dream Gate ships as a Command Code mod (`~/.commandcode/mods/dream-gate.ts`,
mirrored at `.commandcode/mods/dream-gate.ts`). It hooks `beforeToolCall`,
accumulates streamed text (`text_delta` / `message_end` / `message_update`),
tracks per-file planned state across one turn, allows low-risk mutations
(format/lint-fix/dotfiles), and blocks unplanned edits with the same teaching
message as the core harness. Updated with the "Why you were blocked" section
so both harnesses teach identically.

Upstream repo: https://github.com/weebcoder101/commandcode-mods

---

## Verification Commands Used

```bash
# Gate message integrity
bun build --target=bun src/session/dream-gate.ts --outdir /tmp/check
bun -e 'const m = await import("./src/session/dream-gate.ts");
        console.log(m.DREAM_GATE_ERROR.includes("Why you were blocked"))'

# Checkpoint traversal guard
bun -e 'const {SessionCheckpoint} = await import("./src/session/checkpoint.ts");
        SessionCheckpoint.writeCheckpoint({sessionID:"../../evil", ...});
        // expect sanitize-ok'

# Memory index guard
bun -e 'const {MemoryIndex} = await import("./src/session/memory-index.ts");
        console.log(MemoryIndex.historicalContextBlock("short"))'
```

---

## Open Items

- Body Text style mapping (converter v5, C3) — unrelated to harness, tracked in AGENTS.md RE notes.
- Embedding swap-in for memory-index scorer (design allows drop-in replacement).
- Learned-gate threshold EMA tuning per project (weights logged for audit).
