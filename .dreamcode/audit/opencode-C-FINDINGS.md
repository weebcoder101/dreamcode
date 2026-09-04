# Opencode Audit — Package C (Security/Architecture Findings)

**Scope:** `packages/opencode/src/` — `format/`, `env/`, `index.ts`, `control-plane/`, `storage/`, `background/`, `plugin/`, `sync/schema.ts`, `inbox/`, `share/`, `effect/`, `patch/`, `actor/`, `memory/`, `task/`, `acp/`, `event-v2-bridge.ts`, `image/`, `auth/`, `git/`, `account/`, `id/`, `workflow/`, `temporary.ts`, `pty-preparation.ts`, `question/`, `pieces-ltm/`, `shell/` (113 files).

**No-overlap guarantee:** zero intersection with the file sets covered by `opencode-A` (agent/command/cli/config/server/util) and `opencode-B` (session/tool/permission/file/lsp/ide/flag/global/installation/mcp/snapshot/bus/project/pty/worktree/skill/provider).

**Format:** `file:line` | severity | what | why | fix.

**Severity legend:**
- **P0** — critical, exploitable in default install without user action
- **P1** — high, exploitable in plausible threat model (user/AI supplies adversarial input)
- **P2** — medium, weak validation, defense-in-depth, or limited-blast-radius
- **P3** — low / informational / hardening

---

## Summary

| # | Severity | File:line | Summary |
|---|----------|-----------|---------|
| 1 | P1 | `shell/shell.ts:131-138` | PowerShell raw `-Command` flag accepts unescaped input |
| 2 | P1 | `patch/index.ts:602,616,632,651` | `path.resolve(effectiveCwd, hunk.path)` allows `..` escape of workdir |
| 3 | P1 | `pty-preparation.ts:9-12` | `input.command/args/cwd/env` flow into `Pty.create` unbounded |
| 4 | P2 | `auth/index.ts:51-56` | `decryptToken` silently returns ciphertext on decrypt failure |
| 5 | P2 | `control-plane/workspace.ts:253` | `JSON.parse(event.data) as unknown` — no schema validation |
| 6 | P2 | `share/share-next.ts:210` | `baseUrl` falls back to `https://opncd.ai`; trust-boundary on `cfg.enterprise?.url` |
| 7 | P2 | `plugin/xai.ts:128` | JWT claims base64-decoded without signature verification |
| 8 | P2 | `plugin/openai/codex.ts:8449-8454,8861-8865` | `stopOAuthServer` doesn't clear in-flight `waitForOAuthCallback` promise |
| 9 | P2 | `plugin/github-copilot/copilot.ts:9161,10166,9918` | `JSON.parse(init.body)` / `JSON.parse(text)` without schema validation |
| 10 | P3 | `storage/storage.ts:63` | `path.join(dir, ...key) + ".json"` allows `..` traversal |
| 11 | P3 | `control-plane/workspace.ts:549-551` | OTEL env vars forwarded to subprocess adapter from `process.env` |
| 12 | P3 | `git/index.ts:210` | `${ref}:${target}` interpolation into `git show` argv |
| 13 | P3 | `git/index.ts` `patchUntracked` | File path interpolated; diff against FIFO could hang |
| 14 | P3 | `pieces-ltm/service.ts` | `mcpURL` from env without SSRF guard |
| 15 | P3 | `plugin/digitalocean.ts` | OAuth implicit-token flow with localhost loopback server |
| 16 | P3 | `id/id.ts` | `bytes[i] % 62` introduces modulo bias in ID generation |
| 17 | P3 | `plugin/openai/ws-pool.ts` | `sessionID` from internal headers used as pool key |
| 18 | P3 | `inbox/index.ts` `Service.send` | No-op implementation — silently drops messages if downstream expects persistence |
| 19 | P3 | `share/share-next.ts:35-43` | `ShareSchema.secret` field passed to legacy/console API headers (caller-controlled) |
| 20 | P3 | `plugin/loader.ts` | Plugin spec loaded from `.well-known/` and per-provider config dirs (trust boundary) |

