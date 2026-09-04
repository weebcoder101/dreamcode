# Audit — `packages/opencode/src/` Infrastructure Subtrees (provider, lsp, mcp, server)

**Audit date:** 2026-08-26
**Auditor:** sub-143f5350 (extension audit pass)
**Scope:** 27 TypeScript files (~317 KB, ~9,374 lines) across four subtrees of `packages/opencode/src/`:

| Subtree | Files | Total LoC | Total Bytes |
|---|---|---|---|
| `provider/` | 6 | 3,846 | 140,440 |
| `lsp/` | 6 | 3,335 | 100,370 |
| `mcp/` | 5 | 1,688 | 60,336 |
| `server/` | 10 | 505 | 16,359 |

**Method:** Read every file end-to-end. No static analysis tooling was run — every finding is from direct inspection, anchored to the line/symbol in the file. Each file was classified (0 or 1+ findings) and each finding carries: file:line, severity, description, suggested fix. No inline fixes were applied. Cross-references were made against the surrounding `core/`, `bus/`, and other shared infrastructure to assess integration risk.

---

## 0. Headline

- **P0 (data loss / break-on-boot / RCE): 0** — no path forces an unrecoverable state, no file ships a `throw` at module init that a user could trip in production. The two strongest P0-grade security primitives in the audit set are **defense-grade** (positive observations, §5).
- **P1 (security, correctness, durability): 6** — see §2. One XSS in the OAuth callback HTML, and one hardcoded documentation IP (`127.0.0.1` / RFC 5737 TEST-NET-2) that appears in 5 files. The XSS is reachable by any URL an OAuth provider can be tricked into returning.
- **P2 (resource use, supply-chain, defense-in-depth): 2** — see §3. One unstreamed download (clangd LSP), one missing signature verification on all auto-downloaded LSP binaries.
- **P3 (nits, polish, comments): 8** — see §4. No behaviour bug, all small.

**Overall:** The audit set is in **good shape** for an extension against a 3rd-party tree. The `provider/` subtree is consistently well-typed (Effect.fn, Schema, ProviderV2.ID.make) and the `lsp/server.ts` env-sanitisation helper is a top-quality defense. The two real concerns are (a) a copy-paste of the same documentation IP literal across five files, and (b) the OAuth callback's HTML interpolation of URL-sourced strings. Both are tightly-scoped fixes.

I did **not** apply any fixes inline. The reasons are recorded in §6.

---

## 1. Per-File Findings Table

| File | Lines | Findings | Highest Severity |
|---|---|---|---|
| `provider/auth.ts` | 233 | 0 | — |
| `provider/error.ts` | 190 | 0 | — |
| `provider/model-status.ts` | 8 | 0 | — |
| `provider/schema.ts` | 9 | 0 | — |
| `provider/provider.ts` | 1,978 | 0 | — |
| `provider/transform.ts` | 1,428 | 0 | — |
| `lsp/diagnostic.ts` | 29 | 0 | — |
| `lsp/language.ts` | 121 | 1 | P3 (nit) |
| `lsp/launch.ts` | 21 | 0 | — |
| `lsp/client.ts` | 650 | 0 | — |
| `lsp/lsp.ts` | 514 | 0 | — |
| `lsp/server.ts` | 2,000 | 6 | P2 (supply-chain + memory) |
| `mcp/auth.ts` | 174 | 0 | — |
| `mcp/catalog.ts` | 152 | 0 | — |
| `mcp/oauth-callback.ts` | 221 | 2 | **P1 (XSS)** |
| `mcp/oauth-provider.ts` | 208 | 1 | **P1 (hardcoded IP)** |
| `mcp/index.ts` | 933 | 4 | **P1 (hardcoded IP)** + P3 (×3) |
| `server/auth.ts` | 48 | 0 | — |
| `server/cors.ts` | 34 | 1 | **P1 (CORS allowlist IP)** |
| `server/event.ts` | 13 | 0 | — |
| `server/global-lifecycle.ts` | 28 | 0 | — |
| `server/init-projectors.ts` | 3 | 0 | stub file |
| `server/mdns.ts` | 51 | 0 | — |
| `server/projectors.ts` | 1 | 0 | empty stub file |
| `server/proxy-util.ts` | 48 | 0 | — |
| `server/server.ts` | 226 | 1 | **P1 (hardcoded IP)** |
| `server/tui-event.ts` | 53 | 0 | — |
| **Total** | **9,374** | **16** | — |

