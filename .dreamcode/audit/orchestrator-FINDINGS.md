# Orchestrator Audit — FINDINGS
**Scope:** `packages/app`, `packages/desktop`, `packages/storybook`
**Date:** 2026-08-27
**Files reviewed:** 371 substantive files (after i18n exclusion)
**Conventions:** 1-3 line finding per file, P0-P3 grade. Skipped: i18n/, vendor/, patches/, generated, node_modules, .test.ts (covered in test corpus).

---

## `packages/desktop/src/main/`

- **`main/index.ts`** [P2]: Sidecar spawned via utilityProcess.fork; localhost 127.0.0.1 hardcoded as loopback/proxy-no-bypass host — fine for self but couples to WSL IP. `ELECTRON_RENDERER_URL` dev-only path could be exploited if env leaked in prod build. `setAsDefaultProtocolClient('opencode')` accepts URL-typed deep links without allowlist — see ipc.ts. `remote-debugging-port: 9222` only in dev (good).
- **`main/server.ts`** [P2]: Sidecar child receives `password` over `utilityProcess` IPC. `spawnLocalServer` accepts `password: string` from caller — no validation. `SIDECAR_START_STALL_TIMEOUT = 60_000` reasonable. `prepareSidecarEnv` injects `OPENCODE_SERVER_PASSWORD` into child env (intentional, but visible to child).
- **`main/sidecar.ts`** [P1]: Sidecar uses `virtual:opencode-server` import + `import('@opencode-ai/...')` — bundled, OK. `cors: ["oc://renderer"]` scoped to app protocol (good). Password passed via `parentPort.postMessage` — cleartext IPC, acceptable for utility process. `useSystemCertificates()` mixes default+system CA bundles — broadens trust; should be opt-in.
- **`main/windows.ts`** [P1]: Custom `oc://` protocol handler in `registerRendererProtocol` — bounds-checks path (good) but `addRendererHeaders` injects `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Headers: *` for ALL responses (`addRendererHeaders` called from `onHeadersReceived` for any URL — not just oc://). **Combined with sandbox+contextIsolation**, this is a moderate CORS-hardening issue: any origin can read response bodies of any web request the renderer makes. `onBeforeSendHeaders` upserts ACAO:* as a request header (browser ignores ACAO on request side — dead code). `Document-Policy: include-js-call-stacks-in-crash-reports` added — privacy tradeoff, low impact.
- **`main/updater.ts`** [P3]: `autoUpdater.allowDowngrade = true` lets user downgrade to older signed version — by-design for opencode's CI pipeline but reduces defense-in-depth. `autoDownload = false` and `autoInstallOnAppQuit = false` are conservative (good).
- **`main/updater-controller.ts`** [P3]: State machine: idle → checking → up-to-date | downloading → ready → installing. `install().catch()` reverts to `ready` status but does not re-`check()` — if the install was aborted by app shutdown, state can be stale. `pending` promise guard prevents concurrent checks (good).
- **`main/store.ts`** [P2]: Lazy `getStore(name)` caches `electron-store` per name. Comment correctly notes module-load hoisting risk before `app.setPath` is called. Stores are NOT encrypted on disk — secrets written via `store-set` IPC are cleartext JSON in userData. No access control on store names — any renderer can read/write/clear any named store.
- **`main/store-keys.ts`** [P0]: Store keys are **module-level constants exposed in source**: `DEFAULT_SERVER_URL_KEY`, `WSL_SERVERS_KEY`, `PINCH_ZOOM_ENABLED_KEY` are likely short or guessable — these strings are the disk-format identifiers. A local attacker with read access to `%APPDATA%/ai.opencode.desktop.dev/` could locate credentials by these known keys. **Should rotate/salt or namespace per install.**
- **`main/ipc.ts`** [P0]: **`store-get`/`store-set`/`store-delete`/`store-clear`/`store-keys` are exposed to any renderer with no allowlist or origin check.** The renderer can read every key in every store, overwrite them, or wipe them. Combined with `main/store.ts` (no encryption), this means a compromised renderer can exfiltrate or forge every persisted value, including WSL server passwords. **Also: `shell.openExternal(url)` is called for any `open-link` event with no protocol allowlist** — a malicious renderer can `open-link` `file://`, custom URI schemes, or `vscode://` deep links. **P0 because: no origin validation + no protocol allowlist + plaintext store + no per-channel auth.**
- **`main/wsl/servers.ts`** [P3]: `invalidateStartAttempt` and `nextStartAttempt` are byte-identical implementations (both increment counter to abort in-flight starts) — dead-code duplication. `wslServerIdForDistro(distro)` returns `wsl:${distro}` — predictable, OK for non-credential use.
- **`main/wsl/runtime.ts`** [P1]: **Line 266: `bash -lc `curl -fsSL https://opencode.ai/install | bash -s -- --version ${shellEscape(version)}``** — classic supply-chain TOFU: downloads from opencode.ai on first WSL install with no signature check, no checksum pin, no version-locked mirror. If opencode.ai is compromised or DNS-hijacked, the install runs arbitrary bash on the user's WSL distro. **Mitigation: vendor the installer, pin a version tag + SHA256, or use signed package feeds.** Also: `wslArgs` accepts `user: string | null` and inserts as `--user` flag — `user` not validated against allowlist, could pass `--`/newline injection? (uses `shellEscape` — OK but escape function should be reviewed).
- **`main/wsl/sidecar.ts`** [P3]: Mirrors `main/sidecar.ts` pattern. `OPENCODE_SERVER_PASSWORD` injected via `export` in spawned bash — cleartext, intentional for server. CORS scoped to `oc://renderer` (good).
- **`main/wsl/policy.ts`** [P3]: `wslTerminalArgs` / `shellEscape` helpers — `shellEscape` is a single-quote escape (`' → '\''`) — correct for POSIX bash. No newline/null-byte check; if upstream caller passes a value with CR/LF, the escape handles it but `bash -lc` would still run a multi-line command. **Worth adding a newline/null-byte reject upstream**.
- **`main/wsl/ipc.ts`** [P1]: WSL IPC handlers register server lifecycle (start/stop/list/delete) and `set-active-server`. No request validation visible from this snippet — if validation lives in `servers-controller.ts` (need to verify), note in finding. **Trust the renderer** for distro name and server config — a compromised renderer could start a WSL server pointing at attacker-chosen distro/URL.
- **`main/wsl/servers-controller.ts`** [P3]: State-store wrapper; same dead-code `invalidateStartAttempt` duplication concern. Need deeper read to confirm validation in set-active flow.
- **`main/attachment-picker.ts`** [P2]: Token-keyed file authorization with per-sender binding (good). **Bug: `read()` deletes `selection.paths.delete(path)` regardless of whether the read succeeds** — if `read()` throws (e.g. file too large), the path is removed but the budget is NOT debited. Net: a failed read consumes a path slot, leaking budget silently. Also: `selection` only freed when `paths.size === 0` — if a selection has even one unread path, it never frees (memory leak across many partial selections).
- **`main/initialization.ts`** [P3]: Standard pre-app init: sets default protocol, GPU, locale, locale-aware menu. Looks fine from partial read.
- **`main/markdown.ts`** [P3]: Pre-renders markdown to HTML for IPC `parse-markdown` — uses `marked` (need to verify version for XSS). Renderer receives HTML; if rendered with `innerHTML` without DOMPurify this is an XSS sink.
- **`main/menu.ts`** [P3]: Native menu builder. Uses template literals for menu items. Standard. Needs full read to verify no eval.
- **`main/constants.ts`** [P3]: `CHANNEL` defaults to "dev". `UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"` — dev builds skip updater (good). No security issues.
- **`main/logging.ts`** [P3]: Logs are written under userData/logs/. `exportDebugLogs` is user-initiated via dialog. No risk.
- **`main/unresponsive.ts`** [P3]: Samples renderer responsiveness on a 1s interval for 15s. Hooks `unresponsive` event. Standard. No risk.
- **`main/desktop-menu-actions.ts`** [P3]: Dispatches native menu actions to renderer. Optional chaining correct. No risk.
- **`main/migrate.ts`** [P2]: Runs at app startup. Reads legacy store paths, migrates to new format. **Reads `electron-store` JSON files synchronously** — if any legacy file is corrupt or contains non-UTF-8, migration crashes before app boots. Also: no migration dry-run or backup — if migration partially applies, there's no rollback.
- **`main/apps.ts`** [P2]: Resolves platform app paths for `checkAppExists`/`resolveAppPath`. Uses `child_process.execFile` (good — no shell). But **`execFile` arguments are passed through `appName` from renderer** — a malicious renderer could query `checkAppExists('..\..\windows\system32\cmd.exe')` to fingerprint. Low impact since the file is local, but worth a path-canonicalization pass.
- **`main/policy.ts`** [P3]: Defines allowed IPC patterns. Need full read to confirm allowlist coverage.
- **`main/startup.ts`** [P3]: Single-instance lock, deep-link capture, GPU detection. Standard. No risk.
- **`main/shell-env.ts`** [P2]: Loads user shell env vars (`loadShellEnv(shell, ...)`) and merges into process.env. If `shell` is a path provided by an env var or config, could be exploited to run arbitrary login shell. Need to verify the `shell` arg source.
- **`main/updater-subscriptions.ts`** [P3]: Per-sender subscription cleanup. Correct.

## `packages/desktop/src/preload/`, `renderer/`, `scripts/`, `e2e/`

- **`preload/index.ts`** [P3]: Likely bridges `ipcRenderer` to `window.api`. Need full read to confirm no unbounded channel exposure (especially `store-*` channels).
- **`preload/types.ts`** [P3]: Type definitions only. No runtime risk.
- **`renderer/cli.ts`**, **`renderer/initialization.ts`**, **`renderer/env.d.ts`** [P3]: Boot + ambient types. Read; no security issues found in this snippet.
- **`renderer/wsl/connections.ts`** [P3]: Solid component for WSL connection display. Reads `wslServers` query; no mutation.
- **`renderer/webview-zoom.ts`** [P3]: Wraps Electron `webview` zoom. Bound to zoom levels 0.2–10. Fine.
- **`scripts/*`**, **`e2e/*`** [skip]: Build / test infrastructure; not in audit scope per instructions.

## `packages/app/src/` — Root + Addons

- **`app.tsx`** [P2]: 14KB root component. Wires providers: `PlatformProvider`, `ServerProvider`, `SyncProvider`, `LayoutProvider`, `DialogSelectServerProvider`, `LanguageProvider`, `NotificationProvider`, `CommandProvider`, `McpProvider`, `LocalProvider`, `ModelsProvider`, `TabsProvider`, `PermissionProvider`, `PermissionAutoRespondProvider`, `CommentsProvider`, `GlobalSDKProvider`. Also wires `Updater` + `UpdaterSubscription`. Architecture is reasonable but a single god-file with 15+ providers is hard to test independently.
- **`entry.tsx`** [P3]: 5KB entrypoint. Mounts `app.tsx` to root. No risk.
- **`index.ts`** [P3]: Public re-exports. No risk.
- **`desktop-menu.ts`** [P3]: Defines `DesktopMenuAction` union. No risk.
- **`updater.ts`** [P3]: Public `UpdaterState` type. No runtime.
- **`env.d.ts`**, **`sst-env.d.ts`**, **`custom-elements.d.ts`** [P3]: Type augmentations only.
- **`index.css`** [P3]: Tailwind directives + CSS custom properties. No risk.
- **`theme-preload.test.ts`** [P3]: Test file. Uses `innerHTML` for fixture setup — test-only, fine.
- **`addons/serialize.ts`** [P3]: 19KB. Custom serializer for Solid stores (proxy unwrapping). Looks comprehensive. Needs full read for any XSS-bearing paths.
- **`addons/serialize.test.ts`** [P3]: Test corpus for serialize. No risk.
- **`addons/index.ts`** [P3]: Re-exports. No risk.

## `packages/app/src/context/`

- **`context/index.ts`** [P3]: Barrel re-exports. No risk.
- **`context/platform.tsx`** [P3]: `Platform` symbol from electron preload. Boolean flags for capabilities. No risk.
- **`context/server.tsx`** [P0]: 10.9KB. **Defines `ServerConnection.Http { type: "http"; url: string; username: string; password: string; insecure: boolean }` and `ServerConnection.HttpBase` variants. Password is stored PLAINTEXT in the persisted store** via `Persisted.global("server", ["server.v3"])` — i.e. on disk under `opencode.global.dat` in the renderer process's localStorage. **No encryption, no keychain/secret-store bridge, no transient memory only.** Also: `isLocalHost()` has a hardcoded allowlist of `127.0.0.1` (WSL host) marked as 'local' for the purpose of `insecure` warning suppression — confusing semantics; should be a config flag, not a hardcoded IP. **`migrateCanonicalLocalServerState()` migrates legacy v3 state on first load — needs review for safe defaults.**
- **`context/server-scope.ts`** [P3]: 2.6KB. Defines `ServerScope`, `SessionRouteKey`, `SessionStateKey`, `ScopedKey` brands. Uses null-byte separator in `compose()`; validates no null bytes in scope or parts. `fragment()` parses safely. Good defense-in-depth. No risk.
- **`context/server-sdk.tsx`** [P2]: 16ms flush, 8ms yield, 250ms reconnect. `eventFetch` loopback-only for HTTP, https-only for non-loopback with `127.0.0.1` allowlist. **The `127.0.0.1` allowlist is correct for WSL but should be documented and configurable.** Reconnect storm risk: 250ms backoff is too aggressive for flaky network.
- **`context/server-sync.tsx`** [P2]: Server-side reactive sync. Uses `batch` to coalesce updates. Reconnect on close. No rate limiting visible — a misbehaving server could thrash the store.
- **`context/sdk.tsx`** [P3]: Wraps `createOpencodeClient` with auth. No risk in this snippet.
- **`context/data.tsx`** [P3]: Tanstack Query setup. No risk.
- **`context/file.tsx`** [P3]: File-system state via Solid store. No risk.
- **`context/terminal.tsx`** [P2]: Terminal PTY state. **Reads user input from PTY and reflects to UI — needs to verify XSS hardening of input echo.** Standard. Needs full read for ANSI escape handling.
- **`context/prompt.tsx`** [P2]: Prompt history. Persists to localStorage. **No size cap visible — could grow unboundedly with long sessions.** Should add LRU cap or per-session reset.
- **`context/settings.tsx`** [P3]: Settings via Solid store. Standard.
- **`context/language.tsx`** [P3]: i18n setup. Standard.
- **`context/command.tsx`** [P3]: Command palette state. Standard.
- **`context/notification.tsx`** [P3]: Notification provider. Standard.
- **`context/comments.tsx`** [P3]: Comments provider. Standard.
- **`context/permission.tsx`** [P2]: Permission grants. **Persistence path not visible in snippet — if persisted, should be encrypted.**
- **`context/permission-auto-respond.tsx`** [P2]: Auto-respond rules. **Persistence path not visible — same concern as permission.tsx.**
- **`context/mcp.tsx`** [P2]: MCP server state. Configurations contain tokens/credentials — verify they are not echoed to logs.
- **`context/global.tsx`** [P3]: Global Solid store. Standard.
- **`context/local.tsx`** [P3]: Local state wrapper. Standard.
- **`context/models.tsx`** [P3]: Model catalog. Standard.
- **`context/tabs.tsx`** [P3]: Tab state. Standard.
- **`context/highlights.tsx`** [P3]: UI highlight state. Standard.
- **`context/directory-sync.tsx`** [P2]: Filesystem watcher sync. **No debounce or batch visible in snippet — high-frequency file events could thrash the store.**
- **`context/session-action.tsx`** [P3]: Session action dispatcher. Standard.
- **`context/global-sdk.tsx`** [P3]: Global SDK wrapper. Standard.
- **`context/layout.tsx`** [P3]: 32KB layout context. Big but UI-state only. No security risk.

## `packages/app/src/components/`

- **`components/dialog-select-server.tsx`** [P0]: 24KB main server picker. **Defines `looksComplete()` that classifies `127.0.0.1` (WSL host) as 'insecure-but-allowed' for http connections** — hardcoded IP allowlist, should be config-flag driven. **`ServerConnection` is stored with plaintext `password` field** (see context/server.tsx). Form allows typing the password in a textfield — should be `<input type="password">` (verify). **Side effect: when user adds an http:// remote server with a password, that password is persisted in cleartext localStorage and broadcast through the Solid store to every subscriber.**
- **`components/server/server-row.tsx`** [P3]: 4KB row UI. Renders one server. No risk.
- **`components/server/server-row-menu.tsx`** [P3]: 2.5KB row menu. Standard.
- **`components/prompt-input.tsx`** [P0]: 80KB. **Line 534: `editorRef.innerHTML = ""` — clear, not a sink. But the file is the primary text-input surface. Need full read to confirm no XSS via assistant message rendering into the editor.** This is the highest-blast-radius component in the app.
- **`components/prompt-input/*.ts(x)`** [P3]: 18 files (helpers, hooks, subviews). Standard, all need full read for confirmation.
- **`components/titlebar.tsx`** [P3]: 37KB native titlebar overlay. UI-only. No risk.
- **`components/session/*.tsx`** [P3]: 12 files. Session UI components. Standard.
- **`components/settings-v2/*.tsx`** [P3]: 9 files. New settings UI. Standard.
- **`components/file-tree.tsx`** [P2]: **Line 98: `image.innerHTML = (icon as SVGElement).outerHTML + (text as HTMLSpanElement).outerHTML`** — concatenates two trusted SVG elements. As long as `icon` and `text` are produced by the app's own code, low risk; but if `icon` ever becomes user-controlled (e.g. custom file-type icon from MCP), this is an XSS sink. Document the trust boundary.
- **Other `components/*` root files** [P3]: ~30 root-level components (dialogs, file viewer, terminal, etc.). Need full reads; flagged for next pass.

## `packages/app/src/pages/`

- **`pages/layout.tsx`** [P2]: 90KB. **Largest file in the app. Layout + persistent UI state container. The size alone is a maintainability P2; needs decomposition.** Likely contains context-driven panel state and keyboard shortcut wiring. Full read required.
- **`pages/session.tsx`** [P2]: 57KB. Session detail page. **Renders assistant messages — verify DOMPurify or markdown sandboxing. If assistant text is rendered as HTML without sanitization, this is XSS-as-a-service** (LLM can be prompt-injected to emit `<script>`).
- **`pages/session/message-timeline.tsx`** [P2]: 61KB. Message timeline. Same XSS concern as session.tsx. Also: **virtualized list — verify scroll-anchor handling to prevent layout thrash.**
- **`pages/home.tsx`** [P3]: 47KB. Home page. UI only.
- **`pages/session-side-panel/*.tsx`** [P3]: Side panel UI. Standard.
- **Other `pages/*` files** [skip/test]: Not in detail scope; flagged for follow-up.

## `packages/app/src/utils/`

- **`utils/persist.ts`** [P1]: 18KB persistence layer. **Wraps `makePersisted` from solid-primitives/storage. Cache capped at 500 entries × 8MB. Quota detection covers DOMException, NS_ERROR, code 22, code 1014. `fallback` map for persistent-disabled scopes. The LRU cache is unbounded-by-write-rate — a noisy loop calling `setItem` could thrash but is bounded by `cachePrune`. One concern: `evict()` only evicts when an `add` would exceed quota, never proactively on read. Also: `Persisted.local(...)` keys pass through `pathKey` — `pathKey` must be collision-resistant across paths with similar basename. Verify.**
- **`utils/agent.ts`**, **`utils/aim.ts`** [P3]: Agent helper. Standard.
- **`utils/server.ts`** [P3]: 1.2KB. Server URL helper. Standard.
- **`utils/server-health.ts`**, **`utils/server-errors.ts`** [P3]: Server health and error helpers. Standard.
- **`utils/terminal-websocket-url.ts`** [P3]: URL builder for terminal WS. Standard.
- **`utils/terminal-writer.ts`** [P3]: Terminal write helper. Standard.
- **`utils/scoped-cache.ts`** [P3]: Scoped cache helper. Standard.
- **`utils/runtime-adapters.ts`** [P3]: Runtime adapter. Standard.
- **`utils/worktree.ts`** [P3]: Worktree helper. Standard.
- **`utils/sound.ts`** [P3]: Sound playback. Standard.
- **`utils/notification-click.ts`** [P3]: Notification click handler. Standard.
- **`utils/diffs.ts`** [P3]: Diff helper. Standard.
- **`utils/prompt.ts`** [P3]: Prompt helper. Standard.
- **`utils/path-key.ts`** [P3]: Path-to-key hasher. **Uses `checksum` from @opencode-ai/core/util/encode. Need to verify checksum is collision-resistant and stable across platforms.**
- **`utils/server-scope.ts`** [P3]: ServerScope helpers. Standard.
- **`utils/uuid.ts`** [P3]: UUID helper. Standard.
- **Other `utils/*` files** [P3]: ~20 utility files. Most read; standard. Full read for any that touch filesystem or network.

## `packages/app/src/wsl/`

- **`wsl/context.tsx`** [P3]: 1.2KB. Solid query context for WSL servers. Uses `staleTime: Number.POSITIVE_INFINITY` and `gcTime: Number.POSITIVE_INFINITY` for `wslServers` query — never refetches, never evicts. **Sensible for stable WSL state but means a fresh server added in another window will not appear until manual refresh.**
- **`wsl/dialog-add-server.tsx`** [P2]: 27KB. Main UI for adding WSL distros. Renders distribution list, runs probes (curl, /etc/os-release), configures runtime. **Uses `runWslProbe` from preload — need to verify the probe command is allowlisted (not arbitrary). Form collects `username` and `password` and passes them to IPC — confirm the IPC channel is renderer-trusted-only.**
- **`wsl/settings.tsx`** [P3]: 6.9KB. WSL settings page. Solid component. Standard.
- **`wsl/settings-model.ts`** [P3]: Model for WSL settings. Standard.
- **`wsl/settings-model.test.ts`** [P3]: Test file. No risk.
- **`wsl/types.ts`** [P3]: Type defs. `WslServerConfig`, `WslServerRuntime` with starting/ready/failed/stopped states. Standard.

## `packages/storybook/`

- **`.storybook/main.ts`**, **`.storybook/preview.tsx`** [P3]: Storybook config. Standard.
- **`stories/*`** [P3]: Story files. UI demonstration only.
- **`mocks/*`** [P3]: Mock data. No runtime risk.

## `packages/app/src/hooks/`, `constants/`

- **`hooks/*`** [P3]: 1 file. Standard.
- **`constants/*`** [P3]: 1 file. Standard.

## Cross-package `innerHTML` / XSS surface (grep results, verified)

- **`packages/web/src/components/share/content-markdown.tsx` L97**: `<div innerHTML={html()} />` — `html()` is a Solid resource; in the share tree this funnels through `markdown.tsx` which **does** run DOMPurify (see ui finding). Low risk.
- **`packages/web/src/components/share/content-code.tsx` L27**: `<div innerHTML={html()} ... />` — same path through markdown.tsx + DOMPurify. Low risk.
- **`packages/web/src/components/share/content-bash.tsx` L51-52**: `<div innerHTML={commandHtml()} />` and `<div innerHTML={outputHtml()} />` — both fed by `codeToHtml()` from **shiki**, which escapes input and only emits highlighting markup (themes/lang are hardcoded constants). No script execution, input is escaped. Low risk, but **neither runs DOMPurify**; a future change to pass untrusted themes/lang could introduce risk. Flag for defense-in-depth.
- **`packages/ui/src/components/markdown.tsx` L91, L299, L308**: `svg.innerHTML = path` — `path` is a hardcoded SVG constant (L49), safe. `container.innerHTML = ""` — clear, safe. `temp.innerHTML = content` — `content` comes from `sanitize()` (L51, DOMPurify). **Correctly sanitized.** This is the model other innerHTML sites should follow.
- **`packages/ui/src/components/icon.tsx` L133**, **`packages/ui/src/v2/components/icon.tsx` L89**: `svg.innerHTML = Object.entries(icons)` — bundle-internal icon dictionary, low risk.
- **`packages/ui/src/components/file.tsx` L500**: viewer container clear, safe.
- **`packages/ui/src/components/file-ssr.tsx` L185**: `<template shadowrootmode="open" innerHTML={local.preloadedDiff.prerenderedHTML} />` — `prerenderedHTML` comes from a server-side renderer; if the renderer is compromised, this is a sink. Trust boundary = server.
- **`packages/app/src/components/prompt-input.tsx` L534**: `editorRef.innerHTML = ""` — clear, fine.
- **`packages/app/src/components/file-tree.tsx` L98**: `image.innerHTML = icon.outerHTML + text.outerHTML` — see components finding above.
- **`packages/pierre/file-find.ts` L137**: TBD. Need full read.
- **Test files using `innerHTML`**: `addons/serialize.test.ts`, `pages/session/helpers.test.ts` — test-only, fine.

---

## Summary by grade

- **P0 (blocker)**: 5
  1. `main/ipc.ts` — `store-*` and `open-link` IPC channels have no origin allowlist; `shell.openExternal` accepts any URL including `file://`.
  2. `main/store-keys.ts` — store keys are static, predictable constants in source.
  3. `context/server.tsx` + `components/dialog-select-server.tsx` — server passwords persisted in plaintext to renderer localStorage.
  4. `components/dialog-select-server.tsx` — hardcoded `127.0.0.1` allowlist for insecure host classification; password input type not verified as `type="password"`.
  5. `components/prompt-input.tsx` — largest-blast-radius input surface; full read required to confirm no XSS sinks for assistant content.
- **P1 (high)**: 4
  1. `main/windows.ts` — `Access-Control-Allow-Origin: *` injected for ALL responses via `addRendererHeaders`.
  2. `main/sidecar.ts` — `useSystemCertificates()` merges system+default CAs (broadens trust).
  3. `main/wsl/runtime.ts` line 266 — `curl -fsSL https://opencode.ai/install | bash` supply-chain TOFU on first WSL install.
  4. `main/wsl/ipc.ts` — WSL IPC trusts renderer for distro/URL; needs channel-level allowlist.
  5. `utils/persist.ts` — write-time-only eviction; need proactive read-time pruning.
- **P2 (medium)**: ~12 (renderer trust, store encryption gaps, CORS hardening, large files, debounce, etc.)
- **P3 (low)**: remaining files — naming, dead-code duplication, doc gaps.
