# opencode-A Fixes

Per-finding patch plans. Each P0/P1 entry has a concrete edit, with risk and verification step.

---

## P1-1 — `util/archive.ts`: PowerShell single-quote injection

**File:** `packages/opencode/src/util/archive.ts`

**Issue:** Windows code path interpolates `zipPath`/`destDir` into a PowerShell single-quoted string. A crafted zip filename containing a single quote (e.g. `evil' ; calc ; .zip`) escapes the single quotes and runs arbitrary PowerShell as the user.

**Fix:**

Replace the single-quoted PowerShell `Command` with a here-string that quotes paths with `[Management.Automation.Language.CodeGeneration]::EscapeSingleQuotedStringContent`, or — preferred — drop the `-Command` string entirely and invoke `Expand-Archive` from a temp `.ps1` file with `powershell -File`.

```ts
// Recommended: use -File with a temp .ps1 that builds the args safely
async function expandWindows(zipPath: string, destDir: string) {
  const zipAbs = path.resolve(zipPath)
  const destAbs = path.resolve(destDir)
  const ps = `Expand-Archive -Path ${quotePS(zipAbs)} -DestinationPath ${quotePS(destAbs)} -Force`
  const script = path.join(os.tmpdir(), `expand-${Date.now()}.ps1`)
  await fs.promises.writeFile(script, `$global:ProgressPreference = 'SilentlyContinue'\r\n${ps}\r\n`, "utf8")
  try {
    await Process.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script])
  } finally {
    await fs.promises.unlink(script).catch(() => undefined)
  }
}
function quotePS(s: string) {
  // PowerShell single-quoted literal: ' becomes ''
  return `'${s.replaceAll("'", "''")}'`
}
```

**Risk:** Low — the function is only called from `Archive.extractZip`. `Archive` is not imported inside `opencode/src` (only in `lsp/server.ts`, `public.ts`, `handlers/...`, `task/registry.ts`, `session/session.ts` — none call `Archive.extractZip` directly).

**Verification:** Run `grep -rn 'Archive.extractZip\|Archive\.extract' packages/opencode/src` to confirm no in-tree caller (lowest-risk deploy). Add a unit test: `extractZip('C:\\evil\'\\;calc;.zip', tmpDir)` does not execute `calc`.

---

## P1-2 — `cli/cmd/pr.ts`: symlinked cwd to self-spawn

**File:** `packages/opencode/src/cli/cmd/pr.ts`

**Issue:** `Process.spawn(["dreamcode", ...opencodeArgs], { cwd: p })` where `p` is a directory the user supplied. A symlink at `p` could point anywhere. Spawned `dreamcode` then loads configs (`.opencode/`, `opencode.json`) from the symlinked dir, executes hooks, runs hooks via `Process.spawn` of additional binaries, and inherits the full parent env.

**Fix:**

1. Resolve `p` with `fs.realpath` and reject if it's not inside the original repo working tree:
2. Pass a minimal env (only `PATH`, `HOME`, `LANG`, `TMPDIR`).

```ts
const realRoot = await fs.promises.realpath(p)
// optionally: assert realRoot.startsWith(originalRepoRoot)
const proc = Process.spawn(["dreamcode", ...opencodeArgs], {
  stdin: "inherit", stdout: "inherit", stderr: "inherit",
  cwd: realRoot,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG, TMPDIR: process.env.TMPDIR },
})
```

**Risk:** Low. The spawn is the user invoking their own `dreamcode` binary from their own shell — the only realistic attacker is a malicious `p` in argv, which the user typed. realpath + cwd pin is defense-in-depth.

**Verification:** `dreamcode pr --help` smoke test; run `pr` flow against a symlink and confirm realpath substitution.

---

## P1-3 — `cli/cmd/db.ts`: spawn without env isolation

**File:** `packages/opencode/src/cli/cmd/db.ts`

**Issue:** `spawn("sqlite3", [Database.path()])` inherits full env. While `Database.path()` is fixed, an attacker who controls `PATH` (via env injection earlier) can substitute a fake `sqlite3` binary.

**Fix:**

Use `Process.spawn` (which is the project's wrapper) and pass a minimal env, plus the absolute path to `sqlite3` if available (e.g. resolve via `which` at startup).

```ts
import { Process } from "@/util/process"
const sqlite3 = (await Process.text(["which", "sqlite3"])).text.trim() || "sqlite3"
const child = Process.spawn([sqlite3, Database.path()], {
  env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG },
})
```

**Risk:** Low. `Database.path()` is computed from `Global.Path.data` which is a fixed user-data dir.

**Verification:** Run `dreamcode db` interactively; confirm the spawn still works after env narrowing.

---

## P1-4 — `cli/cmd/providers.ts`: wellknown-auth command exec

**File:** `packages/opencode/src/cli/cmd/providers.ts`

**Issue:** `dreamcode providers login --url <URL>` fetches `${url}/.well-known/dreamcode` and runs `wellknown.auth.command`. If the user is phished into pasting an attacker URL, attacker can run arbitrary commands with the user's env.

**Fix:**

1. Restrict the URL scheme to `https://` only (reject `http://`, `file://`, custom schemes).
2. Print a confirmation prompt listing the exact command before spawn.
3. Spawn with a minimal env (no API keys, no shell secrets).

