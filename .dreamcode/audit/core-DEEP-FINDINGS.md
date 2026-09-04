# Core Package — Deep Audit Findings (P0–P3)

**Scope**: `/home/ronya/dreamcode/packages/core` — `@opencode-ai/core` v1.17.4
**Files audited**: 313 .ts source files (~32,953 lines) + 132 test files
**Method**: Manual review of high-risk files (tool/, session/, credential/, database/, permission/, event/, npm.ts, dynamic.ts, encryption.ts, llm runner, projectors) + static greps for security patterns (`shell:true`, `eval`, raw SQL, hardcoded secrets, `require("fs")` in ESM, `as any`).
**Build verification**: `tsc --noEmit` (full project typecheck).

---

## Summary

| Severity | Count | Fixed inline | Notes |
|----------|-------|--------------|-------|
| **P0** (critical / crash / RCE) | 1 | 1 | `dynamic.ts` would `ReferenceError` on first call |
| **P1** (real bug, type-error or incorrect behavior) | 5 | 0 | 4 in `integration.ts`, 1 in `compaction.ts` — pre-existing TS errors caught by `tsc` |
| **P2** (quality / robustness) | ~12 | 0 | Effect.die control flow, wildcard exports, missing JSDoc, etc. |
| **P3** (style / nits) | many | 0 | cosmetic |

**Overall code quality**: solid. Effect-based architecture is well-typed. No SQL injection. No `shell:true` spawns. No `eval`/`new Function`. Credential encryption uses AES-256-GCM with PBKDF2 (100k iter). File-mutation paths go through `fs-util` `contains()` check. Log redaction is comprehensive. SSRF protection present (though incomplete — see P2-3).

---

## P0 — Critical (1)

### P0-1: `src/plugin/provider/dynamic.ts` — `path` and `require("fs")` used but not imported
- **Symptom**: File uses `path.resolve(...)` (lines 39–40) and `require("fs").realpathSync(...)` (line 41) but only imports `pathToFileURL` from `"url"`. In an ESM module (project `type: "module"`), `require` is undefined, and `path` is a free identifier — both would throw `ReferenceError` at runtime on first invocation of `DynamicProviderPlugin`.
- **Impact**: Any attempt to load a `file://` AI SDK provider (a deliberate security-allowlisted code path) would crash the plugin.
- **Fix applied**: Added `import { realpathSync } from "fs"` and `import path from "path"`. Replaced `require("fs").realpathSync(resolvedPath)` with `realpathSync(resolvedPath)`.
- **Verified**: `tsc --noEmit` no longer flags `dynamic.ts`. No new errors introduced.

---

## P1 — Real Bugs (5)

### P1-1: `src/integration.ts:434` — `Integration.connect.key` returns `undefined` but type expects `void`
- Effect fails with `NotFoundError` but the declared error type for the method (in `Interface`) is only `AuthorizationError`. Effect's typed-channel rejects `NotFoundError`. Runtime works (fails fast) but type signature is wrong, and downstream `Effect.tap`/`Effect.mapError` chains will silently lose typing.

### P1-2: `src/integration.ts:446` — same `NotFoundError` mismatch in `Integration.connect.oauth`
- Same root cause. Both `NotFoundError` should be added to the method's `Interface` declared error type, OR a tag-mapped error (`AuthorizationError({ reason: "not-found" })`) should be used.

### P1-3: `src/integration.ts:488` — `Integration.attempt.status` returns `NotFoundError` but declared `never`
- Returns `Effect.fail(new NotFoundError(...))` on missing attempt, but the `Interface` declares the error channel as `never`. Pre-existing tsc error.

### P1-4: `src/integration.ts:496` — `Integration.attempt.complete` also leaks `NotFoundError`
- Same pattern. Should be added to error type union or remapped.

### P1-5: `src/session/compaction.ts:199` — `.text` access on discriminated union without narrowing
- Loop reads `input.entries[i].message.text` after checking `message.type === "user"`. The compiler can't narrow the union because the `for` loop index `i` is captured by closure. At runtime the code is safe (first match is the most recent user), but the access is unsound by the type system. Fix: use `Array.prototype.findLast` or store the narrowed message in a local `const` before reading `.text`.

**Not fixed inline** — these are pre-existing TS errors, all surfaces are stable but the type contracts are inaccurate. Recommend a focused PR that updates the `Interface` declarations to match actual error channels.

---

## P2 — Quality / Robustness (~12)

### P2-1: `Effect.die` used for control flow in `session/runner/llm.ts`
- 10 sites use `Effect.die(rebuildPreparedTurn(...))` and `Effect.die(new TurnTransitionError(...))` to short-circuit turns. The class is a custom error used as a typed-control-flow signal. This is an anti-pattern: `Effect.die` converts a recoverable branch into a fiber defect, which can trigger the supervisor's crash handler. Recommend a `TurnTransitionError extends Error` returned via a normal `Effect.fail` (already done in some paths, mixed in others).

### P2-2: Wildcard export `"./*": "./src/*.ts"` in `package.json`
- All internal files (including `credential/encryption.ts`, `database/schema.gen.ts`, `permission/saved.ts`) are reachable from any consumer. `_internalExports` field acknowledges this is for migration; the wildcard is still wide-open and the dangerous files are not yet split out. Recommend a stricter allowlist now (move `src/public/*` to `./public` and gate everything else).

