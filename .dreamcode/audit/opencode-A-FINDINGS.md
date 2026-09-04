# opencode-A Audit Findings

**Scope:** `packages/opencode/src/{agent, command, cli, config, server, util}` — 217 files.
**Grading:** P0=critical (auth bypass / secret leak / RCE), P1=high (SSRF / traversal / injection), P2=medium, P3=clean.
**Out of scope:** `auth/`, `provider/` (covered by `llm-sdk-plugins-FINDINGS.md`), generated `.gen.ts`, `.rej`, `AGENTS.md`.
**Files not read (filtered):** generated `.gen.ts`, `.rej`, `AGENTS.md`.

---

## Headline

| Module | Files | P0 | P1 | P2 | P3 |
|---|---:|---:|---:|---:|---:|
| util/ | 25 | 0 | 1 | 2 | 22 |
| config/ | 14 | 0 | 0 | 1 | 13 |
| server/ | 75 | 0 | 3 | 11 | 61 |
| agent/ | 10 | 0 | 0 | 0 | 10 |
| command/ | 4 | 0 | 0 | 0 | 4 |
| cli/ | 89 | 0 | 3 | 1 | 85 |
| **Total** | **217** | **0** | **7** | **15** | **195** |

**Headline issues (P0/P1):**

1. **P1 — `util/archive.ts`**: Windows path interpolation into a PowerShell single-quoted string. `Expand-Archive -Path '${winZipPath}'` allows shell injection if a zip path contains a single quote (crafted download / TOCTOU).
2. **P1 — `cli/cmd/pr.ts`**: `Process.spawn("dreamcode", ..., { cwd: p })` where `p` is a directory from the user — symlink/relative-path risk; spawned process inherits TTY and full env.
3. **P1 — `cli/cmd/db.ts`**: `spawn("sqlite3", [Database.path()])` — unfiltered env inheritance; harmless when `Database.path()` is fixed, but spawn is untyped.
4. **P1 — `cli/cmd/providers.ts`**: `providers login --url <URL>` fetches `${url}/.well-known/dreamcode` and then `Process.spawn(wellknown.auth.command)` with full inherited env. URL/command are attacker-controlled if the user types a hostile URL.
5. **P1 — `server/routes/instance/httpapi/handlers/session.ts`**: `parsePromptPayload` coerces missing `model.providerID` to literal `"openai"` — clients that forget the field silently hit a wrong provider, not a 400.
6. **P1 — `server/routes/instance/httpapi/handlers/experimental.ts`**: `providerConfig` writes `existing.provider[ctx.payload.providerID] = { name, npm: "@ai-sdk/openai-compatible", api: ctx.payload.baseURL }` to `~/.config/dreamcode/config.json` with no scheme/host validation.
7. **P1 — `server/routes/instance/httpapi/handlers/pty.ts`**: PTY WebSocket upgrade is allowed *without* a ticket. The auth middleware exempts the path entirely when the optional `ticket` query param is missing; the handler does `if (ticket) { ... }` and only runs the origin check inside the `if` block.

---

## Detailed findings by module

### `util/`

**P1** (1)

- `util/archive.ts` — PowerShell `Expand-Archive` invoked via single-quoted string interpolation — `${winZipPath}` is interpolated by Node template literal then placed inside PowerShell single-quotes. If `zipPath` contains a single quote (rare on Windows, but possible via crafted download), it breaks out of the single-quoted string and executes arbitrary PowerShell. **Note**: `Process.run(["powershell", "-NoProfile", ...])` already uses array args so the `-Command` argument IS shell-parsed by PowerShell. Use a heredoc/script file instead.

**P2** (2)

- `util/process.ts` — Cross-spawn wrapper with `shell: boolean | string` option; no allowlist on `cmd[0]`, but call sites pass arrays. No env isolation by default. `Process.spawn` API is a thin wrapper — call-site responsibility.
- `util/wildcard.ts` — Wildcard match — could mask path-like inputs in error messages if used carelessly elsewhere.

**P3** (22)