```ts
const parsed = new URL(url)
if (parsed.protocol !== "https:") return yield* fail(`Only https URLs are allowed: ${parsed}`)
const wellknown = yield* cliTry(`Failed to load auth provider metadata from ${url}: `, () =>
  fetch(parsed.toString() + "/.well-known/dreamcode").then((x) => x.json()),
)
// ... after parsing:
yield* Prompt.log.info(`Running: \`${wellknown.auth.command.join(" ")}\``)
if (!(yield* Prompt.confirm({ message: "Proceed?" }))) return yield* Prompt.log.warn("Cancelled")
const proc = Process.spawn(wellknown.auth.command, {
  stdout: "pipe", stderr: "inherit",
  env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG },
  abort: abort.signal,
})
```

**Risk:** Medium — interactive flow; adding a confirm prompt is a UX change. Consider making confirm optional behind a flag for CI/automation.

**Verification:** `dreamcode providers login --url http://attacker.example` should be rejected; `https://...` should print command and prompt.

---

## P1-5 — `server/.../handlers/session.ts`: parsePromptPayload silent provider fallback

**File:** `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`

**Issue:** `parsePromptPayload` defaults `model.providerID = "openai"` when missing. Client that forgets the field silently hits a wrong provider instead of getting 400.

**Fix:** Return `BadRequest` when `model` is set but lacks `providerID`. Don't coerce.

```ts
if (obj.model !== null && typeof obj.model === "object" && !Array.isArray(obj.model)) {
  const m = obj.model as Record<string, unknown>
  if (typeof m.modelID === "string" || typeof m.id === "string") {
    if (typeof m.providerID !== "string") {
      return yield* new HttpApiError.BadRequest({ message: "model.providerID is required" })
    }
    payload.model = m
    if (!m.modelID && m.id) m.modelID = m.id
  }
}
```

**Risk:** Low. The coercion is undocumented; clients that rely on the fallback are buggy. Most schemas already require `providerID`.

**Verification:** `curl -X POST .../session/<id>/prompt -d '{"model":{"id":"gpt-4"}}'` returns 400; with `providerID` set it works.

---

## P1-6 — `server/.../handlers/experimental.ts`: providerConfig writes unvalidated baseURL

**File:** `packages/opencode/src/server/routes/instance/httpapi/handlers/experimental.ts`

**Issue:** `providerConfig` writes `existing.provider[providerID] = { name, npm: "@ai-sdk/openai-compatible", api: baseURL }` to `~/.config/dreamcode/config.json` with no scheme/host validation. If the API endpoint is exposed without auth, any caller can point the user's `openai-compatible` provider at a hostile URL. Worse: `api` is used for outbound HTTP — credential exfiltration is possible.

**Fix:**

1. Validate `baseURL` is a well-formed `https://` or `http://localhost` URL.
2. Mark the route as experimental and require an `X-Experimental-Ack: 1` header.
3. Confirm via existing `ExperimentalHttpApi.tool` / console flow that baseURL changes are not bypassed; if they are, gate behind a runtime flag.

```ts
let parsed: URL
try { parsed = new URL(ctx.payload.baseURL) }
  catch { return yield* new HttpApiError.BadRequest({ message: "baseURL must be a valid URL" }) }
if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && parsed.hostname === "localhost")) {
  return yield* new HttpApiError.BadRequest({ message: "baseURL must be https or http://localhost" })
}
if (ctx.request.headers["x-experimental-ack"] !== "1") {
  return yield* new HttpApiError.BadRequest({ message: "missing X-Experimental-Ack header" })
}
```

**Risk:** Low. The endpoint is gated by the standard `Authorization` middleware so it requires Basic auth when `OPENCODE_SERVER_PASSWORD` is set; if password is not set, the server is open, and this endpoint becomes a global-config takeover. The validation should still be added regardless.

**Verification:** `curl -X POST .../experimental/providerConfig -d '{"providerID":"x","baseURL":"javascript:alert(1)"}'` → 400. With valid https URL → 200.

---

## P1-7 — `server/.../handlers/pty.ts`: PTY connect path lacks auth gating

**File:** `packages/opencode/src/server/routes/instance/httpapi/handlers/pty.ts` (and the corresponding middleware in `middleware/authorization.ts`).

**Issue:** `ptyConnect` upgrades to WebSocket when a ticket is present, but when the ticket is *absent* it falls through and still upgrades. The auth middleware exempts the path when `hasPtyConnectTicketURL(url)` is true (any URL on `/pty/{id}/connect` regardless of ticket presence). Result: a request to `/pty/{any-ptyID}/connect` without a `?ticket=` is unauthenticated.

**Fix:**

1. Treat absent ticket as `403` in the handler.
2. In the middleware, only skip Basic Auth when the URL actually contains a `?ticket=` query string.

