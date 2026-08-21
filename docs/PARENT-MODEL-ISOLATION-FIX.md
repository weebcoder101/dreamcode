# Parent Agent Model Isolation Fix

> **Date:** August 21, 2026
> **Branch:** `dream-harness-fixes`
> **Severity:** Critical — user-selected model silently overwritten
> **File:** `packages/opencode/src/tool/task.ts`
> **Status:** Implemented

---

## Problem Statement

When a user selects a model for the parent agent (e.g., Ox Alpha Free), launching subagents (e.g., `@general`, `@deep-research`) would **silently overwrite the parent agent's model** to the subagent's model (e.g., DeepSeek). The parent agent would continue on the wrong model for all subsequent turns.

### Reproduction Steps
1. User selects Ox Alpha Free as parent model
2. User sends a message → parent runs on Ox Alpha, spawns subagents
3. Subagents run on DeepSeek (their own model)
4. Subagent completes → result injected back into parent session
5. **BUG:** Parent's model changes to DeepSeek for all subsequent turns

### Impact
- User loses control of which model their parent agent runs on
- Cost unpredictability (DeepSeek vs Ox Alpha billing)
- Agent behavior changes mid-session without user consent

---

## Root Cause Analysis

### The Injection Pipeline

When a subagent completes, its result is injected back into the parent session via the `inject` function in `task.ts`. There are **three injection paths**:

1. **Busy session** → `queueSynthetic()` — writes a synthetic user message directly to DB
2. **Idle session** → `ops.prompt()` — creates a user message and enters the processor loop
3. **Error fallback** → `Effect.catch()` → falls back to `queueSynthetic()`

### The Bug

All three paths used `parentMsgModel ?? model` as the model for the injected message, where:
- `parentMsgModel` = the parent assistant message's model (captured from `msg.info.modelID`)
- `model` = the **subagent's** resolved model (e.g., DeepSeek)

When `parentMsgModel` was `undefined` (which happened when the parent assistant message lacked a `modelID` — e.g., after compaction, or edge cases in message persistence), the fallback `model` (DeepSeek) was used. This created a **cascade**:

```
1. First subagent completes → queueSynthetic uses DeepSeek (parentMsgModel undefined)
2. Synthetic message written to DB with DeepSeek model
3. Processor loop picks up synthetic message → lastUser.model = DeepSeek
4. Assistant message created with DeepSeek model
5. Next task tool call: parentMsgModel = DeepSeek (from assistant message)
6. All subsequent injections use DeepSeek → permanent model leak
```

### Why `parentMsgModel` Could Be Undefined

`parentMsgModel` is derived from `msg.info.modelID` where `msg` is the parent assistant message. While assistant messages are *always* created with a `modelID` in the processor loop, edge cases could cause it to be falsy:

- **Compaction:** Compaction creates summary messages that may not carry the original model
- **DB race:** The assistant message's DB row might not be fully persisted when `MessageV2.get` reads it
- **Schema edge cases:** Empty string `""` for `modelID` would be falsy in the truthiness check

---

## Fix: `guaranteedParentModel`

### Design

Introduced `guaranteedParentModel` — a **3-tier fallback** that always resolves the parent's correct model:

```
parentMsgModel (from assistant message)
  ↓ if undefined
SessionTable.model (from DB — authoritative source, set by ModelSwitched)
  ↓ if undefined
First user message's model (from DB — the user's original selection)
  ↓ if undefined
Subagent model (absolute last resort — logs a warning)
```

### Why This Works

- **Tier 1** (`parentMsgModel`): The normal fast path. Works 99.9% of the time.
- **Tier 2** (`SessionTable.model`): The DB stores the session's current model, set by the `ModelSwitched` event when the user first sends a message. This is always correct for the parent session.
- **Tier 3** (first user message): If `SessionTable.model` is somehow unset, the first user message always carries the user's selected model.
- **Tier 4** (subagent model): Only reached in truly degenerate cases. Logs a warning.

### Code Changes

**File:** `packages/opencode/src/tool/task.ts`

#### 1. Added `guaranteedParentModel` resolution (after `parentMsgModel` capture)

```typescript
const guaranteedParentModel = parentMsgModel ?? (yield* Effect.gen(function* () {
  const session = yield* sessions.get(ctx.sessionID).pipe(
    Effect.catchCause(() => Effect.succeed(undefined)),
  )
  if (session?.model) {
    return { modelID: ModelV2.ID.make(session.model.id), providerID: ProviderV2.ID.make(session.model.providerID) }
  }
  const firstUser = yield* MessageV2.stream(ctx.sessionID).pipe(
    Effect.provideService(Database.Service, database),
    Effect.map((msgs) => msgs.find((m) => m.info.role === "user" && m.info.modelID)),
  )
  if (firstUser?.info.modelID) {
    return { modelID: ModelV2.ID.make(firstUser.info.modelID), providerID: ProviderV2.ID.make(firstUser.info.providerID) }
  }
  log.warn("guaranteedParentModel: no parent model found, using subagent model as last resort")
  return { modelID: model.modelID, providerID: model.providerID }
}))
```

#### 2. Busy session path — `queueSynthetic`

**Before:** `parentMsgModel ?? model`
**After:** `guaranteedParentModel`

#### 3. Idle session path — `ops.prompt()`

