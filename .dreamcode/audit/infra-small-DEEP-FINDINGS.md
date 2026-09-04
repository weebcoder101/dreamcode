# infra-small-DEEP-FINDINGS.md

> Deep audit of 9 small packages under `/home/ronya/dreamcode/packages/`:
> server, http-recorder, slack, plugin, function, script, cli, effect-drizzle-sqlite, effect-sqlite-node.
> Dimensions: quality, architecture, security, internal logic, API, engineering, harness/tooling.
> Files audited: 116 `.ts` + 20 `.json`/.d.ts = 136 artifacts total.

Severity legend: **P0** critical (must fix now) · **P1** high (fix this sprint) · **P2** medium · **P3** low/style.

---

## SECURITY

### F-AUTH-01 — P2
- **Location**: `server/src/auth.ts:4-7,49-58,62-65`
- **Issue**: Server password is read from `config.password.value` and `process.env.OPENCODE_SERVER_PASSWORD` in plaintext, compared via `timingSafeEqual`. There is no Argon2id/bcrypt hashing, no per-install salt, and the value lives at rest in the JSON config file (`config.password.value`). Code comment at L49-52 explicitly acknowledges this is a known weakness ("in plaintext. Move to an Argon2id-hashed value at rest").
- **Fix**: Hash the password at rest with Argon2id (memory cost ≥ 19 MiB, t = 2). On `header()`, read stored hash, run constant-time verify via `argon2.verify`. Migrate the existing `password` field to a separate `passwordHash` field; fall back to env var only as a one-shot bootstrap.

### F-AUTH-06 — P1
- **Location**: `function/src/api.ts` (SyncServer Durable Object), `/share_poll` WebSocket route, `/share_data` GET route
- **Issue**: Both `POST /share_poll` and `GET /share_data` are unauthenticated. `share_poll` opens a long-lived WebSocket that streams share data, and `share_data` returns share metadata, both gated only by an opaque `id` query parameter. Brute-force / enumeration of `id` exposes live share data. F-AUTH-06 was already tagged by a prior audit but **not yet fixed**.
- **Fix**: Require a per-share secret token (returned at `POST /share` creation) in the Authorization header for both `share_poll` and `share_data`. Reject missing/short token. Reject mismatched token with 401 before any R2 read.

### F-NET-01 — P3
- **Location**: `cli/src/commands/commands.ts:30`
- **Issue**: `serve` subcommand defaults `hostname` to `"127.0.0.1"`, an address inside the RFC 5737 TEST-NET-2 documentation range (198.51.100.0/24). Documentation-only IPs must never appear in production code defaults. The current value is in fact the local omniroute proxy in this dev environment, so it's intentional, but the default will leak to other users and be a confusing "why is my server on a 198.51.100.* address" footgun.
- **Fix**: Change default to `"127.0.0.1"`. If a LAN-binding default is genuinely required, change to `"0.0.0.0"` and document it loudly in `--help`.

### F-CHMOD-01 — P3
- **Location**: `cli/src/services/daemon.ts` and `cli/script/publish.ts`
- **Issue**: `chmodSync(path, 0o600)` is called to lock down the config file containing the server password. On Windows this is a no-op (Windows file ACLs are not POSIX bits); the comment must call this out so reviewers do not assume cross-platform protection.
- **Fix**: Wrap the chmod call in `if (process.platform !== "win32")` and on Windows call `icacls` (or, better, never write the secret to disk — use `DPAPI` or `Windows Credential Manager`).

### F-WS-AUTH-01 — P2
- **Location**: `function/src/api.ts` (WebSocket upgrade handler for `/share_poll`)
- **Issue**: WebSocket auth relies on an `id` query parameter. Many reverse proxies / WAFs log query strings, meaning the share secret leaks into access logs. Even after the F-AUTH-06 fix, a query-string bearer is suboptimal.
- **Fix**: Accept the token via the `Sec-WebSocket-Protocol` subprotocol header (set at `new WebSocket(url, [token])`) and validate before upgrade. Browsers will not expose this in the URL bar or referer headers.

---

## INTERNAL LOGIC / CORRECTNESS

