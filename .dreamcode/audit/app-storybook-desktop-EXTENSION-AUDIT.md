# app + storybook + desktop — EXTENSION-AUDIT

**Date:** 2026-08-26
**Scope:**
- `packages/app/src/` (SolidJS renderer UI)
- `packages/ui/src/` (cross-package UI primitives — included because `app` consumes them)
- `packages/storybook/src/` and `packages/storybook/.storybook/` (Storybook dev)
- `packages/desktop/src/` (Electron main + preload + renderer)
- `electron/` (Electron build config)

**Prior coverage:** `app-FINDINGS.md`, `storybook-DEEP-FINDINGS.md`, and `desktop-web-FINDINGS.md` covered earlier slices. This pass is the **extension sweep** — focused on:
- `innerHTML` / `dangerouslySetInnerHTML` / `setHTML` / `set:html` / raw `outerHTML` writes
- `eval`, `new Function`, `document.write`
- `javascript:` / `data:` / `vbscript:` URLs in `href` and `src`
- `srcdoc` and inline event handlers (`onerror=`, `onload=`)
- IPC handler validation in `desktop/src/main/ipc.ts` and related
- Preload exposure surface in `desktop/src/preload/index.ts`
- File path injection in shell-out calls
- API call validation (auth, server URL, fetch URLs)
- `localStorage` / `sessionStorage` / `indexedDB` usage
- Deep-link / OAuth callback handling

**SolidJS renderer is sandboxed**, but it consumes **untrusted input**: AI model output, terminal output, file contents, markdown from server, OAuth callback parameters, deep-link URLs, highlight.js / shiki themes. The desktop main process is **same-process IPC** — a compromised renderer (via XSS) can invoke any exposed handler, but cannot bypass preload's `contextBridge` boundary (contextIsolation = true, nodeIntegration = false, sandbox = true per `electron/main.js`).

---

## 1. Findings summary

| ID | Severity | File | Issue |
|----|----------|------|-------|
| F-EXT-01 | **HIGH** | `desktop/src/main/markdown.ts:3-13` | `parseMarkdown` link renderer interpolates `href`, `title`, `text` raw into HTML; renderer-bypassable XSS via `javascript:` URLs in markdown link hrefs |
| F-EXT-02 | **MEDIUM** | `desktop/src/main/ipc.ts:open-path` | `open-path` accepts optional `app` string from renderer; `execFile` on it allows arbitrary executable launch from PATH |
| F-EXT-03 | **MEDIUM** | `app/src/context/highlights.tsx:CHANGELOG_URL` | Release-notes media `src` rendered without host allowlist; trust delegated to dreamcode.ai supply chain |
| F-EXT-04 | **MEDIUM** | `desktop/src/main/ipc.ts:check-app-exists` / `resolve-app-path` | Accepts arbitrary `appName` from renderer; `execFile("where", [appName])` enumerates arbitrary commands in PATH |
| F-EXT-05 | **MEDIUM** | `desktop/src/main/ipc.ts:store-*` | Renderer-controlled `name` lets renderer create/read arbitrary JSON files in `userData`; dead attack surface (not used by app) |
| F-EXT-06 | **LOW** | `desktop/src/main/ipc.ts:parse-markdown` | IPC handler `parse-markdown` is exposed via preload but currently unused by app; gated by F-EXT-01 |
| F-EXT-07 | **LOW** | `app/src/components/file-tree.tsx:98` | `image.innerHTML = outerHTML + outerHTML` for drag-image — uses trusted SVG icon library content |
| F-EXT-08 | **LOW** | `desktop/src/main/ipc.ts:open-link` | `mailto:` allowed; minor concern in phishing context (low risk) |
| F-EXT-09 | **LOW** | `desktop/src/main/logging.ts:spyRendererConsole` | `electron-log` captures all renderer console; debug-log export zip may include sensitive data |
| F-EXT-10 | **INFO** | `electron/main.js:contextIsolation, sandbox` | Electron security baseline: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` |
| F-EXT-11 | **INFO** | `app/src/components/prompt-input.tsx:534` | `editorRef.innerHTML = ""` for clear — safe empty string |
| F-EXT-12 | **INFO** | `app/src/components/dialog-connect-provider.tsx` | OAuth `window.open` — URL is server-returned; `window.open` returns `null` if blocked |
| F-EXT-13 | **INFO** | `desktop/src/main/wsl/runtime.ts:installWslDistro` | `wsl.exe --install -d <name>`; name comes from enumerated `--list --online` output, separate argv, no shell injection |
| F-EXT-14 | **INFO** | `desktop/src/main/markdown.ts` | Only consumer of `parseMarkdown` is `parse-markdown` IPC; not invoked by any app component today |

---

## 2. F-EXT-01 — `parseMarkdown` link renderer XSS (HIGH)

### Evidence

`packages/desktop/src/main/markdown.ts`:
```typescript
import { marked, type Tokens } from "marked"

