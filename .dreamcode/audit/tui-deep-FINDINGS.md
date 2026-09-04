# TUI Package Deep Audit — Findings

**Package**: `packages/tui/` (opencode TUI)
**Files audited**: 246 source files (excluding `patches/`, `vendor/`, `node_modules/`, `.git/`, `*_gen*.ts`, `LICENSE`, build artifacts)
**Audit dimensions**: quality, architecture, research, internal logic, security, API, engineering, harness/tooling
**Date**: 2026

## Severity legend

- **P0** — Critical: crashes, data loss, security holes, broken contracts, race conditions
- **P1** — High: silent failures, design flaws that hurt users or maintainers, missing observability
- **P2** — Medium: dead code, debug logging, UX paper-cuts, missing tests
- **P3** — Low: stylistic nits, naming, doc gaps

---

## `src/` — Root files (12)

### `app.tsx` — P0
Top-level TUI entry; wires all providers. Lifecycle hooks manage SIGUSR2, MCP, soundpack, todo rehydration, session, child session, SDK event stream. Mixed responsibilities: provider tree + boot sequence + cleanup. ~37KB; bootstrap path covers ~10 distinct async operations in onMount; if any rejects the renderer is left without the project/store but `render()` already returned, so TUI renders a partial UI before the failure surfaces. **Fix**: split into `bootstrap.ts` (orchestrates) + thin shell. **Security**: no shell-injection check on user-controlled keybind inputs; keymap parsing tolerates unknown keys silently.

### `index.tsx` — P3
One-line re-export of `run` and `TuiInput`; fine. No findings beyond being trivially small.

### `keymap.tsx` — P1
Adapter over `@opentui/keymap/solid`. Uses `useTuiConfig` for leader timeout; `formatKeySequence` and `formatCommandBindings` use `Reflect.get` defensively but lack fallbacks for missing theme. Mode stack (`OPENCODE_MODE_KEY=REDACTED`) — the constant is hard-coded and not exposed; only one mode (`base`) is defined; `command.palette.show` lives in `OPENCODE_BASE_MODE` but `useCommandShortcut` is the only documented way to bind it. No type-level guarantee that all `command.*` IDs match `keybind.ts`. **Architectural**: mode stack API is exposed but only used by `question.tsx` — half-built abstraction. **Engineering**: 4 separate helper re-exports at the bottom of the file hint at incremental API growth without consolidation.

### `attention.ts` — P1
Audio + notification attention system. `clampVolume`, `normalizeText` (strips ANSI + control chars) look correct. `notify` returns `TuiAttentionNotifyResult` but only `error` and `skipped` paths surface failure; the renderer side at `app.tsx` does not consume the `notification: false` case for subagent messages, so the spec'd behaviour of subagent-not-being-frontmost skipping the OS notification is correct. **Bug**: `win32InstallCtrlCGuard` polls at 1s but doesn't unregister when the process exits non-SIGINT; on Node-on-Windows setups this leaks a setInterval. The `dispose` callback is exported but not called from `app.tsx`.

### `audio.ts` — P1
Bundles default soundpack metadata; depends on `Bun.build` audio imports with `with { type: 'file' }`. Clean. **Missing**: no rate-limiting between consecutive `play` calls, so `done` sound can play 5x in 1s if 5 subagents finish simultaneously. Should debounce or batch notifications.

### `clipboard.ts` — P0
Cross-platform clipboard with image support. **Security**: `osascript` is invoked with `set fileRef to open for access POSIX file "${file}"` — `file` is `path.join(tmpdir(), "dreamcode-clipboard.png")`, which is constructed from `tmpdir()`. On a multi-user shared host this is safe (tmpdir is per-user), but the `try/finally` does not handle the case where `rm` fails because the file is held open by another process. Falls back to text clipboard silently. **P1**: macOS path always writes PNG; never cleans up the file before `osascript` reuses the same name on a subsequent call within the same process — race condition. **P1**: `darwin` branch uses `the clipboard as "PNGf"` (deprecated, replaced by `the clipboard as «class PNGf»` in modern macOS).

### `editor.ts` — P1
External editor integration. `openEditor` shells out to `$VISUAL` or `$EDITOR`; the spawn uses `shell: process.platform === 'win32'`. **P1**: When `$EDITOR` is unset and `$VISUAL` is unset, the function silently returns undefined instead of throwing — users get a no-op for `Cmd+E`/`Ctrl+E` press with no feedback. Should toast an error. **P1**: `discoverEditorConnection` walks `~/.claude/ide` and looks for JSON files but never validates JSON parsing — if the file is malformed the read throws and crashes the call site. **P2**: `normalizePromptContent` strips a single trailing `\n` / `\r\n` if the file is otherwise one line, but does NOT strip `\r` (old Mac) line endings.

### `editor-zed.ts` — P0
Reads Zed's SQLite editor database via `bun:sqlite`. **P0**: Walks `~/.config/zed/db/0 - editor.sqlite`-shaped paths without confirming the path is owned by the current user or that the SQLite file is signed as Zed's. On a multi-user box an attacker who can place a crafted file at `~/.config/zed/db/0/0.db` can inject arbitrary SQL results into `resolveZedSelection` — but `decodeZedEditorRow` uses `Schema.decodeUnknownOption` so unknowns are silently dropped. **Severity downgraded to P2**: risk is bounded by Effect's schema validation. **P1**: The function falls back to `readFileAsync(row.buffer_path, 'utf8')` if the SQLite contents column is null, but never validates that `buffer_path` is inside the project directory — Zed DB rows are trusted verbatim.

### `logo.ts` — P3
ASCII logo definitions. No findings.

### `parsers-config.ts` — P1
Tree-sitter parser URL registry. 16KB of hard-coded GitHub release URLs. **P1**: URLs point at `github.com/tree-sitter/...` release artifacts; if any of those release tags are force-pushed or yanked (GitHub preserves redirects but breaks checksums), there is no SHA-256 verification on the WASM download. **P2**: `filetype: "markdown"`, `filetype: "javascript"`, `filetype: "typescript"` are noted as 'we use the opentui built-in parsers' but no assertion prevents a future maintainer from removing the comment and adding a duplicate.

### `runtime.tsx` — P3
One utility: `abbreviateHome`. No findings.

### `terminal-win32.ts` — P1
Windows console mode tweakery via `bun:ffi`. `win32InstallCtrlCGuard` polls at 1000ms to re-clear `ENABLE_PROCESSED_INPUT` — leaks a setInterval on long-running sessions unless `unhook` is called. **P1**: The `setRawMode` hook saves and replaces `process.stdin.setRawMode`, but never restores the original if the process exits between `win32InstallCtrlCGuard` and `unhook()`. **P2**: `kernel32.dll` is loaded once and cached in `k32` module variable; if the dll is unloaded by Windows (rare but possible) all subsequent calls return 0 and the guard silently no-ops.

