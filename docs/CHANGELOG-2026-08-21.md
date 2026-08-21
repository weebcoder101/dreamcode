# Changelog — August 21, 2026

## 🐛 Bug Fixes

### Fix: Parent agent model isolation (prevents model leak to subagent model)

**Severity:** Critical
**File:** `packages/opencode/src/tool/task.ts`
**Full docs:** [`docs/PARENT-MODEL-ISOLATION-FIX.md`](./PARENT-MODEL-ISOLATION-FIX.md)

**Symptom:** When a user selects a model for the parent agent (e.g., Ox Alpha Free), launching subagents (`@general`, `@deep-research`, etc.) would **silently overwrite the parent agent's model** to the subagent's model (e.g., DeepSeek) after the subagent completed. The parent would continue on the wrong model for all subsequent turns.

**Root cause:** `queueSynthetic` and `inject` in `task.ts` used `parentMsgModel ?? model` as the model for injected results. When `parentMsgModel` was `undefined` (edge cases with compacted assistant messages, DB race conditions, or schema edge cases), the fallback `model` was the **subagent's** resolved model. This leaked into the parent session via `ModelSwitched` events in `prompt-user-message.ts`, which updated `SessionTable.model` in the DB.

The cascade worked as follows:
1. Subagent completes → `inject` called → `parentMsgModel` undefined
2. Fallback to `model` (subagent's DeepSeek) → synthetic message written with DeepSeek
3. Processor loop picks up synthetic message → `lastUser.model` = DeepSeek
4. Assistant message created with DeepSeek → `ModelSwitched` fires
5. `SessionTable.model` overwritten to DeepSeek → permanent model leak

**Fix:** Introduced `guaranteedParentModel` — a **3-tier fallback** that always resolves the parent's correct model:
1. `parentMsgModel` (from the parent assistant message's `modelID`)
2. `SessionTable.model` (the authoritative DB source, set by `ModelSwitched` when the user first sends a message)
3. First user message's model (the user's original selection)

All three injection paths now use `guaranteedParentModel`:
- **Busy session path** (`queueSynthetic`): `parentMsgModel ?? model` → `guaranteedParentModel`
- **Idle session path** (`ops.prompt()`): `parentMsgModel ? { ... } : undefined` → always passes `guaranteedParentModel`
- **Error fallback** (`Effect.catch`): `parentMsgModel ?? model` → `guaranteedParentModel`

The subagent's model can **never** leak into the parent session.

**Tests:** Existing `subagent uses user-selected subagentModel over parent model` in `test/tool/task.test.ts` passes.

---

## Summary

| Category | Count |
|----------|-------|
| Bug Fixes | 1 |
| New Features | 0 |
| Breaking Changes | 0 |

### Files Changed
| File | Change |
|------|--------|
| `packages/opencode/src/tool/task.ts` | Added `guaranteedParentModel` resolution + updated 3 injection paths |
| `docs/PARENT-MODEL-ISOLATION-FIX.md` | New — full technical documentation of the fix |
| `docs/CHANGELOG-2026-08-21.md` | New — this changelog |
| `docs/HANDOVER-PARENT-MODEL-FIX.md` | New — AI handover document |
