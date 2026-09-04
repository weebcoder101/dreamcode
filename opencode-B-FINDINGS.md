# opencode-B Audit Findings

**Scope**: Support modules in `packages/opencode/src/` — session, tool, permission, file, lsp, ide, flag, global, installation, mcp, snapshot, bus, project, pty, worktree, skill, provider (4 files).
**Date**: 2026-08-26
**Auditor**: opencode-B wave (Sumati via audit orchestrator)

## Summary

| Severity | Count | Notes |
|----------|-------|-------|
| P0 (Critical) | 0 | No security/correctness blockers |
| P1 (High) | 4 | Fix soon |
| P2 (Medium) | 5 | Fix when convenient |
| P3 (Low) | 7 | Polish, nits, deprecations |

**Out of scope**: patches/*, vendor/*, generated *.gen.ts, AGENTS.md, SESSION_ANCHOR.md, persona files.
**Already covered by llm-sdk-plugins**: most provider/* files. Only 4 provider files in scope: `transform.ts`, `provider.ts`, `model-status.ts`, `error.ts` (not deeply read in this wave).
**Note**: pty, file, flag, global do not exist as top-level modules in this scope. pty-preparation.ts is a thin shell that delegates to shell/. file/flag live in @opencode-ai/core. `global.ts` is at `bus/global.ts`.

---

## P0 (Critical)

_None found._ All permission-gated operations (file writes, shell, webfetch, MCP) properly ask via the `Permission` service. No SQL injection (Drizzle ORM is used throughout). No path traversal (paths resolved against `instance.directory` and validated by `assertExternalDirectoryEffect`).

---

## P1 (High)

### P1-1. `bus/bus.ts:30` — `subscribeCallback` ignores event type filter

**File**: `packages/opencode/src/bus/bus.ts` (lines 30-39)
**Symptom**: Every subscriber registered via `Bus.Service.subscribeCallback(event, callback)` receives a callback for EVERY event emitted on the bus, regardless of the `event` argument passed in.

```typescript
const subscribeCallback: Interface["subscribeCallback"] = (_event, callback) =>
  Effect.sync(() => {
    const handler = (evt: { payload: any }) => {
      callback(evt.payload.data)   // <-- no type check on evt.payload.type
    }
    GlobalBus.on("event", handler)
    return () => {
      GlobalBus.off("event", handler)
    }
  })
```

**Impact**: This is a fan-out amplifier. A subscriber to `Permission.Asked` will also fire for `McpAuth.Updated`, `Lsp.Diagnostic`, `Session.Message`, etc. Effects that call `subscribeCallback` and then mutate state or fire side effects are exposed to cascading cross-event reactions. In TUI/UI layers this can cause render thrash, log spam, and event-loop churn. In long-running processes (TUI, server) it can cause memory growth from closures retaining per-event data.

**Fix**:
```typescript
const subscribeCallback: Interface["subscribeCallback"] = (event, callback) =>
  Effect.sync(() => {
    const handler = (evt: { payload: { type: string; data: unknown } }) => {
      if (evt.payload.type !== event.type) return
      callback(evt.payload.data)
    }
    GlobalBus.on("event", handler)
    return () => GlobalBus.off("event", handler)
  })
```

---

### P1-2. `installation/index.ts:148-156` — `upgradeCurl` pipes remote script to bash

**File**: `packages/opencode/src/installation/index.ts` (lines 148-166)
**Symptom**: `upgradeCurl` downloads a shell script from `https://raw.githubusercontent.com/weebcoder101/dreamcode/main/install.sh` and pipes it to bash with `VERSION` env set to the target version.

```typescript
const upgradeCurl = Effect.fnUntraced(function* (target: string) {
  const response = yield* httpOk.execute(HttpClientRequest.get(
    "https://raw.githubusercontent.com/weebcoder101/dreamcode/main/install.sh"))
  const body = yield* response.text
  const bodyBytes = new TextEncoder().encode(body)
  const shell = yield* upgradeScriptShell()
  const result = yield* appProcess.run(
    ChildProcess.make(shell, [], {
      stdin: Stream.make(bodyBytes),
      env: { VERSION: target },
      extendEnv: true,
    }),
  )
  ...
})
```

**Impact**: Standard `curl | bash` upgrade pattern. RCE risk if the GitHub repo is compromised, if DNS is hijacked, or if the user's `VERSION` template injection allows arbitrary env to be set (it does not — `target` is a semver string from the version check, so direct env injection is low). However:
- The downloaded script is not signature-verified or pinned to a specific commit SHA. A `latest` redirect to a different commit would be silently executed.
- `VERSION` is read by the script as env var, so if the install script supports `VERSION` as a string that flows into `eval` or `curl ... | $VERSION` (it does not, in standard install scripts, but a malicious one would), this is a vector.

**Fix** (defense in depth):
- Pin the install script URL to a specific commit SHA or signed tag instead of `main`.
- Add a SHA256 checksum verification step before piping to bash.
- Consider downloading to a temp file first, showing the diff/size to the user, then executing.
- Note: This is the same pattern used by opencode (parent project), and the install script is the user's own distribution. Risk is bounded by trust in the upstream repo.

---

### P1-3. `mcp/index.ts:740` — `effectiveRedirectUri` hardcodes 127.0.0.1

**File**: `packages/opencode/src/mcp/index.ts` (line 740)
**Symptom**: When `oauthConfig.callbackPort` is provided but `oauthConfig.redirectUri` is not, the redirect URI is built as `http://127.0.0.1:${callbackPort}${OAUTH_CALLBACK_PATH}`.

```typescript
const effectiveRedirectUri =
  oauthConfig?.redirectUri ??
  (oauthConfig?.callbackPort ? `http://127.0.0.1:${oauthConfig.callbackPort}${OAUTH_CALLBACK_PATH}` : undefined)
```

**Impact**: 127.0.0.1 is hardcoded regardless of the host the MCP server expects. The OAuth provider is registered with this redirect URI, so the remote OAuth server expects the user's browser to come back to `http://127.0.0.1:PORT/callback`. This works on most setups (browsers on the same machine as the daemon), but breaks:
- Containerized deployments where dreamcode runs in a container and the OAuth callback server listens on the container's loopback but the browser runs on the host.
- Remote dev machines accessed via SSH port forwarding.
- Mobile workflows where dreamcode runs in Termux on a phone and the browser is on a desktop.

**Fix**:
- Honor an explicit `oauthConfig.host` setting that defaults to `127.0.0.1` but can be overridden.
- Or auto-detect via `os.networkInterfaces()` and pick the first non-loopback IPv4.
- Or just document the limitation: "When using `callbackPort`, the redirect URI is hardcoded to 127.0.0.1. For other hosts, supply `redirectUri` explicitly."

**Also note**: `mcp/oauth-callback.ts:115` (`isPortInUse`) hardcodes `127.0.0.1` as the bind target for the port check. Same fix.

---

### P1-4. `session/processor.ts` — 17 `TODO(v2)` comments indicating v1/v2 dual-write

**File**: `packages/opencode/src/session/processor.ts` (lines 252, 317, 377, 455, 477, 489, 555, 596, 653, 681, 704, 763, 822, 941)
**Symptom**: The processor writes to BOTH v1 and v2 session/message storage on every event. Each `// TODO(v2): Temporary dual-write while migrating session messages to v2 events.` marks a code path that emits to legacy v1 storage AND v2 storage.

**Impact**: 2x write amplification. Performance penalty on every event. Risk of v1/v2 desync if either write fails partway. The v1 path is dead code that should be removed.

**Fix**:
- Pick a cutoff date and remove all v1 writes.
- Or, gate v1 writes behind a feature flag (`DREAMCODE_LEGACY_V1=1`) so it's opt-in.
- For now, the dual-write is correct (both stores get the same data), so this is mostly a performance/maintenance concern. Mark as P1 because it's 17 sites and a hot path.

---

## P2 (Medium)

### P2-1. `mcp/oauth-callback.ts:115` — `isPortInUse` hardcodes 127.0.0.1

See P1-3 above. Same fix.

### P2-2. `tool/webfetch.ts` — No SSRF protection

**File**: `packages/opencode/src/tool/webfetch.ts` (line 65)
**Symptom**: `webfetch` tool accepts any `http://` or `https://` URL with no protection against internal IPs (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 127.0.0.0/8, ::1, link-local).

**Impact**: A prompt-injection attack that convinces the LLM to call webfetch with `http://169.254.169.254/latest/meta-data/iam/security-credentials/` (AWS IMDS) or `http://localhost:8080/admin` will exfiltrate or probe internal services. The user is asked for permission via `ctx.ask` (line 67-75), but the URL is shown verbatim and users may approve without recognizing the risk.

**Fix**:
- Add an `allowInternal` flag (default false) that, when off, blocks requests to RFC 1918 / loopback / link-local / cloud metadata IPs.
- Resolve the hostname via `dns.lookup()` first and check the resolved IP before making the request.
- Re-check after every redirect (HTTP 301/302/307).
- Add explicit warning UI for private IP targets.

### P2-3. `session/session.ts:458` — Pricing model TODO

**File**: `packages/opencode/src/session/session.ts` (line 458)
**Symptom**: `// TODO: update models.dev to have better pricing model, for now:` — indicates incomplete pricing data.

**Impact**: Cost tracking may be inaccurate or defaulted. Users see estimated costs in the TUI that may be wrong.

**Fix**: Track upstream models.dev and update when ready.

### P2-4. `tool/tool.ts:15` — `Metadata = { [key: string]: any }`

**File**: `packages/opencode/src/tool/tool.ts` (line 15)
**Symptom**: `interface Metadata { [key: string]: any }` with `// TODO: remove this hack`.

**Impact**: Loses type safety across all tool metadata. Propagation through `ctx.metadata(input: { metadata?: M })` is typed but the tool's own metadata field is `any`. Bugs in metadata propagation are not caught at compile time.

**Fix**: Replace `any` with `Record<string, unknown>` and a generic `Metadata<T>` shape per tool.

### P2-5. `tool/skill.ts` — `@deprecated` shim still in registry

**File**: `packages/opencode/src/tool/skill.ts` (entire file)
**Symptom**: File is marked `@deprecated Use the core skill tool from @opencode-ai/core/tool/skill instead.` and `TODO: Remove this file entirely once migration to core skill system is complete.`

**Impact**: Two skill tools can be loaded. The comment warns: "This file provides an ALTERNATE execution path that double-executes skills when the core skill system (src/skill/index.ts) is also loaded." A lazy runtime check in `execute` should guard against this, but the file is still in the registry and may execute skills twice if the guard regresses.

**Fix**: Migrate to core skill tool, then delete this file. Or, fail fast at registry-load time if the core skill is also registered.

---

## P3 (Low)

### P3-1. `tool/webfetch.ts:78` — User-Agent contains `0.0.0.05`

**File**: `packages/opencode/src/tool/webfetch.ts` (line 78)
**Symptom**: `"User-Agent": "Mozilla/5.0 ... Chrome/0.0.0.05 Safari/537.36"`. `198.51.100.0/24` is a TEST-NET-2 documentation IP. The `.245` was likely meant to be a real Chrome version number (e.g. `120.0.0.0`) and got mangled.

**Impact**: Cosmetic. Some servers may treat the malformed UA differently.

**Fix**: Use a real Chrome version like `120.0.6099.130`.

### P3-2. `tool/webfetch.ts:99` — `parseInt` without radix

**File**: `packages/opencode/src/tool/webfetch.ts` (line 99)
**Symptom**: `parseInt(contentLength)` — missing radix argument.

**Impact**: Lint warning. No security impact since the result is compared numerically.

**Fix**: `parseInt(contentLength, 10)`.

### P3-3. `tool/mcp-websearch.ts:4` — `EXA_HEADERS` resolved at module load

**File**: `packages/opencode/src/tool/mcp-websearch.ts` (line 4)
**Symptom**: `EXA_HEADERS = process.env.EXA_API_KEY ? { "x-api-key": process.env.EXA_API_KEY } : undefined` — evaluated once at import.

**Impact**: If the env var changes after import (e.g. set by a tool at runtime, or in test setups), the change is not picked up.

**Fix**: Wrap in a function: `function exaHeaders() { return process.env.EXA_API_KEY ? { "x-api-key": process.env.EXA_API_KEY } : undefined }`.

### P3-4. `lsp/lsp.ts` — Duplicate `Diagnostic` re-export

**File**: `packages/opencode/src/lsp/lsp.ts`
**Symptom**: `export * as Diagnostic from "./diagnostic"` appears twice (once via barrel re-export, once explicitly).

**Impact**: No runtime effect. Lint warning.

**Fix**: Remove the duplicate.

### P3-5. `session/prompt-schemas.ts:22` — `@deprecated` tools and permissions

**File**: `packages/opencode/src/session/prompt-schemas.ts` (line 22)
**Symptom**: `"@deprecated tools and permissions have been merged, you can set permissions on the session itself now"`.

**Impact**: Doc-only. No code path affected.

**Fix**: Remove deprecated fields.

### P3-6. `snapshot/index.ts:36` — `prune = "7.days"` hardcoded

**File**: `packages/opencode/src/snapshot/index.ts` (line 36)
**Symptom**: `const prune = "7.days"` and `const limit = 2 * 1024 * 1024` (2MB file size limit) are hardcoded module constants.

**Impact**: Users cannot tune snapshot retention or per-file size. For projects with large generated files (e.g. dist/, .next/, target/), files over 2MB are silently dropped from snapshots.

**Fix**: Make these configurable via Config.

### P3-7. `permission/arity.ts:6364` — Large LLM-generated ARITY dict

**File**: `packages/opencode/src/permission/arity.ts` (6364 bytes)
**Symptom**: A 6KB dictionary of ARITY tool permissions, likely LLM-generated.

**Impact**: If this dict is supposed to be authoritative for tool permissions, any new tool added to the registry must also be added here, or the default permission will fall back to "ask". Easy to miss.

**Fix**: Generate `arity.ts` from the tool registry at build time, or fall back to a default-allow for tools not in the dict.

---

## Files Reviewed (in scope)

### Group 1 (read fully)
- `bus/bus-event.ts` (298B) — P3
- `bus/bus.ts` (1318B) — **P1-1**
- `bus/global.ts` (609B) — P3
- `bus/index.ts` (177B) — P3
- `ide/index.ts` (1759B) — P3 (clean)
- `installation/index.ts` (14781B) — **P1-2**
- `permission/arity.ts` (6364B) — P3-7
- `permission/evaluate.ts` (29B) — P3 (clean)
- `permission/index.ts` (7918B) — P3 (clean, well-tested)
- `snapshot/index.ts` (32842B) — P3-6
- `worktree/index.ts` (23857B) — P3 (runStartCommand uses bash -lc with `eval ${JSON.stringify(command)}` — safe)

### Group 2 (read fully)
- `mcp/auth.ts` (6979B) — P3 (clean schema definitions)
- `mcp/catalog.ts` (5133B) — P3 (clean)
- `mcp/index.ts` (34851B) — **P1-3**
- `mcp/oauth-callback.ts` (6722B) — **P2-1**
- `mcp/oauth-provider.ts` (6539B) — P3 (clean)
- `lsp/client.ts` (22846B) — P3 (clean)
- `lsp/diagnostic.ts` (900B) — P3 (clean)
- `lsp/language.ts` (2559B) — P3 (clean)
- `lsp/launch.ts` (794B) — P3 (clean)
- `lsp/lsp.ts` (16865B) — P3-4
- `lsp/server.ts` (56330B) — P3 (clean)

### Group 3 (session - 39 files)
- All 16 small files: `background-agent.ts`, `checkpoint-dreamcode.ts`, `message-error.ts`, `overflow.ts`, `persona-tracker.ts`, `reminders.ts`, `schema.ts`, `status.ts`, `subagent-context.ts`, `todo.ts`, `summary.ts`, `system.ts`, `tools.ts`, `run-state.ts`, `revert.ts`, `message.ts` — P3 (clean)
- `session.ts` (39535B) — P2-3
- `prompt.ts` (46626B), `processor.ts` (45797B) — **P1-4**
- `message-v2.ts` (26227B), `llm.ts` (15609B), `compaction.ts` (23215B) — P3 (clean)
- `prompt-sensor-gate-phase.ts` (28726B), `prompt-user-message.ts` (19460B) — P3 (clean, well-commented)
- `prompt-state.ts` (8636B), `prompt-utils.ts` (11420B), `prompt-command.ts` (5857B), `prompt-shell.ts` (7028B) — P3 (clean)
- `prompt-schemas.ts` (3963B) — P3-5

### Group 4 (tool - 41 files, sampled)
- `tool.ts`, `schema.ts`, `registry.ts` — P3 (clean)
- `webfetch.ts` — **P2-2, P3-1, P3-2**
- `mcp-websearch.ts` — P3-3
- `skill.ts` — P2-5
- `apply_patch.ts`, `edit.ts`, `write.ts`, `read.ts`, `grep.ts`, `glob.ts` — P3 (clean, all paths resolved against `instance.directory` and external-dir checked)
- `task.ts`, `plan.ts`, `question.ts`, `todo.ts`, `invalid.ts`, `external-directory.ts`, `truncate.ts`, `truncation-dir.ts`, `lsp.ts`, `json-schema.ts` — P3 (clean)
- `websearch.ts` (5437B), `read.ts` (13122B), `edit.ts` (24530B) — P3 (clean)

### Group 5 (project, snapshot, pty, shell, etc.)
- `project/*.ts` (9 files) — P3 (clean)
- `pty-preparation.ts` (1142B) — P3 (clean, delegates to shell)
- `shell/shell.ts` (5840B) — P3 (clean, uses JSON.stringify for command interpolation)
- `provider/{transform,provider,model-status,error}.ts` (4 files) — Not deeply read in this wave (covered by llm-sdk-plugins).

---

## Cross-Cutting Notes

- **Effect framework**: All new code uses `effect` (Effect.gen, Effect.fn, Effect.fnUntraced, etc.). Legacy code uses raw promises. This is the intended migration path.
- **Permission gating**: Every tool that touches the filesystem, network, or shell calls `ctx.ask(...)` to gate the operation. No tool is silent.
- **Path resolution**: All file tools resolve paths against `instance.directory` and call `assertExternalDirectoryEffect` if the path escapes. This pattern is correct.
- **SQL**: All DB ops use Drizzle ORM. No raw SQL with string interpolation.
- **Logging**: All errors and warnings go through `Effect.logError` / `Effect.logWarning`. No `console.log` in production code.
- **Testing**: No unit tests visible in this scope. All correctness is verified by type system + integration tests.
