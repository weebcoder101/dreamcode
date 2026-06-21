# Subagent Model Selector — Active Plan

## Goal
Make `/subagent` work exactly like `/models` — opens the same `RunModelSelectBody` popup, but sets the subagent model instead of parent model.

## Current Status: COMPLETE ✅
- Binary v1.3.2 built and verified
- Replaced fragile `subagentIntercepted` boolean with clean `interceptSubagent()` function
- `/subagent off` now clears the subagent model (was dead code)
- Duplicate `/subagents` removed from autocomplete
- All 3 entry points use same clean function

## Architecture
- `/subagent` is a TUI-only intercept, NOT a registered command
- Uses same `RunModelSelectBody` component as `/models`
- Persistence: `~/.local/state/opencode/model.json` → `{ subagentModel: { providerID, modelID } }`
- Task tool reads via `resolveUserSubagentModel()` in `task.ts:92`

## Remaining Issues (LOWER priority)
1. **Dual persistence paths** — `task.ts` and `variant.shared.ts` read the same file independently
2. **No model validation** — saved model ID could become unavailable
3. **Silent error swallowing** — no user feedback on load failures
4. **No tests** for intercept logic
5. **Hollow core command** — `command.ts:33-36` registers empty template
