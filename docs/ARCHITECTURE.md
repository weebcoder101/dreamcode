# DreamCode Harness Architecture — Full Reference

This document describes the complete enforcement and intelligence architecture of
the DreamCode harness: the Dream Gate, the Sensor Gate, persona spawning, skill
chains, memory systems, and how they all fit together. For a chronological record
of every change, see [TOTAL-LOG.md](TOTAL-LOG.md).

---

## 1. The Big Picture

```
User Prompt
    │
    ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  SENSOR GATE    │────▶│  GUARDIAN AI     │────▶│  SKILL CHAIN LOAD   │
│  (classify)     │     │  (risk approval) │     │  (MUST-LOAD skills) │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
    │                                                     │
    │ persona spawn decision                              ▼
    ▼                                             ┌───────────────┐
┌─────────────────┐                               │ LLM GENERATES │
│ PERSONA SPAWNING│                               └───────┬───────┘
│ (specialists)   │                                       │
└─────────────────┘                                       ▼
                          ┌───────────────────────────────────────────┐
                          │              DREAM GATE                   │
                          │  (per-file plan enforcement on mutations) │
                          └───────────────────────────────────────────┘
```

There are two gates with very different jobs:

| | Sensor Gate | Dream Gate |
|---|---|---|
| **When** | Before the LLM runs (per user turn) | During tool execution (per mutation) |
| **Job** | Classify intent, pick skills, decide personas | Enforce plan-before-edit on file mutations |
| **Failure mode** | Wrong/missing skill chain | Unplanned edit slips through |
| **Cost** | Cheap Python classifier, no LLM call | Zero — regex + learned scoring |

---

## 2. Sensor Gate

**File**: `docs/sensor-gate.md` (detail), Python classifier upstream of the LLM.

On every user turn the sensor gate produces structured JSON:

- `intent`, `domain_tags`, `risk_level`, `confidence`, `complexity`
- `primary_skill` + `support_skills` → the **skill chain**
- `guardian_decision` / `guardian_risk` — Guardian AI risk approval
- `mode` — e.g. `DREAM_INNOVATION`
- `personas` — specialist agents to spawn (see §4)

The chain obligation is injected into the system prompt as
`<skill-chain-obligation>` with per-skill states:

- `[EXECUTED]` — automation script pre-ran; model must load `SKILL.md`
- `[ALREADY-LOADED]` — content already in context; must NOT reload
- `[MUST-LOAD]` — model must call the skill tool before executing

Idempotency is explicit: the header reports how many of N chain skills are
already loaded so the model never double-loads.

### Minimal cost mode

`<sensor-gate state="minimal">` disables persona spawning entirely while skills
and chains still execute normally. This is the cost-control lever: personas are
the most expensive part of the pipeline (each spawns its own LLM session).

---

## 3. Dream Gate (plan-before-edit enforcement)

**Files**: `packages/opencode/src/session/dream-gate.ts` (verdict logic),
`packages/opencode/src/session/tools.ts:249-289` (real enforcement point),
`packages/opencode/src/session/dream-gate-learn.ts` (online learner).

### The rule

A mutating tool (`edit`, `write`, `apply_patch`, `patch`) may only run if the
current assistant message carries a plan marker naming the target file, and the
first mutating edit of a turn must follow a correlation step (`relations`,
`lsp`, `read`, `grep`, `glob`).

### The critical ordering rule

> **Plan text must be the LAST text before the edit.**

The gate evaluates `input.processor.accumulatedText` — only text accumulated
**after the most recent tool result**. Every tool result flushes that buffer.
Consequences:

- Plan written BEFORE a correlation/tool call → invisible at edit time → block.
- Correlation calls FIRST, then plan text, then edit → passes.

This was empirically confirmed in-session: identical plans passed when emitted
after `relations` and blocked 3× when emitted before it.

### Verdict pipeline (`gateToolCall`)

1. `bypassAgentCheck` → allow (subagents bypass).
2. Non-mutating tool → allow.
3. Low-risk mutation (formatting, lint-fix, dotfile writes) → allow.
4. File already planned this message → allow (per-file approval).
5. Plan marker present:
   - Degenerate (marker, no content) → hard block listing missing sections.
   - Score < learned threshold → **allow + nudge** (advisory sufficiency note).
   - Otherwise → clean allow; file marked planned.
6. No marker → block with rich feedback.

### Learned model (§5.2 v2)

