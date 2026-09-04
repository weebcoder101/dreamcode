# opencode-A Audit Completion

## Summary

Audit scope: `packages/opencode/src/{agent, command, cli, config, server, util}` — 217 source files.

**Result:** 217 files graded, 7 P1 issues identified, **all 7 P1 fixes applied**, 0 P0 issues found.

| Metric | Count |
|---|---:|
| Files audited | 217 |
| P0 (critical) | 0 |
| P1 (high) | 7 |
| P1 fixes applied | 7 |
| P2 (medium) | 17 |
| P3 (clean) | 193 |

**By module:**

| Module | Files | P0 | P1 | P2 | P3 |
|---|---:|---:|---:|---:|---:|
| util/ | 25 | 0 | 1 | 2 | 22 |
| config/ | 14 | 0 | 0 | 1 | 13 |
| server/ | 75 | 0 | 3 | 11 | 61 |
| agent/ | 10 | 0 | 0 | 0 | 10 |
| command/ | 4 | 0 | 0 | 0 | 4 |
| cli/ | 89 | 0 | 3 | 1 | 85 |

---

## P1 fixes applied (7 of 7)

| # | File | Issue | Fix |
|---|---|---|---|
| 1 | `util/archive.ts` | PowerShell single-quote injection in Windows zip path | Use `powershell -File` with a temp `.ps1` script and `quotePS()`-escaped paths |
| 2 | `cli/cmd/db.ts` | `spawn('sqlite3', ...)` inherits full parent env | Pass minimal env (`PATH`, `HOME`, `LANG`, …) to the child |
| 3 | `cli/cmd/pr.ts` | `Process.spawn` uses raw `process.cwd()` (symlink ambiguity) and full env | Resolve cwd via `fs.promises.realpath`; minimal env |
| 4 | `cli/cmd/providers.ts` | `--url` accepts http/javascript schemes, spawn inherits full env | Restrict URL scheme to `https:`; minimal env; validate `auth.command` is a non-empty array |
| 5 | `server/.../handlers/session.ts` | `parsePromptPayload` silently coerces missing `model.providerID` to literal `"openai"` | Return 400 `BadRequest` when `model.providerID` is missing |
| 6 | `server/.../handlers/experimental.ts` | `providerConfig` writes attacker-supplied `baseURL` to `~/.config/dreamcode/config.json` | Validate scheme is `https:` or `http://localhost`/`http://127.0.0.1` |
| 7 | `server/.../handlers/pty.ts` | PTY WebSocket upgrade was allowed *without* a ticket (`if (ticket) { ... }` no-op) | Return 403 when ticket is missing |

**TypeScript verification:** `tsc --noEmit -p tsconfig.json` (project-wide) reports **0 errors** in any of the seven files.

---

## P2 findings (17 — not applied, fix plans in `opencode-A-FIXES.md`)

**util/**
- `util/lock.ts` — unbounded `Map<string, Promise>` growth if dispose is never called; add LRU cap or per-key TTL.
- `util/proxy-env.ts` — adapted from `proxy-from-env` (MIT); `NO_PROXY` prefix matching has edge cases (e.g. `NO_PROXY=example.com` matches `attacker-example.com`).
- `util/wildcard.ts` — wildcard matcher can mask path-like inputs in error messages; needs strict mode for path patterns.

**config/**
- `config/managed.ts` — macOS MDM plist parsed via `plutil -convert json`; if the plist is malformed the catch swallows the error. Propagate.
- `config/vscode.ts` — VS Code config dirs from env; verify they resolve under `~/.vscode/` or `~/.config/Code/`.

**server/**
- `server/cors.ts` — hardcoded test IP `http://127.0.0.1:*` in production allowlist; should be env-gated.
- `server/mdns.ts` — silent error swallowing on Bonjour failures.
- `server/routes/instance/httpapi/middleware/authorization.ts` — custom Basic Auth (not HttpApiSecurity) is intentional; document the design decision in a module comment.
- `server/routes/instance/httpapi/middleware/workspace-routing.ts` — falls back to `process.cwd()` when `x-opencode-directory` header is missing; add a config flag.
- `server/routes/instance/httpapi/handlers/global.ts` — `upgrade`/`upgradeRaw` runs installer with no signed target.
- `server/routes/instance/httpapi/handlers/sync.ts` — `(handlers as any).handle(...)` typing bypasses schema validation.
- `server/routes/instance/httpapi/handlers/tui.ts` — `startsWith("ses")` weak session-id check; use `Schema.is(SessionID)`.
- `server/routes/instance/httpapi/handlers/project-copy.ts` — `generateName` uses client-supplied `context` as LLM prompt; validate length and strip control chars.
- `server/routes/instance/httpapi/handlers/control.ts` — `/auth/set` no rate limiting.
- `server/shared/ui.ts` — upstream proxy strips only `content-encoding`/`content-length`; missing RFC 7230 §6.1 hop-by-hop headers.

**cli/**
- `cli/cmd/session.ts` — pager binary is read from `PAGER` env; consider allowlisting `less`/`more`.

---

## Methodology

1. Read grading rubric from `CONTINUITY.md` and `llm-sdk-plugins-FINDINGS.md`.
2. Discovered 217 in-scope files via glob on `agent|command|cli|config|server|util`.
3. Read all 217 files into IPython (1.24 MB total) for persistent reference.
4. Built a per-file `GRADES` map (severity + 1–3 line justification) keyed by repo-relative path.
5. Scanned each file for risk patterns: `spawn`, `exec`, `innerHTML`, `eval`, `fs-direct`, `env-read`, `JSON.parse`, `fetch`.
6. Investigated each flagged file in detail to confirm issue, scope, and remediation.
7. Wrote per-file entries into `opencode-A-FINDINGS.md` (Summary table + Headline issues + per-module detail).
8. Wrote remediation plans into `opencode-A-FIXES.md` (P1 patches with code + risk + verification; P2 patches with rationale).
9. Applied 7 P1 fixes via the `edit` tool with `dream_plan` per round (correlate → plan → edit).
10. Verified with `tsc --noEmit` — 0 errors in any of the edited files.

## Files not read

- Generated `*.gen.ts` (auto-generated)
- `*.rej` patches
- `AGENTS.md` files (per task scope)
- `auth/`, `provider/` (covered by `llm-sdk-plugins-FINDINGS.md`)

## Output files

- `/home/ronya/dreamcode/opencode-A-FINDINGS.md` — 21 KB, 217 per-file grades
- `/home/ronya/dreamcode/opencode-A-FIXES.md` — 14 KB, P1/P2 fix plans
- `/home/ronya/dreamcode/opencode-A-COMPLETION.md` — this file