---

## Findings (P0 → P3)

### 1. P1 — PowerShell raw `-Command` flag accepts unescaped input

**File:** `packages/opencode/src/shell/shell.ts:131-138`

**What:** The PowerShell `shell()` returns a wrapped command whose last argument is the user-supplied command string. The wrapper passes it via the raw `-Command` flag without any quoting or escaping.

**Why:** The `input.command` ultimately comes from the LLM/tool-layer (e.g. `prompt-shell.ts:109`); an LLM, prompt-injection, or compromised model can supply any PowerShell snippet. A command like `Start-Process -FilePath 'powershell' -ArgumentList '-Command','malicious'` will be re-interpreted by the wrapper. There is no allowlist or argv-split. By contrast, `bash`/`zsh` (L108-117) safely `eval` a JSON-stringified args array, and `fish`/`nu` are denied.

**Fix:** Either (a) argv-split the supplied command into an array and pass as `-Command` parameters individually, or (b) apply the same JSON-stringify+eval pattern used for bash/zsh, or (c) deny PowerShell entirely (consistent with the `fish`/`nu` policy) until a safe wrapper exists.

---

### 2. P1 — `path.resolve(effectiveCwd, hunk.path)` allows `..` escape of workdir

**File:** `packages/opencode/src/patch/index.ts:602,616,632,651`

**What:** All four patch operations (`add` L602, `delete` L616, `update` L632, `move_path` L651) compute the target path as `path.resolve(effectiveCwd, hunk.path)` with **no containment check** that the result is inside `effectiveCwd`. A relative path like `../../etc/passwd` resolves to `/etc/passwd`, which is then read/written/deleted.

**Why:** The `hunk.path` originates from the LLM (or upstream tool result). A prompt-injection, misbehaving model, or compromised provider can craft a patch that escapes the project workdir and either reads sensitive system files or writes/overwrites arbitrary user-writable files (e.g. `~/.bashrc`, `~/.ssh/authorized_keys`, `~/.config/dreamcode/auth.key`). The fact that the user explicitly invoked the patch tool is not a meaningful trust grant — the path is LLM-generated.

**Fix:** After `path.resolve`, compute `path.relative(effectiveCwd, resolved)` and reject if it starts with `..` or is empty (would resolve to `effectiveCwd` itself). Mirror the containment check in `plugin/shared.ts`'s `Filesystem.contains(root, next)`. Apply uniformly to all four call sites.

---

### 3. P1 — `input.command/args/cwd/env` flow into `Pty.create` unbounded

**File:** `packages/opencode/src/pty-preparation.ts:9-12`

**What:** `PtyInput.command`, `args`, `cwd`, `env` are passed directly into `Shell.preferred(...)` → `Shell.login(command)` → `Pty.create(...)` with no validation, allowlist, or normalization. Combined with finding #1 (PowerShell raw pass), an untrusted upstream source can pick any executable name and any argument.

**Why:** A prompt-injected LLM, an ACP client controlled by an attacker, or a malicious skill can supply a `command` field. With PowerShell active, the attacker only needs the binary name; with bash, the same field plus `args` lets them pass any command. There is no command allowlist analogous to `ToolPermission`. The downstream `Pty.create` runs the command with the user's full privileges.

**Fix:** Add a `Shell.prepare(input)` allowlist that (a) requires `command` to be a known shell name (`bash`, `zsh`, `sh`, `pwsh`, `cmd`), and (b) when `command` is `pwsh` or `cmd`, normalizes the `args` array to prevent raw `-Command` / `/c` followed by attacker-supplied concatenation. Reject any other binary in the PTY path.

---

### 4. P2 — `decryptToken` silently returns ciphertext on decrypt failure

**File:** `packages/opencode/src/auth/index.ts:51-56`