`dream-gate-learn.ts` keeps per-project weights in
`.dreamcode/dream-gate-model.json` (mode 0o600). An EMA-adapted threshold
calibrates plan-sufficiency scoring from turn outcomes. Feature weights are
logged as `name=weight` pairs for auditability.

### Block error teaching

The block message (`DREAM_GATE_ERROR`) does not just reject — it teaches:
it explains the accumulatedText flush mechanism and gives the exact 3-step
recovery recipe (correlation → fresh full plan → edit, one message). Agents
that fail learn the correct pattern from the failure itself.

### Command Code mod parity

The same gate ships as a Command Code mod at `~/.commandcode/mods/dream-gate.ts`
(mirrored in-repo at `.commandcode/mods/dream-gate.ts`). It hooks
`beforeToolCall`, accumulates `text_delta`/`message_end`/`message_update`
events, tracks per-file planned state, and returns `{ block: true,
additionalContext }` with the identical teaching message.

---

## 4. Persona Spawning

Personas are specialist sub-agents (e.g. "The Detective" for root-cause
analysis) selected by the sensor gate when complexity/risk warrants multiple
perspectives. Key properties:

- Spawn decision happens pre-LLM, in the sensor gate JSON (`personas[]`).
- Subagent sessions do NOT re-enter persona spawning (no recursion explosion).
- Capped by `sensor_gate.max_personas` (default 5) — see `docs/config.md`.
- Disabled entirely under `<sensor-gate state="minimal">`.
- Each persona consumes independent tokens — see the cost warning in README.

Persona continuity across compaction is handled by AGENTS.md auto-fire rules
(e.g. the Sumati protocol reloads the persona file after context compaction).

---

## 5. Memory & Session Systems

### Memory Index (`src/session/memory-index.ts`)

Cross-session retrieval without an embedding API. Compaction summaries are
indexed to `<data>/memory-index/index.json` (200-entry FIFO, idempotent per
session+hash), retrieved via BM25-style idf-weighted lexical scoring with a
recency boost, and injected into the SYSTEM TAIL as `<historical-context>` —
KV-cache-safe because the cached prefix is never touched.

Security: `loadIndex()` shape-validates every entry (string types required,
lengths capped: id/sessionID ≤200, title ≤120, text ≤2000) before content can
reach the prompt.

### Session Checkpoints (`src/session/checkpoint.ts`)

Pre-crash state written to `<data>/checkpoints/<sessionID>.json` (debounced,
best-effort). On resume, a `<checkpoint-resume>` hint tells the agent to
continue rather than restart. Checkpoints are cleared on normal turn completion
so resume hints only fire after real interruptions.

Security: `sessionID` is sanitized to `[A-Za-z0-9_-]` before path interpolation
— path traversal (`../../evil`) is impossible.

### Parent Model Isolation (`src/tool/task.ts`)

Subagent models can never leak into the parent session. Injection paths use a
3-tier fallback: parent message model → `SessionTable.model` → first user
message model. Rule: `parentMsgModel ?? model` is ALWAYS wrong in injection
paths. See `docs/PARENT-MODEL-ISOLATION-FIX.md`.

### Taste Routing (`prompt-taste.ts`, task.ts)

`.dreamcode/taste.md` is read (5-min TTL cache) and mapped to a routing tier
adjustment (+1 quality-first / 0 / −1 cost-conscious), applied to per-workflow
model routing (compaction→cheap … implementation→capable).

---

## 6. KV-Cache Discipline

Cross-cutting invariant: dynamic content (taste, knowledge, historical context,
date) lives in the SYSTEM TAIL; the ~250k-token prefix stays byte-identical.
Retrieval runs once per user message (step === 1). Tool-input repairs are
applied in-memory for execution only — DB parts stay byte-identical.

---

## 7. File Map

| Concern | File |
|---|---|
| Gate verdict logic | `packages/opencode/src/session/dream-gate.ts` |
| Gate enforcement point | `packages/opencode/src/session/tools.ts` |
| Online learner | `packages/opencode/src/session/dream-gate-learn.ts` |
| Memory index | `packages/opencode/src/session/memory-index.ts` |
| Checkpoints | `packages/opencode/src/session/checkpoint.ts` |
| Subagent routing/isolation | `packages/opencode/src/tool/task.ts` |
| Taste routing | `packages/opencode/src/session/prompt-taste.ts` |
| Sensor gate docs | `docs/sensor-gate.md` |
| Command Code mod | `.commandcode/mods/dream-gate.ts` (~ mirror: `~/.commandcode/mods/`) |
| Chronological log | `docs/TOTAL-LOG.md` |
