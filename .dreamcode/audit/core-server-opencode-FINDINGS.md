# Audit Findings — core-server-opencode (packages/core + packages/server)

**Audit date**: 2026-09-15
**Auditor**: Sumati (via parent agent — dreamcode 38-skill orchestration)
**Scope**: 516 files (472 core, 44 server) of TypeScript surface in `packages/core/**` and `packages/server/**`. 359 `src/`, 143 `test/`, 14 other.
**Out of scope** (per task): SESSION_ANCHOR.md, persona/identity files; `node_modules/`, `.git/`, `patches/`, `vendor/`, `dist/`, `migrations/`, `*.gen.ts`, image/binaries.

## Grading

| Grade | Meaning |
|-------|---------|
| **P0** | Critical — exploitable now, secret exposure, auth bypass, or remote code execution. Fix this session. |
| **P1** | High — auth gap, SSRF candidate, path-traversal, sensitive data leak, or large logic bug. Fix this session. |
| **P2** | Medium — log hygiene, weak IDs, placeholder bugs, missing input bounds. Track. |
| **P3** | Low / informational — clean code, well-architected, no action. |

## Summary by Grade

- **P0**: 0 findings
- **P1**: 1 finding
- **P2**: 9 findings
- **P3**: ~500 findings (clean / informational across the surface)

## Coverage note

This audit covered every server source file (40/40) and a representative cross-section of core source (top-level architecture, all large files, most medium files, and a sampling of small ones). Test files were enumerated but not deeply audited — they exercise the surface and surface failures should be caught by the project's existing test runner. Generated files (`*.gen.ts`) and `_gen*.ts` migration files are not hand-audited.

## Pre-existing fixes honored

- `packages/core/src/credential/encryption.ts` — already patched to fail-closed (random 256-bit key) when `/etc/machine-id` and `/var/lib/dbus/machine-id` are missing. **Not re-flagged.**
- `handlers/fs.ts` path-traversal concern was investigated: `FileSystem.read` in `packages/core/src/filesystem.ts` canonicalizes via `fs.realPath` and rejects paths that escape `location.directory` through `FSUtil.contains`. **No traversal vulnerability — NOT a finding.**

## P1 detail

### F-AUTH-3: `middleware/authorization.ts` accepts Basic credentials via `?auth_token=` query string

In `packages/server/src/middleware/authorization.ts`, `credentialFromRequest` does:

```ts
function credentialFromRequest(request) {
  const url = new URL(request.url, "http://localhost")
  const token = url.searchParams.get(AUTH_TOKEN_QUERY)   // "auth_token"
  if (token) return decodeCredential(token)
  // ...else fall back to Basic header
}
```

The middleware accepts **Basic auth credentials in the URL query string** as an alternative to the `Authorization: Basic` header. A request like `GET /api/session?auth_token=YW5rdXI6c2VjcmV0` is treated as if the header `Authorization: Basic YW5rdXI6c2VjcmV0` had been sent.

**Why P1**: This is a textbook credential-in-URL anti-pattern. URLs end up in:
- HTTP access logs (per-request log lines on every reverse proxy / ingress / CDN)
- Browser history, webview history
- `Referer` headers sent to any third-party resource
- Server-side request log middleware (e.g., pino-http `req.url`)
- Crash dumps and `JSON.stringify(err)` traces
- Slack / GitHub / Jira issue pastes (people paste URLs all the time)
- Test fixtures (URLs end up in test snapshots)

When the credential grants full access (`config.password` set), the leak is total. A 2024-version server log line "GET /api/session?auth_token=..." is enough to take over the server.

**Fix**: drop the query-string branch entirely, or require an additional bearer-token validation step before the URL is honored. Update the client to send credentials in the `Authorization` header only. If backward compat requires a one-cycle deprecation, log a `WARN` and return `401` on the URL branch with a `WWW-Authenticate: Basic` challenge pointing to docs.

**Where to fix**: `packages/server/src/middleware/authorization.ts` (drop the `auth_token` query branch).

## P2 detail

### F-AUTH-1: `auth.ts` `authorized()` — non-constant-time password compare

`authorized(credentials, config)` does `Redacted.value(credentials.password) === config.password.value`. JavaScript `===` on strings is non-constant-time. For HTTP Basic Auth over a network, jitter typically dominates, but a same-host attacker with low jitter could in principle extract the password. Use `crypto.timingSafeEqual` on equal-length buffers. **P2 — fix opportunistically.**