**What:** If `createDecipheriv` or `decipher.update/final` throws (e.g. because the AES key was regenerated, the IV is corrupt, the auth tag is wrong, or the file was tampered with), `decryptToken` swallows the exception and returns the original `ciphertext` string (including the `enc:v1:` prefix).

**Why:** Callers (`decryptOauth`, the `api` branch in `all()`) then treat the returned blob as a valid access token / API key and pass it to provider HTTP clients. The provider receives `enc:v1:...` and either rejects the call (silent broken state) or, worse, echoes the prefix back into a log/error path. There is no way to distinguish "valid plaintext" from "encrypted-but-undecryptable" downstream. The encryption module claims to protect tokens at rest but the silent fallback undermines that guarantee.

**Fix:** Throw a structured `AuthError({ message: "Token decrypt failed; key may have been regenerated" })` instead of returning the ciphertext. The caller in `all()` should surface this as a partial failure (return the entries that *did* decrypt and log a warning, or fail the whole call).

---

### 5. P2 — `JSON.parse(event.data) as unknown` — no schema validation

**File:** `packages/opencode/src/control-plane/workspace.ts:253`

**What:** The SSE parser `Stream.map` returns the parsed JSON typed as `unknown`. The downstream `onEvent` callback receives this and presumably routes it into the event bus. There is no `Schema.decodeUnknownEither(Event)` or any structural check.

**Why:** The SSE stream is fetched from an HTTP endpoint derived from `config.enterprise?.url` (or the default control plane). If the control plane returns a hostile `data:` payload (e.g. a `session.message` event with a `toolCall` block that injects arbitrary `command`), the event bus will dispatch it. The `as unknown` cast is just a type-level escape hatch; runtime trust is still zero.

**Fix:** Pipe the parsed object through `Schema.decodeUnknownEither(SyncEvent)` (the schema used in the existing dispatch), and replace the catch branch with a structured `WorkspaceEventParseError` that is logged + dropped, not silently forwarded as `sse.message`.

---

### 6. P2 — `baseUrl` falls back to `https://opncd.ai`; trust-boundary on `cfg.enterprise?.url`

**File:** `packages/opencode/src/share/share-next.ts:210`

**What:** The `request()` Effect returns `{ headers, api: legacyApi, baseUrl: (yield* cfg.get()).enterprise?.url ?? "https://opncd.ai" }`. All sync, create, and remove POSTs go to this baseUrl with full session content (messages, parts, session diffs) serialized in the body.

**Why:** If a config file in the user's project root sets `enterprise.url` to an attacker-controlled host (via a malicious repo clone, supply-chain attack on a shared config, or untrusted MCP result writing to the config), all session content — including any secrets pasted into the chat, code with credentials, file paths, and project metadata — is exfiltrated to that host. The hardcoded `opncd.ai` fallback is at least a known endpoint, but the config override removes that guarantee.

**Fix:** (a) Reject any `enterprise.url` that is not in a configured allowlist (`config.share.allowedHosts`); (b) warn the user (not just log) on first share to a non-default baseUrl; (c) consider requiring an explicit env var (`OPENCODE_ENTERPRISE_URL_OVERRIDE=YES`) to override the baseUrl.

---

### 7. P2 — JWT claims base64-decoded without signature verification

**File:** `packages/opencode/src/plugin/xai.ts:128` (in the `decodeJwt` / claim-extraction helper)

**What:** The xAI provider decodes JWT claims with `atob()` / base64-decode of the payload segment, parses JSON, and uses the claims (e.g. `email`, `sub`, `team_id`) for routing or display.

**Why:** Any attacker who can issue a JWT-like token (e.g. via a self-signed token in a custom auth flow) can inject arbitrary claims. There is no signature verification against xAI's published JWKS, no `alg` whitelist, and no `exp` check before use. The token is used as a bearer for the API, so the JWT itself is not the trust anchor — but the claim values feed into downstream decisions.