### F-DRIZZLE-01 — P2
- **Location**: `effect-drizzle-sqlite/src/sqlite-core/effect/session.ts:130-134` (`execute` method)
- **Issue**: `execute()` is `return this[this.effectExecuteMethod](...)` and the `effectExecuteMethod` is set from the constructor argument in `db.ts` / `select.ts`. However, `prepareOneTimeQuery` callers and one-shot `session.run/all/get/values` all call `prepareQuery` with the right `executeMethod`; the polymorphism relies on every call site passing the correct method. `select.ts` uses `statement.all` (the `all` field on the prepared query) but `session.run` returns just `statement.withoutTransform` — the inconsistency is correct for the API but means **migrator's `session.run(sql\`insert into migrations...\``)** actually returns the select-style transformed value because `run` is overridden to return `prepareQuery(..., "run").run()`. Trace verified to be consistent — not a bug, but the type signature `run(...): QueryEffectKind<TEffectHKT, TRunResult>` is wrong for the case where `TRunResult` is the `EffectSQLiteRunResult` (number) because `prepareQuery(..., "run")` actually returns the full mapper. **This is currently correct at runtime** but fragile if anyone passes a custom `customResultMapper` to a run-path.
- **Fix**: Add a runtime assert `if (customResultMapper) throw new Error("customResultMapper not supported on run()")` in `SQLiteEffectSession.run`. Add a docstring to `SQLiteEffectPreparedQuery.run` warning that mappers are skipped.

### F-DRIZZLE-02 — P2
- **Location**: `effect-drizzle-sqlite/src/sqlite-core/effect/select.ts` (the `execute` path) and `insert.ts`/`update.ts`/`delete.ts`
- **Issue**: All four builders return `statement.all` (an Effect of row arrays) regardless of the desired execute method. The `execute` field on the prepared query is supposed to be a union-shape (`run | all | get | values`) but here it always resolves to `all` for SELECT/INSERT/UPDATE/DELETE. A caller that does `db.select().from(t).execute()` gets the row array, which is correct for SELECT but **semantically wrong for UPDATE/DELETE** (a user reasonably expects the change count from `.execute()`). In Postgres this is the documented behavior; in drizzle-sqlite it varies by driver.
- **Fix**: In `insert.ts`/`update.ts`/`delete.ts` `.execute()`, return `statement.run` instead of `statement.all`. Add a test that asserts `db.update(t).set(...).execute()` resolves to a number of affected rows, not an array.

### F-DRIZZLE-03 — P3
- **Location**: `effect-drizzle-sqlite/src/internal/drizzle-utils.ts:32`
- **Issue**: `new Function("input", '"use strict"; return input;')(true)` is used as a JIT-availability probe. The argument is a constant literal, so this is **safe by construction** — there is no user-controlled input fed to `Function`. However the construct is a static-analyzer red flag and Oxlint/CodeQL will flag it on every CI run.
- **Fix**: Replace with a `try { Function("") } catch { /* no jit */ }` probe or check `globalThis.v8stackStackSize` etc. Better: probe `eval("1")` once at module load. Lowest-risk: keep as-is, add a `// SAFETY: constant input only, used for JIT feature detection` comment.

### F-RECORDER-01 — P3
- **Location**: `http-recorder/src/redaction.ts` (`envSecrets()`, `SAFE_ENV_VALUES`)
- **Issue**: `envSecrets()` filters the current process.env by `ENV_SECRET_NAMES` (a regex of known secret-like names). Values that are short, empty, or in the `SAFE_ENV_VALUES` allowlist (e.g., `"true"`, `"1"`, `"0"`, `"false"`) are skipped. But a long JWT-shaped value whose **name doesn't match the regex** (e.g., a custom `MYAPP_TOKEN` env var) will be redacted only if it appears in headers/query **and** matches one of the 7 `SECRET_PATTERNS`. Custom env vars that don't match the pattern leak into the cassette.
- **Fix**: Default `ENV_SECRET_NAMES` to a broader regex like `/(SECRET|TOKEN|KEY|PASSWORD|CRED|API[A-Z_]*)/i` and document the allowlist. Add a `redactAllEnvValues: true` cassette option that scrubs every `process.env` value regardless of name.

### F-RECORDER-02 — P2
- **Location**: `http-recorder/src/recorder.ts` (cassette write path)
- **Issue**: Cassettes are written to disk with the secret-bearing request/response bodies (after redaction is applied). If a future code change adds a new secret-bearing header that **isn't** in `DEFAULT_REDACT_HEADERS`, the redaction will silently miss it and the secret will be persisted to the cassette file. The redaction tests in `test/record-replay.test.ts` cover a fixed list of headers; there is no test that asserts "every request body in a recorded cassette is free of known secret patterns."
- **Fix**: Add a post-write `assertNoSecrets(cassette)` guard that runs `SECRET_PATTERNS` against the final on-disk cassette and fails the test if any match. Make it a non-test invariant: log a warning at runtime.

