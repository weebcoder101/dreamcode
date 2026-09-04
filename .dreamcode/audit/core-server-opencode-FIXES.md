# Audit Fixes — core-server-opencode

**Audit date**: 2026-09-15
**Companion to**: `core-server-opencode-FINDINGS.md`
**Scope**: 1 P1 + 9 P2 fixes from the audit of `packages/core/**` and `packages/server/**`.

## Fix Priority

- **F-AUTH-3 (P1)**: server accepts Basic credentials via `?auth_token=` query string.
- **F-AUTH-1 (P2)**: non-constant-time password compare in `auth.ts`.
- **F-AUTH-2 (P2)**: `header()` embeds env-derived password into outgoing requests.
- **F-REDACT-1 (P2)**: env-derived secret cache in `redact.ts` is one-shot.
- **F-REDACT-2 (P2)**: hand-maintained sensitive field-name list.
- **F-PWD-1 (P2)**: `identifier.ts` counter wraps every 2^53.
- **F-SCHEMA-1 (P2)**: `externalID` array-order contract.
- **F-LOGINTEGRATION-1 (P2)**: `Effect.die` for missing integration methods.
- **F-PERM-1 (P2)**: `permission.ts reply()` cascade iteration.
- **F-DB-1 (P2)**: `database/schema.gen.ts` is generated; do not hand-edit.

This audit session applies **F-AUTH-3** (the only P1) and **F-AUTH-1, F-REDACT-1, F-LOGINTEGRATION-1** (the most-impactful P2s). The rest are tracked for follow-up.

## F-AUTH-3 (P1) — Drop the `?auth_token=` URL query branch

**File**: `packages/server/src/middleware/authorization.ts`
**Risk**: Credentials leak in URL access logs, browser history, `Referer` headers, test fixtures, and pasted links.
**Fix**: Remove the `auth_token` query-string branch from `credentialFromRequest`. Credentials are only honored via the `Authorization: Basic` header.
**Backward compat**: The URL branch is dropped, but a one-cycle deprecation shim is in place (F-AUTH-3-SOFTEN below) so the change is observable: the server logs a `WARN` and returns `401` with a deprecation hint whenever a client sends `?auth_token=`. Operators can grep server logs for `F-AUTH-3 deprecation` to find stragglers.

## F-AUTH-3-SOFTEN — One-cycle deprecation shim for `?auth_token=`

**File**: `packages/server/src/middleware/authorization.ts`
**Purpose**: Make the F-AUTH-3 breaking change observable so operators can find clients that haven't migrated.
**Fix**: `hasDeprecatedAuthToken(request)` only checks for the presence of the `auth_token` URL parameter — it intentionally does NOT decode the credential from the URL (that would be the original leak). When the parameter is detected, the middleware emits `Effect.logWarning("F-AUTH-3 deprecation: client sent Basic credentials in ?auth_token= URL query string...")` and returns `401` with a `WWW-Authenticate: Basic; error="deprecated_query_auth_token"; docs="https://opencode.ai/docs/server-auth"` header.
**Removal**: After one release cycle, drop the `hasDeprecatedAuthToken` branch and the related constants. The deprecation hint URL can be retired when no client logs the warning.

## F-AUTH-1 (P2) — Constant-time password compare

**File**: `packages/server/src/auth.ts`
**Risk**: Non-constant-time `===` could leak password length/contents to a same-host attacker.
**Fix**: Use `crypto.timingSafeEqual` on equal-length buffers. If buffer lengths differ, return `false` early (don't `timingSafeEqual` mismatched lengths).

## F-REDACT-1 (P2) — Refresh env-derived secret cache

**File**: `packages/core/src/observability/redact.ts`
**Risk**: Long-running process that picks up new env-derived secrets after first redact call won't have them redacted.
**Fix**: Drop the cache, or invalidate the cache on every redact call. The `Object.entries(process.env)` walk is microseconds; the cost is negligible compared to the safety gain. Keep `refreshEnvSecrets()` for tests but no longer rely on it in production paths.

## F-LOGINTEGRATION-1 (P2) — Typed error for missing methods

**File**: `packages/core/src/integration.ts`
**Risk**: `Effect.die` on missing method crashes the fiber rather than returning a typed error.
**Fix**: Replace `Effect.die("Key method not found: ...")` with `Effect.fail(new IntegrationNotFoundError({ integrationID, methodID? }))` where `IntegrationNotFoundError` is a new tagged error class. Add the error to the `Error` union.

## Fix list summary

| ID | File | Grade | Action |
|----|------|-------|--------|
| F-AUTH-3 | `packages/server/src/middleware/authorization.ts` | P1 | Drop `?auth_token=` query branch |
| F-AUTH-3-SOFTEN | `packages/server/src/middleware/authorization.ts` | P1 shim | One-cycle deprecation WARN + 401 hint |
| F-AUTH-1 | `packages/server/src/auth.ts` | P2 | Use `crypto.timingSafeEqual` |
| F-REDACT-1 | `packages/core/src/observability/redact.ts` | P2 | Drop env-secret cache |
| F-LOGINTEGRATION-1 | `packages/core/src/integration.ts` | P2 | Replace `Effect.die` with typed `IntegrationNotFoundError` |
| F-AUTH-2 | `packages/server/src/auth.ts` | P2 | Track in maintenance |
| F-REDACT-2 | `packages/core/src/observability/redact.ts` | P2 | Track in maintenance |
| F-PWD-1 | `packages/core/src/util/identifier.ts` | P2 | Track in maintenance |
| F-SCHEMA-1 | `packages/core/src/schema.ts` | P2 | Track in maintenance |
| F-PERM-1 | `packages/core/src/permission.ts` | P2 | Track in maintenance |
| F-DB-1 | `packages/core/src/database/schema.gen.ts` | P2 | Do not hand-edit |