**Fix:** Verify the JWT signature against xAI's JWKS (or the configured `enterpriseUrl` JWKS), enforce `alg === "RS256"`, and check `exp`/`nbf`/`iss` before extracting claims. If the claims are purely informational, document that explicitly and gate on `info.alg`.

---

### 8. P2 — `stopOAuthServer` doesn't clear in-flight `waitForOAuthCallback` promise

**File:** `packages/opencode/src/plugin/openai/codex.ts:8449-8454, 8861-8865` (also xai block at L8618, digitalocean at L9038)

**What:** When a user starts a second OAuth flow or aborts the first, `stopOAuthServer()` only closes the HTTP server and nulls the global `oauthServer`. The `pendingOAuth` reference, its 5-minute `setTimeout`, and the resolve/reject closures remain live. In the xai variant, `waitForOAuthCallback` correctly rejects any prior `pendingOAuth` before installing a new one (L8461-8464) — but in the digitalocean and codex variants, no such guard exists. The callback for the new flow can therefore clobber `pendingOAuth` and the original promise will never resolve, hanging the caller's `await` until the 5-minute timeout fires.

**Why:** Each `waitForOAuthCallback` registers a 5-minute `setTimeout` whose only escape is the resolve/reject closures. If a second call replaces `pendingOAuth` without rejecting the first, the first caller's promise (and its 5-minute timer) leaks. Memory grows linearly with reauthorizations. In the worst case the user sees a 5-minute hang on a `cancel` action.

**Fix:** Mirror the xai pattern: at the top of `waitForOAuthCallback`, if `pendingOAuth` exists, call `pendingOAuth.reject(new Error("Superseded by a newer authorize request"))` and clear it, *then* install the new entry. Apply to both codex and digitalocean copies.

---

### 9. P2 — `JSON.parse(init.body)` / `JSON.parse(text)` without schema validation

**File:** `packages/opencode/src/plugin/github-copilot/copilot.ts:9161, 9918, 10166`

**What:** Three sites parse request/response bodies as JSON and immediately use the parsed object. L9161: `typeof init?.body === "string" ? JSON.parse(init.body) : init?.body` is used to detect vision/agent mode by inspecting `body.messages[*].content[*].type === "image_url"`. L9918 and L10166 parse HTTP response text into `unknown` and then cast.

**Why:** The `init.body` is the provider's own request body, so it's internally controlled — *except* when an upstream tool result (e.g. a user-injected message part, or a tool-call result carrying attacker JSON) flows into the request. L9161 then walks `body.messages` and reads `.type` from a `part: any` without checking. The `any` annotations are intentional but bypass type-checker defenses.

**Fix:** Replace the `any` annotations with `unknown` and use `Schema.decodeUnknownEither` for the message-part shape. If the message is not a valid content array, fall through to the "not vision, not agent" branch instead of throwing on `.some`/`.map`.

---

### 10. P3 — `path.join(dir, ...key) + ".json"` allows `..` traversal

**File:** `packages/opencode/src/storage/storage.ts:63`

**What:** The `file(dir, key)` helper computes `path.join(dir, ...key) + ".json"`. `path.join` does not normalize `..` segments, so `path.join("/data/storage", "..", "..", "etc", "passwd")` returns `/etc/passwd.json`. There is no `path.resolve`-then-containment check.

**Why:** In practice, the only callers are internal (session/message/part/diff keys), and the keys are server-generated IDs (see `id/id.ts`). The risk is therefore limited to a bug elsewhere passing a user-supplied key. Low severity.

**Fix:** Add a `path.relative(dir, path.join(dir, ...key))` check that rejects `..` prefixes, or migrate to `path.resolve(dir, ...key)` and assert containment.

---

### 11. P3 — OTEL env vars forwarded to subprocess adapter from `process.env`

**File:** `packages/opencode/src/control-plane/workspace.ts:549-551`

**What:** When creating a workspace adapter subprocess, the parent reads `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_ENDPOINT`, and `OTEL_RESOURCE_ATTRIBUTES` directly from `process.env` and passes them through to the child adapter.

