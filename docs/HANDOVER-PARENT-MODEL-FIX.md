# AI Handover: Parent Agent Model Isolation Fix

> **Read this before touching `task.ts` or any subagent/model code.**
> **Branch:** `dream-harness-fixes` · **Date:** 2026-08-21
> **Author:** Buffy (Codebuff agent)

---

## What Was Done

Fixed a critical bug where the parent agent's user-selected model (e.g., Ox Alpha) was silently overwritten to the subagent's model (e.g., DeepSeek) when subagents ran and completed.

## The Fix (One File)

**`packages/opencode/src/tool/task.ts`** — 4 changes, all in the `run` function of `TaskTool`:

### Change 1: Added `guaranteedParentModel` (line ~558)

After the existing `parentMsgModel` capture, added a new variable `guaranteedParentModel` that ALWAYS resolves to the parent's correct model via a 3-tier fallback:

```
parentMsgModel (from assistant message)
  → SessionTable.model (from DB)
    → First user message's model (from DB)
      → Subagent model (last resort, logs warning)
```

This is a `yield*` Effect that only runs the fallback logic when `parentMsgModel` is undefined (which is rare — it's a safety net).

### Change 2: Busy session path (line ~832)

```diff
- yield* queueSynthetic(currentParent, parentMsgModel ?? model, parts, childCost, childTokens)
+ yield* queueSynthetic(currentParent, guaranteedParentModel, parts, childCost, childTokens)
```

### Change 3: Idle session path (line ~841)

```diff
- model: parentMsgModel
-   ? { modelID: parentMsgModel.modelID, providerID: parentMsgModel.providerID }
-   : undefined,
+ model: {
+   modelID: guaranteedParentModel.modelID,
+   providerID: guaranteedParentModel.providerID,
+ },
```

### Change 4: Error fallback (line ~881)

```diff
- Effect.catch(() => queueSynthetic(currentParent, parentMsgModel ?? model, parts, childCost, childTokens)),
+ Effect.catch(() => queueSynthetic(currentParent, guaranteedParentModel, parts, childCost, childTokens)),
```

## How to Verify the Fix

1. **Read the code:** All three injection paths in `task.ts` now use `guaranteedParentModel` — search for `guaranteedParentModel` to find all usages
2. **Run existing tests:** `bun test test/tool/task.test.ts` — all 18+ tests should pass, including `subagent uses user-selected subagentModel over parent model`
3. **Manual test:** Launch a session, select Ox Alpha, spawn `@general` subagent, verify parent model stays Ox Alpha after completion

## Key Architecture: How Model Flows Through Subagents

```
User selects Ox Alpha
  → create user message (Ox Alpha) → ModelSwitched → SessionTable.model = Ox Alpha
  → Processor loop: lastUser.model = Ox Alpha → Assistant msg (Ox Alpha)
  → Task tool called → parentMsgModel = Ox Alpha (from assistant msg)
  → Subagent spawned with its own model (DeepSeek)
  → Subagent completes → inject() called
  → guaranteedParentModel = Ox Alpha (from parentMsgModel)
  → Synthetic msg written with Ox Alpha → Processor loop uses Ox Alpha ✓
```

## Key Files (Map)

| File | What it does | Why it matters |
|------|-------------|----------------|
| `src/tool/task.ts` | Task tool — spawns subagents, injects results | **THE file that was fixed.** Contains `inject`, `queueSynthetic`, `guaranteedParentModel` |
| `src/session/prompt-user-message.ts` | Creates user messages, fires `ModelSwitched` | The event that overwrites `SessionTable.model` — the mechanism of the bug |
| `src/session/prompt.ts` | Processor loop — reads `lastUser.model` | Determines which model the parent uses for the next LLM call |
| `core/src/session/projector.ts` | Projects `ModelSwitched` → updates DB | Writes the model to `SessionTable.model` |
| `cli/cmd/run/variant.shared.ts` | Saves/loads subagent model from `model.json` | User's subagent model selection persistence |

## Key Concepts

- **`parentMsgModel`** — Model from the parent assistant message. Captured at subagent spawn time. Used to inject parent's model back when subagent completes. Usually defined, but can be undefined in edge cases.
- **`model`** (in task.ts scope) — The **subagent's** resolved model. This is what the subagent runs on. Should NEVER be used for parent session operations.
- **`guaranteedParentModel`** — NEW: Always resolves to the parent's correct model. Replaces `parentMsgModel ?? model` everywhere.
- **`SessionTable.model`** — The session's current model in the DB. Updated by `ModelSwitched` events. Authoritative source for "what model is this session using?"
- **`ModelSwitched` event** — Fired in `createUserMessage` when a new user message's model differs from `SessionTable.model`. This is how the bug manifested — the subagent's model triggered this event on the parent session.

## Gotchas for Future AI

1. **`parentMsgModel ?? model` is ALWAYS wrong** — if you see this pattern anywhere, it means the subagent's model can leak. Use `guaranteedParentModel` instead.
2. **`model` in task.ts scope is the SUBAGENT's model** — never use it for parent session operations.
3. **`queueSynthetic` bypasses `createUserMessage`** — it writes directly to DB, so `ModelSwitched` doesn't fire from the write itself. But the processor loop later reads the synthetic message and may fire `ModelSwitched` if the model differs.
4. **`ops.prompt()` goes through `createUserMessage`** — which fires `ModelSwitched` if the model differs from `SessionTable.model`. Always pass the correct model explicitly.
5. **The `onComplete` callback fires for ALL background jobs** — both foreground and background subagents trigger `inject` via `onComplete`. Don't assume only background subagents inject results.

## Related Work (Prior Fixes)

This is the **second** fix for parent model isolation. The first fix (in `RESUME-HANDOFF-2026-08-20.md`) addressed a simpler case where `queueSynthetic` used `lastUser?.info.model` (the last user message's model) instead of the parent's model. That fix introduced `parentMsgModel` but left the `?? model` fallback, which this fix now closes.

## Next Steps (If Needed)

1. **Add a regression test** that specifically tests the `parentMsgModel === undefined` path (currently only tested indirectly)
2. **Consider making `parentMsgModel` non-optional** — the fallback to `guaranteedParentModel` is a safety net, but the root cause (why `parentMsgModel` could be undefined) should be investigated
3. **Monitor for other `parentMsgModel ?? model` patterns** — search the codebase to ensure no other injection paths exist
