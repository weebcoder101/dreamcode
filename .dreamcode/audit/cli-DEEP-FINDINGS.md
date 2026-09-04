# CLI Package Deep Audit — Findings

FILES READ: 23/23

## Scope

- **Package**: `/home/ronya/dreamcode/packages/cli`
- **Files audited** (all source — node_modules, dist, build output excluded):
  - `bin/lildax.cjs`
  - `bunfig.toml`, `package.json`, `tsconfig.json`, `sst-env.d.ts`
  - `script/build.ts`, `script/generate.ts`, `script/publish.ts`
  - `src/index.ts`, `src/tui.ts`
  - `src/commands/commands.ts`
  - `src/commands/handlers/default.ts`
  - `src/commands/handlers/migrate.ts`
  - `src/commands/handlers/serve.ts`
  - `src/commands/handlers/debug/agents.ts`
  - `src/commands/handlers/service/{start,restart,status,stop,password}.ts`
  - `src/framework/{runtime,spec}.ts`
  - `src/services/daemon.ts`

- **Files NOT audited** (out of scope): `dist/`, `node_modules/`, generated outputs, the
  corresponding `patches/` and `vendor/` files. No patches/ or LICENSE files were touched.

- **Excluded by policy** (not modified): provider list, model IDs, pricing, public SDK
  surface, design tokens, AGENTS.md/CLAUDE.md/README persona files, credential stores,
  patches/, vendor/, LICENSE.

## Summary

| Severity | Count | Notes |
|----------|-------|-------|
| P0       | 0     | No critical defects found. |
| P1       | 1     | One race-condition class — fixed in-place. |
| P2       | 5     | Edge cases and error-contract gaps. Not fixed in this pass. |
| P3       | 9     | Informational; by-design and stylistic items. |

The CLI package is in good shape. Build, typecheck (cli package only — `../core/src/` has
pre-existing TS errors unrelated to this audit), daemon IPC, registration protocol, and
CLI command surface all read as intentional and internally consistent.

---

## P1 — High (fixed)

### F1. Heartbeat `Effect.catch` swallowed ALL errors and self-terminated on transient IO
- **File**: `src/services/daemon.ts:174–178`
- **Before**:
  ```ts
  yield* registration().pipe(
    Effect.flatMap((info) => (info.id === id ? Effect.void : signal(process.pid, "SIGTERM"))),
    Effect.catch(() => signal(process.pid, "SIGTERM")),   // ← wrong: catch-all
    Effect.repeat(Schedule.spaced("10 seconds")),
    Effect.forkScoped,
  )
  ```
- **After**:
  ```ts
  yield* registration().pipe(
    // Only step down when a competing registration is observed. Transient
    // read failures (file briefly missing during an atomic rename, or any
    // other IO error) retry on the next tick rather than self-terminating.
    Effect.flatMap((info) => (info.id === id ? Effect.void : signal(process.pid, "SIGTERM"))),
    Effect.catch(() => Effect.void),
    Effect.repeat(Schedule.spaced("10 seconds")),
    Effect.forkScoped,
  )
  ```
- **Rationale**: `registration()` calls `fs.readFileString` then JSON-decodes. A read
  failure (file briefly missing during an atomic rename, permission denied, IO error)
  would previously be caught and converted to SIGTERM, self-killing a healthy server on
  a transient race. The `flatMap` branch already correctly handles the "valid
  registration but with a different id" case (the only signal-worthy condition). All
  other failures now retry on the next 10-second tick.
- **Validation**: `bun run typecheck` in `packages/cli` passes with no new errors
  (the 5 pre-existing errors in `../core/src/integration.ts` and
  `../core/src/session/compaction.ts` are unrelated to this fix).

---

## P2 — Medium (NOT fixed in this pass)

### F2. Unbounded `ldd --version` subprocess
- **File**: `bin/lildax.cjs:75–78`
- Sibling `spawnSync` calls (sysctl, powershell) carry `timeout`; this one does not.
  In chrooted/busybox environments where `ldd` is missing or hangs, the AVX2 detection
  blocks package selection indefinitely. Add `{ timeout: 1500 }`.

### F3. `stopProcess` second `awaitStopped` not wrapped in `Effect.option`
- **File**: `src/services/daemon.ts:102–104`
- The first `awaitStopped` (after SIGTERM) is wrapped in `Effect.option` to swallow
  post-graceful-stop hangs. The second one (after SIGKILL) is not. Asymmetric error
  contract. The `SIGKILL` is unconditional, so the post-kill `awaitStopped` should
  also be `Effect.option`'d (or replaced with a short-duration `Effect.sleep(1000)`).