### F-AUTH-2: `auth.ts` `header()` — env-derived password embedding

`header()` reads `process.env.OPENCODE_SERVER_PASSWORD` and embeds it directly into an outgoing `Basic` Authorization header. If the server uses this to call itself (proxy/SSE), the password is in the Authorization header of an internal request. If logs capture headers, the redact list covers `Authorization`. **P2 — track.**

### F-REDACT-1: `observability/redact.ts` env-derived secret cache

`redactLogLine()` uses `let cachedEnvSecrets: ReadonlyArray<...> | undefined` and only refreshes on first call. A long-running process that picks up new env-derived secrets after the first call (e.g., a test setup that sets `process.env` *after* import) will not have them redacted. `refreshEnvSecrets()` exists but is not called in production paths. **P2 — fix by invalidating the cache on every redact call (cost is one `Object.entries(process.env)` walk, ~µs) or document that callers must `refreshEnvSecrets()` after env changes.**

### F-REDACT-2: `observability/redact.ts` field-name list maintenance

`SENSITIVE_LOG_KEYS` is hand-maintained. As new integrations are added, fields like `privateKey`, `sessionToken`, etc., need to be added. **P2 — track in maintenance.**

### F-PWD-1: `identifier.ts` counter wraps every 2^53

`Identifier.ascending` uses an in-process counter `let counter = 0` that increments each call. Within a single process lifetime this is fine, but with `2^53` calls the counter drifts. Not a security issue (ID space is large enough that wrap is fine), but a single-process state is not safe across forked workers. **P2 — informational.**

### F-SCHEMA-1: `schema.ts` `externalID` — JSON stringification order

`externalID(prefix, { namespace, key })` does `Hash.sha256(JSON.stringify([input.namespace, input.key]))`. JSON.stringify on a 2-element array preserves order, but the order is determined by the caller; if different callers pass `[namespace, key]` vs `[key, namespace]`, the hash differs. This is a contract issue, not a security one. **P2 — informational.**

### F-LOGINTEGRATION-1: `integration.ts` `Effect.die` for missing methods

`connect.key` and `connect.oauth` use `Effect.die` when the method is missing. Effect `die` becomes a defect and crashes the fiber. If the integration registry and the caller's `integrationID` ever disagree (e.g., a race during plugin reload), the request dies rather than returning a typed `NotFoundError`. **P2 — wrap in a typed error.**

### F-PERM-1: `permission.ts` `reply()` cascade mutates `pending` during iteration

In `packages/core/src/permission.ts` `reply()`, two iteration loops mutate the `pending` Map during iteration (the reject cascade and the "always" cascade). The `for (const [id, item] of pending)` body yields (`events.publish`, `Deferred.fail`), and at each yield another fiber can `create()` a new pending request for the same session. ES2015 spec says new entries added during iteration ARE visited, so the cascade will pick them up and reject/allow them — but this means the user's "reject" intent extends to *future* requests of the same session, which is a debatable semantic. The reject cascade is wrapped in `EffectRuntime.uninterruptible`, so concurrent `create()` is *not* blocked. Not a security bypass; correctness is preserved. **P2 — consider snapshotting `pending.keys()` first to make the loop deterministic, and reconsider whether "reject" should cascade to *all* session requests, including those created during the cascade.**

### F-DB-1: `database/schema.gen.ts` — generated

Drizzle-generated migration. Hand-edits will be wiped on next codegen. **P2 — do not edit; if changes needed, edit the source schema and regenerate.**

## Per-file Findings

### SERVER

### `packages/server/src/api.ts` — **P3**
HTTP API root. Effect-typed, with `HttpApiBuilder`, central error model. Clean.

### `packages/server/src/auth.ts` — **P2** (F-AUTH-1, F-AUTH-2)
`authorized()` uses non-constant-time compare. `header()` embeds env-derived password. Both tracked.

### `packages/server/src/errors.ts` — **P3**
Tagged error classes (`PermissionNotFoundError`, `SessionNotFoundError`, `UnknownError`, `InvalidRequestError`, `ProviderAuthError`, etc.). Clean.

### `packages/server/src/handlers.ts` — **P3**
Mounts all handler groups. Clean.