### P2-3: SSRF protection in `tool/webfetch.ts` is incomplete
- Blocklist regex covers `10/8`, `172.16/12`, `192.168/16`, `0/8`, plus 5 hardcoded hostnames. **Missing**: `127.0.0.0/8` (only `localhost` literal is blocked — `127.0.0.5` slips through), `169.254.0.0/16` (cloud metadata — most critical!), `100.64.0.0/10` (CGNAT), `224.0.0.0/4` (multicast), IPv6 `fc00::/7` (ULA), `fe80::/10` (link-local), `::ffff:` (IPv4-mapped). Also no DNS-rebinding protection: an attacker-controlled DNS can resolve a public hostname to an internal IP at request time. Recommend an allowlist (public-only) or a resolving proxy that validates the resolved IP before the request goes out.

### P2-4: 404-line `permission.ts` monolith
- Permission module is one file. No internal subdivision (rules, persistence, evaluation). Recommend splitting into `permission/rules.ts`, `permission/evaluate.ts`, `permission/registry.ts` (already partially done with `permission/saved.ts`, `permission/schema.ts`, `permission/sql.ts` — finish the split).

### P2-5: 669-line `event.ts`
- Event registry, definition, layer, replay, sync — all in one file. Manageable but room for `event/registry.ts`, `event/layer.ts`, `event/replay.ts`.

### P2-6: 636-line `v1/session.ts` — deprecated V1 still actively maintained
- File is marked `@deprecated` but contains the full V1 message/part schema, including the `OutputFormatJsonSchema` with `retryCount` default. Tests likely still depend on it. The deprecation marker is documentation-only; no deprecation gate exists.

### P2-7: `redact.ts` env-secret list recomputed on every log line
- Comment acknowledges this (F-REDACT-1). 50+ ms of work for high-volume logging if many env vars match. Recommend a debounce (recompute only if env mtime changes, or every 5 s).

### P2-8: `websearch.ts` URL handling — no documented input validation
- Quick scan shows it delegates to a provider SDK; if a future provider is added, malformed URL inputs are not validated. Should centralize URL validation in a single helper (like `webfetch.ts` `assertHttpUrl`).

### P2-9: `npm.ts` uses `Effect.promise(() => import("@npmcli/arborist"))` — but also `arborist.reify` is `try/catch`ed into `InstallFailedError`. No timeout. A long-running `npm install` could tie up a fiber forever. Recommend a `Duration` timeout.

### P2-10: `git.ts` (445 lines) — no `shell:true` (good), but command-arg assembly happens in many places. Audit for git-arg injection (`--upload-pack`, `-c`, `ext.`) — manual review not yet completed.

### P2-11: `cross-spawn-spawner.ts` (511 lines) — env sanitization not yet reviewed. Comment indicates env-vars are forwarded selectively; full check needed.

### P2-12: Missing JSDoc on most public exports of large files (`integration.ts`, `session/event.ts`, `event.ts`). The 38-skill orchestration relies on these — IDE-inferred types alone are insufficient for the API consumer.

---

## P3 — Style / Nits (many)

- 4 occurrences of `as any` (lowest count in this monorepo — good).
- 87 `TODO` markers (cluster: write tool, lsp integration, formatter runtime, snapshots/undo).
- Long file `github-copilot/responses/openai-responses-language-model.ts` (1770 lines) is verbose AI-SDK boilerplate — could be split by request/response shape.
- `integration.ts` has `attempts: SynchronizedRef.makeUnsafe(...)` (line 279) — `makeUnsafe` is documented as such but reads as concerning; verify the pre-init race window is acceptable.

---

## Fixes Applied

| File | Severity | Change |
|------|----------|--------|
| `packages/core/src/plugin/provider/dynamic.ts` | P0 | Added `import { realpathSync } from "fs"` and `import path from "path"`. Replaced `require("fs").realpathSync(...)` with `realpathSync(...)`. |

**Verification**:
```
$ npx tsc --noEmit -p packages/core/tsconfig.json
# Errors in dynamic.ts: 0 (was 1)
# Pre-existing errors in integration.ts and compaction.ts: 5 (unchanged)
```

**Risk of fix**: minimal. `realpathSync` is the documented node API for resolving symlinks; replacing `require("fs")` with a top-level `import` is the ESM-correct form. Behavior unchanged on success paths; on failure paths the surrounding `try/catch` already converts to `undefined`, matching prior semantics.

---

## Recommendations (priority order)

1. **P1-1 to P1-5** — type contract fix in `integration.ts` and `compaction.ts`. Single PR. Should be done before next minor.
2. **P2-3** — SSRF protection. Pull request blocked on this if the tool is exposed to the internet. Single PR.
3. **P2-2** — gate wildcard exports via a curated allowlist. Single PR.
4. **P2-1** — `Effect.die` → `Effect.fail` migration in `llm.ts`. Larger refactor, can be deferred.
5. **P2-4 / P2-5** — split `permission.ts` and `event.ts` into focused files.
6. **P2-9** — `npm.ts` install timeout.

---

*Generated: 2026 audit pass. Reviewed by: deep code audit. Verified: tsc clean for `dynamic.ts`.*