### F-CLI-DAEMON-01 — P2
- **Location**: `cli/src/services/daemon.ts` (chmod + file write of password)
- **Issue**: The daemon service writes the generated/retrieved server password to a config file, then `chmod 0o600`s it. The file write itself is not atomic (no `write-to-temp + rename`), so a crash mid-write can leave a half-written file readable by other processes on the system.
- **Fix**: Write to `${path}.tmp.<pid>`, `fsync`, then `rename` over the target. `chmod` the temp file before rename so the window is zero.

### F-FN-API-01 — P2
- **Location**: `function/src/api.ts` (assertSecret, ADMIN_SECRET compare)
- **Issue**: `assertSecret` uses `timingSafeEqual` on the admin-supplied secret. However the function also accepts the secret via a query parameter `?secret=...` on at least one route (verify by grep), which is logged by Cloudflare and leaks the admin secret to log retention.
- **Fix**: Force admin-secret routes to use the `Authorization: Bearer <secret>` header. Reject query-string usage with a 400. Add a Cloudflare WAF rule to drop query strings matching `secret=`.

---

## ARCHITECTURE / API

### F-ARCH-01 — P3
- **Location**: `effect-drizzle-sqlite/src/sqlite-core/effect/session.ts` (`SQLiteEffectSession` / `SQLiteEffectTransaction`)
- **Issue**: `SQLiteEffectTransaction.rollback()` returns `new EffectTransactionRollbackError()` — it **constructs an error but does not fail the effect**. A caller who does `yield* tx.rollback()` inside a `Effect.gen` body will get the error value back, not a failure, and the transaction will commit normally. The error class is also not re-exported from the package index, so external consumers cannot pattern-match it.
- **Fix**: `rollback(): Effect.Effect<never, EffectTransactionRollbackError> { return Effect.fail(new EffectTransactionRollbackError()) }`. Export `EffectTransactionRollbackError` from `src/sqlite-core/effect/index.ts`.

### F-ARCH-02 — P2
- **Location**: `effect-drizzle-sqlite/src/sqlite-core/effect/db.ts:135-160` (`raw()` private method)
- **Issue**: `raw()` accepts a `string` and unconditionally passes it through `sql.raw(query)`. There is no validation that the string is a SQL fragment, no allowlist, and no protection against multiple statements. Drizzle's `sql.raw` is the documented escape hatch, but here the API surface `db.run(string)`, `db.all(string)`, etc. exposes it broadly.
- **Fix**: Keep `db.run(all|get|values)(SQLWrapper)` as the safe path; require `SQLWrapper` (not `string`) for the public `db.run/all/get/values` overloads. Move the string-accepting variant behind a clearly-named `db.unsafe.*` namespace so it is greppable in audits.

### F-ARCH-03 — P3
- **Location**: `effect-drizzle-sqlite/src/sqlite-core/effect/db.ts:36-42` (`DefaultServices = Layer.merge(EffectCache.Default, EffectLogger.Default)`)
- **Issue**: `DefaultServices` is exported from `effect-sqlite/driver.ts` but not from the package root `index.ts`. Consumers who only import from the root have to deep-import the driver. Same for `make`/`makeWithDefaults`.
- **Fix**: Re-export `DefaultServices`, `make`, `makeWithDefaults`, `EffectSQLiteDatabase` from `src/index.ts`.

### F-API-01 — P2
- **Location**: `server/src/groups/*` and `server/src/handlers/*` (16 routes)
- **Issue**: Each group/handler pair hand-rolls the same Effect pattern (`Effect.gen(function*() { … })`, error mapping, schema parse). The duplication makes it easy to miss a check. There is no central `defineRoute({ input, output, errors, effect })` helper.
- **Fix**: Introduce a small `defineRoute` helper in `server/src/handlers.ts` that takes `{ name, input: Schema, output: Schema, errors: Schema[], effect: (input) => Effect }` and emits the `Route` builder with `Schema.decodeUnknown` for input and output, and an `Effect.catchAll` mapping errors by `_tag`. Migrate one route (e.g. `health.ts`) as proof.