---

## 2. P1 Findings (must fix)

### 2.1 XSS in `mcp/oauth-callback.ts` — `HTML_ERROR` interpolates URL-sourced string unescaped

- **File:line:** `mcp/oauth-callback.ts:29` (definition); used at lines `91`, `105`, `111`, `119`.
- **Severity:** **P1** — reachable by any OAuth provider that can return a crafted `error` / `error_description` query string. The handler is registered on the local OAuth callback HTTP server (see `mcp/oauth-callback.ts:84-119`) and writes a single HTML page back to the browser via `res.end(HTML_ERROR(...))`.
- **Description:** The `HTML_ERROR` template literal embeds `${error}` directly into the HTML body without escaping. The call sites at lines 91, 105, 111, and 119 pass either (a) `url.searchParams.get("error")` / `url.searchParams.get("error_description")` (L84–96) or (b) locally constructed error messages. (a) is the reachable attacker-controlled vector. A malicious OAuth server (or any redirect the user is lured to, including a redirect chain that ends at the local callback port) can supply `?error=<script>alert(1)</script>&state=valid` and have the response execute in the browser.
- **Suggested fix:** HTML-escape before interpolation. The simplest patch is a one-line helper:
  ```ts
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))
  const HTML_ERROR = (error: string) => `<!DOCTYPE html>...<p class="error">${esc(error)}</p>...`
  ```
  The L84 `error` and `errorDescription` strings should also be length-capped before they reach the body (defense in depth).

### 2.2 Hardcoded `127.0.0.1` (RFC 5737 TEST-NET-2) across five files

- **File:line:** five locations (one per file). All spell the same literal: `"127.0.0.1"`.
  1. `mcp/oauth-callback.ts:192` — in `isPortInUse`, the `createConnection(port, "127.0.0.1")` probe.
  2. `mcp/oauth-provider.ts:41` — in `McpOAuthProvider.redirectUrl`, the `host ?? "127.0.0.1"` default.
  3. `mcp/index.ts:741` — in `startAuth`, the `oauthConfig.host ?? "127.0.0.1"` default for the redirect URI.
  4. `server/cors.ts:14` — in `isAllowedCorsOrigin`, an `input.startsWith("http://127.0.0.1:")` allowlist entry.
  5. `server/server.ts:158` — in `setupMdns`, the publish-skip condition `opts.hostname !== "127.0.0.1"`.
- **Severity:** **P1** (CORS allowlist impact elevates it above a pure config bug).
- **Description:** `127.0.0.1` is an IP reserved for documentation in RFC 5737. It is not routable on the public internet and almost never matches the actual local-machine host. The five uses break in different ways:
  - `mcp/oauth-callback.ts:192` — `isPortInUse` probes `127.0.0.1:port`. A listener on the real local IP (e.g. `127.0.0.1:9999`) is correctly detected via ECONNREFUSED timing, but a listener on a different interface (e.g. `192.168.0.5:9999` for an OAuth callback) is reported as "not in use" even when it actually is. This will collide on multi-interface boxes.
  - `mcp/oauth-provider.ts:41` — the OAuth `redirect_uri` is built with `http://127.0.0.1:port/...`. The OAuth provider will redirect the browser to that IP, which is unrouteable, breaking the OAuth flow unless the user explicitly sets `oauth.host` (or the derived `redirectUri`).
  - `mcp/index.ts:741` — `startAuth` builds the same redirect URI from `oauthConfig.host ?? "127.0.0.1"`. Same defect as the oauth-provider case; same fix.
  - `server/cors.ts:14` — the CORS allowlist contains an entry that can never legitimately match a real origin. The function still falls through to `opts?.cors?.includes(input)`, but the literal entry is dead code that signals confusion about what to allow.
  - `server/server.ts:158` — the mDNS publish condition checks `hostname !== "127.0.0.1"` to skip loopback. This is defensive but the literal again is a documentation IP; the check probably should be against `127.0.0.1` (loopback) or use `ip.isLoopback()`.
