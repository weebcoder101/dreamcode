# Orchestrator Audit — PROPOSED FIXES

**Scope:** `packages/app`, `packages/desktop`, `packages/storybook`
**Date:** 2026-08-27
**Applies:** P0 + P1 findings from `orchestrator-FINDINGS.md`. P2/P3 fixes documented for follow-up.

---

## P0 fixes (blockers)

### F-001: `packages/desktop/src/main/ipc.ts` — `store-*` and `open-link` channels

**Finding:** Any renderer can read/write/clear any named `electron-store` via `store-get`/`store-set`/`store-delete`/`store-clear`/`store-keys`/`store-length`. `open-link` accepts any URL including `file://`. No origin allowlist.

**Fix:**
1. **Drop the `store-*` IPC channels from `registerIpcHandlers`.** Replace with explicit, narrowly-typed handlers per need (e.g. `get-pinch-zoom`, `set-pinch-zoom`, `get-wsl-servers`, `set-active-wsl-server`).
2. **Restrict `open-link` to an allowlist of schemes** (`https`, `http`, `mailto`):
   ```ts
   const OPEN_LINK_ALLOWED = new Set(["https:", "http:", "mailto:"])
   ipcMain.on("open-link", (_event, url: string) => {
     try {
       const parsed = new URL(url)
       if (!OPEN_LINK_ALLOWED.has(parsed.protocol)) return
     } catch { return }
     void shell.openExternal(url)
   })
   ```
3. **Document the channel surface** with a comment block at the top of `ipc.ts` listing all exposed channels and their purpose.

**Verification:** `grep -n "ipcMain.handle\|ipcMain.on" packages/desktop/src/main/ipc.ts` shows no `store-*` or unrestricted `open-link`.

---

### F-002: `packages/desktop/src/main/store-keys.ts` — predictable store keys

**Finding:** Module-level constants `DEFAULT_SERVER_URL_KEY`, `WSL_SERVERS_KEY`, `PINCH_ZOOM_ENABLED_KEY` are static, guessable, and form the on-disk format identifier.

**Fix:** Either
- Generate a per-install suffix (e.g. `randomUUID()` stored in `app.getPath("userData")`/`.salt`) and concatenate, or
- Move sensitive stores to the OS keychain via `keytar` (e.g. `ai.opencode.desktop.dev/server` namespace).

For the minimal fix: add a per-install salt file at `app.getPath("userData")/.key-salt`, prepend it to keys for the WSL servers store at minimum.

**Verification:** Inspect `getStore("opencode.settings").path` after fix; key should be `default.<salt>` not `default`.

---

### F-003: `packages/app/src/context/server.tsx` + `packages/app/src/components/dialog-select-server.tsx` — plaintext server password persistence

**Finding:** `ServerConnection.Http` carries `password` in plaintext, persisted via `Persist.global("server", ["server.v3"])` to renderer localStorage. `dialog-select-server.tsx` hardcodes `127.0.100.239` (WSL host) as the only IP for which insecure http+password is silently allowed.

**Fix:**
1. **Move password storage out of the Solid store.** The server connection in the store should reference a server by id; the password lives in the desktop main process's `safeStorage` (or OS keychain) keyed by server id.
2. **Add a new IPC channel** `server-get-credentials(serverId)` and `server-set-credentials(serverId, password)` in `main/ipc.ts` that uses `safeStorage.encryptString` / `decryptString` to keep the password in OS-protected memory when possible, and never re-emits plaintext to the renderer.
3. **Renderer only stores** `{ id, type, url, username, insecure }`. Passwords are pushed to main on add/update and pulled on connect.
4. **Replace the hardcoded `127.0.100.239` allowlist in `dialog-select-server.tsx`** with a config-driven `localInsecureHosts` list passed from the main process, with a documented migration of the default.

**Verification:** Re-read `context/server.tsx`; ensure `password` no longer appears in the `ServerConnection` type. Inspect localStorage after adding a server; ensure no plaintext password.

---

### F-004: `packages/app/src/components/dialog-select-server.tsx` — input field type

**Finding:** Password input verified to be `type="password"` (good), but the surrounding form is the only protection; if a future refactor moves to `type="text"`, browsers will autocomplete and store will not mask.

**Fix:** Add a runtime assertion in test or `if (DEV)` mode that the password input element has `type="password"`. No-op in production; prevents regression.

**Verification:** Check the assertion fires when type is changed to "text".

---

### F-005: `packages/app/src/components/prompt-input.tsx` — XSS audit of editor

**Finding:** 80KB component. Line 534 `editorRef.innerHTML = ""` is a clear (safe). Full read required to confirm no assistant-content is ever rendered into the editor via innerHTML without sanitization.

**Fix:**
1. Do a targeted read of `prompt-input.tsx` for `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `dangerouslySetInnerHTML`, `srcdoc`.
2. Any match must be: (a) a clear/setter with constant content, (b) followed by DOMPurify, or (c) refactored to use Solid's safe text binding.
3. Add a unit test that pastes `<script>alert(1)</script>` into the input and asserts it does NOT execute.

**Verification:** `grep -n "innerHTML\|outerHTML\|insertAdjacentHTML\|srcdoc" packages/app/src/components/prompt-input.tsx` shows only clear/setter patterns.

---

## P1 fixes (high)

### F-101: `packages/desktop/src/main/windows.ts` — `Access-Control-Allow-Origin: *` for all responses

**Finding:** `addRendererHeaders` injects `ACAO: *` and `ACAH: *` on every `onHeadersReceived` callback, regardless of URL. Combined with `onBeforeSendHeaders` upserting the same (no-op for request side), the response-side header is the issue.

**Fix:** Gate `addRendererHeaders` to only fire for `oc://renderer` requests, matching `isRendererUrl(value, false) || isRendererUrl(value, true)`. For non-oc:// requests, leave the response headers alone.

