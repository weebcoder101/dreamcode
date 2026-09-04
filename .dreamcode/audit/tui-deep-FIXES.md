# TUI Package Deep Audit — Fixes

**Companion to**: `tui-deep-FINDINGS.md`
**Date**: 2026

This document describes fixes for all P0 and P1 findings. P2 and P3 fixes are noted in the
findings file but not actioned in this round (deferred to follow-up waves).

---

## P0 Fixes (must-fix, in priority order)

### FIX-1: `context/local.tsx` — `writeQueue` catch chain bug

**File**: `packages/tui/src/context/local.tsx` (lines ~431, 449, 462)

**Problem**: `writeQueue = writeQueue.then(...)` serializes writes; the `.catch` is attached to the
*new* promise each iteration, not the chain root. If a write rejects, the catch on the new promise
unblocks but the original chain is poisoned.

**Fix**:
```ts
let writeQueue: Promise<unknown> = Promise.resolve()
// ... inside save():
writeQueue = writeQueue
  .catch((err) => {
    log.error("previous write failed", { err })
  })
  .then(() => doWrite(data))
```
Attach the catch *between* the chain root and the new write so the chain root is always
satisfied, and a single failure can't poison the rest of the pipeline.

---

### FIX-2: `context/local.tsx` — subagentModel drop in `syncModelJson`

**File**: `packages/tui/src/context/local.tsx` (lines 181–187)

**Problem**: The `save()` catch branch silently drops the `subagentModel` field when writing
`model.json`. The CLI's `run` command reads this field — TUI's subagent selection never reaches it.

**Fix**:
```ts
const save = async () => {
  const snapshot = JSON.parse(JSON.stringify(modelStore)) // deep copy
  await atomicWrite(Global.Path.model, snapshot)  // include subagentModel
}
```
Or, if the canonical is `subagent.json`, remove the `subagentModel` field from `model.json`
entirely and have the CLI read `subagent.json`. Pick one source of truth and stick to it.

**Recommended**: keep `subagent.json` as the canonical (TUI) and have the CLI read it. Remove
`subagentModel` from `model.json` schema. Update `cli/cmd/run.tsx` to read `subagent.json` when
`--subagent` flag is unset.

---

### FIX-3: `context/local.tsx` — subagentModel not in modelStore

**File**: `packages/tui/src/context/local.tsx`

**Problem**: The TUI dialog (`component/dialog-subagent-model.tsx`) writes the user's selection to
`subagent.json` only, never to the in-memory `modelStore`. Restart-to-see-change is forced.

**Fix**:
```ts
export const setSubagentModel = (providerID: string, modelID: string) => {
  batch(() => {
    setModelStore("subagentModel", { providerID, modelID })  // in-memory
    syncSubagentJson()                                       // disk
  })
}
```
The store should mirror the disk; reload from disk on app start.

---

### FIX-4: `context/sync-session.ts` — `recover()` no-op on in-flight

**File**: `packages/tui/src/context/sync-session.ts`

**Problem**: `recover(sessionID)` clears `fullSyncedSessions` but if a sync is in-flight for that
sessionID in `syncingSessions`, the cached promise is returned and no actual re-sync happens.

**Fix**:
```ts
export const recover = async (sessionID: SessionID) => {
  // Drop any in-flight promise so the next sync is a real call
  syncingSessions.delete(sessionID)
  fullSyncedSessions.delete(sessionID)
  await sync(sessionID)
}
```

---

### FIX-5: `context/sync-session.ts` — `messagesForSession` unbounded growth

**File**: `packages/tui/src/context/sync-session.ts`

**Problem**: `store.message[sessionID]` grows without bound across paginations; for long sessions
this is a memory leak.

**Fix**: cap messages per session to a sliding window (e.g. last 200 messages). When the user
scrolls up, fetch the older page and prepend. Use `produce` from `solid-js/store` for the cap:
```ts
const MAX_MESSAGES = 200
setStore("message", sessionID, produce((arr) => {
  if (arr.length > MAX_MESSAGES) arr.splice(0, arr.length - MAX_MESSAGES)
}))
```