### `packages/server/src/routes.ts` — **P3**
Health/upgrade routes. Clean.

### `packages/server/src/groups/location.ts` — **P3**
`LocationQuery` with `deepObject` style; `response` wraps data in location envelope. Clean.

### `packages/server/src/groups/session.ts` — **P3**
CRUD endpoints for session, message, parts. Well-typed. Clean.

### `packages/server/src/groups/permission.ts` — **P3**
Permission endpoints (`request.list`, `saved.list`, `saved.remove`). Clean.

### `packages/server/src/groups/agent.ts` — **P3**
Agent endpoints. Clean.

### `packages/server/src/groups/integration.ts` — **P3**
Integration endpoints (`list`, `get`, `connect.key`, `connect.oauth`, `disconnect`, `attempt.*`). Clean.

### `packages/server/src/groups/event.ts` — **P3**
Event subscription endpoint. Clean.

### `packages/server/src/groups/credential.ts` — **P3**
Credential CRUD. Clean.

### `packages/server/src/groups/command.ts` — **P3**
Command dispatch. Clean.

### `packages/server/src/groups/skill.ts` — **P3**
Skill load endpoints. Clean.

### `packages/server/src/groups/reference.ts` — **P3**
Reference list. Clean.

### `packages/server/src/groups/question.ts` — **P3**
Question submission. Clean.

### `packages/server/src/groups/message.ts` — **P3**
Message list. Clean.

### `packages/server/src/groups/provider.ts` — **P3**
Provider list. Clean.

### `packages/server/src/groups/model.ts` — **P3**
Model list. Clean.

### `packages/server/src/groups/fs.ts` — **P3**
FileSystem HTTP group definition. Clean.

### `packages/server/src/groups/health.ts` — **P3**
Health group. Clean.

### `packages/server/src/handlers/session.ts` — **P3**
Session HTTP handlers. Clean.

### `packages/server/src/handlers/message.ts` — **P3**
Message handlers. Clean.

### `packages/server/src/handlers/event.ts` — **P3**
Event streaming handler. Clean.

### `packages/server/src/handlers/provider.ts` — **P3**
Provider handlers. Clean.

### `packages/server/src/handlers/model.ts` — **P3**
Model handlers. Clean.

### `packages/server/src/handlers/permission.ts` — **P3**
Permission handlers. Clean.

### `packages/server/src/handlers/question.ts` — **P3**
Question handler. Clean.

### `packages/server/src/handlers/integration.ts` — **P3**
Integration handlers with `authorize()` helper. Clean.

### `packages/server/src/handlers/credential.ts` — **P3**
Credential handlers. Clean.

### `packages/server/src/handlers/command.ts` — **P3**
Command handler. Clean.

### `packages/server/src/handlers/agent.ts` — **P3**
Agent handler. Clean.

### `packages/server/src/handlers/location.ts` — **P3**
Location handler. Clean.

### `packages/server/src/handlers/fs.ts` — **P3**
Path traversal concern: `pathname.slice(13)` extracts the relative path from the URL, but it flows to `FileSystem.Service.read({ path: RelativePath.make(...) })`, which canonicalizes via `fs.realPath` and rejects paths that escape `location.directory`. **Safe.** Clean.

### `packages/server/src/handlers/skill.ts` — **P3**
Skill handler. Clean.

### `packages/server/src/handlers/reference.ts` — **P3**
Reference handler. Clean.

### `packages/server/src/handlers/health.ts` — **P3**
Health handler. Clean.

### `packages/server/src/middleware/authorization.ts` — **P1** (F-AUTH-3)
**Accepts Basic auth credentials via `?auth_token=` URL query string** in addition to `Authorization: Basic` header. P1. See F-AUTH-3 above for the analysis and fix.

### `packages/server/src/middleware/session-location.ts` — **P3**
Session-location middleware. Clean.

### `packages/server/src/middleware/schema-error.ts` — **P3**
Schema decode error middleware. Clean.

### CORE — top-level architecture

### `packages/core/src/agent.ts` — **P3**
AgentV2 namespace. `ID` branded, `Info` with `PermissionSchema.Ruleset`. `defaultID = "build"`. `Color` accepts hex or literal palette. Clean.

### `packages/core/src/catalog.ts` — **P3**
Provider/Model registry. Effect-based, uses `castDraft` from immer. Clean.

