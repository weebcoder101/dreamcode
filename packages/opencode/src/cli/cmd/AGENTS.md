# Command-specific notes

## In-process server (`run.ts`)

The `dreamcode run` command uses an in-process HTTP server via `Server.Default().app.fetch(request)`. This is DIFFERENT from the `dreamcode serve` command:

- **No real HTTP listener**: The in-process server uses `HttpRouter.toWebHandler` which creates a bare fetch handler. It does NOT expose a TCP port (unless `--port` is explicitly provided, which runs a separate `listen`).
- **No ConfigProvider layer**: Unlike `listenerLayer`, the in-process path doesn't provide `ConfigProvider.layer(ConfigProvider.fromEnv())`. `Config.string(...)` calls use the default (module-level cached) ConfigProvider.
- **No WebSocketTracker, no real HttpServer**: Services depending on these will fail silently.
- **UI catch-all disabled**: The `/*` catch-all route that proxies to `app.dreamcode.ai` is excluded via `createRoutes(undefined, { serveUI: false })`.

**Error surface**: Errors from the in-process server propagate through `causeResponse` (`HttpServerError.ts:283`). If the errorLayer middleware doesn't catch the error (route-level middleware won't catch route-not-found), the framework produces `internalServerError()` — an empty 500 body. This manifests as "Session not found" in the CLI because the SDK receives an unparseable 500 response.

**SDK fetch adapter**: The `fetchFn` at `run.ts:875` wraps `Server.Default().app.fetch(request)`. The SDK's `createOpencodeClient({ fetch: fetchFn, directory })` sends `directory` as both `x-opencode-directory` header and `?directory=` query param (GET/HEAD only). This is consumed by `workspaceRoutingLayer` → `defaultDirectory()` at `middleware/workspace-routing.ts:86`.

## model.json Concurrent Access (variant.shared.ts, local.tsx)

`~/.local/state/opencode/model.json` is written from THREE code paths using TWO different I/O paradigms:

1. **`variant.shared.ts:saveVariant()`** — Effect `FSUtil.writeJson` (async). Uses `{...current, variant: next}` which preserves `subagentModel` and other fields via spread.
2. **`variant.shared.ts:saveSubagentModel()`** — synchronous `fs.writeFileSync` with atomic tmp+rename. Preserves existing fields via `{...data, subagentModel}`.
3. **`tui/src/context/local.tsx:save()`** — async `readJson` + `writeJsonAtomic`. Writes `recent`, `favorite`, `variant`. **Catch branch (line 181-187) drops `subagentModel`** — if the initial read fails, the fallback write only contains TUI-local fields.

**TOCTOU race**: Because path 1 is async and paths 2/3 are async (3) or sync (2), a read-modify-write cycle in path 1 creates a window where another writer's changes are lost.

**No cross-writer field preservation**: The TUI's model store (`modelStore`) does not track `subagentModel` — it's only stored in `variant.shared.ts`'s `ModelState` type. Any TUI write that takes the catch branch silently erases it.

**Fix**: Either (a) centralize all `model.json` writes through a single coordinator, or (b) add `subagentModel` to the TUI's model store so it's always round-tripped.

### Implicit filesystem contract: tool/task.ts reads model.json directly

`resolveUserSubagentModel` at `tool/task.ts:92` reads `~/.local/state/opencode/model.json` directly via `fs.readFile` and `JSON.parse`. This creates an implicit compile-time coupling between the `tool/task.ts` module and the file format written by two independently-maintained code paths:
- `variant.shared.ts:saveSubagentModel()` (CLI `run` command, Effect sync)
- `local.tsx:syncModelJson()` (TUI, async writeQueue)

There is NO typed interface or schema validation between the producers and consumer. If a producer adds a new nesting level or changes the `subagentModel` key, the consumer silently reads `undefined` with only a debug log (line 106).

### Four model.json writers (not three)

The existing documentation says 3 writers, but `local.tsx` has TWO independent writers:
1. `local.tsx:save()` (line 165) — writes `recent`, `favorite`, `variant`
2. `local.tsx:syncModelJson()` (line 433) — writes `subagentModel`
3. `variant.shared.ts:saveSubagentModel()` (line 229) — writes `subagentModel`
4. `variant.shared.ts:saveVariant()` (line 215) — writes `variant`

Writers 1 and 2 share a file but NOT an I/O pipeline, creating a TOCTOU race within a single file.

## `/subagent` slash command REMOVED (client-side only)

`/subagent` and `/subagents` were removed from:
- Server-side command registry (`command/index.ts:55-59`, `core/plugin/command.ts:33-36`)
- Builtin slash autocomplete options (`footer.prompt.tsx`)
- Command palette footer text (`footer.command.tsx:426`)
- The `isSubagentSlash()` helper (`footer.prompt.tsx`) was removed entirely

Subagent model switching is now purely client-side via `onSubagentModelSelect`/`onSubagentModelClear` callbacks. There is no slash command dispatch for it — the TUI shows a model selector dialog directly. If typed as `/subagent provider/model` raw text, `submitPrompt()` no longer has a special handler; it falls through to `parseSlashCommand` which issues an unnecessary IPC round-trip.

## `select()` reentrancy guard (footer.prompt.tsx:841-845)

The `select()` function uses a `selecting` boolean to prevent recursive dispatch. Without this guard, `options()` memo lookup triggered during `select()` can propagate signal changes that call `select()` again before the first call completes. The guard drops nested invocations silently.

## Model Resolution

### Parent vs subagent model separation

`runPromptTurn` at `runtime.ts:667` must use `state.model` (the main model), NOT `state.subagentModel`. The subagent model is resolved inside the stream transport layer via `RunInput.subagentModel`. Using `state.subagentModel` in `runPromptTurn` caused ALL prompts (including parent agent prompts) to use the subagent model, not just subagent-generated prompts.

### Provider validation timing gap in `onSubagentModelSelect`

The `onSubagentModelSelect` handler at `runtime.ts:322` removed provider validation against `state.providers` because providers may not have loaded yet (deferred `modelTask` at `runtime.ts:445`). The TUI-side `isModelValid()` already validates before calling the handler; the Effect-side should trust the caller's validation.

### Subagent "clear" = reset to parent model, not disable

`onSubagentModelClear` at `runtime.ts:326-328` sets `state.subagentModel = state.model` before calling
`clearSubagentModel()`. This means "clearing" the subagent model resets it to the parent model, not to
undefined. `tool/task.ts:103-104` checks `data?.subagentModel` — after clear, this reads the parent
model, which is the intended behavior but non-obvious from the name "clear".

### Sync vs async I/O to model.json in variant.shared.ts

`variant.shared.ts` has THREE write paradigms to the same file (`model.json`):

1. **`saveVariant()` (line 162)** — Effect `FSUtil.writeJson` (async promise). Uses `{...current, variant: next}` spread.
2. **`saveSubagentModel()` (line 229)** — sync `fs.writeFileSync` with tmp+rename atomic pattern.
3. **`clearSubagentModel()` (line 251)** — sync `fs.writeFileSync` with tmp+rename, uses `delete data.subagentModel`.

The mix of async (Effect) and sync (direct fs) I/O to the same file creates a TOCTOU race:
- `saveVariant()` does async read-modify-write — between `readJson` and `writeJson`, another sync writer
  can modify the file, and those changes are lost.
- `saveSubagentModel()` uses sync tmp+rename to avoid partial-write corruption, but this doesn't protect
  against concurrent reads from the async path.

Any new writer to `model.json` must use the same I/O paradigm or go through a single coordinator.