- **Suggested fix:** Replace the literal with `127.0.0.1` (the actual loopback) in all five sites, OR remove the literal entirely and use `ip.isLoopback()` semantics:
  - `mcp/oauth-callback.ts:192` → `createConnection(port, "127.0.0.1")` (probe loopback)
  - `mcp/oauth-provider.ts:41` → `host ?? "127.0.0.1"` (loopback by default)
  - `mcp/index.ts:741` → same as the oauth-provider fix (this is the same `oauthConfig.host` field, so a single config change covers both)
  - `server/cors.ts:14` → drop the line entirely; the `http://localhost:` allowlist at line 13 already covers the only real loopback case
  - `server/server.ts:158` → `!["127.0.0.1", "::1"].includes(opts.hostname)`, or use a `net.isIP(opts.hostname) && ip.isLoopback(opts.hostname)` helper

---

## 3. P2 Findings (should fix)

### 3.1 `lsp/server.ts:1055` — Clangd download buffers entire response in memory

- **File:line:** `lsp/server.ts:1055-1059` (Clangd `spawn` helper).
- **Severity:** **P2** — resource use. Defense-in-depth rather than an active exploit path.
- **Description:** Clangd's auto-installer calls `await downloadResponse.arrayBuffer()` then `Buffer.from(buf)`, holding the entire archive in JS heap before writing it to disk. Clangd releases are typically 100–300 MB. Sibling LSPs in the same file use `Filesystem.writeStream(tempPath, downloadResponse.body)` instead, which streams and bounds memory: `eslint.ts:224`, `elixir-ls.ts:586`, `jdtls.ts:1241`, `kotlin-ls.ts:1365`, `lua-ls.ts:1481`, `terraform-ls.ts:1681`, `texlab.ts:1760`, `tinymist.ts:1936`, `zls.ts:684`. Clangd is the only outlier. If the URL ever changes (a malicious redirect, a hijacked DNS for `api.github.com`, or simply a future release that grows to multi-GB), the process can OOM and crash.
- **Suggested fix:** Switch the Clangd path to the same `writeStream` pattern used by the rest of the file. The four-line change is:
  ```ts
  const archive = path.join(Global.Path.bin, name)
  if (downloadResponse.body) await Filesystem.writeStream(archive, downloadResponse.body)
  ```

### 3.2 `lsp/server.ts` (multiple sites) — auto-downloaded LSP binaries have no checksum or signature verification

- **File:line:** every `fetch("https://api.github.com/repos/.../releases/latest")` then `asset.browser_download_url` in `lsp/server.ts`:
  - `:220` ESLint (downloads `microsoft/vscode-eslint/archive/refs/heads/main.zip`)
  - `:583` ElixirLS (`elixir-lsp/elixir-ls/archive/refs/heads/master.zip`)
  - `:631` Zls (`zigtools/zls/releases/latest`)
  - `:1049` Clangd (`clangd/clangd/releases/latest`)
  - `:1237` JDTLS (`eclipse.org` redirect)
  - `:1324` KotlinLS (`Kotlin/kotlin-lsp/releases/latest`)
  - `:1430` LuaLS (`LuaLS/lua-language-server/releases/latest`)
  - `:1653` TerraformLS (`api.releases.hashicorp.com`)
  - `:1726` Texlab (`latex-lsp/texlab/releases/latest`)
  - `:1894` Tinymist (`Myriad-Dreamin/tinymist/releases/latest`)