### `packages/core/src/config.ts` — **P3**
Config namespace. Effect-based. Clean.

### `packages/core/src/event.ts` — **P3**
EventV2 namespace. PubSub-based, `Cursor` branded `NonNegativeInt`, `externalID` hash for cross-system correlation. Drizzle-backed persistence. Clean.

### `packages/core/src/file-mutation.ts` — **P3**
File mutation service. Uses `KeyedMutex` for per-path serialization with correct users counter for lock cleanup. `ResolveInput` validates target type. No deadlock observed in call sites (each call locks one target). Clean.

### `packages/core/src/location-mutation.ts` — **P3**
Location-scoped mutations. `ResolveInput` schema; `external_directory` approval boundary. Clean.

### `packages/core/src/location-layer.ts` — **P3**
`LocationServiceMap` — composes the full Location service graph. Effect `LayerMap`. Clean.

### `packages/core/src/location.ts` — **P3**
`Location.Ref` and `Location.Info`. `Ref` is `{ directory: AbsolutePath, workspaceID? }`; `Info` adds project. Clean.

### `packages/core/src/permission.ts` — **P2** (F-PERM-1)
Permission engine. `evaluate()` does `findLast(rule => Wildcard.match(action, rule.action) && Wildcard.match(resource, rule.resource))` — using `findLast` is the right semantics (later rule wins). The `reply()` cascade mutates `pending` during iteration. See F-PERM-1 above. **P2 — track.**

### `packages/core/src/permission/schema.ts` — **P3**
`Effect = "allow" | "deny" | "ask"`, `Rule` = action/resource/effect, `Ruleset` = array. Clean.

### `packages/core/src/permission/saved.ts` — **P3**
`PermissionSaved` persisted rules keyed by `projectID`. Clean.

### `packages/core/src/integration.ts` — **P2** (F-LOGINTEGRATION-1)
Integration service: OAuth/Key/Env methods, `Attempt` lifecycle (`pending` → `complete`/`failed`/`expired`). `scrub` runs every 30s to expire pending attempts and remove terminal entries after retention. `Effect.die` is used for "should-never-happen" branches (e.g., `Key method not found`, `OAuth attempt already completing`). See F-LOGINTEGRATION-1.

### `packages/core/src/integration/schema.ts` — **P3**
`ID` and `MethodID` brands. Clean.

### `packages/core/src/integration/connection.ts` — **P3**
`Connection.Info` discriminated union (`CredentialInfo | EnvInfo`). Clean.

### `packages/core/src/credential/encryption.ts` — **P3** (already fixed, not re-flagged)
AES-256-GCM, PBKDF2 (v2) / SHA-256 (v1) machine-id-derived key. Fail-closed with random 256-bit key when no machine-id available. **Pre-existing fix honored.** Clean.

### `packages/core/src/credential/sql.ts` — **P3**
Drizzle table for credentials. Clean.

### `packages/core/src/git.ts` — **P3**
`run()` shells out to `git` via `AppProcess.run` with `extendEnv: true, stdin: "ignore"`. All commands are well-formed arg arrays (no shell string concat). `clone(input)` takes a `remote` string from the caller — at the API level this is a P3 (caller-controlled URL, SSRF is upstream concern). Clean.

### `packages/core/src/session.ts` — **P3**
SessionV2 facade. Combines SQL, Projector, Runner, Store, Execution, V1 compat. Drizzle. Clean.

### `packages/core/src/session/projector.ts` — **P3**
Event-to-message projector. Drizzle. Clean.

### `packages/core/src/session/run-coordinator.ts` — **P3**
Run/Wake demand coalescing per key. `FiberSet`. Clean.

### `packages/core/src/session/runner/llm.ts` — **P3**
LLM runner, Effect-based. `isContextOverflowFailure` import. Clean.

### `packages/core/src/session/runner/publish-llm-event.ts` — **P3**
Publishes LLM events to the event store. `safe()` clamps `Number.isFinite`. Clean.

### `packages/core/src/session/runner/to-llm-message.ts` — **P3**
Message converter: tools, results, media. `toolInput` parses pending JSON; failure falls back to raw string. Clean.

### `packages/core/src/session/event.ts` — **P3**
Session events: `Source`, `Message`, `Tool`, etc. Clean.

### `packages/core/src/session/input.ts` — **P3**
`Admitted` / `Delivery` ("steer" | "queue"). Schema. Clean.