---

### FIX-6: `context/sync.tsx` — double `bootstrap()` call

**File**: `packages/tui/src/context/sync.tsx`

**Problem**: `bootstrap()` is called twice — once in onMount, once with `{ fatal: false }` later.
No source comment explains the intent; readers will suspect a bug.

**Fix**: add a comment explaining the second call is a "warm refresh after the initial hard
bootstrap completes". Better: combine into a single call with internal state machine.

---

### FIX-7: `context/sync-bootstrap.ts` — `bootstrap()` void return on late reject

**File**: `packages/tui/src/context/sync-bootstrap.ts`

**Problem**: If a sub-promise rejects after `await Promise.all` resolves, the `fatal` path is
triggered and `exit()` is called with no user-visible error.

**Fix**: log the rejection to the diag file and surface a toast before exiting. Use
`Promise.allSettled` and check each result:
```ts
const results = await Promise.allSettled([providers, providerList, ...])
for (const r of results) {
  if (r.status === "rejected") log.error("bootstrap failure", r.reason)
}
if (fatal && results.some((r) => r.status === "rejected")) {
  useToast().show({ title: "Bootstrap failed", body: "See /tmp/dreamcode-diag.log" })
  exit(1)
}
```

---

### FIX-8: `component/prompt/index.tsx` — args.prompt + route.prompt race

**File**: `packages/tui/src/component/prompt/index.tsx`

**Problem**: If both `args.prompt` and `route.prompt` are set, the first wins; the second is
silently dropped.

**Fix**: explicit merge with a clear precedence: `args.prompt` > `route.prompt`. If both are set,
log a warning and concatenate. The `once` flag in `routes/home.tsx` should be reset on
route change.

---

### FIX-9: `component/prompt/index.tsx` — O(n) mention lookup per keystroke

**File**: `packages/tui/src/component/prompt/index.tsx`

**Problem**: `@-mention` lookup is O(n) per keystroke; with 50+ agents this is visible lag.

**Fix**: build a `Map<string, Agent>` once on mount; look up by name prefix in O(log n) using a
sorted index. Or use a trie for prefix search.

---

### FIX-10: `routes/session/index.tsx` — 92KB god component + `appendFileSync` in render path

**File**: `packages/tui/src/routes/session/index.tsx`

**Problem**: Single 92KB file mixes chat render, message tools, prompt, dialog mount, scroll, mouse
handling, and shell command rendering. `appendFileSync` is called in a streaming render path —
disk-full blocks the entire render.

**Fix**:
1. Split into `routes/session/index.tsx` (orchestrator) + `routes/session/chat-render.tsx`,
   `routes/session/message-tool.tsx` (already exists), `routes/session/shell-render.tsx`.
2. Move `appendFileSync` to a debounced background task. Use `Bun.write` (async) or a
   `setImmediate` batched write.

---

## P1 Fixes (high-priority architectural)

### FIX-11: `context/sync-handlers.ts` — `event.subscribe` typed as `any`

**File**: `packages/tui/src/context/sync-handlers.ts`

**Fix**: replace `(event: any, { workspace }: any) => ...` with the actual SDK types from
`@opencode-ai/sdk`. The SDK exports `Event` and `EventWorkspace` types.

---

### FIX-12: `context/sync-handlers.ts` — `server.instance.disposed` heuristic

**File**: `packages/tui/src/context/sync-handlers.ts`

**Problem**: Heuristic (`hasActiveGeneration || hasSessionMessages || hasAnySessions`) suppresses
legitimate dispose events.

**Fix**: replace heuristic with explicit "is the current operation finished?" check. Track an
in-flight count and only suppress if count > 0.

---

### FIX-13: `context/sync-messages.ts` — unbounded hydration map

**File**: `packages/tui/src/context/sync-messages.ts`