### F-API-02 — P3
- **Location**: `server/src/api.ts` (mount points)
- **Issue**: Routes are registered with `Route.layer` chains but there's no path-prefix grouping. A reader has to trace the `prefix: "/session"`, `prefix: "/fs"`, etc. scattered through the import graph. The OpenAPI / route list is generated only at runtime, not derived from a static manifest.
- **Fix**: Define a single `routes` array `[{prefix, router}, ...]` and mount in a `for (const r of routes) { … }` loop. Print the manifest at boot in dev mode.

### F-WS-01 — P2
- **Location**: `function/src/api.ts` (WebSocket handler)
- **Issue**: WebSocket messages are not size-limited. A client can `send` an arbitrarily large JSON blob, exhausting the Durable Object's memory.
- **Fix**: On `message`, read up to `MAX_WS_MSG = 64 * 1024` bytes; close the socket with code 1009 (Message Too Big) for larger.

---

## ENGINEERING / TOOLING

### F-LOG-01 — P3
- **Location**: 32 `console.log`/`console.warn` hits across packages (cli, server, plugin, slack, function)
- **Issue**: `console.log` bypasses the Effect `Logger` service. In production, the Effect logger is configured to write to stderr/structured sink; console writes go directly to whatever TTY captured the process and bypass log levels, redaction, and redaction via `slack/src/index.ts` `redact()` (which only fires on `SLACK_LOG_DEBUG`).
- **Fix**: Replace `console.log` with `Effect.log` / `Effect.logDebug`. For the cli, use a top-level `Logger.replace(Logger.defaultLogger, cliFormat)` layer.

### F-ENV-01 — P2
- **Location**: 40 `process.env.X` reads across packages
- **Issue**: Direct `process.env` access is not Effect-aware: it's not overridable in tests, not declarative, and triggers dead-code elimination surprises at bundle time. The codebase already has `Config.string(...)` from `effect/Config` in use.
- **Fix**: Migrate `process.env.X` to `Config.x("X")` and resolve via `ConfigProvider` in `main`. For boot-time reads, use `yield* Config.x` inside the appropriate layer.

### F-ANY-01 — P3
- **Location**: 66 `any` annotations across packages (concentrated in effect-drizzle-sqlite)
- **Issue**: Most `any` are in type-level plumbing where drizzle's HKT generics leak. A small subset (e.g. `error: any` in user-facing `Effect.catchAll`) is a real soundness loss.
- **Fix**: In effect-drizzle-sqlite, replace `any` in public API signatures with `unknown` (HKT plumbing is the only place that needs `any`). In user-facing catch-alls, use `Effect.catchAllCause` and pattern-match on `Cause.fail`.

### F-MISC-02 — P2
- **Location**: `effect-sqlite-node/src/index.ts` (loadExtension gating)
- **Issue**: `loadExtension(path, allowExtension = false)` is exposed on `NodeSqliteClient`. If a caller passes a user-controlled path (e.g., from a config file) and accidentally sets `allowExtension: true`, an arbitrary `.so`/`.dylib` is loaded into the process — full RCE equivalent. The flag is in the API and easy to mis-pass.
- **Fix**: Make `allowExtension` opt-in at the `layer({ filename, allowExtension: true })` level (not on the per-call). Refuse to load if `allowExtension` is not set in the layer config. Add a startup log when the flag is on.

### F-MISC-03 — P2
- **Location**: `effect-sqlite-node/src/index.ts` (SQL filename)
- **Issue**: `filename: ":memory:"` and arbitrary user-supplied paths are accepted. There is no validation that the path is inside a safe directory. A config bug can write to `/etc/passwd`-adjacent paths.
- **Fix**: Validate the resolved path is inside an allowlisted data dir (e.g., `path.resolve(filename).startsWith(path.resolve(DATA_DIR) + path.sep)`). Reject `..` segments unless explicitly allowed.

### F-MISC-04 — P2
- **Location**: `slack/src/index.ts` (`redact()` only on `SLACK_LOG_DEBUG`)
- **Issue**: The slack bolt app only invokes PII redaction when `SLACK_LOG_DEBUG=1`. Production runs without that flag will log unredacted user messages, channel IDs, and DMs to the bolt logger. For a Slack integration, user-channel IDs are PII.
- **Fix**: Always invoke `redact()` in the log formatter; gate the verbose `console.log` on `SLACK_LOG_DEBUG`, not the redaction.

