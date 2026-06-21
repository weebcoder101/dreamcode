# TUI Context Learnings

## model.json Write Path (local.tsx)

The `save()` function at `local.tsx:165` writes `recent`, `favorite`, and `variant` fields to `~/.local/state/opencode/model.json`.

- **Catch branch drops subagentModel**: Line 181-187 — if `readJson` fails (first-ever read or transient error), the fallback write creates `{ recent, favorite, variant }` without the `subagentModel` field that `variant.shared.ts:saveSubagentModel()` stores there.
- **No subagentModel tracking**: The `modelStore` reactive store does not include a `subagentModel` field. It's only tracked by `variant.shared.ts`'s `ModelState` type, creating a split-brain between the TUI and CLI `run` command.

**Note**: The fix for this split-brain used NEITHER of the two original options (add to TUI store or externalize to Effect). Instead, a new `subagent.json` file was introduced as the TUI's canonical source, with `syncModelJson()` bridging TUI→CLI direction only. See "Dual-file subagent storage" below.

## Dual-file subagent storage (subagent.json + model.json)

The subagent model is stored in TWO files:
1. **`subagent.json`** — primary TUI store. Written by subagent `save()` at line 460 via `writeQueue`.
2. **`model.json`'s `subagentModel` field** — read by `variant.shared.ts:resolveSavedSubagentModel()` for the CLI `run` command and `tool/task.ts`. Written by `syncModelJson()` at line 438.

`syncModelJson()` bridges TUI→CLI direction only. CLI writes via `variant.shared.ts:saveSubagentModel()` go directly to `model.json` without updating `subagent.json`. The two sources of truth can diverge: the TUI picks up the stale `subagent.json` value on restart even if a CLI command changed `model.json` in between.

## writeQueue promise-chain serialization

`local.tsx:431` uses `writeQueue = writeQueue.then(...)` to serialize async file writes. The `.catch()` at line 449/462 is attached to the NEW promise returned by `.then()`, not the chain itself — a failure in one queued operation does NOT stop subsequent operations. This is a fire-and-forget serialization pattern, not a proper mutex.

Additional fragility: `syncModelJson()` (line 464, called after every `save()`) is serialized on the same `writeQueue`. If `save()` rejects, `syncModelJson()` never runs, leaving `model.json` with stale `subagentModel`.

## readJson + spread defensive pattern

The general pattern to prevent destructive overwrites of shared JSON files:
```
readJson<Record<string, unknown>>(filePath)
  .then((existing) => writeJsonAtomic(filePath, { ...(existing ?? {}), myField: value }))
  .catch(() => writeJsonAtomic(filePath, { myField: value }))
```
The `.then()` path preserves unknown fields via spread. The `.catch()` fallback (line 181-187) is the primary source of data loss — if the initial read fails, all previously written fields from other writers are dropped. When adding a new writer to a shared JSON file, always spread existing data first.