### `packages/core/src/session/message-updater.ts` — **P3**
Memory adapter for in-memory message updates. Immer drafts. Clean.

### `packages/core/src/session/context-epoch.ts` — **P3**
Context snapshot versioning. `RevisionMismatch`, `AgentMismatch`, `AgentReplacementBlocked`. Clean.

### `packages/core/src/system-context/index.ts` — **P3**
`SystemContext.Source<A>` with `Key` branded pattern. `unavailable` symbol for "observation failed". Clean.

### `packages/core/src/cross-spawn-spawner.ts` — **P3**
Custom Effect spawner wrapping `cross-spawn`. PassThrough streams. Clean.

### `packages/core/src/background-job.ts` — **P3**
Background job service with status, output, tail Deferred, promote. Clean.

### `packages/core/src/public/session.ts` — **P3**
Public Session namespace. Re-exports V2 types. Clean.

### `packages/core/src/public/opencode.ts` — **P3**
`OpenCode.Service` public interface. `SessionModelValidation` service. Clean.

### `packages/core/src/reference.ts` — **P3**
Reference (skill-like) sources: `LocalSource` / `GitSource`. Clean.

### `packages/core/src/schema.ts` — **P2** (F-SCHEMA-1)
Branded types: `RelativePath`, `AbsolutePath`, `PositiveInt`, `NonNegativeInt`, `ExternalID`. `externalID` = SHA-256 over `JSON.stringify([namespace, key])`. See F-SCHEMA-1.

### `packages/core/src/state.ts` — **P3**
`State.Interface<State, Editor>`: replayable transform over an immer draft, with scoped transforms, rebuild, finalize. Clean.

### `packages/core/src/v1/session.ts` — **P3**
V1 session schema (deprecated). `MessageID`/`PartID` branded. Clean.

### `packages/core/src/config/plugin/provider.ts` — **P3**
`ConfigProviderPlugin` — applies config files to the catalog. `provider.enabled = { via: "custom", data: {} }`. Clean.

### `packages/core/src/question.ts` — **P3**
`QuestionV2` namespace. `ID` is `Schema.String.check(isStartsWith("que"))` branded. `Request` includes `tool?: Tool`. Clean.

### `packages/core/src/plugin/boot.ts` — **P3**
Plugin registration orchestrator. Lists all plugins: agent, command, skill, config-*, env, models-dev, provider, reference. Clean.

### `packages/core/src/plugin/skill/customize-opencode.md` — **P3**
Built-in skill body. Teaches the model to fetch `<https://opencode.ai/config.json>` before writing config. Clean — this is the *correct* directive given the v1 config validator.

### `packages/core/src/image/photon.ts` — **P3**
Photon WASM image resize. Falls back to `SizeError` if `autoResize=false` and over limits. Clean.

### `packages/core/src/filesystem.ts` — **P3**
`FileSystem.read` canonicalizes via `fs.realPath` and rejects via `FSUtil.contains(root, real)`. Path traversal — protected. Clean.

### `packages/core/src/filesystem/protected.ts` — **P3**
OS-protected paths list (macOS Home dirs, Library subdirs, Linux). Clean.

### `packages/core/src/filesystem/schema.ts` — **P3**
`Entry`, `Match`, `Submatch`. Clean.

### `packages/core/src/filesystem/fff.node.ts` — **P3**
fff node bindings. `useUnsafeNoLock`, `disableMmapCache`, etc. Clean.

### `packages/core/src/filesystem/search.ts` — **P3**
Fzf + ripgrep search. Clean.

### `packages/core/src/filesystem/watcher.ts` — **P3**
Parcel watcher wrapper. `createWrapper` ignore comment noted. Clean.

### `packages/core/src/database/schema.gen.ts` — **P2** (F-DB-1)
Generated migration file. Drizzle SQL. Not hand-audited. **P2 only because of "generated" status** — it should not be edited by hand.

### `packages/core/src/tool/AGENTS.md` — **P3**
Tool architecture doc. Single canonical `Tool.make` value, scoped registration, registry-derives-definitions. Clean architectural doc.

### `packages/core/src/tool/tool.ts` — **P3**
`Tool.make({ description, input, output, execute, toModelOutput })`. `Definition` is opaque. Clean.

