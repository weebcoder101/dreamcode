# F-003 — safeStorage Server Credential — Fix Status

## Status: RESOLVED (verified 2026-08-27)

## Problem
`packages/console/app/src/lib/stats-proxy.ts` (and 3 other files) stored 
the `OPENCODE_SERVER_PASSWORD` and API tokens in plain `localStorage` on 
the renderer side. The `safeStorage` Electron API (OS keychain) was 
available but unused for the server credential. A malicious browser 
extension, devtools session, or compromised renderer could exfiltrate 
the server password and use it to access the local opencode instance 
over the network.

## Resolution Path

### 1. IPC channel naming
Renamed to singular form for consistency:
- `server-get-credential`
- `server-set-credential`
- `server-delete-credential`

### 2. Fail-closed safeStorage contract
- `setServerCredential` throws if safeStorage is unavailable
- `getServerCredential` returns null if unavailable (not the raw value)
- `deleteServerCredential` returns false (does not throw) if unavailable

### 3. Migration: server.v3 → server.v4
The migration drops `http.password` from the old config so the plain 
text password never gets migrated. New credentials are written 
exclusively via `setServerCredential` into the OS keychain.

### 4. Files touched
- `packages/core/src/credential/encryption.ts` — new Credential class 
  wrapping safeStorage with the fail-closed contract
- `packages/console/app/src/lib/stats-proxy.ts` — uses Credential.load 
  for outbound proxy auth
- `packages/console/app/src/context/auth.ts` — auth context uses 
  Credential
- `packages/console/app/src/routes/honeycomb/webhook.ts` — uses 
  Credential
- `packages/console/app/src/routes/stripe/webhook.ts` — uses Credential
- `packages/console/function/src/auth.ts` — function-side auth uses 
  Credential
- `packages/desktop/src/main/ipc.ts` — defines the 3 IPC channels
- `packages/desktop/src/main/index.ts` — registers IPC handlers
- `packages/desktop/src/preload/index.ts` — exposes channels to 
  renderer
- `packages/desktop/src/preload/types.ts` — TypeScript types
- `packages/enterprise/src/routes/api/[...path].ts` — uses Credential
- `packages/app/src/context/server.tsx` — calls IPC channels
- `packages/app/src/components/server/server-row.tsx` — uses server 
  context
- `packages/app/src/components/dialog-select-server.tsx` — uses server 
  context

## Verification
- `npx tsc --noEmit -p packages/console/tsconfig.json` → 0 errors
- `npx tsc --noEmit -p packages/console/function/tsconfig.json` → 0 errors
- `npx tsc --noEmit -p packages/core/tsconfig.json` → 0 errors
- `npx tsc --noEmit -p packages/enterprise/tsconfig.json` → 0 errors
- `npx tsc --noEmit -p packages/desktop/tsconfig.json` → 0 errors
- `npx tsc --noEmit -p packages/app/tsconfig.json` → 0 errors
- All 5 batches of edits applied; final batch verified by dream-gate.

## Notes
The Credential class is the single source of truth for OS-keychain 
storage in the codebase. Any future credential that needs persistent 
storage should use `Credential.load` and `Credential.set` rather than 
touching localStorage directly.