---

## `src/context/` — Store + bootstrap (26 files)

### `context/exit.tsx` — P3
Trivial exit-context provider. No findings.

### `context/editor.ts` — P1
MCP-style JSON-RPC schema definitions for editor selection protocol. **P1**: Hard-codes `MCP_PROTOCOL_VERSION = "2025-11-25"` — speculative future date string; not yet a real spec. **P1**: Schema decoders throw on unknown variants; no `Schema.decodeUnknownOption` wrapper at the boundary, so a malformed payload from a buggy editor crashes the connection handler. **P2**: The MCP connection retry loop has no backoff cap.

### `context/directory.ts` — P3
Memoized directory + branch display. No findings.

### `context/thinking.ts` — P1
Reasoning visibility mode + summary detection. **P1**: `reasoningSummary` matches `^\*\*([^*\n]+)\*\*(?:\r?\n\r?\n|$)` — only handles the case where the title is followed by a blank line. If a streaming chunk ends mid-title with no blank-line yet, the regex returns `body: content` and the title is NOT separated; downstream renders get the whole blob. **P2**: The migration from `thinking_visibility` boolean to `thinking_mode` string is one-way — if a user re-imports a config that still uses `thinking_visibility`, no warning is logged. **P3**: `nextThinkingMode` falls back to `'show'` when MODES.indexOf returns -1 (impossible) instead of throwing.

### `context/route.tsx` — P1
Routing store. **P1**: `initialRoute(startup.initialRoute)` uses an untyped `value: unknown` parameter; the function returns `undefined` for unrecognized shapes, silently. No telemetry/log. **P1**: `useRouteData<T extends Route['type']>(type: T)` casts via `as Extract<Route, { type: typeof type }>` but the `type` argument is not actually checked — calling `useRouteData("garbage")` compiles (TypeScript widens the literal only when literal-typed). **P2**: The store uses `reconcile` on navigate but `navigate` is the only mutation; no `_reset` method to clear back to home during testing.

### `context/sync.tsx` — P0
Central sync store. Wires `createSyncStore`, `createHydrationTracker`, `createBootstrap`, `createSessionSync`, `registerEventHandlers`. **P0**: `onMount` chain calls `bootstrap()` then `bootstrap({ fatal: false })` again — the second call is documented in `sync-bootstrap.ts` as a refresh path but no source comment explains the double invocation; readers will suspect a bug. **P1**: `listSessions` returns sessions sorted by ID; but `bootstrap` later does `setStore('session', reconcile(bootstrapSessions))` with a different sort order — sessions are re-shuffled every bootstrap. **P1**: `sessionListQuery` reads `kv.get('session_directory_filter_enabled', true)` and `project.data.instance.path.worktree` / `directory` but does not invalidate when the project path changes — if user changes project mid-session the list query is stale until next bootstrap.

### `context/sdk.tsx` — P1
Opencode SDK wrapper with event-bus. **P1**: SSE reconnect uses `Date.now() - last` heuristic for `elapsed > retryDelay` but `last` is only set inside `flush`, not on the initial connect — first retry uses `retryDelay=1000` regardless of how long the connection was alive. **P1**: `createSDK()` is called once at init; if the `url` prop changes (e.g. user re-points the TUI to a different server) the existing `sdk` is not replaced — `props.url` is read at most once. **P2**: `handlers.delete` in the unsubscribe path is a method on `Set`; the returned function is also missing the `handlers.clear()` path. **P2**: `abort` AbortController is created but `abort.abort()` is never called — the SSE will live until process exit.

### `context/clipboard.tsx` — P3
Clipboard context wrapper. No findings.

### `context/project.tsx` — P1
Project + workspace state. **P1**: `sync` is called from `onMount` with no debounce; rapid `workspace.current` changes will fire overlapping `Promise.all`s and race. **P1**: `syncWorkspace` is called in `onMount` but `experimental.workspaces.status` API path looks speculative — no error handler beyond `.catch(() => undefined)`. **P2**: `defaultPath` sets `directory: sdk.directory ?? ""` — empty string then triggers `reconcile(instancePath.data || defaultPath)` which replaces an empty-string directory with the SDK-returned path; if SDK returns `undefined` we re-apply the empty string silently. **P2**: `setStore('workspace', 'list', reconcile(listed.data))` discards the `current` selection if the list shrinks; user is silently kicked to undefined workspace.

### `context/prompt.tsx` — P3
One-method prompt ref context. No findings.

### `context/runtime.ts` — P1
Path + terminal env context. **P1**: `useTuiPaths` returns `{home, cwd, ...}` but the `home` is computed from `os.homedir()`; on Windows that's `process.env.USERPROFILE`, not `HOME` — if the user sets `$HOME` (e.g. via WSL interop) the TUI abbreviates against the wrong root. **P2**: `useTuiTerminalEnvironment` reads once at init; terminal capability changes (e.g. TERM_PROGRAM switch) are not picked up.

### `context/path-format.ts` — P2
Path formatter for permission dialogs. Single function; no findings beyond testing absence.

### `context/sync-store.ts` — P2
Solid store schema + helpers. **P2**: `diag()` function appends to `/tmp/dreamcode-diag.log` synchronously on every event; on a high-traffic session this becomes a hot path. Should be feature-flagged or behind `--diag`. **P2**: `search()` is binary search on a stable-sorted array; called from `sync-session.ts` on every `get()` — fine, but the comparator is a closure (allocates per call). Should be hoisted. **P3**: `emptyConsoleState` is a hard-coded `consoleManagedProviders: []` and `switchableOrgCount: 0` — magic numbers.

### `context/sync-bootstrap.ts` — P0
Bootstrap orchestrator. **P0**: `bootstrap()` returns `void`; if a sub-promise rejects after `await Promise.all` resolves (chained `setStore` call), the `fatal` path is hit and `exit()` is called with no error message to the user. **P0**: `diag(...)` writes the bootstrap call site to `/tmp/dreamcode-diag.log` — debug code shipped in source. **P1**: The `project` ref is used to compute `workspace` but the `setStore('project', reconcile(...))` happens after `projectPromise` resolves; if `args.continue` is set we have a TOCTOU window where `route.data.type === 'session'` but `store.project.id` is still undefined. **P1**: `Promise.all([..., ...(args.continue ? [sessionListPromise] : [])])` mixes 5-arg and 6-arg spread — minor readability issue but the runtime path is the same.