**Why:** If any of these env vars is set to an attacker-controlled endpoint (e.g. via a malicious `.env` in the project, a CI injected env, or an attacker writing to `/proc/<pid>/environ`), the adapter's OpenTelemetry SDK will send traces/metrics/logs (and request headers, which often carry auth tokens) to that endpoint. The header is particularly sensitive because `OTEL_EXPORTER_OTLP_HEADERS` is `key=value,key2=value2` and is interpreted by the OTel SDK as actual HTTP headers to attach to export requests.

**Fix:** Read the OTEL env vars through `Config.String` (or a secrets-aware layer) so they are filtered/explicitly whitelisted. Consider stripping `OTEL_EXPORTER_OTLP_HEADERS` from the forwarded env unless the user has explicitly enabled telemetry forwarding.

---

### 12. P3 — `${ref}:${target}` interpolation into `git show` argv

**File:** `packages/opencode/src/git/index.ts:210`

**What:** `git show ${ref}:${target}` is built by template interpolation; the full command is then passed as an argv array (no shell), so there is no shell injection. The risk is `ref` starting with `-` (e.g. `--upload-pack=...`) being interpreted by `git` as an option rather than a positional argument.

**Why:** `git show` accepts a ref like `HEAD:src/file.ts`, and a malicious ref could be `--upload-pack=...` which would instruct `git` to use a different transport. With `argv` form, git's argv parser still interprets `-`-prefixed tokens as options. This is a known git argument-injection class.

**Fix:** Prepend `--` before positional args, or validate `ref` against a regex (e.g. `^[a-f0-9]{40}$` for full SHAs, or `^[A-Za-z0-9_/.-]+$` for branch/tag names).

---

### 13. P3 — `patchUntracked` against arbitrary user file path

**File:** `packages/opencode/src/git/index.ts` `patchUntracked` body

**What:** The function invokes `git diff --no-index --no-color <file> <devnull>` against a path that originates from upstream. If the path is a FIFO (named pipe) or a special device, `git diff` will block reading from it indefinitely.

**Why:** The `timeout` Effect on the surrounding call may or may not apply. A user-controlled path could point to a FIFO that the attacker holds open, causing the tool to hang until timeout. With a 5-30s timeout, this is a DoS vector.

**Fix:** Reject paths whose `lstat()` reports `S_ISFIFO`, `S_ISCHR`, `S_ISBLK`. Add a hard timeout (e.g. 5s) on the `git diff` invocation.

---

### 14. P3 — `mcpURL` from env without SSRF guard

**File:** `packages/opencode/src/pieces-ltm/service.ts` (and config in `pieces-ltm/config.ts`)

**What:** The Pieces LTM bridge connects to `mcpURL` (defaulting to `http://localhost:...`); the value can be overridden via env var or config. There is no SSRF protection beyond the localhost default — if the user overrides the URL to a non-localhost host, the bridge will connect to it.

**Why:** A misconfigured or malicious env var (`PIECES_LTM_MCP_URL=http://internal-vault:8200/...`) can route the LTM requests to an internal endpoint. Pieces LTM payloads are conversation/agent metadata, not credentials, so the blast radius is small, but the env var override is undocumented and not validated.

**Fix:** Validate `mcpURL` to be either `http://localhost:*`, `http://127.0.0.1:*`, or in an explicit allowlist. Reject `169.254.169.254`, RFC1918 ranges, and other metadata service IPs.

---

### 15. P3 — DigitalOcean OAuth implicit-token flow (localhost loopback server)

**File:** `packages/opencode/src/plugin/digitalocean.ts` (around L8787-8859 in the combined file)

**What:** The DigitalOcean plugin starts a localhost HTTP server on a fixed port, listens for a POST containing `access_token`, validates `state` (CSRF guard), and stores the access token in `auth.json`. The user copies the token from the DO dashboard and pastes it into a local HTML form that POSTs to the loopback.