**Fix**: on `message.deleted` event, clear the hydration tracker entry:
```ts
eventBus.on("message.deleted", (msg) => {
  hydrationTracker.delete(msg.id)
})
```

---

### FIX-14: `context/sync-children.ts` — orphaned children on parent delete

**File**: `packages/tui/src/context/sync-children.ts`

**Fix**: on `session.deleted` event, walk `store.session` and re-parent or prune children with
matching `parentID`.

---

### FIX-15: `context/sync-permission.ts`, `context/sync-question.ts` — request cleanup

**Files**: `packages/tui/src/context/sync-permission.ts`, `context/sync-question.ts`

**Fix**: subscribe to `session.deleted` and clear `store.permission[deletedSessionID]` and
`store.question[deletedSessionID]`.

---

### FIX-16: `context/theme.tsx` — SIGUSR2 hot-reload doesn't trigger re-render

**File**: `packages/tui/src/context/theme.tsx`

**Fix**: after `discover()` completes, call `setStore("theme", reconcile(newThemeMap))` so Solid
consumers re-render. Use `produce` for fine-grained updates.

---

### FIX-17: `context/theme.tsx` — `setSystemTheme` dead export

**File**: `packages/tui/src/context/theme.tsx`

**Fix**: remove the dead export or wire it to a UI surface (e.g. theme switcher in home footer).

---

### FIX-18: `context/local.tsx` — `load()` blocks on single corrupt file

**File**: `packages/tui/src/context/local.tsx`

**Fix**: use `Promise.allSettled` for the four file reads; log per-file failures; degrade to
defaults for the broken file only.

---

### FIX-19: `context/local.tsx` — `save()` no debounce

**File**: `packages/tui/src/context/local.tsx`

**Fix**: debounce save with a 200ms trailing window:
```ts
import { debounce } from "../util/timeout"
const debouncedSave = debounce(save, 200)
```

---

### FIX-20: `context/local.tsx` — Windows `rename` over existing file

**File**: `packages/tui/src/context/local.tsx`

**Fix**: use `Bun.write(path, data, { createPath: true })` which handles the atomic-replace
case. On Node, use the `write-file-atomic` package.

---

### FIX-21: `context/kv.ts` — async flush race

**File**: `packages/tui/src/context/kv.ts`

**Fix**: either make `set()` sync to disk or use an in-memory `Map` and persist on each
set with a debounced flush. Prefer the latter; the former is too slow for hot paths.

---

### FIX-22: `context/route.tsx` — `initialRoute` accepts untyped value

**File**: `packages/tui/src/context/route.tsx`

**Fix**: use the existing `Route` union from the SDK. Reject unknown shapes with a clear error
instead of `undefined`.

---

### FIX-23: `context/sync.tsx` — session re-shuffle on bootstrap

**File**: `packages/tui/src/context/sync.tsx`

**Fix**: sort sessions by `updatedAt` (or another stable order) in both `listSessions` and the
bootstrap path. Document the sort key.

---

### FIX-24: `context/sync.tsx` — `sessionListQuery` doesn't invalidate on project change

**File**: `packages/tui/src/context/sync.tsx`

**Fix**: subscribe to `project.data.instance.path` change and re-run the query.

---

### FIX-25: `context/sdk.tsx` — `props.url` only read once

**File**: `packages/tui/src/context/sdk.tsx`

**Fix**: make SDK url a `createMemo` or watch it in an effect. When the url changes, close the
existing SSE and open a new one.

---

### FIX-26: `context/sdk.tsx` — `abort` never called

**File**: `packages/tui/src/context/sdk.tsx`

**Fix**: in the `useExit` hook or app teardown, call `abort.abort()` to clean up the SSE
listener. Add a `dispose()` method to the SDK context.

---

### FIX-27: `context/editor.ts` — speculative `MCP_PROTOCOL_VERSION` date

**File**: `packages/tui/src/context/editor.ts`

**Fix**: the date `2025-11-25` is in the future. Either pin to the actual current spec version
or mark the constant as `// TENTATIVE` and document the fallback.

---