**Verification:** Add a test: a `https://example.com` request from the renderer should NOT see `ACAO: *` in the response headers.

---

### F-102: `packages/desktop/src/main/sidecar.ts` — `useSystemCertificates`

**Finding:** Merges default + system CA bundles via `setDefaultCACertificates([...new Set([...default, ...system])])`. Broadens trust to any system-installed CA (corporate MITM proxies, accidentally-trusted roots).

**Fix:** Make `useSystemCertificates` opt-in via an env var or a `--use-system-certs` CLI flag, defaulting OFF. Document the trust implication in a comment.

**Verification:** After fix, no `setDefaultCACertificates` call unless flag is set.

---

### F-103: `packages/desktop/src/main/wsl/runtime.ts` — `curl | bash` supply-chain TOFU

**Finding:** Line 266: `bash -lc `curl -fsSL https://opencode.ai/install | bash -s -- --version ${version}`` runs on first WSL install with no signature check.

**Fix:**
1. **Bundle the installer.** Add `packages/desktop/resources/wsl/install.sh` to the desktop package resources and run `bash -lc "bash $RESOURCES/install.sh --version $version"`.
2. **If a download is unavoidable, pin a checksum.** Compute the SHA-256 of the latest install.sh on build, hardcode it in `main/wsl/runtime.ts`, and assert before pipe.
3. **Mirror under our control** (e.g. `https://releases.opencode.ai/wsl/install-<version>.sh`) with HTTPS + signed manifest.

**Verification:** Diff shows `install.sh` is loaded from disk, not `curl | bash`.

---

### F-104: `packages/desktop/src/main/wsl/ipc.ts` — renderer-trusts-distro

**Finding:** WSL IPC handlers accept distro name and server URL from the renderer without an explicit allowlist.

**Fix:** Maintain a renderer-supplied list of distros the user has explicitly authorized (via `wsl -l -q` enumeration or manual add) and reject any IPC call referencing a distro not in the list. URLs should be parsed and the host:port matched against a typed enum (e.g. `127.0.0.1:<port>` only).

**Verification:** Add a test that calls the IPC handler with a distro not in the authorized set and asserts the rejection.

---

### F-105: `packages/app/src/utils/persist.ts` — write-time-only eviction

**Finding:** `cachePrune` only runs when a new `cacheSet` would exceed cap. A write-flood could thrash; a steady-state read-heavy session never prunes.

**Fix:** Add a `cachePruneIfIdle()` call on `cacheGet` when `cache.size > CACHE_MAX_ENTRIES * 0.8` (or similar watermark). Or: do a periodic prune on a low-frequency interval.

**Verification:** Add a unit test: 1000 gets with no sets → no entries > 500 in cache.

---

## P2 fixes (medium) — documented, not applied in this pass

- F-201: `main/attachment-picker.ts` — `selection` should be freed when `selection.remaining <= 0`, not only when `paths.size === 0`.
- F-202: `main/attachment-picker.ts` — `read()` should NOT delete `paths` entry on failure; or the budget debit should be reverted on throw.
- F-203: `context/server-sdk.tsx` — increase reconnect backoff from 250ms to exponential.
- F-204: `context/directory-sync.tsx` — debounce file events with `requestIdleCallback` or a 100ms trailing-edge debounce.
- F-205: `context/prompt.tsx` — add an LRU cap to prompt history (e.g. 1000 entries per session).
- F-206: `main/migrate.ts` — wrap each migration in try/catch with a per-step rollback.
- F-207: `main/apps.ts` — canonicalize `appName` before `execFile`; reject if it contains path separators.
- F-208: `main/shell-env.ts` — validate `shell` arg against a hardcoded list (`bash`, `zsh`, `fish`, `pwsh`, `cmd`).
- F-209: `main/wsl/policy.ts` — reject values containing CR/LF/NUL in `shellEscape` upstream.
- F-210: `pages/layout.tsx` (90KB), `prompt-input.tsx` (80KB), `message-timeline.tsx` (61KB), `session.tsx` (57KB), `home.tsx` (47KB), `titlebar.tsx` (37KB), `context/layout.tsx` (32KB) — decompose into smaller modules.

## P3 fixes (low) — documented

- F-301: `main/wsl/servers.ts` — remove duplicate `invalidateStartAttempt` / `nextStartAttempt`; consolidate.
- F-302: `main/updater.ts` — document `allowDowngrade = true` rationale in a comment (already commented "by-design").
- F-303: `main/updater-controller.ts` — `install().catch()` reverts to `ready`; consider re-`check()` on next tick.

---

## Files this fixes document modifies (none — proposal only)

This is a proposal document. Mutations to apply F-001..F-105 will be made in a follow-up pass via `dream_correlate` + `edit`.