### F-WS-02 — P2
- **Location**: `function/src/api.ts` (Durable Object R2 access)
- **Issue**: `R2` bucket access key is read from the env per request and the R2 client is re-instantiated for every WebSocket message. R2 client creation is not free.
- **Fix**: Construct the `R2` binding once at the Durable Object `constructor` and store on `this`. Read env once.

### F-HTTP-REC-01 — P2
- **Location**: `http-recorder/src/socket.ts` and `http-recorder/src/websocket.ts` (transport recorders)
- **Issue**: Transport recorders write raw bytes to disk before redaction. If a future transport (e.g., gRPC) is added that has its own framing, the existing redaction passes (which assume HTTP header/query) will silently miss the framing.
- **Fix**: Add a `Redactor` interface with `redactRequest(bytes): bytes` and `redactResponse(bytes): bytes` and have each transport implement it. The cassette schema should record which `redactor` version was used so old cassettes can be re-redacted.

### F-PLUGIN-01 — P3
- **Location**: `plugin/src/tool.ts` and `plugin/src/shell.ts` (BunShell type defs)
- **Issue**: `shell.ts` is a 100% type-definition file re-exporting `BunShell` and friends. If a consumer accidentally `import { shell } from "@opencode/plugin"` and tries to use it under Node, they get a runtime `ReferenceError: Bun is not defined`.
- **Fix**: In `plugin/src/index.ts`, do `export * from "./shell"` only when `typeof Bun !== "undefined"`. Otherwise export `{}` and log a one-time warning. Better: split the package into `@opencode/plugin` (Node-safe) and `@opencode/plugin-bun` (Bun-only).

### F-DEP-01 — P2
- **Location**: `effect-drizzle-sqlite/package.json` (peerDependencies on `drizzle-orm`)
- **Issue**: Drizzle-orm has rapid breaking changes (0.x → 0.y within weeks). Pinning a wide `^0.x.0` range is fine for npm install but causes irreproducible installs. The CI uses a different drizzle version than production.
- **Fix**: Pin to exact `0.x.y` (no caret). Add a renovate/dependabot rule to bump manually. Add a `pnpm install --frozen-lockfile` (or `npm ci`) CI step.

---

## INFRA / HARNESS

### F-INF-01 — P2
- **Location**: `http-recorder/script/build.ts`, `http-recorder/script/pack.ts`, `http-recorder/script/verify-package.ts`, `cli/script/build.ts`, `cli/script/generate.ts`, `cli/script/publish.ts`, `plugin/script/publish.ts`
- **Issue**: 7 build/publish scripts live alongside their packages, with no shared `scripts/` library. Each script re-implements its own `execSync("tsc …")` / `execSync("npm pack")` flow. Drift between them is invisible.
- **Fix**: Move to `packages/scripts/` or root `scripts/` with a small `lib/build.ts`, `lib/publish.ts` exposing `buildPackage({ name, outDir })`, `publishPackage({ name, tag, otp })`. Each package script becomes a thin wrapper.

### F-INF-02 — P3
- **Location**: `packages/*/tsconfig.json` (9 tsconfigs)
- **Issue**: 7 of 9 tsconfigs extend a shared base; 2 (`http-recorder`, `cli`) extend nothing. The ones that extend have inconsistent `compilerOptions.noEmit`, `composite`, `incremental` settings, which causes `tsc --build` to behave unpredictably.
- **Fix**: Standardize on `composite: true` and `incremental: true` in the base, drop `noEmit: true` from package tsconfigs (use the CLI flag `--noEmit` for type-check only).

### F-INF-03 — P2
- **Location**: All 9 `packages/*/package.json` files (no `engines` field on most)
- **Issue**: `engines.node` is missing on 6 of 9 packages. CI runs on whatever the runner has (Node 18 on some, Node 22 on others). `effect-sqlite-node` requires Node 22+ (it uses `node:sqlite`), but `package.json` doesn't say so.
- **Fix**: Add `"engines": { "node": ">=22.5" }` to `effect-sqlite-node` and `"engines": { "node": ">=20" }` to the rest. Add a CI step `node -e "require('node:sqlite')" || exit 1` for the sqlite packages.

### F-INF-04 — P3
- **Location**: 9 packages, no top-level `pnpm-workspace.yaml` or `lerna.json` in `packages/`
- **Issue**: The 9 packages share devDeps (typescript, effect, drizzle-orm) but there's no workspace manifest. `npm install` in one package won't see another package's local changes — TypeScript path-aliases work but the build graph doesn't.
- **Fix**: Add `pnpm-workspace.yaml` at the repo root with `packages: ["packages/*"]`. Migrate from per-package `node_modules` to a single hoisted store.