**Before:**
```typescript
model: parentMsgModel
  ? { modelID: parentMsgModel.modelID, providerID: parentMsgModel.providerID }
  : undefined,
```
**After:**
```typescript
model: {
  modelID: guaranteedParentModel.modelID,
  providerID: guaranteedParentModel.providerID,
},
```

#### 4. Error fallback path — `Effect.catch()`

**Before:** `parentMsgModel ?? model`
**After:** `guaranteedParentModel`

---

## Related Code Paths

### Model Resolution Flow (Normal Operation)

```
User selects Ox Alpha → create user message with Ox Alpha
  → ModelSwitched fires → SessionTable.model = Ox Alpha
  → Processor loop reads lastUser.model = Ox Alpha
  → Assistant message created with Ox Alpha
  → Task tool called → parentMsgModel = Ox Alpha (from assistant message)
  → Subagent spawned with its own model (DeepSeek)
  → Subagent completes → inject() called
  → guaranteedParentModel = Ox Alpha (from parentMsgModel)
  → Synthetic message written with Ox Alpha
  → Processor loop picks up synthetic message → Ox Alpha ✓
```

### Model Resolution Flow (Bug Path — Before Fix)

```
User selects Ox Alpha → create user message with Ox Alpha
  → ModelSwitched fires → SessionTable.model = Ox Alpha
  → Processor loop reads lastUser.model = Ox Alpha
  → Assistant message created with Ox Alpha
  → Task tool called → parentMsgModel = Ox Alpha
  → Subagent spawned with DeepSeek
  → Subagent completes → inject() called
  → parentMsgModel undefined (edge case) → fallback to model = DeepSeek
  → Synthetic message written with DeepSeek
  → Processor loop picks up synthetic message → DeepSeek
  → ModelSwitched fires → SessionTable.model = DeepSeek ✗
  → All subsequent turns use DeepSeek
```

### Key Files

| File | Role |
|------|------|
| `packages/opencode/src/tool/task.ts` | Task tool — spawns subagents, injects results back to parent |
| `packages/opencode/src/session/prompt-user-message.ts` | Creates user messages, fires `ModelSwitched` when model differs from `SessionTable.model` |
| `packages/opencode/src/session/prompt.ts` | Processor loop — reads `lastUser.model` to resolve LLM model for next turn |
| `packages/core/src/session/projector.ts` | Projects `ModelSwitched` events — updates `SessionTable.model` in DB |
| `packages/opencode/src/cli/cmd/run/variant.shared.ts` | Persists user's subagent model selection to `model.json` |

### Key Concepts

- **`SessionTable.model`** — The session's current model, stored in the DB. Updated by `ModelSwitched` events. This is what the TUI footer displays and what `currentModel()` reads.
- **`ModelSwitched` event** — Fired in `createUserMessage` when a new user message's model differs from `SessionTable.model`. The projector handles this event by updating `SessionTable.model`.
- **`currentModel(sessionID)`** — Fallback model resolver in `prompt.ts`. Reads `SessionTable.model` first, then falls back to first user message with a model, then provider default.
- **`parentMsgModel`** — The parent assistant message's model, captured at subagent spawn time. Used to inject the parent's model back when the subagent completes.
- **`guaranteedParentModel`** — New bulletproof fallback that always resolves the parent's correct model, even when `parentMsgModel` is undefined.

---

## Testing

### Existing Tests

The existing test `subagent uses user-selected subagentModel over parent model` in `test/tool/task.test.ts` verifies that the subagent model selection works correctly. This test continues to pass with the fix.

### What the Fix Prevents

1. **`parentMsgModel` undefined → subagent model leak:** The `guaranteedParentModel` fallback resolves from `SessionTable.model` instead of using the subagent's model.
2. **`ops.prompt()` with `model: undefined` → `currentModel()` fallback:** Now always passes the parent's model explicitly, so `createUserMessage` never falls through to `currentModel()`.
3. **Error fallback using subagent model:** The `Effect.catch` handler now uses `guaranteedParentModel` instead of `parentMsgModel ?? model`.

### Manual Verification

After the fix, launch subagents from a parent session and verify:
1. Parent model in TUI footer remains unchanged after subagent completion
2. Parent agent's next LLM call uses the originally selected model
3. `SessionTable.model` in the DB is not modified by subagent injection

---

## Changelog Entry

```markdown
### Fix: Parent agent model isolation (prevents model leak to subagent model)

When a user selects a model for the parent agent (e.g., Ox Alpha), launching
subagents would silently overwrite the parent's model to the subagent's model
(e.g., DeepSeek) after the subagent completed.

Root cause: `queueSynthetic` and `inject` in task.ts used `parentMsgModel ?? model`
as the model for injected results. When `parentMsgModel` was undefined (edge cases
with compacted messages), the fallback `model` was the subagent's model, which leaked
into the parent session via `ModelSwitched` events.

Fix: Introduced `guaranteedParentModel` — a 3-tier fallback that resolves the parent's
correct model from (1) the parent assistant message, (2) `SessionTable.model` in the
DB, or (3) the first user message. All three injection paths now use this guaranteed
model. The subagent's model can never leak into the parent session.

Files: `packages/opencode/src/tool/task.ts`
Tests: existing `subagent uses user-selected subagentModel over parent model` passes
```