### `context/sync-handlers.ts` — P1
Event subscription dispatcher. **P1**: `server.instance.disposed` handler has a heuristic to suppress the auto-rebootstrap (`hasActiveGeneration || hasSessionMessages || hasAnySessions`) — heuristic will suppress legitimate dispose-and-recover events. **P1**: `permission.replied` uses `produce` but never logs the requester's sessionID, so a missing `requestID` in the event silently does nothing. **P1**: The `event.subscribe((event: any, { workspace }: any) => ...)` types the parameters as `any` — bypasses the entire SDK type system. **P2**: Multiple `diag(...)` calls scattered through every handler — high noise level in `/tmp/dreamcode-diag.log`.

### `context/sync-session.ts` — P0
Per-session sync logic. **P0**: `recover(sessionID)` clears `fullSyncedSessions` and calls `sync(sessionID)` — but if `sync` is already in-flight for the same sessionID in `syncingSessions`, the new call gets the cached promise and does not actually re-sync. **P0**: `messagesForSession(sessionID)` fetches a large page once and stores the result keyed by session; on pagination the older messages are NOT evicted from `store.message[sessionID]` — the array grows unbounded. **P1**: `diag` calls on every refresh; high log noise. **P1**: `setStore('session_diff', sessionID, reconcile(diff))` discards other sessions' diffs if `reconcile` thinks they're the same reference; in practice the diffs are immutable arrays, so reconcile is unnecessary work. **P2**: `search` is called on every `get()` and `get()` is called on every render — performance cliff at >10k sessions.

### `context/sync-messages.ts` — P1
Per-message sync. **P1**: Hydration tracker wraps `Promise<void>` per messageID but never clears entries on a `message.deleted` event — Map grows unbounded for long sessions. **P2**: `diag` everywhere; P2 noise.

### `context/sync-provider.ts` — P2
Provider-state sync. Clean. **P2**: `console_state` is fetched and stored but never read by any other file in the TUI (grep -r 'console_state' shows only the store + bootstrap path) — dead field.

### `context/sync-children.ts` — P1
Subagent child-session tracking. **P1**: Subagent state derived from `parentID` walking; but if a parent session is deleted the children are not re-parented and they linger in the store. **P2**: No way to manually prune the children list.

### `context/sync-permission.ts` — P1
Permission request sync. **P1**: Permission requests are stored per-session; when the session is deleted the requests are NOT cleared — `store.permission[deletedSessionID]` lingers. **P2**: `diag` on every reply/reject.

### `context/sync-question.ts` — P1
Question request sync. Same pattern as permissions: **P1** no cleanup on session delete; **P2** diag noise.

### `context/sync-mcp.ts` — P2
MCP status sync. **P2**: `subscribe` path silently swallows errors via `.catch(() => undefined)`; no user-visible feedback when an MCP fails. **P2**: `diag` on every status change.

### `context/theme.tsx` — P1
Theme context provider. **P1**: `discover()` walks every parent directory up to `/` looking for `.dreamcode/themes/*.json` — on a deeply-nested project the walk is bounded only by the dirname-stabilization check, but each step reads the directory with `Glob.scan` which is async — on a slow disk the user sees a blank theme for several seconds. **P1**: `subscribeRefresh` registers a SIGUSR2 handler that re-runs `discover()` but never re-renders the SolidJS UI — the new themes are merged into `customThemes` but no `setStore` triggers a re-render of the theme consumer. **P1**: `Global.Path.config` is read at `discover()` call time, not at provider init — race with any process that mutates `XDG_CONFIG_HOME`. **P2**: `setSystemTheme` is exported but no caller in the TUI uses it; dead export.

### `context/keybind.tsx` — P2
Keybind config re-exports. **P2**: File is a thin re-export; no findings beyond being thin.

### `context/args.ts` — P1
CLI args context. **P1**: `args.continue` is a single boolean — no way to continue into a specific session by id; the entire continue path is one-shot. **P2**: No validation that `args.prompt` and `args.continue` aren't both set (mutually exclusive UX-wise).

### `context/command.tsx` — P2
Command palette integration. No findings beyond missing tests.

### `context/kv.ts` — P1
Solid-style KV store with persistence. **P1**: `set()` is sync (writes to in-memory map) but `flush()` is async — on process crash between `set` and the next `flush`, the in-memory state diverges from disk. **P1**: `signal<T>(key, default)` returns `[Accessor<T>, Setter<T>]` but the Setter's overload set is broken (per the comment in `thinking.ts`); this is a known P1 in the repo. **P2**: No size cap on stored values — a user can write a 100MB blob to KV.

### `context/local.tsx` — P0
TUI-side state persistence (`model.json`, `subagent.json`, `mcp.json`, `kv.json`). **P0**: `writeQueue = writeQueue.then(...)` serializes writes but the `.catch` is attached to the *new* promise (line 449/462), not the chain root — a write that rejects in the middle of a 10-deep chain will silently unblock subsequent writes. **P0**: `syncModelJson()` writes `recent/favorite/variant` to `model.json` but the catch branch (lines 181-187) drops `subagentModel` — split-brain with `subagent.json` (TUI's canonical) and `model.json.subagentModel` (CLI's consumer). **P0**: `subagentModel` is NOT stored in the TUI's `modelStore` — only in the disk file; reload from disk happens only at app start, so the user's `subagent` selection in the dialog is not round-tripped through the store. **P1**: `load()` reads all four JSON files but each is a separate `await` — a single corrupt file blocks the others. Should `Promise.allSettled` and degrade gracefully. **P1**: `save()` writes the entire model state on every keystroke; no debounce. **P2**: Tempfile is written with `os.tmpdir() + ".opencode-model.json.${pid}.${rand}"` but the rename uses `fs.renameSync` — on Windows, `rename` fails if the destination exists, which it does (we just wrote it).

### `context/data.tsx` — P2
Data context. Wires SDK + project. **P2**: `useData()` returns the full data tree with no selectors; consumers re-render on any change. **P2**: The type `Data` interface is large and not exported — consumers can only access via the hook.

---

## `src/component/` — UI components (43 files including 3 `.rej`)

### `component/command-palette.tsx` — P1
Command-palette dialog using `DialogSelect`. **P1**: Keymap registration via `useBindings`; if a command has the same `name` as another registered command, the later one silently wins. No collision detection. **P2**: Filter is case-insensitive substring; no fuzzy matching despite the obvious UX upgrade.

### `component/dialog-agent.tsx` — P2
Agent-picker dialog. **P2**: No 'default' badge — user can't tell which agent is the system default without consulting docs.

### `component/dialog-mcp.tsx` — P1
MCP server dialog. **P1**: Lists MCP servers but does not surface `needs_client_registration` status with actionable guidance — just the dot color. **P2**: No way to remove a configured MCP from this dialog (read-only view).

### `component/dialog-model.tsx` — P1
Model-picker. **P1**: Filters on `provider.id` and `model.id` but not on `model.cost` or capability tags — user has to scroll through thousands of models on a multi-provider setup. **P1**: Selected model is stored via `useLocal().model.set(...)` but the dialog does not validate the new model exists; selecting a then-deleted model is silently allowed.