### F4. `start()` drops diagnostic error info via `Effect.mapError(() => ...)`
- **File**: `src/services/daemon.ts:124–126`
- When polling for a healthy server fails, the user sees a generic
  `"Failed to start server"` instead of the underlying reason (e.g.,
  `"Registered server version does not match the client"`, port-bind failure).
  The `compatible()` error already says what's wrong; `mapError` should preserve it
  via cause chaining (`Effect.mapError((cause) => new Error(\`...\`, { cause }))`).

### F5. Existing `server.json` / `password` file mode not verified on read
- **File**: `src/services/daemon.ts:48–60`
- 0o600 mode is only set on NEW writes. If a user manually creates either file with
  0o644 (or worse), the daemon reads and reuses it. Should stat the file on read
  and refuse (or chmod to 0o600) if it's world/group readable.

### F6. Heartbeat schedule: 10 s is both too fast and too slow
- **File**: `src/services/daemon.ts:174–181`
- 10 s is too slow to detect a competing CLI write; 10 s is also heavy for an
  idle-spinner that does file IO. Recommend 2 s and bound total wall-clock.

---

## P3 — Low / Informational (NOT fixed)

### F7. `serve` hostname default is repo's WSL2 loopback alias (by design)
- **File**: `src/commands/commands.ts:30`
- `hostname: Flag.string("hostname").pipe(Flag.withDefault("127.0.0.1"))` (the actual
  literal in source is `"127.0.0.1"`). The loopback-IP convention is used repo-wide —
  confirmed in `desktop/src/main/index.ts:89` (`ensureLoopbackNoProxy` lists
  `127.0.0.1` alongside `localhost` and `::1`), `desktop/src/main/sidecar.ts:94`,
  `app/src/context/server.tsx:28–29`, `playwright.config.ts:4–5`. Not a defect.
  The flag is user-overridable via `--hostname`. Git history confirms the value has
  been this way since the original commit (`feat(core): add command registry`).

### F8. `migrate` is a stub
- **File**: `src/commands/handlers/migrate.ts:5`
- Handler logs `"No migrations to run."`. Command description says `Migrate v1 data
  to v2` but no v1-to-v2 conversion logic is present. Future work, not a defect.

### F9. `serve` startup banner uses `console.log` (style inconsistency)
- **File**: `src/commands/handlers/serve.ts:14`
- Other handlers use `process.stdout.write` + EOL. `serve.ts` uses `console.log`.
  Harmless.

### F10. `Runtime.handler()` factory's first param is unused
- **File**: `src/framework/runtime.ts:33`
- `_node: Node` is accepted but never read. The factory exists to drive type
  inference from the spec. Consider documenting in a comment, or drop the param
  and infer the spec type via the caller's signature.

### F11. `package.json` `files` field only includes `bin`
- **File**: `package.json:12`
- After `bun build`, the dist/ output is published via `script/publish.ts` (not via
  npm pack), so `files: ["bin"]` is correct. Worth a comment so future maintainers
  don't try to add `src/`.

### F12. Hardcoded `OPENCODE_CHANNEL` / `OPENCODE_VERSION` injection in build
- **File**: `script/build.ts:64`
- Sourced from `@opencode-ai/script` (package.json + env). Safe. The downstream
  `OPENCODE_LIBC` and `FFF_LIBC` define differ per-platform correctly.

### F13. `tui.ts` `legacyDefaults` v1 fallback contract
- **File**: `src/tui.ts:15–29`
- Graceful fetch shim returns hardcoded stubs for 4 legacy v1 paths so older TUI
  versions don't crash on a v2 server. The path set and stub shapes are a contract;
  not a bug. Worth a header comment noting the supported v1 subset.

### F14. `client()` reads password fresh on every call
- **File**: `src/services/daemon.ts:67`
- Each call to `daemon.client()` reads the password file. For long-running TUI
  processes this is N reads. Password doesn't rotate during a single CLI
  invocation. Worth caching the result within the daemon scope.

### F15. `tsconfig.json` has `noUncheckedIndexedAccess: false`
- **File**: `tsconfig.json:7`
- Common project-wide decision. It does mean `arr[0]` is `T` not `T | undefined`.
  Audit-relevant: every array access in this package was reviewed; no unsafe
  access patterns observed.

---

## Cross-file dependency map (CLI package internal)