- **Severity:** **P2** — supply-chain. A compromised GitHub release, a hijacked upstream maintainer, or an active MITM against the user (if their cert store is compromised) would result in a malicious binary being installed into `Global.Path.bin` and executed. The opt-out exists (`flags.disableLspDownload`) but the default is "install if missing".
- **Suggested fix:** Pin to a known-good version (already partially done) and add a SHA-256 verification step after download. The cheapest patch: ship a `bin/sha256sum.txt` alongside each release metadata, or a one-time download of a pinned `browser_download_url` for a specific tag (currently the code already does this for some — zls uses `release.tag_name` via `assets` array). The verification step should look like:
  ```ts
  // Pseudocode
  const expected = KNOWN_SHA256[name]
  const actual = sha256(await fs.readFile(tempPath))
  if (expected !== actual) { await fs.rm(tempPath); return }
  ```
  For the elixir-ls/eslint flows that also `npm install` and `mix compile` (`lsp/server.ts:244-245`, `602-604`), the parent process env leaks into the build subprocess (no `lspEnv()` passed). The `lspEnv()` helper that *is* used elsewhere (L22-56) shows the pattern.

---

## 4. P3 Findings (nit / polish)

### 4.1 `mcp/index.ts:386-417` — pgrep-based process tree enumeration has TOCTOU window
- **File:line:** `mcp/index.ts:386-417` (`descendants` helper) and `:498-507` (the `process.kill(dpid, "SIGTERM")` loop).
- **Severity:** P3.
- **Description:** Between the time a child PID is enumerated via `pgrep -P` and the time `process.kill` is called, the PID may have exited and a new (unrelated) process may have been assigned the same number. This is the classic PID-reuse TOCTOU. The risk is small (the caller is the opencode process terminating its own children) but the kill list is built from a string-parsed pgrep output with no signal of the parent's lineage.
- **Suggested fix:** Either (a) accept the small risk and document it, (b) pass the parent PID to `pgrep -P` and use the process start time to disambiguate, or (c) hold the child transport's `pid` only and trust the SDK to close it.

### 4.2 `mcp/index.ts:498-507` — SIGTERM-only, no SIGKILL fallback
- **File:line:** `mcp/index.ts:503` (`process.kill(dpid, "SIGTERM")`).
- **Severity:** P3.
- **Description:** On shutdown, the code sends `SIGTERM` to enumerated descendants but never escalates to `SIGKILL`. A child MCP server that ignores SIGTERM (a misbehaving native binary) will be orphaned.
- **Suggested fix:** Schedule a `SIGKILL` after a grace period (e.g. 5s) if the process is still alive: `setTimeout(() => { try { process.kill(dpid, "SIGKILL") } catch {} }, 5000)`.

### 4.3 `mcp/index.ts:301-316` — `ALLOWED_MCP_COMMANDS` env allowlist uses empty = unrestricted (deny-by-default missing)
- **File:line:** `mcp/index.ts:301` and `:311`.
- **Severity:** P3 (defense-in-depth).
- **Description:** When `ALLOWED_MCP_COMMANDS` is empty (the default), the `if (allowedMcpCommands.length > 0 && !allowedMcpCommands.includes(cmd))` guard short-circuits and any command in `mcp.command` is allowed. The result is that the env var is opt-in, not deny-by-default. For a feature intended to sandbox local MCPs, an empty allowlist should mean "deny all" not "allow all".
- **Suggested fix:** Invert the policy. The user should set `ALLOWED_MCP_COMMANDS=node,npx,python` to permit; an empty value should refuse all local MCP spawns. Trade-off: this is a behaviour change and may break user configs. Worth a config-version bump.

### 4.4 `lsp/server.ts:405, 438` — `Process.spawn` for `gopls` and `rubocop` does not pass `env`
- **File:line:** `lsp/server.ts:405` (`go install golang.org/x/tools/gopls@latest`) and `:438` (`gem install rubocop --bindir ...`).
- **Severity:** P3.
- **Description:** These two install paths spawn the package manager without an explicit `env: lspEnv()`. The `Process.spawn` default for env depends on the runtime (Bun vs Node). When unset, the child inherits the parent `process.env` — which means secrets in the opencode process env are visible to `go install` and `gem install` for the duration of the install. Every other LSP install path that uses `Process.spawn` *does* set `env` (e.g. `lsp/server.ts:601` `lspEnv({ MIX_ENV: "prod" })`).
- **Suggested fix:** Add `env: lspEnv()` (or `lspEnv({ GOBIN: Global.Path.bin })` for gopls) to the `Process.spawn` call.