### `component/dialog-provider.tsx` — P2
Provider connect dialog. **P2**: OAuth flow triggers an external browser but the dialog stays open showing 'Connecting…' — no way to cancel if the user closes the browser tab.

### `component/dialog-session-list.tsx` — P2
Session list dialog. **P2**: Paginates in memory — for a project with 5000+ sessions the list render is slow. **P2**: The `.rej` companion file is committed to the source tree (see P2 below).

### `component/dialog-session-list.tsx.rej` — P2
**DEBUG ARTIFACT**: rejected patch hunks committed in source tree. Diagnostic logging to `/tmp/dreamcode-diag.log` via `diag()` from `sync-store.ts`. Same issue for `dialog-workspace-list.tsx.rej` and `routes/session/index.tsx.rej`. **Action**: delete or move to `.opencode/patches/`.

### `component/dialog-session-rename.tsx` — P2
Session rename. No findings beyond missing tests.

### `component/dialog-workspace-list.tsx` — P2
Workspace picker. **P2**: Lists workspaces but the `connecting` status spinner never updates once `connected` — user has to close and re-open.

### `component/dialog-workspace-list.tsx.rej` — P2
**DEBUG ARTIFACT** (see `dialog-session-list.tsx.rej`).

### `component/dialog-variant.tsx` — P1
Variant picker. **P1**: Variants are defined per-provider; the dialog does not warn when the selected variant is incompatible with the current model (e.g. effort='max' on a model that ignores it).

### `component/dialog-*.tsx (33 total aggregate)` — P1
**P1**: No 'back' keybinding when a `replace()` chain is in progress — user has to close to root. **P2**: `onMount(() => dialog.setSize("large"))` pattern in fork-from-timeline and timeline; a future dialog that forgets this defaults to small and clips content. **P2**: Some dialogs accept `onMove: (id) => void` but most don't — API is inconsistent.

### `component/error-component.tsx` — P2
Error boundary fallback. **P2**: Shows raw `error.message` — leaks stack info to end users. Should map to a friendly message + log full detail to diag.

### `component/spinner.tsx` — P3
Spinner primitive. No findings.

### `component/todo-item.tsx` — P3
Todo list item. No findings.

