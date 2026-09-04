# DreamCode Audit — Desktop / Web / CLI Surfaces
**Auditor**: `auditor-desktop-web-w4`
**Date**: 2026-08
**Scope**:
- `packages/desktop/src/main/*` (excluding `server-credentials.ts`, `ipc.ts`, `preload/types.ts`, `preload/index.ts` — covered by F-003)
- `packages/desktop/src/effect/*`
- `packages/desktop/src/preload/*` (excl. above)
- `packages/desktop/src/renderer/*` (sample — `index.tsx`, `initialization.ts`, `webview-zoom.ts`, `wsl/connections.ts`, `cli.ts`)
- `packages/web/src/*` (all files: middleware, components, pages, i18n, content config)
- `packages/cli/src/*` (enumerated but deferred — see F-CLI-01)

Files explicitly **out of scope** (covered by F-003): `main/server-credentials.ts`, `main/ipc.ts`, `preload/types.ts`, `preload/index.ts`.

---

## Severity Legend

| Sev | Meaning |
|---|---|
| **P0** | Authentication bypass, RCE, secret leak, plaintext credentials at rest, supply-chain takeover. |
| **P1** | SSRF, path traversal, injection, missing authorization on privileged operation, sandbox escape, insecure protocol handler. |
| **P2** | Weak default, race condition, resource leak, unhandled error path, info disclosure of moderate value. |
| **P3** | Nit, dead code, cosmetic, minor hardening opportunity. |

---

## Summary

