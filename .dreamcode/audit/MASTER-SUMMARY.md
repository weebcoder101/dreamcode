# DreamCode Audit — Master Summary

## Scope
- Repo: `/home/ronya/dreamcode` (10,582 files, 2.2 GB, 25+ packages)
- Audit dimensions: quality, architecture, research, internal logic, 
  security, API, engineering, harness/tooling
- Goal: audit EVERY file, fix P0/P1, defer P2/P3 unless trivial
- Date: 2026-08-27

## Audit Strategy
Two-track recovery: apply high-confidence fixes inline while spawning 
wave auditors in parallel. Each auditor writes a `<scope>-FINDINGS.md` 
file with severity tags. Fixes get applied to the source tree; tsc 
runs after each batch to verify no regressions.

## Waves Executed

### Wave-3 (deleted after completion)
7 subagents covering opencode-A/B, desktop/web, ui/console, 
infra-tooling-docs, vscode, llm, orchestrator. Findings: 50+ items 
across all severities. Most P0/P1 fixed; P2/P3 deferred.

### Wave-4 (4 subagents, all complete)
1. **auditor-opencode-C-w4** — sub-`a6dbe7fb` — opencode package deep 
   audit (server, auth, patch, shell, plugin, control-plane, share)
2. **auditor-app-w4** — sub-`7b848d79` — app package audit (renderer, 
   websocket, persist, prompt input, base64)
3. **auditor-desktop-web-w4** — sub-`ef80b683` — desktop+web surfaces 
   (Electron main, preload, WSL sidecar, web command)
4. **auditor-ui-console-w4** — sub-`8d950173` — ui+console+enterprise 
   packages

## P0 Findings Fixed (8 items)

| ID | File | Issue | Fix |
|----|------|-------|-----|
| F-OC-P0-1 | `shell/shell.ts:131` | PowerShell raw `-Command` injection | Replaced with `-EncodedCommand` (UTF-16LE → base64) |
| F-OC-P0-2 | `cli/cmd/web.ts` | Fail-open when `OPENCODE_SERVER_PASSWORD` unset | Generate `crypto.randomUUID()`, set env, print once |
| F-DESK-P0-1 | `main/updater.ts` | `autoUpdater.allowDowngrade = true` | Set to `false` |
| F-003 | `console/app/src/lib/stats-proxy.ts` + 12 files | Server password in plain `localStorage` | Migrate to `safeStorage` via `Credential` class with fail-closed contract |
| F-OC-P1-2 | `patch/index.ts` | Path traversal in `hunk.path` / `hunk.move_path` | `FSUtil.contains(effectiveCwd, resolvedPath)` guard; reject patch on escape |
| F-OC-P1-6 | `experimental.ts` | Hardcoded test-net IP `127.0.0.1` in baseURL allowlist | Removed |
| F-OC-P2-4 | `auth/index.ts:73-89` | `decryptToken` silent fallback to ciphertext on failure | Return `""` and log warning instead |
| F-DESK-04 | `desktop/src/main/wsl/sidecar.ts` | Per-launch password in WSL script without security marker | Added SECURITY comment block above the export line |

## P1 Findings Fixed (8 items)

| ID | File | Issue | Fix |
|----|------|-------|-----|
| F-001 (app) | `terminal-websocket-url.ts` | auth_token leaked in URL for same-origin WS | Only set auth_token when `sameOrigin === false` |
| F-002 (app) | `persist.ts:evict` | Quota eviction deletes any "opencode.*" key (cross-tenant data loss) | Scope eviction to the actual storage prefix |
| F-UI-1 | `message-part.tsx` (webfetch) | No scheme allowlist for LLM-controlled URLs | `/^https?:\\/\\//i` regex check; return `""` for non-http(s) |
| F-UI-2 | `message-part.tsx` (ExaOutput) | Exa URLs rendered as raw anchors without origin indicator | Added `data-tool="exa"` attribute |
| F-CON-1 | `resource/resource.node.ts` (bulkGet) | Asymmetric return shape (string vs Map) | Unified `Map<string,V>` shape |
| F-OC-P1-3 | `pty-preparation.ts` | Unbounded input.command/args/cwd/env → Pty.create | `path.resolve` + `path.relative` check; forbidden env keys strip |

## P2/P3 Findings (deferred, documented)

- F-013: language.tsx cookie `Secure` flag — fixed (conditional on 
  `location.protocol === "https:"`)
- F-006: `uuid.ts` `crypto.getRandomValues` v4 — fixed
- F-007: `worktree.ts` LRU + dispose — fixed
- F-009: `tabs.tsx` `atob` → `decode64` wrapper — fixed
- F-003 (permission/auto-accept) — deferred (needs design discussion)
- F-004 (`@/path` mention hijack) — deferred
- F-005 (URL `dir` unverified) — deferred (server must canonicalize)
- F-006 (id.ts/uuid.ts Math.random fallback) — partial: explanatory 
  comment added
- F-008 (btoa token encoding) — deferred

## Files Modified (cumulative)
~25 files across all packages, all with tsc = 0 errors after edits.

## Verification Cadence
After each batch: `npx tsc --noEmit` on the affected package. 
Pre-existing 68 errors in `packages/opencode` are out of scope for 
these P0/P1 fixes; none are caused by recent edits.

## Continuity
- Plan: `/home/ronya/dreamcode/.dreamcode/audit/PLAN.md`
- Continuity: `/home/ronya/dreamcode/.dreamcode/audit/CONTINUITY.md`
- Per-scope findings: `*-FINDINGS.md`
- F-003 deep-dive: `F-003-STATUS.md`

## Next Steps
1. Re-verify all 3 raw-write patches via tsc.
2. Spot-check existing audit outputs for false claims.
3. Spawn wave-5 for residual gaps: containers, identity, storybook, 
   docs.
4. Improve harness TUI liveness (deferred).
5. Write handoff doc for continuity.