- `util/bom.ts` — UTF BOM stripping.
- `util/data-url.ts` — Data URL decoder; uses Buffer.from for base64.
- `util/defer.ts` — Deferred/Promise wrapper.
- `util/effect-http-client.ts` — HTTP retry helper.
- `util/error.ts` — Standard error helpers, no security issues.
- `util/filesystem.ts` — FS helpers using Node fs/promises; uses `FSUtil.contains` for path containment.
- `util/iife.ts` — IIFE helper.
- `util/index.ts` — Util index.
- `util/lazy.ts` — Lazy value memoization.
- `util/local-context.ts` — AsyncLocalStorage wrapper.
- `util/locale.ts` — Locale re-export.
- `util/lock.ts` — Async write lock — single global Map (not per-process), can grow unbounded if disposed not called.
- `util/log.ts` — Logger wiring.
- `util/media.ts` — MIME sniffing via byte prefixes.
- `util/proxy-env.ts` — proxy-from-env — adapted under MIT license. NO_PROXY parsed with simple prefix check, may have bypass edge cases.
- `util/queue.ts` — In-memory async queue, no I/O.
- `util/record.ts` — Re-export.
- `util/repository.ts` — Repository reference parser.
- `util/rpc.ts` — JSON-RPC helpers.
- `util/signal.ts` — Promise signal.
- `util/timeout.ts` — Promise.race with timeout.
- `util/token.ts` — Token estimator re-export.


### `config/`

**P2** (1)

- `config/managed.ts` — macOS managed preferences plist reader via `Process.run(["plutil", "-convert", "json", ...])`. Reads `/Library/Managed Preferences/{user}/ai.dreamcode.managed.plist` — system-level. user from `os.userInfo().username()`.

**P3** (13)