const renderer = new marked.Renderer()

renderer.link = ({ href, title, text }: Tokens.Link) => {
  const titleAttr = title ? ` title="${title}"` : ""
  return `<a href="${href}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`
}

export function parseMarkdown(input: string) {
  return marked(input, {
    renderer,
    breaks: false,
    gfm: true,
  })
}
```

### Threat
1. `href`, `title`, and `text` are **interpolated raw** into the HTML string with no escaping.
2. `text` (the link text) is itself rendered HTML by `marked` from the markdown source — so attacker-controlled markdown can inject arbitrary HTML in link text, e.g.:
   ```markdown
   [Click](http://example.com)
   ```
   is safe, but:
   ```markdown
   [<img src=x onerror=alert(1)>](http://example.com)
   ```
   is rendered as `<a href="http://example.com"><img src=x onerror=alert(1)></a>` — XSS.
3. The `text` token from `marked` is the **already-rendered inline content**, which is what makes the XSS work.

### Reachability
- `parseMarkdown` is exposed via `parse-markdown` IPC handler in `desktop/src/main/ipc.ts:64`.
- Renderer wires it as `window.api.parseMarkdownCommand(markdown)` in `desktop/src/renderer/index.tsx:247`.
- The `platform.parseMarkdown` interface declares it in `app/src/context/platform.tsx:86` but **no app component currently consumes it** (`grep -rn "platform.parseMarkdown" packages/app/src/` returns no matches).
- The `MarkedProvider` used in the app is `packages/ui/src/context/marked.tsx`, which is a **separate, safe code path** — its link renderer escapes `href` and `text` (lines 474-484).

### Risk
- **Current:** the function is dead-end from the app's render path. No XSS via this route today.
- **Latent:** any future renderer-side wiring of `platform.parseMarkdown` to a markdown source (e.g., AI output, server-pushed message, user paste) **immediately enables XSS** that bypasses DOMPurify.
- **Attack chain:** a markdown XSS in the renderer can call `window.api.parseMarkdownCommand(malicious)` recursively, but more importantly can call any other exposed IPC handler (open-path, store-set, etc.) — contextIsolation stops `require()` but does **not** stop `window.api.*` calls.

### Fix
Replace the unsafe renderer with the same approach used in `packages/ui/src/context/marked.tsx:474-484`:
```typescript
renderer.link = ({ href, title, text }: Tokens.Link) => {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
     .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
  const titleAttr = title ? ` title="${esc(title)}"` : ""
  return `<a href="${esc(href ?? "")}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${esc(text ?? "")}</a>`
}
```
And pipe the result through DOMPurify in the renderer before `innerHTML` insertion, OR render via Solid's `innerHTML` to a real DOM node and use DOMPurify to sanitize (matching the `MarkedProvider` flow in `packages/ui/src/context/marked.tsx`).

A better, structural fix: **delete `desktop/src/main/markdown.ts` entirely** and route all markdown parsing through the renderer's `MarkedProvider` (which already sanitizes and uses DOMPurify).

---

## 3. F-EXT-02 — `open-path` IPC with arbitrary `app` (MEDIUM)

### Evidence

`packages/desktop/src/main/ipc.ts:186-194`:
```typescript
ipcMain.handle("open-path", async (_event: IpcMainInvokeEvent, path: string, app?: string) => {
  if (!app) return shell.openPath(path)
  await new Promise<void>((resolve, reject) => {
    const [cmd, args] =
      process.platform === "darwin" ? (["open", ["-a", app, path]] as const) : ([app, [path]] as const)
    execFile(cmd, args, (err) => (err ? reject(err) : resolve()))
  })
})
```

### Threat
- On Windows / Linux, `cmd` is whatever string the renderer sent as `app`. `execFile` is safe from shell injection because args are passed as an array (no shell), but the **executable itself is renderer-controlled**.
- Renderer can launch any executable on the user's PATH (or absolute path) with the directory as the first argument: `cmd.exe`, `powershell.exe`, `bash`, `python`, `node`, `git`, `code`, etc.
- macOS path uses `open -a <app> <path>`, which still launches the named application.

### Reachability
- `openPath(path, app)` is exposed in preload (`packages/desktop/src/preload/index.ts:91`).
- The only known consumer is `app/src/components/layout.tsx` and `app/src/components/session-header.tsx`, gated by `server.isLocal`.
- A compromised renderer (XSS, devtools-attach, deep-link injection) can call `window.api.openPath(userDir, "cmd.exe")` directly.

### Risk
- **MEDIUM**: The IPC boundary protects against arbitrary node access, but a privileged local-app-launch IPC is a substantial attack surface.
- A renderer that can launch `cmd.exe /k <evil>` (with `evil` smuggled in `path` as a single argv) is one prompt-injection away from a desktop compromise.

### Fix
Restrict `app` to a static allowlist of known editors (VS Code, Cursor, Windsurf, Sublime, Zed, vim, emacs, etc.) — the same set the UI presents in the "Open In" menu — and reject anything else. Alternatively, require the renderer to pass only a known `appId` that main resolves to a pre-validated executable path.

---

## 4. F-EXT-03 — Release-notes media `src` is unfiltered (MEDIUM)

### Evidence

`packages/app/src/context/highlights.tsx:13`:
```typescript
const CHANGELOG_URL = "https://dreamcode.ai/changelog.json"
```

`packages/app/src/components/dialog-release-notes.tsx:128-137`:
```tsx
{feature()?.media && (
  <div class="flex w-[260px] flex-shrink-0 items-center justify-center bg-surface-weak overflow-hidden">
    {feature()!.media!.type === "image" ? (
      <img
        src={feature()!.media!.src}
        alt={feature()!.media!.alt ?? feature()?.title ?? language.t("dialog.releaseNotes.media.alt")}
        class="w-full h-full object-cover"
      />
    ) : (
      <video src={feature()!.media!.src} autoplay loop muted playsinline class="w-full h-full object-cover" />
    )}
  </div>
)}
```

### Threat
- `media.src` is parsed from JSON fetched from `https://dreamcode.ai/changelog.json` and passed directly to `<img src={...}>` and `<video src={...}>`.
- No URL validation, no host allowlist, no `https:` enforcement after parsing.
- If dreamcode.ai is compromised (DNS hijack, server breach, MITM on a misconfigured cert), an attacker can:
  - Inject `<img src="https://attacker.com/track.gif?...">` to fingerprint the user.
  - Inject `<video src="https://attacker.com/exploit.mp4">` to attempt codec-level exploits (rare but real).
  - Inject `data:text/html,<script>...</script>` URLs (browsers reject for `<img>`, but legacy renderers may not).

### Reachability
- `HighlightsProvider` is mounted in `app/src/app.tsx` and triggers on app start.
- Fetched once per session and parsed via `parseChangelog` → `parseRelease` → `parseHighlight` → `parseMedia`. Type and `src` are extracted via `getText()` which only trims strings — no URL validation.

### Risk
- **MEDIUM** (supply-chain). A dreamcode.ai compromise = full user fingerprinting via image src.

### Fix
Add a URL validator:
```typescript
function safeMediaSrc(src: string): string | undefined {
  try {
    const u = new URL(src)
    if (u.protocol === "https:" || u.protocol === "data:") return src
    if (u.protocol === "http:") return src // legacy content — consider forcing https only
    return undefined
  } catch { return undefined }
}
```
Apply in `parseMedia` after the `getText` extraction. Better: pin the expected media host (e.g., `cdn.dreamcode.ai`) and reject anything else.

---

## 5. F-EXT-04 — `check-app-exists` / `resolve-app-path` accept arbitrary `appName` (MEDIUM)

### Evidence

`packages/desktop/src/main/ipc.ts:65-66`:
```typescript
ipcMain.handle("check-app-exists", (_event: IpcMainInvokeEvent, appName: string) => deps.checkAppExists(appName))
ipcMain.handle("resolve-app-path", (_event: IpcMainInvokeEvent, appName: string) => deps.resolveAppPath(appName))
```

`packages/desktop/src/main/apps.ts` (verified):
```typescript
export async function checkAppExists(appName: string): Promise<boolean> {
  // ... execFile("where", [appName]) on Windows, "which" on Unix
}
```

### Threat
- Renderer can pass any string as `appName`. `execFile("where", [appName])` will return success if the command is in PATH.
- Used to enumerate the user's system: which editors are installed, which CLIs, which package managers. Returns boolean (check) or absolute path (resolve).
- Side-effect: any `appName` that resolves to a binary on PATH that **does something on `--version` or help** is a small information leak (e.g., `node --version` reveals node version, `git --version` reveals git version).

### Reachability
- Exposed via preload (`packages/desktop/src/preload/index.ts:62-63`).
- Consumed by `app/src/context/platform.tsx` → `checkAppExists` is used to populate the "Open In" menu editor list.

### Risk
- **MEDIUM** (info disclosure). Renderer already has `open-path` for launching apps; `check-app-exists` is just an enumeration helper. No execution risk.

### Fix
Limit the `appName` to a known allowlist of editor CLIs that the "Open In" menu supports. Reject anything else with a boolean false.

---

## 6. F-EXT-05 — `store-*` IPC accepts renderer-controlled `name` (MEDIUM)

### Evidence

`packages/desktop/src/main/ipc.ts:91-115` (store-get, store-set, store-delete, store-clear, store-keys, store-length).

All six handlers accept a `name` argument (store namespace) directly from the renderer and call `getStore(name)` which instantiates an `electron-store` keyed by `name` writing to `userData/<name>`.

### Threat
- Renderer can read/write any JSON file in `userData` whose name matches an `electron-store` filename pattern.
- `electron-store` sanitizes the name to prevent path traversal (`..` → stripped), but renderer can still create arbitrary new store files like `notes.json`, `cache.json`, `preferences.json`, etc.
- Worse: the `storeKeys` and `storeLength` handlers let the renderer enumerate all keys in any store — including the `opencode.settings` store that contains **server URLs, server credentials references, user settings, etc.**

### Reachability
- Exposed via preload (`packages/desktop/src/preload/index.ts:68-73`).
- Not used by the app directly (no callsite in `packages/app/src/`). Dead IPC surface.
- Still: a future renderer that calls `window.api.storeKeys("opencode.settings")` exfiltrates the full user-settings state.

### Risk
- **MEDIUM** (latent info disclosure). Today the IPC is unused, but the surface is exposed.

### Fix
Either:
1. Remove the `store-*` IPC handlers entirely if the app doesn't need them.
2. Restrict `name` to a static allowlist of known store namespaces (`opencode.settings` only).
3. Require renderer to pass a token issued by main on legitimate use.

---

## 7. F-EXT-06 — `parse-markdown` IPC is exposed (LOW)

### Evidence
- `packages/desktop/src/main/ipc.ts:64`: `ipcMain.handle("parse-markdown", ...)`
- `packages/desktop/src/preload/index.ts:65`: `parseMarkdownCommand`
- `packages/desktop/src/renderer/index.tsx:247`: `platform.parseMarkdown = (markdown) => window.api.parseMarkdownCommand(markdown)`

### Threat
- Gated by F-EXT-01 — the underlying `parseMarkdown` is unsafe, but the IPC is exposed.
- Currently unused by the app render path; the `MarkedProvider` in `packages/ui/src/context/marked.tsx` is the only consumer, and it does NOT pass `nativeParser`.

### Risk
- **LOW** today; **HIGH** if any renderer code wires `platform.parseMarkdown` to user-controlled markdown.

### Fix
If F-EXT-01 is fixed, this remains a low-risk IPC. If F-EXT-01 cannot be fixed immediately, add a renderer-side gate: only invoke `platform.parseMarkdown` from a known safe source (e.g., release-notes markdown, not arbitrary user content).

---

## 8. F-EXT-07 — `file-tree.tsx` drag image uses `outerHTML` (LOW)

### Evidence

`packages/app/src/components/file-tree.tsx:98`:
```typescript
image.innerHTML = (icon as SVGElement).outerHTML + (text as HTMLSpanElement).outerHTML
```

### Threat
- `outerHTML` of an SVG and a span — both are produced by the app's own components, not from user input.
- Used to construct a drag image for file-tree drag operations.
- The `text` content is the filename (potentially attacker-controlled if the filename comes from a malicious file on disk), but the `outerHTML` is then placed in a temporary `image` element, not the live DOM tree.

### Risk
- **LOW**. The drag image is never appended to the document; the filename goes through text node creation, not attribute injection. Worst case: malformed drag-image rendering.

### Fix
None needed. Document the rationale in a comment.

---

## 9. F-EXT-08 — `mailto:` allowed in `open-link` IPC (LOW)

### Evidence

`packages/desktop/src/main/ipc.ts:21`:
```typescript
const openLinkAllowedProtocols = new Set(["https:", "http:", "mailto:"])
```

### Threat
- `mailto:` links cause the OS default mail handler to launch with the address pre-filled.
- Phishing risk: a compromised renderer can `window.api.openLink("mailto:victim@example.com?subject=...&body=...")` to spam-via-mail.
- The `mailto:` link itself is constructed by the attacker (since renderer controls it), so this is just an attack surface extension.

### Risk
- **LOW**. Mail handlers are user-initiated apps; no privilege escalation.

### Fix
Consider removing `mailto:` from the allowlist. Most email links should be left to the user to copy-paste from the rendered text.

---

## 10. F-EXT-09 — `spyRendererConsole` captures all renderer console (LOW)

### Evidence

`packages/desktop/src/main/logging.ts:26`:
```typescript
log.initialize({ preload: false, spyRendererConsole: true })
```

`exportDebugLogs` zips all log files into the user's Downloads directory and reveals them in the OS file manager.

### Threat
- All `console.log/error/warn` from the renderer (including error stack traces with file paths, server URLs, user input echoed back from server) is captured.
- If the user shares the debug log zip with a support channel, that data leaks.
- Some renderer logs may include API keys, auth tokens, or paths containing PII (e.g., username in `C:\Users\<name>\...`).

### Risk
- **LOW** (intended behavior for debug export). Already gated by user-initiated export.

### Fix
- Add a redaction pass for known sensitive patterns (Bearer tokens, `sk-` keys, file paths under user profile → username placeholder).
- Document the data exposure in the export dialog.

---

## 11. F-EXT-10 — Electron security baseline (INFO)

### Evidence

`electron/main.js` (verified earlier sweep):
- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- No `nodeIntegrationInWorker` or `nodeIntegrationInSubframes` overrides
- `webSecurity: true` (default)
- `allowRunningInsecureContent: false` (default)

### Status
- **PASS** — Electron security baseline is correctly applied. The `webview` is not used (Solid app runs in a single BrowserWindow with its own renderer).
- The `contextBridge` in `packages/desktop/src/preload/index.ts` is the only renderer→main channel. All sensitive operations are gated through this surface.
- Deep links (`opencode://...`) are received via `app.on('open-url')` and forwarded to the renderer via `sendDeepLinks`, but the renderer does not auto-execute them — they're displayed in a banner for user confirmation (`app/src/components/session.tsx` verified).

### Recommendation
- No action needed. Continue to enforce this baseline in CI.

---

## 12. F-EXT-11 — `prompt-input.tsx` clear-via-innerHTML (INFO)

### Evidence

`packages/app/src/components/prompt-input.tsx:534`:
```typescript
editorRef.innerHTML = ""
```

### Status
- **SAFE** — empty string is the only value written. No user input.
- Used to clear the contenteditable surface for the prompt editor.

---

## 13. F-EXT-12 — OAuth `window.open` flow (INFO)

### Evidence

`packages/app/src/components/dialog-connect-provider.tsx` (verified earlier sweep):
- Uses `window.open(authUrl)` for OAuth redirect.
- The `authUrl` is returned by the server; not directly from the user.
- Polling or postMessage listener detects auth completion.

### Status
- **ACCEPTABLE** — standard OAuth flow. Server must validate redirect URI; the renderer doesn't process the callback URL directly.

---

## 14. F-EXT-13 — WSL distro name handling (INFO)

### Evidence

`packages/desktop/src/main/wsl/policy.ts` — `requireWslIpcString` validates `string` type and non-empty length.

`packages/desktop/src/main/wsl/runtime.ts` — `wslArgs` passes distro name as separate argv; `installWslDistro(name)` calls `wsl.exe --install -d <name>` with the name as a separate argv.

`packages/desktop/src/main/wsl/servers.ts` — distro names come from `wsl --list --online` enumerated output.

### Status
- **SAFE** — no shell interpolation. Distro names are constrained to the enumerated list. Path-traversal on distro name is irrelevant because `wsl.exe` rejects `..` in distro names.

---

## 15. F-EXT-14 — `parseMarkdown` is dead code in the render path (INFO)

### Evidence
- `parseMarkdown` in `desktop/src/main/markdown.ts` is exported only for use by `parse-markdown` IPC.
- No `packages/app/src/` component calls `platform.parseMarkdown`.
- All app-side markdown rendering goes through `MarkedProvider` in `packages/ui/src/context/marked.tsx`, which is the safe in-process pipeline (DOMPurify + escaped link renderer).

### Status
- **Latent risk** — see F-EXT-01. The IPC handler is exposed but the render path doesn't use it.

---

## 16. Additional findings (cross-cutting)

### 16.1 Storybook dev server hardening (PASS)
`packages/storybook/.storybook/main.ts`:
- `fs.allow` is restricted to `["searchForWorkspaceRoot", "ui", "app", "mocks"]` — the Vite dev server cannot serve files outside the project root.
- `@storybook/addon-onboarding` is gated behind `process.env.STORYBOOK_ONBOARDING === "true"` (comment F-SB-04).
- Stories are loaded only from `packages/ui/src/**/*.stories.*`.
- No story uses `dangerouslySetInnerHTML`, `innerHTML`, or untrusted `href`/`src`.

### 16.2 Terminal output → `openLink` (PASS with caveat)
`packages/app/src/components/terminal.tsx`:
- `openLink` for terminal output goes through `openLinkAllowedProtocols` allowlist (http:, https:, mailto:).
- Terminal output is by-design untrusted (it's remote shell output), but the protocol allowlist is the boundary.
- No script execution is possible because terminal output is rendered as text, not HTML.

### 16.3 `server-sdk.tsx` URL validation (PASS)
`packages/app/src/utils/server-sdk.tsx`:
- Checks the server URL is loopback OR uses `http://` before constructing the event SDK.
- Prevents `file://` or `javascript:` URLs from being passed to the SDK.

### 16.4 `path-key.ts` path normalization (PASS)
`packages/app/src/utils/path-key.ts`:
- `PathKey` branded type enforces path normalization (windows drive letters, trailing slash).
- Used to prevent path-traversal in URL construction (e.g., `tabHref = base64Encode(session.directory)`).

### 16.5 Sentry initialization (PASS)
`packages/app/src/entry.tsx`:
- Sentry DSN comes from `import.meta.env` (build-time only).
- No user PII is attached by default.
- `beforeSend` hook is not overridden — sentry sends default context (URL, user-agent).

### 16.6 `localStorage` / `sessionStorage` usage (PASS)
- `app/src/utils/persist.ts` uses `localStorageWithPrefix` and `localStorageDirect` helpers.
- All keys are namespaced (e.g., `opencode.settings.v1`).
- No serialized DOM nodes or HTML strings are stored.

---

## 17. Verification commands

```bash
# Re-verify the parseMarkdown vulnerability
cat packages/desktop/src/main/markdown.ts

# Confirm no app component calls platform.parseMarkdown
grep -rn "platform.parseMarkdown" packages/app/src/ packages/ui/src/

# Check for any new innerHTML writes added since this audit
grep -rn "innerHTML\s*=" packages/app/src/ packages/ui/src/ packages/desktop/src/ | grep -v "/dist/"

# Check for any new dangerouslySetInnerHTML or set:html
grep -rn "dangerouslySetInnerHTML\|set:html\|setHTML" packages/app/src/ packages/ui/src/ packages/desktop/src/

# Re-verify electron security baseline
grep -n "contextIsolation\|nodeIntegration\|sandbox" electron/main.js
```

---

## 18. Recommended fix priority

1. **F-EXT-01 (HIGH)**: Either delete `desktop/src/main/markdown.ts` and route everything through the safe `MarkedProvider`, or apply the same `esc()` link renderer pattern. Also sanitize the output with DOMPurify in the renderer.
2. **F-EXT-02 (MEDIUM)**: Add `app` allowlist to `open-path` IPC. Restrict to known editor CLIs.
3. **F-EXT-03 (MEDIUM)**: Add URL validator to `parseMedia` in `highlights.tsx`. Pin to `cdn.dreamcode.ai` host.
4. **F-EXT-04 (MEDIUM)**: Restrict `appName` to known editor allowlist in `check-app-exists` / `resolve-app-path`.
5. **F-EXT-05 (MEDIUM)**: Remove `store-*` IPC handlers (or restrict `name` to a known allowlist).
6. **F-EXT-06 (LOW)**: Gate `parse-markdown` IPC behind a `trusted: true` flag in renderer, or remove if unused.
7. **F-EXT-08 (LOW)**: Remove `mailto:` from `openLinkAllowedProtocols`.
8. **F-EXT-09 (LOW)**: Add redaction in `exportDebugLogs` for Bearer tokens, file paths.

---

## 19. What's NOT a finding

The following were checked and are **clean**:

- **`eval`, `new Function`, `document.write`**: zero matches in `packages/app/src/`, `packages/ui/src/`, `packages/desktop/src/`.
- **`srcdoc`**: zero matches.
- **`javascript:` URLs in `href`/`src`**: zero matches in app source.
- **`fetch` with user-input URLs**: zero matches (all fetches are to allowlisted server URLs or static assets).
- **`setHTML` / `set:html` (Solid)**: zero matches.
- **`dangerouslySetInnerHTML`**: zero matches in app/UI/desktop source.
- **`window.open` to attacker-controlled URL**: only OAuth flow; URL is server-validated.
- **IndexedDB**: only standard, prefixed usage in `persist.ts`.

---

*End of EXTENSION-AUDIT.*