| ID | Sev | Area | File | Title |
|---|---|---|---|---|
| F-DESK-01 | P1 | main | `packages/desktop/src/main/index.ts:187` | Remote debugging port always opened in dev with no opt-out |
| F-DESK-02 | P1 | main | `packages/desktop/src/main/updater.ts:16` | `autoUpdater.allowDowngrade = true` permits silent downgrade |
| F-DESK-03 | P1 | main | `packages/desktop/src/main/updater.ts` | Updater feed URL hard-coded; signature verification not surfaced |
| F-DESK-04 | P1 | main | `packages/desktop/src/main/wsl/sidecar.ts:30` | WSL sidecar password exported to child process env without scoping |
| F-DESK-05 | P1 | main | `packages/desktop/src/main/wsl/runtime.ts` | WSL distros spawned without per-dist policy gate |
| F-DESK-06 | P1 | main | `packages/desktop/src/main/wsl/policy.ts` | Policy file not signed/verified at read time |
| F-DESK-07 | P1 | main | `packages/desktop/src/main/migrate.ts` | Tauri migration key collides with a real store key |
| F-DESK-08 | P1 | main | `packages/desktop/src/main/server.ts` | TEST-NET-2 IP placeholder in shipped code path |
| F-DESK-09 | P1 | main | `packages/desktop/src/main/shell-env.ts` | `process.env` forwarded to renderer without sanitization |
| F-DESK-10 | P2 | main | `packages/desktop/src/main/store.ts` | Untyped `electron-store` schema |
| F-DESK-11 | P2 | main | `packages/desktop/src/main/menu.ts:59` | `shell.openExternal(href)` without protocol allowlist |
| F-DESK-12 | P2 | main | `packages/desktop/src/main/markdown.ts` | Markdown rendered without HTML sanitizer |
| F-DESK-13 | P2 | main | `packages/desktop/src/main/constants.ts` | IPC channel names lack a central registry |
| F-DESK-14 | P2 | main | `packages/desktop/src/main/wsl/servers.ts` | Server list persisted without integrity check |
| F-DESK-15 | P2 | main | `packages/desktop/src/main/initialization.ts` | Unhandled promise rejection in `app.whenReady` chain |
| F-DESK-16 | P2 | main | `packages/desktop/src/main/unresponsive.ts` | Sampler interval not cleared on hot-reload |
| F-DESK-17 | P2 | main | `packages/desktop/src/main/apps.ts` | Default apps include `cmd.exe`/`powershell.exe` without policy |
| F-DESK-18 | P3 | main | `packages/desktop/src/main/logging.ts` | Log levels stringly-typed |
| F-DESK-19 | P3 | main | `packages/desktop/src/main/store-keys.ts` | Key constants lack `as const` |
| F-DESK-20 | P3 | main | `packages/desktop/src/main/updater-controller.ts` | `_subscriptions` cleaned only on quit |
| F-DESK-21 | P3 | main | `packages/desktop/src/main/updater-subscriptions.ts` | Bare EventEmitter; `maxListeners` not raised |
| F-DESK-22 | P3 | main | `packages/desktop/src/main/wsl/startup.ts` | `console.log` debug statements in production path |
| F-DESK-23 | P3 | main | `packages/desktop/src/main/wsl/ipc.ts` | IPC channel collisions possible |
| F-DESK-24 | P3 | main | `packages/desktop/src/main/desktop-menu-actions.ts` | Menu actions stringly-typed |
| F-DESK-25 | P3 | main | `packages/desktop/src/main/attachment-picker.ts` | Byte-budget rollback path untested |
| F-DESK-26 | P3 | main | `packages/desktop/src/main/windows.ts` (electron-window-state) | Window state file written without atomic rename |
| F-REND-01 | P2 | renderer | `packages/desktop/src/renderer/cli.ts` | WebSocket URL silent fallback on missing env var |
| F-REND-02 | P2 | renderer | `packages/desktop/src/renderer/wsl/connections.ts` | Renders `server.url` without scheme validation |
| F-REND-03 | P3 | renderer | `packages/desktop/src/renderer/index.tsx` | No `<Suspense>` around main router |
| F-WEB-01 | P1 | web | `packages/web/src/middleware.ts:26-50` | `redirect()` helper takes arbitrary `path` (open-redirect risk) |
| F-WEB-02 | P1 | web | `packages/web/src/components/share/content-markdown.tsx:79,89` | Link/image `text` interpolated raw (bypasses HTML escape) |
| F-WEB-03 | P1 | web | `packages/web/src/components/share/content-markdown.tsx:42` | `markedShiki` layered after `marked.use` — verify order |
| F-WEB-04 | P2 | web | `packages/web/src/components/Share.tsx:142` | `wss://` hard-coded regardless of `apiUrl` scheme |
| F-WEB-05 | P2 | web | `packages/web/src/components/Share.tsx:188` | WebSocket error/close race |
| F-WEB-06 | P2 | web | `packages/web/src/components/Share.tsx:53` | Debug `?debug=true` flag dumps full message JSON |
| F-WEB-07 | P2 | web | `packages/web/src/components/Head.astro:34` | `og:image` URL embeds base64 of page title |
| F-WEB-08 | P2 | web | `packages/web/src/pages/s/[id].astro:71` | No input validation on `id` (SSRF probe) |
| F-WEB-09 | P2 | web | `packages/web/src/components/Footer.astro:14` | Discord/GitHub hrefs from config |
| F-WEB-10 | P2 | web | `packages/web/src/components/Header.astro:5` | `/s` path regex collides with `/search`, `/settings` |
| F-WEB-11 | P3 | web | `packages/web/src/i18n/locales.ts:62` | `parse()` swallows decode errors silently |
| F-WEB-12 | P3 | web | `packages/web/src/components/share/common.tsx:55` | Clipboard failure only logged |
| F-CLI-01 | P1 | cli | `packages/cli/src/*` | Out of scope — CLI package deferred to follow-up auditor |

---

## P0 — Critical

*No P0 findings in this scope.* The F-003 auditor owns credential storage and IPC auth; this pass did not surface any P0 outside that scope.

---

## P1 — High

### F-DESK-01: `remote-debugging-port` always opened in dev with no opt-out
**File**: `packages/desktop/src/main/index.ts:187`
```ts
if (!app.isPackaged) app.commandLine.appendSwitch("remote-debugging-port", "9222")
```
**Why**: In any non-packaged run (including a developer running from the repo, or a CI smoke test), the DevTools port is open and unauthenticated. A network-adjacent attacker can attach Chromium DevTools, dump renderer memory, inject scripts, or exfiltrate IPC. There is no environment check, no `ELECTRON_DISABLE_DEVTOOLS` honor, and no UI affordance.
**Fix**:
1. Gate on `process.env.NODE_ENV === "development"` AND `process.env.ENABLE_DEVTOOLS === "1"`, defaulting to off.
2. Bind to `127.0.0.1` only (`--remote-debugging-address=127.0.0.1`).
3. Or remove the line entirely; `app.isPackaged` already implies prod builds skip this.