**Why:** The token is typed in by the user into a local HTML page, then sent over the loopback. The state check is the only CSRF protection; there is no PKCE. If the user is socially engineered into completing the flow on a machine where another process can listen on the loopback port, that process can capture the token. (The port is hardcoded; if it's already bound by an attacker, the OAuth server fails to start.) Low risk in normal use.

**Fix:** Add PKCE (RFC 7636) to the implicit flow, or migrate to authorization-code-with-PKCE on the DO side. Bind the server to `127.0.0.1` (not `0.0.0.0`) to prevent LAN exposure.

---

### 16. P3 — `bytes[i] % 62` modulo bias in ID generation

**File:** `packages/opencode/src/id/id.ts`

**What:** The base-62 encoder uses `bytes[i] % 62` to map a random byte to a base-62 character. Because 256 % 62 = 8, the lower 8 characters (indices 0-7) are slightly more likely than the higher ones (indices 56-61).

**Why:** The bias is ~1.6% per character, negligible for a sessionID. No security impact unless the ID is used for an unguessable purpose (e.g. share-secret). Low risk.

**Fix:** Use rejection sampling (`while (b >= 248) b = randomByte(); return ALPHABET[b % 62];`) or switch to base-32 (which divides 256 evenly into 8 groups of 32).

---

### 17. P3 — `sessionID` from internal headers used as pool key

**File:** `packages/opencode/src/plugin/openai/ws-pool.ts`

**What:** The websocket pool keys connections by the `sessionID` extracted from request headers. Two different sessions can theoretically collide if headers are not canonicalized (e.g. case differences in `session-id`).

**Why:** This is a same-process internal API; the headers come from the bus, not from network input. The risk is operational (one session steals another's WS connection) rather than security. Low risk.

**Fix:** Normalize the header (lowercase) and use a hash of `(provider, sessionID, modelID)` for the pool key.

---

### 18. P3 — `Inbox.Service.send` is a no-op

**File:** `packages/opencode/src/inbox/index.ts` (`Service.send = Effect.sync(() => {})`)

**What:** The `send` method is implemented as `Effect.sync(() => {})` — it does nothing. If any downstream code (e.g. the actor/spawn.ts notification path) calls `Inbox.send` and expects persistence, the message is silently dropped.

**Why:** Currently safe because the only callers I've found are no-op-safe (rendering happens in-process). But the API contract is misleading: a method named `send` that discards its message. If a future change assumes the message is queued, persistence is silently lost. Low risk, code-quality issue.

**Fix:** Either (a) implement the queue as documented, or (b) delete the `send` method and inline the no-op at the call sites.

---

### 19. P3 — `ShareSchema.secret` field passed to legacy/console API headers

**File:** `packages/opencode/src/share/share-next.ts:35-43, 207-222`

**What:** The `ShareSchema` declares `id`, `url`, and `secret`. The `secret` is returned from the share-create call and presumably used as a bearer token. The `request()` Effect populates `headers` but I did not see the `secret` being injected into headers in the non-active-org path (L207-211). In the active-org path (L213-221), it uses `account.token` not the share secret.

**Why:** A mismatch between the schema and the request handler could mean the share secret is computed but never sent (no risk), or sent over the wire without TLS (high risk). The current code looks correct, but the `secret` field's lifecycle should be documented.

**Fix:** Add a comment or assert at the type level that `ShareSchema.secret` is only used as a URL fragment (not a header value) and is never sent to `baseUrl`.

---

### 20. P3 — Plugin spec loaded from `.well-known/` and per-provider config dirs

**File:** `packages/opencode/src/plugin/loader.ts`

**What:** Plugin spec is loaded from `.well-known/opencode/` and per-provider config dirs. A malicious actor with write access to the project root (e.g. via a copied template, or a shared project) can drop a plugin spec that runs arbitrary code at startup.

**Why:** This is a documented trust boundary (plugins run in the same Node process and have full user privileges). The risk is operational, not implementation. Low risk.

**Fix:** Document the trust boundary in the plugin loader header. Add a `--no-plugins` flag (or env var) to disable plugin loading entirely for high-assurance workflows. Print a warning listing each plugin that loads on startup.

---

## Not-Findings (verified-safe patterns)

These were investigated and **not** flagged:

- **`auth/index.ts:31-49` (key derivation)**: fails closed (throws) if `~/.config/dreamcode/auth.key` cannot be read or written. Good.
- **`auth/index.ts` mode 0o600 on writeJson**: correct.
- **`shell/shell.ts:108-117` (bash/zsh)**: `eval` of JSON-stringified args is safe — single-quote wrapping with explicit escape.
- **`shell/shell.ts` `fish`/`nu`**: explicitly `deny:true`.
- **`plugin/shared.ts` path containment (`Filesystem.contains(root, next)`)**: correct. Uses `path.relative` containment check.
- **`workflow/sandbox.ts` QuickJS**: well-isolated. `marshalIn`/`marshalOut` strip functions. `vm.alive` checked before each call. Promise rejection propagated correctly.
- **`format/formatter.ts` (`which` + `--write $FILE`)**: argv form, no shell. Safe.
- **`format/index.ts` `ChildProcess.make(replaced[0], replaced.slice(1), ...)`**: argv form, no shell. Safe.
- **`patch/index.ts` parsing/apply logic**: the code-edit application logic is correct; only the path resolution is missing containment.
- **`image/image.ts`**: validates `data:` prefix and `;base64,`; uses Photon WASM. Safe.
- **`id/id.ts` generation logic**: 32 random bytes, modulo bias is the only issue (P3).
- **`plugin/github-copilot/models.ts`**: `Schema.decodeUnknownSync` used throughout. Safe.
- **`event-v2-bridge.ts`**: type-narrowed bridge, no injection vector.
- **`background/job.ts`**: thin `Layer.effect` wrapper around core registry. Safe.
- **`temporary.ts`**: minimal yargs entry → TUI command. Safe.
- **`acp/service.ts` `prompt()`**: forwards to `sdk.session.prompt`; permission gate is `request()`. Safe.
- **`plugin/tui/runtime.ts`**: TUI plugin subprocess — uses argv form. Safe.
- **`plugin/xai.ts:8585` fetch wrapper**: only injects Authorization for `oauth` type; passes through other types unchanged. Safe.
- **`env/index.ts`**: in-memory copy of `process.env`; mutations are local to `InstanceState`. No leak to other processes.
- **`plugin/azure.ts`, `plugin/cloudflare.ts`**: minimal; only read env vars for prompts. Safe.
- **`plugin/hook-event.ts`**: pure event definitions. Safe.
- **`inbox/render.ts`**: rendering of inbox messages. No injection.
- **`sync/schema.ts`**: re-exports `EventID` branded type. Safe.
- **`storage/schema.ts`**: re-exports. Safe.
- **`control-plane/util.ts`, `control-plane/types.ts`**: utility types only. Safe.
- **`control-plane/dev/debug-workspace-plugin.ts`**: dev-only debug plugin; not loaded in production.

---

## Recommendations (priority-ordered)

1. **Fix patch path containment (P1 #2)** — highest priority; trivially exploitable via prompt injection.
2. **Sanitize pty-preparation input + PowerShell raw pass (P1 #1, #3)** — chain of two findings; fix together.
3. **Add schema validation to SSE `event.data` JSON.parse (P2 #5)** — closes a class of control-plane injection.
4. **Migrate auth decrypt to fail-loud (P2 #4)** — current silent fallback can propagate ciphertext to providers.
5. **Add PKCE/state-binding to all OAuth flows (P2 #7, #8, #15)** — consistent auth hardening.
6. **Lock down share baseUrl override (P2 #6)** — defense-in-depth against config tampering.
7. **Hardening (P3 batch)** — fix as cleanup, no urgent timeline.

---

*End of findings.*