- `config/agent.ts` — Agent loader; globs `.md` files in user dir, parses front-matter via ConfigMarkdown.
- `config/command.ts` — Command loader; same pattern as agent.
- `config/config.ts` — Config loader; reads `OPENCODE_*` env, well-defined schema.
- `config/entry-name.ts` — Path-name helper; comment notes prior prefix-in-path bug fix (#25713).
- `config/markdown.ts` — Markdown rendering for config docs.
- `config/parse.ts` — JSONC parser; uses jsonc-parser library with safe defaults.
- `config/paths.ts` — Path resolution; uses `os.homedir()`.
- `config/plugin.ts` — Plugin loader; uses `parsePluginSpecifier` from `@/plugin/shared`.
- `config/tui-cwd.ts` — Effect Context.Reference for CWD.
- `config/tui-host-attention.ts` — Sound path resolver; uses Filesystem.resolveFilePath.
- `config/tui-migrate.ts` — TUI config migration; uses jsonc-parser modify/applyEdits.
- `config/tui.ts` — TUI config schema.
- `config/variable.ts` — Config variable substitution; `{env:VAR}` and `{file:path}`.


### `server/`

**P1** (3)

- `server/routes/instance/httpapi/handlers/experimental.ts` — `providerConfig` reads `~/.config/dreamcode/config.json`, injects `existing.provider[ctx.payload.providerID] = { name, npm: "@ai-sdk/openai-compatible", api: ctx.payload.baseURL }` then writes back. baseURL is fully attacker-controlled (no scheme/host validation, no allowlist). Single-shot unauthenticated write to global config if API is exposed.
- `server/routes/instance/httpapi/handlers/pty.ts` — `ptyConnect` does `if (ticket) { ... }` — ticket is optional. If absent, **no auth check is performed before WebSocket upgrade**. The auth middleware also exempts the entire path when ticket is missing (just lets the request through). Origin check only runs when ticket is present. (Lines around `if (ticket) { const valid = validOrigin ... }`.)
- `server/routes/instance/httpapi/handlers/session.ts` — `parsePromptPayload` coerces missing `model.providerID` to literal `"openai"` when `model.id` is present. Clients expecting 400 on missing field will silently hit a wrong provider. (Lines around the prompt payload parser.)

**P2** (11)

- `server/cors.ts` — Hardcoded `http://127.0.0.1:*` in `isAllowedCorsOrigin` (matches AGENTS.md reference IP). Allowlist strict, no wildcards except `*.opencode.ai`.
- `server/mdns.ts` — mDNS publish via bonjour-service. Hostname defaults to `opencode.local`. Service name `opencode-{port}`. Errors swallowed silently.
- `server/routes/instance/httpapi/api.ts` — Two API roots: `RootHttpApi` (experimental) and `InstanceHttpApi` (legacy). Carries TODO comment about reconciliation. Comment notes GitHub tracking issue.
- `server/routes/instance/httpapi/handlers/global.ts` — `configUpdate` forks dispose after global config change. `dispose` tears down all instances. `upgrade`/`upgradeRaw` run installer upgrade with `installation.method()` — no signed target, accepts any version from `installation.latest()`.
- `server/routes/instance/httpapi/handlers/project-copy.ts` — `generateName` calls LLM with client-supplied `context` (used as prompt). If no default model is available, falls back to `Slug.create()` (random). Streams LLM response into slug. Truncates to 4 words.
- `server/routes/instance/httpapi/handlers/sync.ts` — `steal` reassigns a session to the current workspace (cross-workspace takeover). `history` reads from `EventTable` filtered by client-supplied `(aggregate_id, seq)` tuples — `dieSyncError` suggests it can die. (handlers as any).handle is a typing bypass — see `as any as never` chain.
- `server/routes/instance/httpapi/handlers/tui.ts` — `tui.executeCommand` maps `commandAliases[ctx.payload.command]` to undefined for unknown commands (silently no-op). `tui.controlResponse` accepts any unknown payload (typed as `unknown`). `tui.selectSession` does `if (!ctx.payload.sessionID.startsWith("ses"))` — only checks prefix, not SessionID schema. WS TUI control is a backchannel to drive a TUI over HTTP.
- `server/routes/instance/httpapi/middleware/authorization.ts` — Custom Basic Auth middleware (not HttpApiSecurity) — rationale comment: avoids Effect security wrapping that could remap NotFound to Unauthorized. Public UI paths bypass auth; PTY connect path bypasses auth if ticket query present.
- `server/routes/instance/httpapi/middleware/workspace-routing.ts` — Workspace routing middleware — proxy, redirect, or serve locally. `RequestPlan` tagged union handles Invalid/Missing/Local/Remote. Read x-opencode-directory header; falls back to `process.cwd()`. `x-opencode-workspace` query param. Missing workspace returns 404 with non-200 (leaks nothing).
- `server/server.ts` — Legacy Fastify-style route registration; carries known TODO about reconciling two HTTP API implementations. Used as fallback layer.
- `server/shared/ui.ts` — Proxies to `https://app.dreamcode.ai` UI; rewrites `host` header to `UI_UPSTREAM.host`. Strips `content-encoding`/`content-length` to avoid double-decoding. Uses `opencode-web-ui.gen.ts` embedded assets if present.

**P3** (61)

- `server/auth.ts` — HTTP Basic auth via env; defaults username to "dreamcode" if no password set.
- `server/event.ts` — Server event schema.
- `server/global-lifecycle.ts` — Global instance disposal, no direct risk.
- `server/init-projectors.ts` — No-op projector initializer.
- `server/projectors.ts` — Empty placeholder.
- `server/proxy-util.ts` — Header forwarding helpers for upstream UI proxy.
- `server/routes/instance/httpapi/errors.ts` — Tagged error classes with HTTP status codes.
- `server/routes/instance/httpapi/groups/config.ts` — Config API group definition (schema only, no impl).
- `server/routes/instance/httpapi/groups/control-plane.ts` — Control plane API group.
- `server/routes/instance/httpapi/groups/control.ts` — Control API group.
- `server/routes/instance/httpapi/groups/event.ts` — Event API group.
- `server/routes/instance/httpapi/groups/experimental.ts` — Experimental API group definition.
- `server/routes/instance/httpapi/groups/file.ts` — File API group.
- `server/routes/instance/httpapi/groups/global.ts` — Global API group.
- `server/routes/instance/httpapi/groups/instance.ts` — Instance API group.
- `server/routes/instance/httpapi/groups/mcp.ts` — MCP API group.
- `server/routes/instance/httpapi/groups/metadata.ts` — API metadata helpers.
- `server/routes/instance/httpapi/groups/permission.ts` — Permission API group.
- `server/routes/instance/httpapi/groups/project-copy.ts` — Project copy API group.
- `server/routes/instance/httpapi/groups/project.ts` — Project API group.
- `server/routes/instance/httpapi/groups/provider.ts` — Provider API group.
- `server/routes/instance/httpapi/groups/pty.ts` — PTY API group. `connectToken` is unauthenticated — see P1 finding in pty handler.
- `server/routes/instance/httpapi/groups/query.ts` — Query schema helpers.
- `server/routes/instance/httpapi/groups/question.ts` — Question API group.
- `server/routes/instance/httpapi/groups/session.ts` — Session API group definition.
- `server/routes/instance/httpapi/groups/sync.ts` — Sync API group.
- `server/routes/instance/httpapi/groups/tui.ts` — TUI API group.
- `server/routes/instance/httpapi/groups/workspace.ts` — Workspace API group.
- `server/routes/instance/httpapi/handlers/config.ts` — Config handler — update marks instance for disposal.
- `server/routes/instance/httpapi/handlers/control-plane.ts` — MoveSession between projects.
- `server/routes/instance/httpapi/handlers/control.ts` — Auth set/remove, log levels — auth secrets stored via Auth.Service.
- `server/routes/instance/httpapi/handlers/event.ts` — SSE event stream with `server.instance.disposed` hook.
- `server/routes/instance/httpapi/handlers/file.ts` — File API uses `FSUtil.contains` for path traversal protection.
- `server/routes/instance/httpapi/handlers/instance.ts` — Instance metadata (path, vcs, commands, agents, skills, lsp, formatter).
- `server/routes/instance/httpapi/handlers/mcp.ts` — MCP server CRUD; no path traversal (MCP config validated by MCP service).
- `server/routes/instance/httpapi/handlers/permission.ts` — Permission list/reply, no auth changes.
- `server/routes/instance/httpapi/handlers/project.ts` — Project list/current/initGit/update/directories; `initGit` triggers instance reload via middleware.
- `server/routes/instance/httpapi/handlers/provider.ts` — Provider list/auth/callback; auth state stored in Auth.Service.
- `server/routes/instance/httpapi/handlers/question.ts` — Question list/reply/reject.
- `server/routes/instance/httpapi/handlers/session-errors.ts` — Storage not-found + session busy error mappers.
- `server/routes/instance/httpapi/handlers/sync-util.ts` — Re-exports `dieSyncError`.
- `server/routes/instance/httpapi/handlers/workspace.ts` — Workspace list/create/sync/remove/warp; warp applies VCS patches from one workspace to another.
- `server/routes/instance/httpapi/lifecycle.ts` — Instance reload/dispose via WeakMap handoff between middleware and handler.
- `server/routes/instance/httpapi/middleware/compression.ts` — Compression middleware.
- `server/routes/instance/httpapi/middleware/cors-vary.ts` — Vary header helper.
- `server/routes/instance/httpapi/middleware/error.ts` — Error response shaping.
- `server/routes/instance/httpapi/middleware/fence.ts` — Event sequence tracker (x-opencode-sync header).
- `server/routes/instance/httpapi/middleware/instance-context.ts` — Per-request instance context injection.
- `server/routes/instance/httpapi/middleware/proxy.ts` — Upstream proxying helpers.
- `server/routes/instance/httpapi/middleware/safe-response.ts` — Response safety wrappers.
- `server/routes/instance/httpapi/middleware/schema-error.ts` — Schema validation error mapper.
- `server/routes/instance/httpapi/middleware/security-headers.ts` — Default security headers (CSP, X-Frame-Options, etc.).
- `server/routes/instance/httpapi/public.ts` — OpenAPI schema definitions for SDK shape.
- `server/routes/instance/httpapi/server.ts` — Server bootstrap; wires layers.
- `server/routes/instance/httpapi/websocket-tracker.ts` — Tracks active WS for clean shutdown.
- `server/shared/fence.ts` — Event sequence tracker; parses `x-opencode-sync` header JSON; lenient validation.
- `server/shared/pty-ticket.ts` — PTY connect path regex, header constants.
- `server/shared/public-ui.ts` — Public UI asset allowlist for browser pre-auth fetch.
- `server/shared/tui-control.ts` — AsyncQueue for TUI control channel.
- `server/shared/workspace-routing.ts` — Workspace proxy URL builder; deletes `workspace` query param. SessionID regex parsing.
- `server/tui-event.ts` — TUI event types.


### `agent/`

**P3** (10)

- `agent/agent.ts` — Agent registry; defaults to safe permission profile (ask on doom_loop, deny question/plan_enter, allow .env.example).
- `agent/generate.txt` — Static agent-generation prompt.
- `agent/prompt/compaction.txt` — Static compaction prompt.
- `agent/prompt/deep-research.txt` — Static deep-research prompt.
- `agent/prompt/dream.txt` — Static prompt template.
- `agent/prompt/explore.txt` — Static explore prompt.
- `agent/prompt/general.txt` — Static general prompt.
- `agent/prompt/summary.txt` — Static summary prompt.
- `agent/prompt/title.txt` — Static title prompt.
- `agent/subagent-permissions.ts` — Subagent permission derivation. Comment notes task tool not auto-denied; parent controls via promptOps or subagent ruleset.


### `command/`

**P3** (4)

- `command/index.ts` — Command registry.
- `command/template/initialize.txt` — Static initialize prompt template.
- `command/template/review.txt` — Static review prompt template.
- `command/template/subagent.txt` — Static subagent prompt template.


### `cli/`

**P1** (3)

- `cli/cmd/db.ts` — `spawn("sqlite3", [Database.path()])` — Database.path is a fixed location so lower risk, but the spawn still runs `sqlite3` binary without env filtering.
- `cli/cmd/pr.ts` — `Process.spawn(["dreamcode", ...opencodeArgs], { stdin: "inherit", stdout: "inherit", stderr: "inherit", cwd: p })` where `p` is a directory from `createPR` arg. No validation that `p` is a safe directory.
- `cli/cmd/providers.ts` — `login` handler fetches `${url}/.well-known/dreamcode` (user-controlled URL — SSRF allowed since CLI, but should warn), then runs `Process.spawn(wellknown.auth.command)` with full inherited env. No command allowlist. `wellknown.auth.command` is fully attacker-controlled if user types attacker URL.

**P2** (1)

- `cli/cmd/session.ts` — Pipes session JSON into `Process.spawn(pagerCmd())`. Uses `less`/`more`/`cat`-style pagers. Path from `pager` config or env `PAGER`.

**P3** (85)

- `cli/bootstrap.ts` — CLI bootstrap.
- `cli/cmd/account.ts` — Account CLI.
- `cli/cmd/acp.ts` — ACP integration.
- `cli/cmd/agent.ts` — Agent CRUD CLI.
- `cli/cmd/attach.ts` — Attach CLI.
- `cli/cmd/cmd.ts` — Cmd factory.
- `cli/cmd/debug/agent.handler.ts` — Debug agent handler.
- `cli/cmd/debug/agent.ts` — Debug agent.
- `cli/cmd/debug/config.ts` — Debug config.
- `cli/cmd/debug/file.ts` — Debug file.
- `cli/cmd/debug/index.ts` — Debug index.
- `cli/cmd/debug/lsp.ts` — Debug LSP.
- `cli/cmd/debug/ripgrep.ts` — Debug ripgrep.
- `cli/cmd/debug/scrap.ts` — Debug scrap.
- `cli/cmd/debug/skill.ts` — Debug skill.
- `cli/cmd/debug/snapshot.ts` — Debug snapshot.
- `cli/cmd/debug/startup.ts` — Debug startup.
- `cli/cmd/debug/v2.ts` — Debug v2.
- `cli/cmd/export.ts` — Export CLI.
- `cli/cmd/generate.ts` — Generator.
- `cli/cmd/github.handler.ts` — GitHub integration; uses FSUtil.contains.
- `cli/cmd/github.shared.ts` — Shared GitHub helpers.
- `cli/cmd/github.ts` — Top-level GitHub subcommand.
- `cli/cmd/import.ts` — Import CLI.
- `cli/cmd/mcp.ts` — MCP CLI.
- `cli/cmd/models.ts` — Model list CLI.
- `cli/cmd/plug.ts` — Plugin CLI.
- `cli/cmd/prompt-display.ts` — Prompt display.
- `cli/cmd/run.ts` — Top-level run command.
- `cli/cmd/run/demo.ts` — Demo TUI.
- `cli/cmd/run/entry.body.ts` — Entry body renderer.
- `cli/cmd/run/footer.command.tsx` — Footer command view.
- `cli/cmd/run/footer.menu.tsx` — Footer menu view.
- `cli/cmd/run/footer.panel.ts` — Footer panel.
- `cli/cmd/run/footer.permission.tsx` — Footer permission view.
- `cli/cmd/run/footer.prompt.tsx` — Footer prompt view.
- `cli/cmd/run/footer.question.tsx` — Footer question view.
- `cli/cmd/run/footer.subagent-tab.ts` — Footer subagent tab.
- `cli/cmd/run/footer.subagent.tsx` — Footer subagent view.
- `cli/cmd/run/footer.ts` — Footer container.
- `cli/cmd/run/footer.view.tsx` — Footer view.
- `cli/cmd/run/footer.width.ts` — Footer width.
- `cli/cmd/run/permission.shared.ts` — Permission shared.
- `cli/cmd/run/prompt.editor.ts` — Prompt editor.
- `cli/cmd/run/prompt.shared.ts` — Prompt shared.
- `cli/cmd/run/question.shared.ts` — Question shared.
- `cli/cmd/run/runtime.boot.ts` — Runtime boot.
- `cli/cmd/run/runtime.lifecycle.ts` — Runtime lifecycle.
- `cli/cmd/run/runtime.queue.ts` — Runtime queue.
- `cli/cmd/run/runtime.shared.ts` — Runtime shared.
- `cli/cmd/run/runtime.stdin.ts` — Runtime stdin.
- `cli/cmd/run/runtime.ts` — Runtime loop.
- `cli/cmd/run/scrollback.shared.ts` — Scrollback shared.
- `cli/cmd/run/scrollback.surface.ts` — Scrollback.
- `cli/cmd/run/scrollback.writer.tsx` — Scrollback writer.
- `cli/cmd/run/session-data.ts` — Session data display.
- `cli/cmd/run/session-replay.ts` — Session replay.
- `cli/cmd/run/session.shared.ts` — Session shared.
- `cli/cmd/run/splash.ts` — Splash screen.
- `cli/cmd/run/stream.transport.ts` — Stream transport.
- `cli/cmd/run/stream.ts` — TUI stream.
- `cli/cmd/run/subagent-data.ts` — Subagent data display.
- `cli/cmd/run/theme.ts` — Theme.
- `cli/cmd/run/tool.ts` — Tool rendering in TUI.
- `cli/cmd/run/trace.ts` — Trace renderer.
- `cli/cmd/run/turn-summary.ts` — Turn summary.
- `cli/cmd/run/types.ts` — Runtime types.
- `cli/cmd/run/variant.shared.ts` — Variant shared.
- `cli/cmd/serve.ts` — Server launcher.
- `cli/cmd/stats.ts` — Stats CLI.
- `cli/cmd/tui.ts` — TUI launcher.
- `cli/cmd/uninstall.ts` — Uninstall scripts.
- `cli/cmd/upgrade.ts` — Upgrade CLI.
- `cli/cmd/web.ts` — Web UI launcher.
- `cli/effect-cmd.ts` — Effect-Cmd bridge.
- `cli/effect/prompt.ts` — Effect prompt.
- `cli/error.ts` — CLI error helpers.
- `cli/heap.ts` — CLI heap helpers.
- `cli/logo.ts` — Logo.
- `cli/network.ts` — Network helpers.
- `cli/tui/layer.ts` — TUI layer.
- `cli/tui/validate-session.ts` — Session validator.
- `cli/tui/worker.ts` — TUI worker.
- `cli/ui.ts` — CLI UI helpers.
- `cli/upgrade.ts` — Upgrade helpers.