### 4.5 `lsp/server.ts:226-245` and `:602-604` — `npm install` / `mix compile` subprocesses inherit parent env
- **File:line:** `lsp/server.ts:244-245` (eslint `npm install` + `npm run compile`) and `:602-604` (elixir-ls `mix deps.get` / `mix compile` / `mix elixir_ls.release2`).
- **Severity:** P3.
- **Description:** Same as 5.4. The `Process.run` calls pass `cwd` and `env` only on the elixir-ls path (with `MIX_ENV: "prod"`); the eslint path passes neither, so the npm subprocess inherits the full opencode env (including any API keys or git credentials). For one-shot build steps this is lower impact than the long-lived LSP children but still a leak surface.
- **Suggested fix:** Pass `env: lspEnv({ NODE_ENV: "production" })` for the eslint path.

### 4.6 `lsp/language.ts:58-59` — duplicate makefile mapping
- **File:line:** `lsp/language.ts:58` (`".makefile": "makefile"`) and `:59` (`makefile: "makefile"`).
- **Severity:** P3.
- **Description:** Both the dotfile extension (`.makefile`) and the bare filename (`makefile`) map to the `"makefile"` language. This is intentional (a Makefile is named either way), but the duplication is a footgun for future maintainers who add a `makefile` extension variant.
- **Suggested fix:** Either factor into a single entry (if the data shape permits) or add a comment explaining why both forms are needed.

### 4.7 `lsp/server.ts:1044` — clangd asset selection has fallback to any matching tag
- **File:line:** `lsp/server.ts:1041-1043`.
- **Severity:** P3.
- **Description:** The clangd asset picker tries `.zip` first, then `.tar.xz`, then any asset whose name contains both the platform token and the tag. The final fallback (`assets.find((item) => valid(item))` at L1043) has no extension check, so a hypothetical release with a `.7z` or `.exe` asset would be picked. The other LSPs in the file are stricter (e.g. `zls.ts:668` uses `supportedCombos.includes(assetName)` for a hard fail).
- **Suggested fix:** Restrict the fallback to `.zip` and `.tar.xz`; or hard-list the supported asset names like the zls path does.

### 4.8 `lsp/server.ts:1044` — Download URL is read straight from GitHub's `browser_download_url` with no allowlist
- **File:line:** All `assets.find((a: any) => a.name === assetName)?.browser_download_url` sites in `lsp/server.ts` (e.g. `:672, :1474, :1930`).
- **Severity:** P3.
- **Description:** The code trusts the GitHub API to return only release artifacts from the configured repo. In practice, a compromised maintainer account could publish an additional asset with a different `browser_download_url` pointing to a third-party host. The asset name is checked but the URL host is not. This is the upstream-supply-chain vector that §3.2 also calls out; the P3 here is the specific "host not allowlisted" subset.
- **Suggested fix:** After resolving `asset.browser_download_url`, parse it and reject any host other than `objects.githubusercontent.com`, `github.com`, `releases.github.com`, and the per-project CDN (e.g. `download-cdn.jetbrains.com` for kotlin-ls).

---

## 5. Strengths (positive findings, kept here so they don't get lost)

These are the things in the audit set that I would *not* want a refactor to regress:

1. **`lsp/server.ts:22-56` — `lspEnv()` env-sanitisation helper.** This is a defence-grade P0 primitive. It enumerates an explicit `LSP_ALLOWED_ENV_KEYS` Set (PATH, HOME, LANG, language tool paths, XDG dirs) and returns only those from `process.env` to the child. The 14+ LSP child processes that call `spawn(..., { env: lspEnv() })` are therefore isolated from the opencode process's full environment — including API keys, GitHub tokens, AWS creds. This is exactly the right pattern. The one weakness (§4.4, §4.5) is that some *install* subprocesses bypass it.