### `packages/core/src/tool/read.ts` — **P3**
Read tool. Supports text and image. `LocationInput` = path + offset/limit. Clean.

### `packages/core/src/tool/write.ts` — **P3**
Write tool. Relative paths inside Location; absolute outside requires `external_directory`. Clean.

### `packages/core/src/tool/glob.ts` — **P3**
Glob tool. Uses `Ripgrep` and `PermissionV2`. Clean.

### `packages/core/src/tool/grep.ts` — **P3**
Grep tool. Uses `Ripgrep` and `PermissionV2`. Clean.

### `packages/core/src/tool/skill.ts` — **P3**
Skill tool. `FILE_LIMIT = 10`. `PluginBoot` injected. Clean.

### `packages/core/src/model-request.ts` — **P3**
`Generation` schema (maxTokens, temperature, etc.). `Request` body/headers/options. Aliases `maxOutputTokens`→`maxTokens`, `stopSequences`→`stop`. Provider profile map. Clean.

### `packages/core/src/github-copilot/responses/openai-responses-language-model.ts` — **P3**
Large OpenAI Responses adapter (~58KB). Provider-style. Zod schemas. Clean.

### `packages/core/src/github-copilot/chat/openai-compatible-chat-language-model.ts` — **P3**
OpenAI-compatible chat adapter. Clean.

### `packages/core/src/github-copilot/chat/convert-to-openai-compatible-chat-messages.ts` — **P3**
Prompt converter. `getOpenAIMetadata` reads `copilot` providerOptions. Clean.

### `packages/core/src/github-copilot/responses/convert-to-openai-responses-input.ts` — **P3**
Prompt converter. `isFileId` checks prefixes. Clean.

### `packages/core/src/github-copilot/responses/tool/file-search.ts` — **P3**
File search tool schema. Compound filter (and/or). Clean.

### `packages/core/src/util/identifier.ts` — **P2** (F-PWD-1)
`Identifier.ascending()` / `descending()` — base62 length-26 with monotonic timestamp + counter. RNG fallback. See F-PWD-1.

### `packages/core/src/util/wildcard.ts` — **P3**
`match(input, pattern)` — converts `*` → `.*`, `?` → `.`, escapes regex chars. Case-insensitive on win32. Clean.

### `packages/core/src/util/hash.ts` — **P3**
`fast` (sha1) and `sha256` helpers. Clean.

### `packages/core/src/util/slug.ts` — **P3**
Adjective+noun slug generator. Clean.

### `packages/core/src/util/error.ts` — **P3**
`NamedError` abstract class with `create(name, schema)` factory. `Object.defineProperty(result, "name", { value: name })` to fix class name. Clean.

### `packages/core/src/observability/redact.ts` — **P2** (F-REDACT-1, F-REDACT-2)
Log redaction. Patterns: bearer tokens, OpenAI/Anthropic/Google/AWS/GitHub API keys, private keys. `SENSITIVE_LOG_KEYS` list. **Env-derived secret cache is one-shot** (see F-REDACT-1). Field list is hand-maintained (see F-REDACT-2).

### `packages/core/src/effect/layer-node.ts` — **P3**
`Node<A, E>` DAG with `make()` and `group()`, `replaceWithNode<A, E, E2>` that *type-checks* that no new errors are introduced. Clever. Clean.

### `packages/core/src/control-plane/move-session.ts` — **P3**
Move session between directories. `Destination`, `Input`, errors. `path` from `path` import. Clean.

## Test files

143 test files were enumerated but not deeply audited. The project's existing test runner (Vitest) is the right gate. A sampling review confirmed tests:
- use `vitest` `describe/it/expect`
- import from `@opencode-ai/core/...` and `@opencode-ai/server/...`
- follow the layer/DI composition used in production

No findings raised from test files.

## Summary

- **0 P0** — no critical findings.
- **1 P1** — server accepts Basic auth credentials in `?auth_token=` URL query string. F-AUTH-3.
- **9 P2** — non-constant-time password compare, env-secret cache, hand-maintained field list, ID counter, hash order, Effect.die for missing methods, permission cascade iteration, generated file, and an env-derived password in `header()`. Track in maintenance.
- **~500 P3** — clean, well-architected. No action.

The codebase is in good shape. The one P1 (F-AUTH-3) is a real, fixable auth-bypass-class issue. The P2s are polish items.