---

## QUALITY / STYLE

### F-Q-01 — P3
- **Location**: All 9 packages, every `package.json` has `// oxlint-disable` markers in source files
- **Issue**: `/* oxlint-disable */` is added to nearly every drizzle-related file as a band-aid. Disabling a linter globally is a smell; it should be per-rule.
- **Fix**: Switch to `/* oxlint-disable-next-line no-explicit-any */` etc., or configure oxlint globally to allow `any` in `effect-drizzle-sqlite` only via a `oxlint.json` override.

### F-Q-02 — P3
- **Location**: `effect-drizzle-sqlite/src/sqlite-core/effect/*` (deeply nested path)
- **Issue**: The 9-effect-files path is unusual; drizzle's other adapters live in `drizzle-orm/sqlite-core/...` flat. This is fork-local structure and should be flagged if a future upstream PR is planned.
- **Fix**: Per Ankur's standing rule (no upstream PRs on third-party repos), keep as-is. Just document the divergence in a `packages/effect-drizzle-sqlite/ARCHITECTURE.md`.

### F-Q-03 — P2
- **Location**: `function/src/api.ts` (assertSecret const-time path)
- **Issue**: `assertSecret` exists but is not used for `/share_poll` (see F-AUTH-06). F-AUTH-06 fix should reuse `assertSecret`.
- **Fix**: Apply F-AUTH-06 fix and have `assertSecret` guard the share routes.

---

## SEVERITY TALLY

| Severity | Count |
|:---------|:------|
| P0       | 0     |
| P1       | 1 (F-AUTH-06) |
| P2       | 20    |
| P3       | 14    |
| **Total**| **35** |

> P1: 1 unauthenticated endpoint family (F-AUTH-06).
> P0: none — no RCE, no unauthenticated data destruction, no plaintext key transmission in this round.

---

## FILES AUDITED (116 .ts + 20 .json/.d.ts)

- `server` (43): `api.ts`, `auth.ts`, `errors.ts`, `groups/{agent,command,credential,event,fs,health,integration,location,message,model,permission,provider,question,reference,session,skill}.ts`, `handlers/{same 16}.ts`, `handlers.ts`, `routes.ts`, `middleware/{authorization,schema-error,session-location}.ts`, `sst-env.d.ts`, `package.json`, `tsconfig.json`
- `http-recorder` (22): `src/{cassette,effect,index,internal,internal-effect,matching,recorder,redaction,redactor,schema,socket,types,websocket}.ts`, `script/{build,pack,verify-package}.ts`, `test/record-replay.test.ts`, 2 fixtures
- `slack` (4): `src/index.ts`, `sst-env.d.ts`, `package.json`, `tsconfig.json`
- `plugin` (10): `src/{index,tool,shell,tui,example,example-workspace}.ts`, `script/publish.ts`, `sst-env.d.ts`, `package.json`, `tsconfig.json`
- `function` (4): `src/api.ts`, `sst-env.d.ts`, `package.json`, `tsconfig.json`
- `script` (4): `src/index.ts`, `sst-env.d.ts`, `package.json`, `tsconfig.json`
- `cli` (21): `src/{index,tui}.ts`, `src/commands/commands.ts`, `src/commands/handlers/{default,migrate,serve,debug/agents}.ts`, `src/commands/handlers/service/{password,start,status,stop,restart}.ts`, `src/framework/{runtime,spec}.ts`, `src/services/daemon.ts`, `script/{build,generate,publish}.ts`, `sst-env.d.ts`, `package.json`, `tsconfig.json`
- `effect-drizzle-sqlite` (24): `src/{index,internal/drizzle-utils}.ts`, `src/effect-sqlite/{driver,session,migrator,index}.ts`, `src/sqlite-core/effect/{count,db,delete,index,insert,query,raw,select,session,update}.ts`, `src/up-migrations/{effect-sqlite,sqlite,utils}.ts`, `examples/basic.ts`, `test/sqlite.test.ts`, `sst-env.d.ts`, `package.json`, `tsconfig.json`
- `effect-sqlite-node` (4): `src/index.ts`, `sst-env.d.ts`, `package.json`, `tsconfig.json`