```ts
// handler:
const ticket = new URL(ctx.request.url, "http://localhost").searchParams.get(PTY_CONNECT_TICKET_QUERY)
if (!ticket) return HttpServerResponse.empty({ status: 403 })
const valid = validOrigin(ctx.request, cors)
  ? yield* dieSyncError(tickets.consume({ ticket, ptyID: ctx.params.ptyID, ...(yield* ticketScope) }))
  : false
if (!valid) return HttpServerResponse.empty({ status: 403 })

// middleware/authorization.ts (PtyConnectAuthorization):
function hasPtyConnectTicketURL(url: string) {
  return PTY_CONNECT_PATH.test(url) && new URL(url, "http://localhost").searchParams.has(PTY_CONNECT_TICKET_QUERY)
}
```

**Risk:** Low. The intended flow is: client calls `/pty/{id}/connect-token` (auth required, returns a ticket) then opens WebSocket with `?ticket=...`. Any deviation is unintended. Adding a 403 on missing ticket is the correct behavior.

**Verification:** `curl -i .../pty/abc/connect` (no ticket) → 403. With valid ticket → 101 upgrade. Origin check still applies inside the `if (ticket)` branch.

---

## P2 — Selected fixes

**P2-1 — `server/cors.ts` hardcoded test IP**
The `http://127.0.0.1:*` literal in `isAllowedCorsOrigin` should be moved to a `CORS_ALLOWED_TEST_HOSTS` env (default empty) so production builds don't ship with a fixed test address.

**P2-2 — `server/routes/instance/httpapi/middleware/workspace-routing.ts`**
Falls back to `process.cwd()` when `x-opencode-directory` is missing. Add an explicit `WorkspaceRoutingDefault` config so deployments can disable the cwd fallback. Also log which directory was selected (currently silent).

**P2-3 — `config/managed.ts` macOS plist read**
Reads `/Library/Managed Preferences/{user}/ai.dreamcode.managed.plist`. If the plist is owned by a non-admin user or has been tampered with, `plutil` may produce unexpected output. The function already strips `PLIST_META` keys; consider validating against the schema before returning.

**P2-4 — `server/mdns.ts` silent error swallowing**
`service.on("error", () => {})` and `catch { ... }` swallow Bonjour errors. At minimum, log to the standard logger so MDNS failures are visible in `dreamcode serve` output.

**P2-5 — `server/.../handlers/sync.ts` typed-as-any**
`(handlers as any).handle(...)` chain in sync handler — type the handler group properly to make the `Steal` and `History` payloads actually validated against the schema in `groups/sync.ts`.

**P2-6 — `server/.../handlers/tui.ts` weak checks**
`if (!ctx.payload.sessionID.startsWith("ses"))` — replace with `Schema.is(SessionID)(ctx.payload.sessionID)` check; same for command aliases.

**P2-7 — `server/.../handlers/global.ts` upgrade**
`upgrade` runs `Installation.method()` blindly. Add a confirmation step or signed-target verification (e.g. compare against `installation.latest()` in a separate endpoint).

**P2-8 — `server/.../handlers/project-copy.ts` LLM slug from context**
`generateName` uses client-supplied `context` as a prompt fragment. Validate length and strip control characters before injecting into the LLM call.

**P2-9 — `cli/cmd/session.ts` pager**
Spawns `Process.spawn(pagerCmd())` to display session output. `pagerCmd` reads from `PAGER` env; consider allowlisting `less`/`more` and rejecting arbitrary binaries.

**P2-10 — `util/lock.ts` unbounded map**
`locks: Map<string, Promise<void>>` grows by key and only shrinks on dispose. Add an LRU cap or per-key TTL to prevent memory growth if a `Disposable` is never invoked.

**P2-11 — `server/shared/ui.ts` upstream proxy**
Proxies to `https://app.dreamcode.ai`. Strip additional hop-by-hop headers (`connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `transfer-encoding`, `upgrade`) per RFC 7230 §6.1. Currently only strips `content-encoding`/`content-length`.

**P2-12 — `server/.../middleware/authorization.ts` rationale**
Custom Basic Auth (not HttpApiSecurity) is intentional to avoid remapping NotFound→Unauthorized. Document this design decision in a module-level comment so future maintainers don't re-introduce Effect's security middleware.

**P2-13 — `util/proxy-env.ts` NO_PROXY bypass**
Adapted from `proxy-from-env` (MIT). Simple prefix matching may have edge cases (e.g. `NO_PROXY=example.com` matches `attacker-example.com`). Document the limitations in the header comment.

**P2-14 — `server/.../handlers/control.ts` auth set/remove**
Stores credentials in `Auth.Service` (which writes to the global config). No rate-limiting on `/auth/set`; consider a per-IP rate limit.

**P2-15 — `util/wildcard.ts`**
Wildcard matcher can mask path-like inputs in error messages. Add a strict mode that requires escaped slashes in path patterns.

**P2-16 — `config/vscode.ts`**
Reads VS Code config dirs from env. No path traversal; add a check that env-supplied dirs resolve under `~/.vscode/` or `~/.config/Code/`.

**P2-17 — `config/managed.ts`**
Same as P2-3; the function is exported and called from the loader. If `parseManagedPlist` JSON.parse throws on malformed input, the catch returns silently — propagate the error so the caller knows MDM config was unreadable.

---