### FIX-28: `context/editor.ts` — schema decoders throw on unknown variants

**File**: `packages/tui/src/context/editor.ts`

**Fix**: wrap each decoder in `Schema.decodeUnknownOption` and treat `None` as "skip this
payload" instead of throwing.

---

### FIX-29: `context/thinking.ts` — `reasoningSummary` regex fails on streaming

**File**: `packages/tui/src/context/thinking.ts`

**Fix**: split the title detection into two passes: first pass detects the title boundary
using a streaming buffer; second pass renders the body. The current single-regex approach is
fragile.

---

### FIX-30: `context/runtime.ts` — `home` from `os.homedir()` ignores `$HOME`

**File**: `packages/tui/src/context/runtime.ts`

**Fix**: prefer `process.env.HOME` on POSIX; fall back to `os.homedir()`. On Windows, prefer
`process.env.USERPROFILE`.

---

### FIX-31: `context/project.tsx` — `sync` race on rapid workspace changes

**File**: `packages/tui/src/context/project.tsx`

**Fix**: introduce an `AbortController`; cancel the previous sync on workspace change.

---

### FIX-32: `context/args.ts` — `--continue` no session id

**File**: `packages/tui/src/context/args.ts`

**Fix**: add `--continue=<sessionID>` form. The CLI should accept both `--continue` (most
recent) and `--continue=<id>` (specific).

---

### FIX-33: `component/dialog-*.tsx` — no 'back' keybinding on `replace()` chain

**Files**: `packages/tui/src/component/dialog-*.tsx`

**Fix**: add a `useCommandShortcut("dialog.back")` handler in `Dialog` that pops one level when
`replace()` is in progress.

---

### FIX-34: `component/dialog-mcp-add.tsx` — no schema check, no test connection

**File**: `packages/tui/src/component/dialog-mcp-add.tsx`

**Fix**: parse the JSON in a try/catch, validate against the MCP config schema from
`@modelcontextprotocol/sdk`, and call `sdk.client.mcp.testConnection(config)` before saving.

---

### FIX-35: `component/dialog-connector.tsx` — OAuth port leak

**File**: `packages/tui/src/component/dialog-connector.tsx`

**Fix**: track the open `net.Server` and `.close()` it on dialog dismiss. Use `unref()` so
port is freed if the dialog crashes.

---

### FIX-36: `component/dialog-questions.tsx` — multi-select not supported

**File**: `packages/tui/src/component/dialog-questions.tsx`

**Fix**: check the SDK's `QuestionRequest.options` for `multi_select: true` and render checkboxes
instead of radio buttons.

---

### FIX-37: `component/dialog-subagent-list.tsx`, `dialog-subagent-model.tsx` — split-brain

**Files**: `packages/tui/src/component/dialog-subagent-{list,model}.tsx`

**Fix**: depends on FIX-2. Once `subagent.json` is the canonical, these dialogs write to it via
`useLocal().setSubagentModel` and the active state reads from the same store.

---

### FIX-38: `component/command-palette.tsx` — no command collision detection

**File**: `packages/tui/src/component/command-palette.tsx`

**Fix**: at registration time, assert that all command names are unique; log a warning if a
collision is detected.

---

### FIX-39: `component/dialog-mcp.tsx` — MCP status not actionable

**File**: `packages/tui/src/component/dialog-mcp.tsx`

**Fix**: render a 'Register' button for MCPs with `needs_client_registration` status.

---

### FIX-40: `component/dialog-model.tsx` — no model validation on selection

**File**: `packages/tui/src/component/dialog-model.tsx`

**Fix**: after dialog close, validate the selected model against `sdk.config.provider`. If
the model is gone, fall back to the previous model and toast a warning.

---

### FIX-41: `component/dialog-model.tsx` — no cost/capability filter

**File**: `packages/tui/src/component/dialog-model.tsx`

**Fix**: add filter inputs for cost (under/over N) and capabilities (e.g. `tools: true`,
`vision: true`).

---