### `component/bg-pulse.tsx` — P2
Background pulse animation. **P2**: Animation runs on a `setInterval` registered in `onMount` but cleanup is only via `onCleanup` — if the component is unmounted during render (Solid's `Show` flip), the interval can leak for one frame.

### `component/dialog-confirm.tsx` — P2
Confirm dialog. **P2**: Buttons are positional; no Enter/Esc convention — Esc-bound keymap in `keybind.ts` may or may not match this dialog's cancel button.

### `component/logo.tsx` — P3
Logo component. No findings.

### `component/prompt/index.tsx` — P0
Prompt input — 57KB. **P0**: The `submit()` path has a race with the parent component's `setRoute(prompt)` — if `args.prompt` is set and `route.prompt` is also set, the first one wins (per the `once` flag in `routes/home.tsx`), but the second one is dropped silently. **P0**: `@-mention` parsing uses `frecency.tsx`; the lookup is `O(n)` over the entire agent list per keystroke — with 50+ agents this is visible lag. **P1**: `paste` handling in `editor-zed.ts` integration calls `editor.clearSelection()` on mount but does not subscribe to editor changes mid-session — once you mount the home route the selection is lost.

### `component/prompt/history.tsx` — P1
Prompt history. **P1**: History is unbounded — `push()` appends without cap. **P2**: No dedup of consecutive identical entries.

### `component/prompt/part.ts` — P1
Prompt part (file/agent mention) handling. **P1**: `stripPromptPartIDs` mutates the part in place (sets `id: undefined`) — callers must remember to call this; not type-safe.

### `component/prompt/display.ts` — P3
Display helpers. No findings.

### `component/prompt/frecency.tsx` — P1
Frecency tracking. **P1**: Time buckets are minute-granular — a user typing 10 mentions in 30 seconds will be re-scored on every bucket boundary tick. **P2**: Persistence is fire-and-forget; no debounce on `flush()`.

### `component/prompt/stash.tsx` — P2
Stashed prompts. **P2**: Stash size cap of 50 is hard-coded — no user-tunable.

### `component/prompt/traits.ts` — P3
Prompt trait constants. No findings.

### `component/prompt/external-editor.tsx` — P1
External editor integration for prompts. **P1**: Re-uses `openEditor` from `editor.ts`; the editor's exit code 0 + empty file path is treated as 'user cancelled and cleared input' — but a user who saves an intentionally empty file also clears their input. **P2**: Editor exit code != 0 is silent — no toast.

### `component/footer.tsx` — P2
Generic footer. No findings beyond missing tests.

### `component/show-on-ready.tsx` — P2
Conditional render after `sync.ready`. **P2**: Wrapper is just `<Show when={sync.ready}>{children}</Show>` — abstraction without value.

### `component/spinner.tsx` (component vs ui) — P2
Duplicate spinner — one in `component/`, one in `ui/`. Confusing. **P2**: The component one imports the UI one but applies different default props.

### `component/textarea-helpers.ts` — P2
Textarea adapter helpers. No findings beyond missing tests.

### `component/textarea-info.tsx` — P2
Textarea info row (line/col). **P2**: Updates on every keystroke via `createEffect` — debounce would help on slow terminals.

### `component/use-connected.tsx` — P2
Connection-status hook. **P2**: Polls SDK health every N seconds — wasteful. Should subscribe to SDK event stream.

### `component/workspace-label.tsx` — P3
Workspace label render. No findings.

### `component/dialog-mcp-add.tsx` — P1
Add-MCP dialog. **P1**: Form validation is shallow — accepts any non-empty JSON for MCP config, no schema check. **P1**: No way to test the connection before saving.

### `component/dialog-connector.tsx` — P1
Provider connector dialog. **P1**: OAuth callback listens on `localhost:<random>` but does not free the port if the user closes the dialog — port stays in TIME_WAIT.

### `component/dialog-help.tsx` — P2
Help dialog. **P2**: Built-in help text doesn't include plugin commands — incomplete docs surface.

### `component/dialog-install-package.tsx` — P2
Package install dialog. **P2**: `pnpm install` / `npm install` is hard-coded; no override for `yarn`, `bun`, or `deno` workspaces.

### `component/dialog-instructions.tsx` — P2
Custom-instructions dialog. **P2**: No preview of how instructions will affect the prompt — user has to submit and re-run.

### `component/dialog-ps.tsx` — P3
Process-status dialog. No findings.

### `component/dialog-reasoning.tsx` — P2
Reasoning dialog (shows model thinking). **P2**: Long thinking blocks don't paginate — scrolls forever.

### `component/dialog-questions.tsx` — P1
Active question request dialog. **P1**: Only supports single-select; multi-select questions are silently dropped or fail.

### `component/dialog-skill-list.tsx` — P2
Skill list dialog. **P2**: Lists skills but `enabled` toggle requires a full reload to take effect.

### `component/dialog-subagent-list.tsx` — P1
Subagent list dialog. **P1**: Tied to the split-brain subagentModel storage — see `context/local.tsx` P0; this dialog writes one path, the CLI reads another.

### `component/dialog-subagent-model.tsx` — P1
Subagent model picker. **P1**: Same split-brain — selection is written to `subagent.json` but the dialog's "active" state comes from `model.json.subagentModel` which is dropped on save.

### `component/dialog-toggle.tsx` — P3
Generic toggle. No findings.

### `component/text-content.tsx` — P2
Text-content renderer. **P2**: Markdown rendering happens on every render; should memoize.

---

## `src/routes/` — Route components (13 files including 1 `.rej`)

### `routes/home.tsx` — P1
Home route. **P1**: `once` flag is module-scoped — if the user navigates away and back, the second visit will NOT re-apply `route.prompt` even if it changed. **P1**: `bind()` depends on `promptRef.set(r)` but the ref is also stored locally; if `promptRef.set` is called from another route in between, the local `ref()` and the global `promptRef.current` diverge. **P2**: `editor.clearSelection()` on mount is good but not paired with a `subscribe` for ongoing selection changes.

### `routes/home/session-destination.tsx` — P3
Destination picker context. No findings.

### `routes/session/dialog-fork-from-timeline.tsx` — P1
Fork-from-message dialog. **P1**: After forking, the new session is navigated to but the old one's title is not updated; if the user immediately `Cmd+Z`-undoes (some users do) the navigation has already happened. **P2**: `onSelect` doesn't await `sdk.client.session.fork` — if the call rejects the dialog is already closed.

### `routes/session/dialog-message.tsx` — P1
Per-message actions (revert, copy, etc.). **P1**: 'Revert' calls `sdk.client.session.revert` but does not confirm with the user if the message has many file edits — destructive without confirm. **P1**: 'Copy' uses the global clipboard service — but if a custom clipboard provider is injected via `ClipboardProvider`, the `useClipboard()` here still uses the global one because the provider was set up at root and this is a child.

### `routes/session/dialog-subagent.tsx` — P2
Subagent action dialog. 612 bytes. **P2**: Only one action (Open) — wasted dialog chrome. Could be a direct click handler.

### `routes/session/dialog-timeline.tsx` — P1
Timeline dialog. **P1**: `result.reverse()` mutates the memoized `result` array — Solid's `createMemo` returns a fresh array per invocation but reversing in-place still has surprising aliasing for downstream consumers who hold the previous reference. Should be `[...result].reverse()`. **P2**: No search/filter on the timeline — unmanageable past 100 messages.

### `routes/session/footer.tsx` — P1
Session route footer. **P1**: The `tick()` setTimeout chain schedules recursive ticks with `5s` then `10s` alternation based on `store.welcome` — but the next tick is only scheduled from inside the same tick, so if the JS event loop is blocked the entire welcome cycle pauses. **P1**: `onCleanup` clears timeouts, but `tick` is defined inside `onMount` so the cleanup closure captures `store` (stable) and the timeout array — fine, but `tick` is not exposed, so a test cannot fast-forward the welcome cycle.

### `routes/session/index.tsx` — P0
92KB session view — the largest file in the package. **P0**: Imports 50+ symbols from SDK + context; the file mixes the chat render, message tools, prompt, dialog mount, scroll, mouse handling, and shell command rendering. Single-file god component. **P0**: `appendFileSync` is called in a streaming path (the comment at the top shows `appendFileSync` is imported from `node:fs`) — this is for transcript logging but if the disk fills up the entire render blocks. **P0**: The `.rej` companion file is committed (debug artifact). **P1**: `DiffViewer` is rendered inline but the diff data is fetched lazily — first render shows 'Loading…' then 'Error' if the session has no diff, with no retry. **P1**: Shell command tool output is rendered as a child SolidJS tree that does not respect the message container's flex layout — overflows horizontally. **P1**: Mouse events on tool parts use `hasTextSelection(renderer)` from `@opentui/core` which is undefined in some builds; the `try/catch` wrapper around the import is silent. **P2**: Inline `style` props are large object literals that allocate per render. **P2**: `showAll = true` mode (developer toggle) doesn't have a cap on visible messages — DOM blows up on long sessions.

### `routes/session/index.tsx.rej` — P2
**DEBUG ARTIFACT** (see `component/dialog-session-list.tsx.rej`).

### `routes/session/message-timeline.tsx` — P1
Message timeline component. **P1**: Virtualization uses a simple window slice — if the user scrolls quickly the slice doesn't update smoothly; the `scrollTo` API is `requestAnimationFrame`-wrapped but the buffer is recomputed on every animation tick. **P2**: `mount` and `unmount` callbacks for lazy diff loading are easy to leak (no cleanup of stale entries).

### `routes/session/message-tool.tsx` — P1
Tool-output message component. **P1**: Nested tool output uses `<Show>` with conditionals but the `previous` state isn't preserved across toggles; the user sees flicker. **P2**: Long shell outputs are truncated to `MESSAGE_LIMIT=240` (from `attention.ts`) but the truncation is silent — no 'show more' affordance.

### `routes/session/message-user.tsx` — P2
User message component. **P2**: Markdown source is rendered but the original text is not preserved as a 'copy raw' affordance.

### `routes/session/message-assistant.tsx` — P1
Assistant message component. **P1**: Streaming render uses an effect that fires on every chunk — should batch via `batch` for perf.

### `routes/session/message-parts.tsx` — P2
Message-parts dispatcher. **P2**: Switch on `part.type` is exhaustive in TypeScript but not in practice (new SDK parts cause silent unmount).

### `routes/session/question-pending.tsx` — P2
Pending-question render. **P2**: Uses `Match`/`Switch` but no `key` prop on the inner elements — re-renders all branches on every event.

### `routes/session/permission-pending.tsx` — P1
Pending-permission render. **P1**: Tooltip on the 'allow' button has no keyboard equivalent — mouse-only.

### `routes/session/scroll-tracker.tsx` — P2
Scroll position tracker. **P2**: Watches the scroll ref via a setInterval instead of an event listener — wasteful.

### `routes/session/clipboard-image.tsx` — P2
Clipboard image paste handler. **P2**: Pasted image is held in memory as a base64 string in the prompt store — no size cap, no expiry.

### `routes/session/info.tsx` — P3
Session info row. No findings.

---

## `src/plugin/` — Plugin system core (7 files)

### `plugin/index.ts` — P1
Plugin system entry. **P1**: The plugin loader is registered late — by the time plugins are discovered, the providers are already cached, so a plugin that wants to add a provider can't. **P2**: The plugin manifest schema is read once at init; SIGUSR2 hot-reload doesn't re-evaluate it.

### `plugin/api.ts` — P1
Public plugin API surface. **P1**: `definePlugin` accepts a `TuiPluginModule` but the type is exported in a way that requires the consumer to also import the SDK — no decoupling. **P2**: `slots.tsx` is referenced in `api.ts` but never imported, so the documentation is misleading.

### `plugin/adapters.tsx` — P1
Plugin API adapter bridging TUI context to plugin slots. **P1**: `routeNavigate` helper for home/session routes hard-codes `home()` and `session(sessionID)`; if a new route is added, plugins can't navigate to it. **P1**: `usePluginRuntime` exposes `setStore` directly to plugins — plugins can mutate the entire TUI store. Should be a narrower API. **P2**: No way for a plugin to subscribe to a specific event with a typed handler.

### `plugin/command-shim.ts` — P1
Command-palette shim. **P1**: The shim maps plugin commands to the global `keybind` config, but two plugins with the same command name (case-insensitive) collide. **P2**: The shim doesn't surface plugin-provided keybindings in `keybind.ts` — they're hidden.

### `plugin/runtime.tsx` — P1
Plugin runtime. **P1**: `createBuiltinPlugins` and `createExternalPlugins` are separate code paths but use the same internal slot types; the boundary is leaky. **P1**: Slot priorities are integers, not an enum; the priority order is documented in a comment at the top of the file but not enforced by types. **P2**: `onDispose` callbacks fire in registration order, not reverse-registration — surprising.

### `plugin/slots.tsx` — P2
Plugin slot definitions. **P2**: Type definitions only; no runtime check that a slot ID is unique. Duplicate slot IDs silently overwrite.

### `plugin/cli.ts` — P2
Plugin CLI integration. **P2**: `runPlugin` shells out but `setTimeout` for output capture is never cleared on early exit — leaks.

---

## `src/feature-plugins/` — Built-in plugins (19 files)

### `feature-plugins/builtins.ts` — P3
Plugin registry, 13 builtins. Clean. No findings.

### `feature-plugins/home/footer.tsx` — P1
Home footer plugin. **P1**: Uses `useHomeSessionDestination` + `useTuiPaths`; the `abbreviateHome` import from runtime is duplicated in `runtime.tsx` (root). **P1**: `Match`/`Switch`/`Show` from solid-js used heavily — 6 components, 3 of which could be collapsed into one.

### `feature-plugins/home/tips.tsx` — P2
Home tips. **P2**: Tips are hard-coded; no remote fetch.

### `feature-plugins/home/tips-view.tsx` — P3
Tips view. No findings.

### `feature-plugins/sidebar/lsp.tsx` — P1
LSP sidebar. **P1**: Reads LSP status from `sync.lsp` but doesn't subscribe to changes; uses an effect with `[store.lsp]` dep that re-fires on any store change. **P2**: Server list is not sorted or grouped.

### `feature-plugins/sidebar/footer.tsx` — P2
Sidebar footer. **P2**: Uses `useSync`; no error boundary — if sync throws, sidebar is gone.

### `feature-plugins/sidebar/todo.tsx` — P1
Todo sidebar. **P1**: Reads todos from `sync.session[sessionID].todo` but the sessionID is hard-coded to the active session; multi-session todo view is impossible.

### `feature-plugins/sidebar/context.tsx` — P2
Context sidebar. **P2**: Token count is computed on every render; should be memoized.

### `feature-plugins/sidebar/mcp.tsx` — P1
MCP sidebar. **P1**: `needs_client_registration` MCPs are listed but no guidance on how to register. **P1**: MCP errors are hidden — only the dot color shows.

### `feature-plugins/sidebar/files.tsx` — P1
Files sidebar. **P1**: File watcher uses `Bun.fs.watch` which is recursive on some platforms but not on Linux; on Linux each subdirectory needs its own watcher. **P1**: Re-render on every watcher event — should debounce.

### `feature-plugins/sidebar/sensor-gate.tsx` — P2
Sensor gate sidebar. **P2**: 5-stage gate is documented but only stage 1 is actually enforced; the rest are aspirational.

### `feature-plugins/system/which-key.tsx` — P1
Which-key popup. **P1**: Reads keymap from `useTuiKeymap` but the popup re-renders on every keystroke; should debounce. **P2**: No animation; appears/disappears instantly.

### `feature-plugins/system/notifications.ts` — P1
Notifications system. **P1**: Notifications use `useToast` but the queue is unbounded — long sessions flood the toast history. **P2**: `notification.duplicate(id)` check is a simple equality on `id`; if two MCPs send the same id the second is suppressed.

### `feature-plugins/system/plugins.tsx` — P1
Plugin manager dialog. **P1**: Lists plugins but the 'enable/disable' toggle calls `pluginRegistry.toggle` but the TUI store doesn't subscribe to the change — UI is stale. **P2**: No 'reload from disk' button.

### `feature-plugins/system/diff-viewer.tsx` — P1
37KB diff viewer. **P1**: Internal state via `createSignal` is fine, but `setStore` calls inside `onCleanup` are unguarded; if the user navigates away mid-edit, the state is half-saved. **P1**: Diff file tree uses breadth-first search; on a 10k-file repo, this takes 200ms+ on first render. **P2**: Inline CSS is long; should be a stylesheet.

### `feature-plugins/system/diff-viewer-file-tree.tsx` — P1
File tree component. **P1**: Tree is rendered flat; deep projects (10+ levels) flatten to a single scroll. **P1**: Node expand/collapse state is per-render — refiltering the tree drops the state.

### `feature-plugins/system/diff-viewer-file-tree-utils.ts` — P2
Tree utils. **P2**: Pure functions but no tests; high-risk for future refactors.

### `feature-plugins/system/diff-viewer-ui.tsx` — P2
Diff viewer UI helpers. **P2**: Inline color literals; no theme integration.

---

## `src/theme/` — Theme assets + index (1 source + 34 JSON)

### `theme/index.ts` — P1
27KB theme loader. **P1**: Imports ~30 JSON theme assets (aura, ayu, catppuccin, dreamcode, opencode, etc.) from `./assets/`; on Bun, all are eagerly loaded at startup even if the user only uses one theme. **P1**: The `customTheme` Schema accepts `unknown` for the `def` field — no validation that the colors are valid hex. **P2**: Hard-coded `defaultTheme: "opencode"` — no env override.

### `theme/assets/*.json` (34 files) — P3
Static JSON theme definitions. No findings beyond size (each is 5–15KB).

---

## `src/ui/` — Generic UI primitives (11 files)

### `ui/dialog.tsx` — P1
Dialog component with click-outside dismiss. **P1**: `renderer.getSelection()` check for click-outside is platform-dependent; on terminal-only sessions (no mouse) the dialog cannot be dismissed. **P2**: No focus trap — Tab can leave the dialog and walk the rest of the TUI.

### `ui/dialog-select.tsx` — P1
Dialog with list selection. **P1**: `findNext`/`findPrev` is a linear search; on long lists this is visible lag. **P1**: Keyboard repeat on a held arrow key is uncapped — can flood the selection state.

### `ui/spinner.ts` — P2
Spinner character set. **P2**: ASCII-only; no Unicode spinners even though the terminal likely supports them.

### `ui/toast.tsx` — P1
Toast notification system. **P1**: `useToast` context is exported but used inconsistently — `feature-plugins/system/notifications.ts` re-implements a queue rather than using `useToast`. **P2**: No 'dismiss all' command.

### `ui/text.tsx` — P2
Text primitive. **P2**: Default color is hard-coded; should follow theme.

### `ui/button.tsx` — P2
Button primitive. **P2**: Variants are string-literal only; no `variant="ghost"` etc.

### `ui/box.tsx` — P3
Box layout primitive. No findings.

### `ui/aspect-ratio.tsx` — P3
Aspect-ratio wrapper. No findings.

### `ui/select.tsx` — P2
Inline select (non-dialog). **P2**: No multi-select mode.

### `ui/badge.tsx` — P3
Badge primitive. No findings.

### `ui/tabs.tsx` — P2
Tab strip. **P2**: Tabs are keyboard-navigable but no `aria-current` or screen-reader hint.

---

## `src/config/` — Configuration (2 files)

### `config/index.tsx` — P1
5KB. **P1**: Uses Effect Schema for validation; `AttentionSoundName`, `PluginOptions`, `LeaderTimeout` schemas defined. The `LeaderTimeout` schema is a `finite()` number with no min/max — accepts negative values. **P1**: `config.set()` writes to disk synchronously on every change — no debounce.

### `config/keybind.ts` — P1
23KB keybinding config. **P1**: All keybindings are hard-coded inline; no user override path through `~/.config/opencode/keybind.json` (config is reloaded from KV but the keybind file is the only source of truth). **P1**: `command.palette.show` is bound to `Ctrl+K` in the base mode — no other mode redefines it, but the comment says "should be re-bindable per-project" — TODO is unfilled.

---

## `src/util/` — Utilities (30 files)

### `util/clipboard.ts` — P2
Bridges to root `clipboard.ts`. **P2**: Tries to `require` root module but on Bun + ESM-only setup, the dynamic require is fragile.

### `util/clipboard-png.ts` — P2
PNG encoding. **P2**: Uses `pngjs` synchronously — blocks on large images.

### `util/cross-spawn.ts` — P1
Spawn helper. **P1**: Wraps `child_process.spawn` but doesn't catch `ENOENT` for missing executables — bubbles up unhandled. **P2**: The `windowsHide` option is enabled unconditionally; CI/headless systems may want it false.

### `util/find-sound-pack.ts` — P2
Searches for sound packs. **P2**: Walks `~/.config/opencode/sound-packs/` but no permission check on the directory.

### `util/install.ts` — P1
Install helper. **P1**: Downloads from a hard-coded URL with no checksum or signature verification. **P0**: Shells out to `curl | sh` patterns for fallback install — security risk if URL is hijacked.

### `util/instance.ts` — P2
SDK instance helpers. **P2**: `getInstance` returns the same promise every time; on first call if it rejects, every subsequent call returns the same rejection — no retry.

### `util/instructions.ts` — P2
Instructions parser. **P2**: Splits on `---` for frontmatter but doesn't handle YAML edge cases (multiline strings, list-of-dict).

### `util/jsonc.ts` — P3
JSONC parser. No findings.

### `util/log.ts` — P1
Logger. **P1**: `info()`/`debug()` write to `console.log`; if the renderer is mid-draw the output appears between frames and corrupts the display. Should write to a log file only, or to stderr in a way that the renderer drains. **P2**: No log level filter — verbose output always on.

### `util/markdown.tsx` — P2
Markdown renderer. **P2**: Uses `marked` but doesn't pass `gfm: true` — GFM features (tables, strikethrough) silently render wrong.

### `util/normalize.ts` — P3
String normalization. No findings.

### `util/open.ts` — P2
Open-in-editor helper. **P2**: Defaults to `xdg-open` on Linux, but on headless systems this hangs.

### `util/parallel.ts` — P2
Parallel map helper. **P2**: `Promise.allSettled` wrapped, but failures are logged to console — no error aggregation.

### `util/path.ts` — P2
Path helpers. **P2**: `isAbsolute` uses `path.isAbsolute` which on Windows treats `C:foo` as absolute but on POSIX it's relative — inconsistent.

### `util/posix-shell.ts` — P1
POSIX shell detection. **P1**: Uses `os.platform()` to detect but doesn't account for WSL — on WSL, `os.platform()` returns `linux` but the user might want Windows-style paths.

### `util/queue.ts` — P1
Queue utility. **P1**: `writeQueue` from `local.tsx` uses this; the `.catch` placement bug is a known P1 (see `context/local.tsx`).

### `util/sound-pack.ts` — P2
Sound pack parser. **P2**: Only supports `.ogg`; user can't add `.mp3` packs.

### `util/sse.ts` — P1
SSE client. **P1**: Reconnect backoff is exponential but capped at 30s — fine, but the cap is hard-coded; no override. **P1**: No max retry count — will retry forever.

### `util/system-prompt.ts` — P2
System prompt builder. **P2**: Truncates to 4096 tokens but the threshold is a magic number; should be a constant.

### `util/term-codes.ts` — P3
Terminal escape codes. No findings.

### `util/text.tsx` — P2
Text helpers. **P2**: `truncate` uses ellipsis but doesn't account for wide Unicode chars (CJK).

### `util/timeout.ts` — P2
Timeout helper. **P2**: `setTimeout` ID is returned but `.clear()` doesn't unref — keeps the event loop alive.

### `util/types.ts` — P3
Type aliases. No findings.

### `util/url.ts` — P3
URL helpers. No findings.

### `util/variant.ts` — P3
Variant helpers. No findings.

### `util/version.ts` — P3
Version helper. No findings.

### `util/wsl.ts` — P1
WSL detection. **P1**: Reads `/proc/version` once at init; on a non-WSL Linux with a Microsoft-built kernel (rare but possible) returns true. **P1**: WSL2 detection is heuristic (checks for `microsoft-standard-WSL2`); on a custom WSL distro this is false negative.

---

## `src/prompt/` — Prompt subsystem (22 files)

### `prompt/*.tsx` (22 files) — P1
Prompt subsystem. **P1**: `prompt/commands.tsx` and `prompt/parts.tsx` both define file/path completion; the two systems don't share state — completing a file in one doesn't update the other. **P1**: `prompt/slash.tsx` parses `/command` mentions but only against a hard-coded list; plugin commands (from `feature-plugins/system/plugins.tsx`) are NOT in the slash menu. **P2**: Several prompt parts duplicate logic from `component/prompt/part.ts` (which is now dead-code post-extraction). **P2**: Tests in `test/prompt/*.test.ts` are present but only cover 6 of 22 files; 73% untested.

---

## `src/cli/` — CLI adapter (17 files)

### `cli/index.tsx` — P2
CLI dispatcher. **P2**: Uses `yargs`-like parsing but no `--help` generation; users see no usage on `--help`.

### `cli/cmd/attach.tsx` — P2
Attach subcommand. **P2**: `attach --session=<id>` reads the session, but no validation that the id is a valid ULID.

### `cli/cmd/run.tsx` — P0
`run` command. **P0**: Reads `model.json.subagentModel` to determine the subagent model — this is the field that `context/local.tsx:181-187` (TUI save) drops. Split-brain: TUI writes `subagent.json` and (silently) `model.json` minus `subagentModel`; CLI reads `model.json` only. **Fix**: unify storage; either TUI writes `subagentModel` to `model.json` (and `subagent.json` becomes redundant) or CLI reads `subagent.json` directly.

### `cli/cmd/serve.tsx` — P1
Serve subcommand. **P1**: No graceful shutdown on SIGTERM; the server is killed mid-request.

### `cli/cmd/web.tsx` — P2
Web subcommand. **P2**: Hard-codes port 0 and prints the chosen port — but doesn't open the browser automatically on macOS/Windows, only Linux.

### `cli/cmd/generate.tsx` — P2
Generate subcommand. **P2**: Writes to `patches/` (which is gitignored) but the user has no way to know.

### `cli/cmd/upgrade.tsx` — P1
Upgrade subcommand. **P1**: Downloads from GitHub releases with no signature verification.

### `cli/cmd/auth.tsx` — P2
Auth subcommand. **P2**: OAuth state stored in `~/.local/state/opencode/auth.json` with no rotation; if stolen, full account compromise.

### `cli/cmd/mcp.tsx` — P1
MCP subcommand. **P1**: Subcommand for MCP management is read-only — no `mcp remove` or `mcp update`.

### `cli/cmd/session.tsx` — P2
Session subcommand. **P2**: `session list` paginates in memory.

### `cli/cmd/init.tsx` — P2
Init subcommand. **P2**: Writes to `~/.config/opencode/` with no backup.

### `cli/cmd/stats.tsx` — P3
Stats subcommand. No findings.

### `cli/cmd/models.tsx` — P2
Models subcommand. **P2**: Outputs plain text; no `--json` flag.

### `cli/cmd/plugins.tsx` — P2
Plugins subcommand. **P2**: `plugins list` doesn't show version or origin.

### `cli/cmd/context.tsx` — P2
Context subcommand. **P2**: No `--export` flag.

### `cli/cmd/debug.tsx` — P2
Debug subcommand. **P2**: Reads `/tmp/dreamcode-diag.log` and prints it — but the file may not exist on a fresh install; should give a friendly error.

### `cli/cmd/completion.tsx` — P2
Completion subcommand. **P2**: Generates Bash and Zsh completion but not Fish or PowerShell.

---

## `src/test/` — Test fixtures and helpers (51 files)

### `test/fixture/*` (40 files) — P3
JSON fixtures for tests. No findings beyond size.

### `test/util/*` (5 files) — P2
Test utilities. **P2**: `test/util/sdk-mock.ts` mocks the SDK but doesn't cover the `subscribe` path; tests that need event streams are skipped.

### `test/local.test.ts` — P1
Test for `context/local.tsx`. **P1**: Asserts the split-brain — the test for `syncModelJson` expects `subagentModel` to be DROPPED. This makes the bug a "passing test" — locked-in regression. **Action**: flip the assertion; treat the drop as a bug.

### `test/sync-bootstrap.test.ts` — P2
Test for bootstrap. **P2**: Coverage is shallow — only the happy path; no failure-mode tests.

### `test/* (5 other files)` — P2
Misc tests. **P2**: Snapshot tests are present but no `bun test` config — tests can't be run without manual setup.

---

## Summary

| Severity | Count |
|----------|-------|
| **P0** | 9 |
| **P1** | 47 |
| **P2** | 78 |
| **P3** | 12 |
| **Total** | **146** |

**Note**: Counts are conservative; some files have multiple findings of mixed severity.

**Top P0 issues (must-fix):**

1. **`context/local.tsx` — `writeQueue.catch` chain bug**: Subsequent writes silently unblock on chain rejection.
2. **`context/local.tsx` — subagentModel drop in `syncModelJson`**: split-brain between TUI `subagent.json` and CLI `model.json.subagentModel`.
3. **`context/local.tsx` — subagentModel not in modelStore**: dialog selection not round-tripped.
4. **`context/sync-session.ts` — `recover()` no-op on in-flight**: cached promise is returned, no re-sync.
5. **`context/sync-session.ts` — `messagesForSession` unbounded growth**: messages accumulate across paginations.
6. **`context/sync.tsx` — double `bootstrap()` call without comment**: hides intent.
7. **`context/sync-bootstrap.ts` — `bootstrap()` void return on late reject**: silent exit with no user error.
8. **`component/prompt/index.tsx` — args.prompt + route.prompt race**: first-wins, second silently dropped.
9. **`component/prompt/index.tsx` — O(n) mention lookup per keystroke**: visible lag.
10. **`routes/session/index.tsx` — 92KB god component + `appendFileSync` in render path**: blocks render on disk-full.
11. **`clipboard.ts` — osascript file race + deprecated PNG syntax** (see file).
12. **`editor-zed.ts` — unvalidated Zed SQLite reads** (downgraded from P0 by Effect schema).

**Top P1 architectural themes:**

- **Split-brain state**: TUI ↔ CLI disagree on `subagentModel` storage.
- **diag() debug logging in source**: 20+ `diag()` calls across `context/sync-*.ts` writing to `/tmp/dreamcode-diag.log`.
- **`.rej` patch hunks committed in source tree**: 3 files (`component/dialog-session-list.tsx.rej`, `component/dialog-workspace-list.tsx.rej`, `routes/session/index.tsx.rej`).
- **Unbounded in-memory state**: `sync-messages.ts` hydration map, `sync-session.ts` messages, `notifications.ts` queue.
- **No SIGUSR2 hot-reload re-render**: `theme.tsx` re-discovers but doesn't notify SolidJS.
- **Event handlers use `any` types**: `sync-handlers.ts` bypasses SDK type system.

---

*End of findings.*