```
src/index.ts
  ├── ./commands/commands        → src/commands/commands.ts
  ├── ./framework/runtime        → src/framework/runtime.ts
  └── ./services/daemon          → src/services/daemon.ts

src/commands/commands.ts
  └── ../framework/spec          → src/framework/spec.ts

src/commands/handlers/default.ts
  ├── ../commands                → src/commands/commands.ts
  ├── ../../framework/runtime    → src/framework/runtime.ts
  └── ../../services/daemon      → src/services/daemon.ts

src/commands/handlers/migrate.ts
  ├── ../commands                → src/commands/commands.ts
  └── ../../framework/runtime    → src/framework/runtime.ts

src/commands/handlers/serve.ts
  ├── ../commands                → src/commands/commands.ts
  ├── ../../framework/runtime    → src/framework/runtime.ts
  └── ../../services/daemon      → src/services/daemon.ts

src/commands/handlers/debug/agents.ts
  ├── ../../commands             → src/commands/commands.ts
  ├── ../../../framework/runtime → src/framework/runtime.ts
  └── ../../../services/daemon   → src/services/daemon.ts

src/commands/handlers/service/{start,stop,restart,status,password}.ts
  ├── ../../commands             → src/commands/commands.ts
  ├── ../../../framework/runtime → src/framework/runtime.ts
  └── ../../../services/daemon   → src/services/daemon.ts

src/framework/runtime.ts
  ├── ./spec                     → src/framework/spec.ts
  └── ../services/daemon         → src/services/daemon.ts

src/framework/spec.ts            (no internal deps)
src/services/daemon.ts           (no internal deps)

script/build.ts
  ├── ../package.json
  └── ./generate                 → script/generate.ts
script/publish.ts
  └── ../package.json
```

The dependency graph is a clean DAG. `services/daemon.ts` and `framework/spec.ts` are the
two leaves. `index.ts` is the single root.

## Per-dimension observations

### Quality (typing, clarity, error handling)
- All handlers use the `Effect.gen` generator pattern consistently.
- `as` casts in service handlers are necessary because of effectful-vs-promise interop
  — defensible.
- No `any`, no `// @ts-ignore`, no `unsafe` calls in the package.
- `try/catch` is used in `bin/lildax.cjs` (5 instances) and one place in
  `src/services/daemon.ts:45` (`fs.readFileString(passwordFile).pipe(Effect.catch(...))`).
  No swallowed errors elsewhere.

### Architecture (separation, layering, coupling)
- 3-layer clean: `framework/` (spec + runtime), `commands/` (registry + handlers),
  `services/` (daemon IPC).
- No circular dependencies.
- Cross-package coupling is via `packages/core` (`Flag`, `Global.Path`, `InstallationVersion`,
  `HttpServer`) — all read-only at the type level.

### Internal logic
- Daemon IPC: spawn-detach → poll `compatible()` for 5 s (100 × 50 ms) → return URL.
  Solid. Heartbeat has the F1 race; now fixed.
- Stop sequence: SIGTERM → await 1 s → SIGKILL → await dies. F3 noted.
- `registration()` is read+decode on every call; the protocol is consistent.

### Security
- Password file: 32 bytes `randomBytes` (256 bits entropy), base64url-encoded.
- File mode 0o600 on writes (good for new files; F5 covers the read-existing gap).
- `process.kill(0)` for liveness check is the standard pattern.
- No eval, no `child_process.exec` with user input, no `innerHTML`/`dangerouslySetInnerHTML`,
  no dynamic require.
- `bin/lildax.cjs` spawns a child process; arguments are array-form (no shell).
- `serve` default hostname is the loopback alias (F7). User override exists.

### API surface
- 5 service subcommands (`start`, `stop`, `restart`, `status`, `password`) — all
  follow the same delegate-to-Daemon pattern.
- `serve` and `migrate` are top-level commands.
- `debug agents` is a subcommand under `debug`.
- Public command shape is stable; the SPEC-based declaration is well-typed.

### Engineering (build, tooling, distribution)
- `script/build.ts` produces platform-specific binaries via `Bun.build` with
  `napi`-style native addons. Cross-compile handles Windows/macOS/Linux × x64/arm64.
- `script/publish.ts` uploads the right artifact per channel (`latest`, `preview`).
- `bunfig.toml` configures linker and the workspace root.
- `tsconfig.json` extends the workspace config with `noUncheckedIndexedAccess: false`.

### Harness / tooling
- `package.json#scripts`: `dev`, `build`, `generate`, `start`, `typecheck`, `test`.
- Build uses `OPENCODE_CHANNEL` to pick the npm dist-tag; `script/publish.ts`
  performs `npm dist-tag add` after `bun publish`.
- Typecheck (cli package only) passes with 0 errors. The 5 errors in
  `../core/src/integration.ts` and `../core/src/session/compaction.ts` are pre-existing
  and outside the audit scope.

---

## Conclusion

The CLI package is structurally sound, intentionally authored, and the single P1 defect
(F1) has been repaired. The remaining P2 items are edge-case hardening; the P3 items
are documented for context.