### FIX-42: `component/dialog-variant.tsx` — no compatibility warning

**File**: `packages/tui/src/component/dialog-variant.tsx`

**Fix**: when a variant is selected that the current model doesn't support, show an inline
warning with a 'use default variant' button.

---

### FIX-43: `component/prompt/history.tsx` — unbounded history

**File**: `packages/tui/src/component/prompt/history.tsx`

**Fix**: cap at 100 entries; use FIFO eviction.

---

### FIX-44: `component/prompt/part.ts` — in-place mutation

**File**: `packages/tui/src/component/prompt/part.ts`

**Fix**: return a new object instead of mutating; change `stripPromptPartIDs` signature to
`(part: PromptPart) => PromptPart`.

---

### FIX-45: `component/prompt/frecency.tsx` — minute-granular re-scoring

**File**: `packages/tui/src/component/prompt/frecency.tsx`

**Fix**: persist the score on each `register()` call; don't recompute on a tick.

---

### FIX-46: `component/prompt/external-editor.tsx` — empty file = cleared input

**File**: `packages/tui/src/component/prompt/external-editor.tsx`

**Fix**: distinguish between "user saved empty file" (preserve original input) and "user
deleted all content" (clear input). Use the mtime of the temp file: if it equals the
original, the user did nothing.

---

### FIX-47: `routes/home.tsx` — `once` flag is module-scoped

**File**: `packages/tui/src/routes/home.tsx`

**Fix**: move the `once` flag into a per-route `createSignal` reset on mount. Or, better, just
use a `createEffect` that fires once per `route.data` change.

---

### FIX-48: `routes/session/dialog-fork-from-timeline.tsx` — race on fork

**File**: `packages/tui/src/routes/session/dialog-fork-from-timeline.tsx`

**Fix**: `await sdk.client.session.fork(...)` before closing the dialog and navigating.

---

### FIX-49: `routes/session/dialog-message.tsx` — 'Revert' needs confirm

**File**: `packages/tui/src/routes/session/dialog-message.tsx`

**Fix**: for messages with `part.length > 1` or `part.some((p) => p.type === "tool")`, show a
confirmation dialog before reverting.

---

### FIX-50: `routes/session/dialog-message.tsx` — clipboard provider bypass

**File**: `packages/tui/src/routes/session/dialog-message.tsx`

**Fix**: use the local `ClipboardProvider` if it's mounted; fall back to the global only if
no provider is present.

---

### FIX-51: `routes/session/dialog-timeline.tsx` — `result.reverse()` mutation

**File**: `packages/tui/src/routes/session/dialog-timeline.tsx`

**Fix**: `[...result].reverse()` (already noted in finding).

---

### FIX-52: `routes/session/footer.tsx` — recursive `tick` not exposed

**File**: `packages/tui/src/routes/session/footer.tsx`

**Fix**: extract the welcome-cycle logic into a `createWelcomeCycle()` helper that's testable.

---

### FIX-53: `routes/session/index.tsx` — `DiffViewer` lazy-load error

**File**: `packages/tui/src/routes/session/index.tsx`

**Fix**: add a 'Retry' button to the DiffViewer error state; auto-retry on session focus.

---

### FIX-54: `routes/session/index.tsx` — `hasTextSelection` import try/catch

**File**: `packages/tui/src/routes/session/index.tsx`

**Fix**: gate the mouse handler on a single `import` at top-level; if the import fails on the
current build, the entire mouse module is disabled (clearer than silent catch).

---

### FIX-55: `routes/session/message-tool.tsx` — `previous` state not preserved

**File**: `packages/tui/src/routes/session/message-tool.tsx`

**Fix**: lift the expanded state to a per-message signal in the parent route; the tool
component subscribes.

---

### FIX-56: `routes/session/message-assistant.tsx` — streaming effect doesn't batch

**File**: `packages/tui/src/routes/session/message-assistant.tsx`

**Fix**: wrap the streaming effect in `batch(() => { ... })` so the message content + metadata
update in a single render.

---