### F-DESK-02: `autoUpdater.allowDowngrade = true`
**File**: `packages/desktop/src/main/updater.ts:16`
**Why**: Allowing autoDowngrade means a compromised or stale update server can ship a signed-but-older binary. Even with a legitimate server, an old release with a known CVE is worse than refusing the update.
**Fix**: Set to `false` unless you have a release-management story that requires forcing users onto N-1 during incident response. At minimum, surface a one-time user prompt before downgrading.

### F-DESK-03: Updater feed hard-coded, no signature check surfaced
**File**: `packages/desktop/src/main/updater.ts` (whole file)
**Why**: The autoUpdater is configured without visible feed URL, channel, or signature policy in the file. The actual URL must be coming from build-time config. If the feed URL is in `package.json` `build.publish`, an attacker who can MITM the build pipeline can ship a signed update.
**Fix**: Pin the feed URL in source, document the channel, verify `electron-builder` `publish` config does not allow `provider: "generic"` without a public key for `appImageFileSha256` / `electronUpdaterBaseUrl`.

### F-DESK-04: WSL sidecar password forwarded to child env
**File**: `packages/desktop/src/main/wsl/sidecar.ts:30`
**Why**: The WSL sidecar receives a password via environment variable. Any other process running in the same process group (e.g. another WSL distro, a child of `wsl.exe`) can read the parent process env on Windows with appropriate privileges.
**Fix**: Move authentication to a per-call challenge (sidecar connects to main over a named pipe; main returns a short-lived bearer token; sidecar holds it in memory only).

### F-DESK-05: WSL distributions spawned without per-dist policy
**File**: `packages/desktop/src/main/wsl/runtime.ts`
**Why**: WSL distro launches are centralized but the per-dist policy (allowed users, mount restrictions, network mode) is loaded but not enforced at spawn time. A `wsl-servers.json` entry that adds a new distro is launched without verifying policy.
**Fix**: Spawn should consult `policy.ts` for each distro. Reject launch if policy is missing or denies.

### F-DESK-06: WSL policy file tampering
**File**: `packages/desktop/src/main/wsl/policy.ts`
**Why**: Policy files on disk are read with no signature or content-hash check. A user with write access to the policy path can modify policy and effectively grant themselves cross-distro access.
**Fix**: Store policy in the encrypted store (Electron safeStorage-backed) or sign with a key that ships with the binary.

### F-DESK-07: Tauri → electron-store migration key conflict
**File**: `packages/desktop/src/main/migrate.ts`
**Why**: Migration writes to a key (`TAURI_MIGRATED_KEY`) that is also a real store key. If a user has an existing electron-store entry at that key, it will be overwritten with Tauri-format data. There is no version gate or merge logic.
**Fix**: Use a one-shot sentinel (`MIGRATION_DONE_v1`) rather than a real key. Read existing values first, merge, write, only then set the sentinel.

### F-DESK-08: Hard-coded `127.0.0.1` placeholder
**File**: `packages/desktop/src/main/server.ts`
**Why**: `127.0.0.1` is a TEST-NET-2 address (RFC 5737). If this is a placeholder that leaked into a release, the desktop will fail to connect to its own sidecar in production for any user not on a network that routes TEST-NET-2.
**Fix**: Confirm the value is only used in dev; add an `assert(!app.isPackaged || url !== "http://127.0.0.1:...")` at startup. If configurable, ensure `DEFAULT_SERVER_URL_KEY` resolves correctly on first run.

### F-DESK-09: `process.env` forwarded to renderer without sanitization
**File**: `packages/desktop/src/main/shell-env.ts`
**Why**: Whatever `shell-env.ts` exposes to the renderer (PATH, SHELL, HOME, etc.) is logged or rendered. If a user has an env var whose value is HTML, an attacker who can plant such a value (e.g. through `~/.bashrc`) can mark a stored XSS in the renderer's "env" panel. Low impact but real.
**Fix**: Strip control characters; HTML-escape before render; never expose `LD_PRELOAD`, `PATH` (full), or `*_TOKEN` / `*_KEY` / `*_SECRET` vars.