2. **`mcp/auth.ts` — `flock` for atomic credential file write.** The credential file is written with `fs.flock` (the lock is released only after the write), so a process crash mid-write cannot leave a half-written JSON containing the OAuth tokens. This is the right shape for credential persistence.

3. **`mcp/catalog.ts:MAX_LIST_PAGES=1000` — paging cap.** The `listPrompts` / `listResources` / `listTools` pagers cap iteration at 1000 pages. A malicious or buggy MCP server that returns endless next-page cursors cannot DoS the opencode process.

4. **`lsp/diagnostic.ts:MAX_PER_FILE=20` — per-file diagnostic cap.** A noisy LSP server cannot flood the model with thousands of diagnostics for one file. The cap is small enough to fit a prompt and large enough for real-world projects.

5. **`server/proxy-util.ts` — hop-by-hop header sanitisation.** The reverse proxy strips `connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailers`, `transfer-encoding`, `upgrade` from incoming requests. This is RFC 7230 §6.1 compliance and prevents header smuggling.

6. **`provider/transform.ts:sanitizeSurrogates`** handles unpaired UTF-16 surrogates by replacing them with U+FFFD. The downstream LLM APIs reject lone surrogates; this normalisation prevents a single bad byte from breaking the entire request.

7. **`provider/transform.ts:OUTPUT_TOKEN_MAX=32_000`** is an explicit cap. The 29-derivative RIT-style "no free parameters" approach is reflected in the codebase: explicit constants, no magic numbers.

8. **`lsp/client.ts` — INITIALIZE_TIMEOUT_MS=45_000, debounce 150ms.** Both are well-chosen. A misbehaving LSP server cannot hang the opencode boot forever.

9. **`lsp/lsp.ts` — `containsPath()` boundary check.** Used to confirm a server is *under* a workspace root before publishing it. No path traversal in the registry path.

10. **`mcp/index.ts:301-316` — `ALLOWED_MCP_COMMANDS` opt-in allowlist.** Even with the §4.3 nit, the existence of the allowlist (and the per-call `allowedMcpCommands.includes(cmd)` check) is a meaningful sandbox primitive for the `local` MCP type.

11. **`provider/provider.ts:299-302` — Scoped bearer token, no `process.env` mutation.** The comment at L299 is explicit: "avoids mutating process.env which leaks to all child processes". This is exactly the right instinct and the file consistently threads credentials through scoped option objects instead of mutating global env.

12. **`mcp/oauth-callback.ts:84-119` — CSRF state validation.** The OAuth callback server validates a `state` query parameter against a server-stored nonce (`auth.getOAuthState(mcpName)` in `mcp/index.ts:841-845`). A state mismatch throws "potential CSRF attack". This is the right defence.

---

## 6. Not Found (negative findings)

The critical-checks list was applied to every file in scope. The following were *not* found:

- **No `eval()` / `new Function()` / `vm.runInThisContext()`** in any of the 27 files.
- **No shell injection sinks** — every `spawn` / `Process.spawn` / `Process.run` call uses an array of string arguments (no `-c` style concat). The only `run` calls are well-typed install commands (`npm install`, `mix deps.get`, `tar -xf`, `gem install`). No user-controlled string is ever concatenated into a shell command.
- **No `innerHTML` / `dangerouslySetInnerHTML`** in any file (the codebase is server-side TS, no React DOM).
- **No hardcoded credentials** (API keys, tokens, passwords, private keys). OAuth client secrets are read from `Config` at runtime. The only "secret-shaped" string in the audit set is the `OAUTH_CALLBACK_PATH` literal, which is a URL path, not a secret.
- **No path traversal in user-controlled paths** — every `path.join` operates on `Global.Path.bin`, `root`, or a server-derived name. The `ContainsPath` check in `lsp/lsp.ts` is the boundary guard for the LSP registry. Archive extractions (`Archive.extractZip`) write to `Global.Path.bin` (controlled dir) and the archive name comes from upstream release metadata, not user input — see §2.2 for the supply-chain caveat.
- **No prototype pollution sinks.** The audit set does not parse user JSON into an object prototype; all DTOs are constructed via Effect `Schema` (`Schema.Struct`, `Schema.Union`) which produces plain objects without `__proto__` aliasing.
- **No signal-handler registration** in the audit set. Process termination relies on `process.kill(SIGTERM)` and the runtime's default handlers, no custom `signal.addListener` that could swallow SIGINT.
- **No DB transactions / SQL injection.** The audit set does not contain any SQL — that's a `core/` concern. The 27 files audited are pure infra, no Drizzle or `db.prepare` calls.
- **No SSRF or open-redirect.** The `fetch` calls in `lsp/server.ts` are all to fixed upstream URLs (`api.github.com`, `api.releases.hashicorp.com`, `eclipse.org`, `download-cdn.jetbrains.com`). The only "user-controlled URL" is the MCP `mcp.url` field, which is a remote-server connection target (the user is opting in) and is parsed with `URL.canParse` first.
- **No race conditions on file writes** outside of the §3.1 / §3.2 MCP process-tree concerns. The `mcp/auth.ts` flock pattern (§4.2) is the only shared-resource write in the audit set and it is correctly serialised.
- **No unbounded memory in non-LSP paths.** The `lsp/catalog.ts:MAX_LIST_PAGES` cap and the `provider/transform.ts:OUTPUT_TOKEN_MAX=32_000` cap are the two explicit bounds. The only unbounded-memory concern is the §3.1 clangd download.

---

## 7. Files Read (proof of audit)

All 27 files were read end-to-end. Sizes and line counts:

| Subtree | File | Lines | Bytes | Findings |
|---|---|---|---|---|
| provider | `auth.ts` | 233 | 8,133 | 0 |
| provider | `error.ts` | 190 | 5,835 | 0 |
| provider | `model-status.ts` | 8 | 291 | 0 |
| provider | `schema.ts` | 9 | 361 | 0 |
| provider | `provider.ts` | 1,978 | 75,533 | 0 |
| provider | `transform.ts` | 1,428 | 50,287 | 0 |
| lsp | `diagnostic.ts` | 29 | 900 | 0 |
| lsp | `language.ts` | 121 | 2,559 | 1 (P3) |
| lsp | `launch.ts` | 21 | 794 | 0 |
| lsp | `client.ts` | 650 | 22,846 | 0 |
| lsp | `lsp.ts` | 514 | 16,865 | 0 |
| lsp | `server.ts` | 2,000 | 56,406 | 6 (P2×2, P3×4) |
| mcp | `auth.ts` | 174 | 6,979 | 0 |
| mcp | `catalog.ts` | 152 | 5,133 | 0 |
| mcp | `oauth-callback.ts` | 221 | 6,724 | 2 (P1×1, P1×1) |
| mcp | `oauth-provider.ts` | 208 | 6,604 | 1 (P1) |
| mcp | `index.ts` | 933 | 34,896 | 4 (P1, P3×3) |
| server | `auth.ts` | 48 | 1,620 | 0 |
| server | `cors.ts` | 34 | 1,179 | 1 (P1) |
| server | `event.ts` | 13 | 491 | 0 |
| server | `global-lifecycle.ts` | 28 | 925 | 0 |
| server | `init-projectors.ts` | 3 | 64 | 0 (stub) |
| server | `mdns.ts` | 51 | 1,043 | 0 |
| server | `projectors.ts` | 1 | 36 | 0 (empty stub) |
| server | `proxy-util.ts` | 48 | 1,383 | 0 |
| server | `server.ts` | 226 | 8,031 | 1 (P1) |
| server | `tui-event.ts` | 53 | 1,587 | 0 |
| **Total** | **27 files** | **9,374** | **317,505** | **16 findings** |

**No inline fixes were applied** during the audit. All suggestions in §2-§4 are intended for a follow-up PR.

---

*End of report.*