### FIX-57: `feature-plugins/sidebar/lsp.tsx` — effect re-fires on any store change

**File**: `packages/tui/src/feature-plugins/sidebar/lsp.tsx`

**Fix**: use `createMemo` with explicit deps `[store.lsp[sessionID]]`.

---

### FIX-58: `feature-plugins/sidebar/todo.tsx` — single-session hard-coded

**File**: `packages/tui/src/feature-plugins/sidebar/todo.tsx`

**Fix**: read the active session from the route; offer a session picker at the top of the
sidebar.

---

### FIX-59: `feature-plugins/sidebar/mcp.tsx` — no registration guidance

**File**: `packages/tui/src/feature-plugins/sidebar/mcp.tsx`

**Fix**: when an MCP has `needs_client_registration`, show an inline 'How to register' link
to the docs.

---

### FIX-60: `feature-plugins/sidebar/files.tsx` — recursive file watcher

**File**: `packages/tui/src/feature-plugins/sidebar/files.tsx`

**Fix**: on Linux, use `Bun.fs.watch` with `recursive: true` if available; otherwise
fall back to per-subdirectory watchers with proper cleanup.

---

### FIX-61: `feature-plugins/system/which-key.tsx` — re-renders on every keystroke

**File**: `packages/tui/src/feature-plugins/system/which-key.tsx`

**Fix**: debounce the popup render with a 50ms trailing window.

---

### FIX-62: `feature-plugins/system/notifications.ts` — unbounded queue

**File**: `packages/tui/src/feature-plugins/system/notifications.ts`

**Fix**: cap the queue at 20; FIFO eviction.

---

### FIX-63: `feature-plugins/system/plugins.tsx` — toggle doesn't notify store

**File**: `packages/tui/src/feature-plugins/system/plugins.tsx`

**Fix**: have the plugin registry emit a `plugin.toggled` event; the UI subscribes.

---

### FIX-64: `feature-plugins/system/diff-viewer.tsx` — 37KB, no `batch` for state updates

**File**: `packages/tui/src/feature-plugins/system/diff-viewer.tsx`

**Fix**: wrap multi-signal updates in `batch`; consider splitting into sub-components.

---

### FIX-65: `feature-plugins/system/diff-viewer-file-tree.tsx` — flat tree, no state

**File**: `packages/tui/src/feature-plugins/system/diff-viewer-file-tree.tsx`

**Fix**: render a real tree (nested `<Show>` blocks); persist expand/collapse state in the
store.

---

### FIX-66: `feature-plugins/home/footer.tsx` — `abbreviateHome` duplication

**File**: `packages/tui/src/feature-plugins/home/footer.tsx`

**Fix**: import from `runtime.tsx`; remove the duplicate.

---

### FIX-67: `app.tsx` — 37KB entry, mixed responsibilities

**File**: `packages/tui/src/app.tsx`

**Fix**: split into `app.tsx` (thin renderer) + `bootstrap.ts` (orchestrates async setup).

---

### FIX-68: `keymap.tsx` — half-built mode stack

**File**: `packages/tui/src/keymap.tsx`

**Fix**: either remove the mode stack if only `base` is used, or document and complete it
(multi-mode support).

---

### FIX-69: `attention.ts` — `dispose` not called from `app.tsx`

**File**: `packages/tui/src/attention.ts`

**Fix**: call `attention.dispose()` in `app.tsx` cleanup.

---

### FIX-70: `audio.ts` — no rate-limiting on `play`

**File**: `packages/tui/src/audio.ts`

**Fix**: debounce same-sound plays within 200ms; use a `Map<soundId, lastPlayTime>`.

---

### FIX-71: `editor.ts` — silent no-op on unset `$EDITOR`

**File**: `packages/tui/src/editor.ts`

**Fix**: throw a `NoEditorConfiguredError`; caller toasts the error.

---

### FIX-72: `editor.ts` — `discoverEditorConnection` no JSON validation

**File**: `packages/tui/src/editor.ts`