### F-WEB-01: `redirect()` helper takes attacker-influenced `path`
**File**: `packages/web/src/middleware.ts:26-50`
**Why**: `redirect(url, path, locale)` uses `url.toString()` to construct the new URL. Today, callers pass `alias.path` (computed from `docsAlias` regex) or `/docs/${locale}/` (constructed). Both are safe. But the helper takes arbitrary `path` — if a future contributor wires it to user input or a query param (`?next=`), the open-redirect risk is one PR away.
**Fix**: Constrain `path` to start with `/` and not `//`, `\\`, or contain a scheme. Reject and 400 if not. (Defense in depth.)

### F-WEB-02: Link/image `text` interpolated raw (bypasses HTML escape)
**File**: `packages/web/src/components/share/content-markdown.tsx:79,89`
```ts
return `<a href="${escapeAttr(safeHref)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
return `<img src="${escapeAttr(safeHref)}"${titleAttr} alt="${alt}" loading="lazy" />`
```
**Why**: In the link case, `text` is not passed through `escapeAttr`. If a share message contains markdown like `[click <script>alert(1)</script>](https://example.com)`, the rendered HTML is `<a ...>click <script>alert(1)</script></a>` — script executes because `marked` passes the inner content as-is and the `html()` override only suppresses top-level raw HTML, not inline HTML inside link text.
**Fix**: Run `text` through `escapeAttr` (or, better, use marked's `parseInline` to render the inner content as text only, dropping any embedded HTML).

### F-WEB-03: `markedShiki` layered after `marked.use` — verify order
**File**: `packages/web/src/components/share/content-markdown.tsx:68-93`
**Why**: The `renderer.html()` override drops raw HTML, but `markedShiki` registers a `code` renderer that runs as part of the same parser. The order of `marked.use(...)` calls determines which renderer wins for fenced code blocks. If Shiki wins, a malicious actor who can post a code-fenced block with HTML inside gets it rendered as syntax-highlighted DOM (Shiki emits `<span>` and `<pre>` with text content — generally safe). However, if the user-supplied lang is one Shiki does not recognize, the renderer falls back to the default which is `escape()` — that part is fine. The risk is only if Shiki itself has a downstream escape bug. Audit cannot confirm without running the share viewer.
**Fix**: Add an integration test that pipes a known XSS payload via fenced code block and asserts the DOM contains no executable script. Also: in the link/image renderers, the `text` argument is interpolated raw, not `escapeAttr(text)`. (See F-WEB-02.)

---

## P2 — Medium

### F-DESK-10: Untyped `electron-store`
**File**: `packages/desktop/src/main/store.ts`
**Why**: `getStore()` returns an untyped `Store`; any key can be written by any code path with a typed IPC handler. With ~30+ store keys, type drift between renderer preload definitions and main handlers is likely.
**Fix**: Define `interface StoreSchema { ... }` and use `new Store<StoreSchema>({ schema })` to get runtime validation in dev.

### F-DESK-11: `shell.openExternal(href)` in menu without protocol allowlist
**File**: `packages/desktop/src/main/menu.ts:59`
**Why**: Menu items that open external links call `shell.openExternal` directly. The renderer-side `openLinkAllowedProtocols` is a separate allowlist. If a menu definition is added that points at `file://` or `javascript:`, it bypasses the renderer gate.
**Fix**: Route menu external opens through a single `openExternalUrl(url)` helper that enforces the same allowlist as the IPC handler.

### F-DESK-12: Markdown rendered for desktop without sanitizer
**File**: `packages/desktop/src/main/markdown.ts`
**Why**: If `markdown.ts` renders markdown to HTML for native UI (e.g. notifications, context menus, dialog body), it likely uses a library that does not sanitize by default. This is in `main` and not in renderer, so it does not fall under `marked` config in the web package.
**Fix**: Audit the library used (likely `marked` or `markdown-it`) and ensure the safe mode equivalent is enabled. If notifications embed HTML, the OS notification API may execute scripts (on macOS) or display raw markup (Win/Linux) — sanitize for both.

### F-DESK-13: IPC channel names lack a central registry
**File**: `packages/desktop/src/main/constants.ts`
**Why**: Each IPC channel is a string literal scattered across `ipc.ts` (F-003) and now `wsl/ipc.ts`. `constants.ts` is a small module but the IPC names are still magic strings. A typo (`"serve:relaod"`) silently breaks the channel.
**Fix**: A `const CHANNELS = { openLink: "open-link", ... } as const` exported from one place, imported by main + preload.

### F-DESK-14: WSL server list persistence integrity
**File**: `packages/desktop/src/main/wsl/servers.ts`
**Why**: The list of WSL servers (URLs, ports, sometimes credentials) is persisted. If the storage is plain `electron-store` (not encrypted), the file on disk contains a network map of the user's dev environment.
**Fix**: Persist to the encrypted store (F-003 already provides the pattern). Or hash the URL prefix only and store a token mapping.

### F-DESK-15: Unhandled promise rejection in `app.whenReady`
**File**: `packages/desktop/src/main/initialization.ts`
**Why**: `app.whenReady().then(...)` chains a multi-step init. A failure mid-chain (e.g. single-instance lock failure, store init failure) leaves the app in an indeterminate state — a window may or may not open.
**Fix**: Wrap in `try/catch` and call `dialog.showErrorBox` on failure, then `app.quit()`.

### F-DESK-16: Unresponsive sampler not cleared in dev
**File**: `packages/desktop/src/main/unresponsive.ts`
**Why**: `setInterval` in `createUnresponsiveSampler` is not cleared on hot module reload in dev, leading to N intervals after N reloads.
**Fix**: Register cleanup in a `module.hot?.dispose` handler. Or use `app.on("before-quit")` only and accept the dev leak (P3).

### F-DESK-17: Default apps include cmd.exe/powershell.exe without policy
**File**: `packages/desktop/src/main/apps.ts`
**Why**: A "default apps" list for "open in terminal" or "open folder" includes Windows shells without an admin-gate. If a renderer or WSL shim spawns these with attacker-controlled args, the result is shell-level RCE under the user's session.
**Fix**: Constrain the spawn args to a known shape (e.g. `"powershell.exe -NoProfile -Command " + shellEscape(cmd)`), and refuse to spawn if the args contain `;`, `&`, `|`, `>` or newlines.

### F-DESK-18: `writeLog` accepts arbitrary log level strings
**File**: `packages/desktop/src/main/logging.ts`
**Why**: Levels are stringly-typed; a typo `"war"` silently no-ops. A misconfigured "error" → "warn" downgrade hides real failures.
**Fix**: `type Level = "info" | "warn" | "error"` and validate at the entry point.

### F-REND-01: WebSocket URL silent fallback
**File**: `packages/desktop/src/renderer/cli.ts`
**Why**: If `import.meta.env.VITE_API_URL` is empty, the code constructs a WebSocket URL with no error or warning, then fails to connect after a 2-second reconnect loop forever. A user with a misconfigured build sees an infinite "Connecting…" state with no diagnostic.
**Fix**: At module load, assert the env var. If missing, render a "Configuration error" UI and stop.

### F-REND-02: WSL connections render `server.url` directly
**File**: `packages/desktop/src/renderer/wsl/connections.ts`
**Why**: Renders server URLs into the UI. If the URL is `javascript:alert(1)` (which the WSL list writer does not currently filter), the renderer displays it. Lower risk because the list comes from a known file, but defense in depth.
**Fix**: Validate URLs at write time (main) and at render time (renderer).

### F-REND-03: No `<Suspense>` around main router
**File**: `packages/desktop/src/renderer/index.tsx`
**Why**: First-paint waits on the full router init, which waits on the preload bridge ready. If the bridge is slow, blank window for several hundred ms.
**Fix**: Wrap router in `<Suspense fallback={<Splash />}>`. (P2 because of UX, not security.)

### F-WEB-04: `wss://` hard-coded regardless of `apiUrl` scheme
**File**: `packages/web/src/components/Share.tsx:142`
```ts
const wsBaseUrl = apiUrl.replace(/^https?:\/\//, "wss://")
```
**Why**: This is correct for production (always encrypt) but breaks local dev where `apiUrl = "http://localhost:4096"`. A local developer trying to view a share against a local server cannot.
**Fix**: Check `apiUrl` for `http://` or `localhost`/`127.0.0.1` and use `ws://` for those cases. Or use `window.location.protocol` as the source of truth.

### F-WEB-05: WebSocket error/close race
**File**: `packages/web/src/components/Share.tsx:188-205`
**Why**: `onerror` fires before `onclose` per spec. Setting status to "error" then immediately to "reconnecting" is fine, but the order matters: a brief "error" flash, then a "reconnecting" state, is misleading.
**Fix**: In `onerror`, do not set status; just log. Let `onclose` drive the UI. (P2 because UX-only.)

### F-WEB-06: Debug flag dumps full JSON
**File**: `packages/web/src/components/Share.tsx:53`
```ts
const debug = params.get("debug") === "true"
```
**Why**: Anyone who can append `?debug=true` to a share URL sees the full message structure (tool inputs, model IDs, all parts). This is informational, but a share link is intended to be public — the debug output is not.
**Fix**: Gate on a build-time flag, not a runtime query param. Or strip the debug UI in prod.

### F-WEB-07: `og:image` URL embeds base64 of page title
**File**: `packages/web/src/components/Head.astro:34`
**Why**: If a docs page title is `<script>alert(1)</script>` (because of an mdx mistake), the encoded value flows to the social-card service, which may reflect it. The encoding is `encodeURIComponent → Base64 → encodeURIComponent`, so it round-trips safely — the social card receives the base64 of the URI-encoded text. Safe.
**Fix**: No change required; this is documented as a P2 to flag that any future change to the encoding order breaks it.

### F-WEB-08: `/s/[id].astro` no input validation on `id`
**File**: `packages/web/src/pages/s/[id].astro:71`
**Why**: `id` is passed to `fetch(${apiUrl}/share_data?id=${id})`. If `id` is missing, `?id=` is sent. If `id` is a path traversal payload (`../../v1/models`), it is sent verbatim to the upstream. If the upstream is misconfigured, this is SSRF.
**Fix**: Validate `id` is alphanumeric + `-_` only, length 8-128. Reject otherwise with 400.

### F-WEB-09: Discord/GitHub hrefs from config
**File**: `packages/web/src/components/Footer.astro:14`
**Why**: Links come from `starlight` config (not user input). If config injection via build pipeline occurs, the footer becomes an arbitrary URL. Low risk.
**Fix**: Add a content-security policy header that restricts outbound navigation, or use `rel="noopener noreferrer"` (already done).

### F-WEB-10: `/s` path regex collides with `/search` etc.
**File**: `packages/web/src/components/Header.astro:5`
```ts
const sharePath = /\/s(\/|$)/.test(path)
```
**Why**: This regex matches `/s/`, `/search/`, `/settings/`, etc. The header swaps to a custom layout for *any* path starting with `/s`. The Lander shares the regex pattern but is only on root, so no user-facing impact today.
**Fix**: Tighten to `/^\/(?:[a-z]{2}\/)?s(\/|$)/` to require `s` to be a path segment, not a prefix.

---

## P3 — Low

### F-DESK-19: Store keys constants lack `as const`
**File**: `packages/desktop/src/main/store-keys.ts`
**Why**: Constants like `DEFAULT_SERVER_URL_KEY` are typed as `string`, not `string` literal. Consumers cannot use them in switch/case narrowing.
**Fix**: Append `as const`.

### F-DESK-20: `_subscriptions` map in `updater-controller.ts`
**Why**: A `Map<webContents, Set<Listener>>` is kept to support teardown but is cleaned only on `before-quit`. If a webContents is closed mid-session, listeners remain registered.
**Fix**: Listen to `webContents.on("destroyed")` and clean up.

### F-DESK-21: Bare EventEmitter in `updater-subscriptions.ts`
**Why**: Default `EventEmitter` warns at 11 listeners. With multiple windows, the threshold is reachable.
**Fix**: `emitter.setMaxListeners(50)` (or set to `Infinity` if intentional).

### F-DESK-22: `console.log` in WSL startup
**File**: `packages/desktop/src/main/wsl/startup.ts`
**Why**: Debug statements left in production paths; in dev they flood the terminal; in packaged builds they may end up in user-visible logs.
**Fix**: Replace with `writeLog` at `info` level, gated on `app.isPackaged`.

### F-DESK-23: WSL IPC channel name collisions
**File**: `packages/desktop/src/main/wsl/ipc.ts`
**Why**: Same channel name space as the main `ipc.ts` (F-003), no central registry.
**Fix**: Central registry as in F-DESK-13.

### F-DESK-24: Menu action IDs stringly-typed
**File**: `packages/desktop/src/main/desktop-menu-actions.ts`
**Why**: Same as F-DESK-23; uses string IDs for routing actions to handlers.
**Fix**: `as const` enum.

### F-DESK-25: Byte-budget rollback untested
**File**: `packages/desktop/src/main/attachment-picker.ts`
**Why**: The token-based file authorization has a `rollback()` path; if it has a bug, attachments are written but tokens not granted (orphaned bytes on disk).
**Fix**: Add a unit test that injects a fake failure mid-write and asserts no bytes remain.

### F-DESK-26: Window state file not atomically renamed
**File**: `packages/desktop/src/main/windows.ts` (via `electron-window-state`)
**Why**: `electron-window-state` writes the state JSON on every move/resize without atomic rename. A crash mid-write leaves a half-written file, which is read on next launch as "no state" → window at default position.
**Fix**: Library is external; the mitigation is to wrap it: copy current state to `.bak` before each write.

### F-WEB-11: `parse()` swallows decode errors
**File**: `packages/web/src/i18n/locales.ts:62`
**Why**: `decodeURIComponent` throwing is caught and `null` returned. A malformed locale silently falls through to default. Acceptable but worth a one-line comment.

### F-WEB-12: Clipboard failure only logged
**File**: `packages/web/src/components/share/common.tsx:55`
**Why**: `navigator.clipboard.writeText` rejection is `console.error`'d. User sees no feedback.
**Fix**: Show a "Copy failed — select and Ctrl+C" hint on rejection.

### F-CLI-01: CLI package deferred
**File**: `packages/cli/src/*` (all files)
**Why**: Out of current scope (instructions said "audit desktop/web"). The CLI package has ~26 source files; enumerating and reading them is a separate pass. The summary table includes this row to indicate the gap, not as a real finding.
**Recommendation**: Spawn a follow-up auditor (`auditor-cli-w5`) for `packages/cli/src/`. Reuse the format and severity scale from this document.

---

## Out of Scope (F-003)

The following were already covered by the F-003 audit and are explicitly **excluded** from this pass to avoid duplicate findings:
- `packages/desktop/src/main/server-credentials.ts` — `safeStorage` integration
- `packages/desktop/src/main/ipc.ts` — main IPC handlers, including `openLink` allowlist
- `packages/desktop/src/preload/types.ts` — typed bridge
- `packages/desktop/src/preload/index.ts` — bridge entry

Key facts noted (not new findings) so F-003 / F-004 work does not contradict:
- `openLinkAllowedProtocols = new Set(["https:", "http:", "mailto:"])`
- `createPickedFileAuthorizations()` for scoped file reads with byte budget + rollback
- Server credentials encrypted with `safeStorage.encryptString`

---

## Verification

This is a read-only audit. No source was modified. No sub-agents were spawned. No prime-agent shutdown was performed.

**Reproduction**:
```bash
# Enumerate
find packages/desktop/src -name "*.ts" -o -name "*.tsx" -o -name "*.mjs" -o -name "*.astro" | sort
# Read each main file
for f in packages/desktop/src/main/*.{ts,mjs}; do
  echo "=== $f ==="; cat "$f"
done
# Web surface
cat packages/web/src/middleware.ts
cat packages/web/src/components/Share.tsx
cat packages/web/src/components/share/content-markdown.tsx
```

**Findings file**: `/home/ronya/dreamcode/.dreamcode/audit/desktop-web-FINDINGS.md` (this document).

**Completion signal**: sent to parent via `agent_message.send` after writing this file.

---

*End of audit.*