**Fix**: wrap the file read in `try/catch`; treat malformed JSON as "no connection".

---

### FIX-73: `editor-zed.ts` — unvalidated SQLite `buffer_path`

**File**: `packages/tui/src/editor.ts`

**Fix**: validate that `buffer_path` is within the project root; reject otherwise.

---

### FIX-74: `parsers-config.ts` — no SHA-256 verification

**File**: `packages/tui/src/parsers-config.ts`

**Fix**: add a `sha256` field to each parser entry; verify on download. Reject mismatches.

---

### FIX-75: `terminal-win32.ts` — `setRawMode` not restored on early exit

**File**: `packages/tui/src/terminal-win32.ts`

**Fix**: register the original `setRawMode` in a `process.on("exit", ...)` handler that
restores it unconditionally.

---

### FIX-76: `util/install.ts` — `curl | sh` fallback (P0 → downgraded to P1)

**File**: `packages/tui/src/util/install.ts`

**Fix**: replace with `curl -fsSL -o /tmp/installer.sh && shasum -a 256 -c` pattern. Or, better,
use the package manager's built-in install where possible.

---

### FIX-77: `util/log.ts` — log writes corrupt terminal display

**File**: `packages/tui/src/util/log.ts`

**Fix**: write to `/tmp/dreamcode-diag.log` only, not `console.log`. The renderer's stderr
drain is the only safe output.

---

### FIX-78: `util/sse.ts` — no max retry count

**File**: `packages/tui/src/util/sse.ts`

**Fix**: add `MAX_RETRIES = 10`; after that, surface an error toast and stop.

---

### FIX-79: `util/posix-shell.ts` — WSL not detected

**File**: `packages/tui/src/util/posix-shell.ts`

**Fix**: read `/proc/version` at call time; on WSL, use `wslpath` to convert paths.

---

### FIX-80: `util/wsl.ts` — heuristic detection

**File**: `packages/tui/src/util/wsl.ts`

**Fix**: combine `/proc/version` check + `WSL_INTEROP` env var + `wsl.exe -l -q` probe; pick
the most reliable signal.

---

## P2/P3 (not actioned in this round)

The remaining 78 P2 and 12 P3 findings are documented in `tui-deep-FINDINGS.md` but not
fixed here. They are appropriate for a follow-up "P2 sweep" wave.

**P2 categories worth a dedicated wave:**

- Remove debug `diag()` calls (20+ instances in `context/sync-*.ts`).
- Delete the 3 `.rej` files committed in source tree.
- Add missing tests for `context/sync-bootstrap.ts`, `context/sync-messages.ts`, `routes/session/message-*.tsx`.
- Surface `console_state` (currently dead) or remove it from the store.
- Add size caps to `kv.ts`, `sync-messages.ts`, `notifications.ts`.
- Memoize `markdown.tsx` and `context.tsx` token count.
- Document `keybind.ts` user-override path.

**P3 categories:**

- Magic number cleanup (`emptyConsoleState`, `MESSAGE_LIMIT` cross-file references).
- Doc gaps in `plugin/api.ts` (slots never imported).
- Test fixture cleanup (`test/fixture/*` 40 files).
- Naming: `error-component.tsx` is fine but a `Boundary` suffix would be clearer.

---

## Verification plan

After applying all P0/P1 fixes:

1. **Type check**: `cd packages/tui && bun run typecheck` — should pass.
2. **Lint**: `cd packages/tui && bun run lint` — no new errors.
3. **Unit tests**: `cd packages/tui && bun test` — all passing.
4. **Manual smoke**:
   - Launch TUI, navigate to home, type a prompt, submit — should work.
   - Open subagent dialog, select a model, restart TUI, verify selection persisted.
   - Open 5 dialogs, navigate back — back key should work.
   - Open MCP dialog with broken config — should show actionable error.
   - Connect to a deleted provider — fallback to previous model with toast.
5. **Memory check**: open 10 long sessions, watch `store.message` size — should not grow unbounded.

---

*End of fixes.*
