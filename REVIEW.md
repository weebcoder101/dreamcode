# Architecture & Security Review — DreamCode/OpenCode

**Date:** 2026-07-08  
**Scope:** Full monorepo — 20+ packages, ~2,100 TypeScript files, Effect-TS runtime, dual-server architecture  
**Reviewers:** The Architect (system design), The Sentinel (security/threats), The Analyst (code review/standards)

---

## Executive Summary

DreamCode is a sophisticated AI-agent orchestration runtime forked from OpenCode, adding a 38-skill graph, sensor-gate enforcement, Pieces LTM integration, and QuickJS workflow sandboxing. The architecture follows Effect-TS layered service patterns with strong conceptual foundations (dependency inversion, Context.Tag service pattern, structured concurrency).

**However, several critical security and architecture issues undermine the system:** authentication credentials leak via URL query parameters (bypassing the intended Basic auth header mechanism), the permissive `localhost:*` CORS policy enables localhost cross-origin attacks, encryption keys are derived from deterministic machine identity (`/etc/machine-id`) which is recoverable by any process on the same machine, and `Effect.die` is used pervasively (38+ occurrences just in `session/`) for expected control flow — defeating Effect-TS's type-safe error tracking entirely. The wildcard export map in `packages/core` exposes all 45+ internal modules as public API, making the intended `public/` boundary meaningless.

These are not theoretical concerns — the combination of `auth_token` query parameters and permissive CORS means a local browser extension or dev server can make credentialed requests to the server without encountering same-origin restrictions.

---

## 1. Tech Stack Overview

| Layer | Technology |
|---|---|
| **Runtime** | TypeScript + Bun (compiled binaries via bun build --compile) |
| **Framework** | Effect-TS v4 beta (Context, Layer, Schema, Stream, Fiber) |
| **Database** | SQLite via Drizzle ORM (Bun + Node dual-platform) |
| **Server** | Local HTTP (Effect HttpApi) + Cloudflare Worker (SST) |
| **Auth** | Basic auth + OAuth (GitHub, Azure, GitLab, Google) |
| **Encryption** | AES-256-GCM with PBKDF2 key derivation (credentials), AES-256-GCM (OAuth tokens) |
| **AI/LLM** | AI SDK v3 (18 provider packages), OpenRouter, custom provider plugin system |
| **Packages** | 20+ workspace packages (`core`, `opencode`, `server`, `ui`, `web`, `infra`, `llm`, `plugin`) |
| **CI/CD** | GitHub Actions (deploy, PR checks), SST for Cloudflare Workers |

---

## 2. Architecture Analysis

### 2.1 High-Level Structure

The system has a dual-server architecture:

```
┌─────────────────────────────────────────────────────┐
│                   opencode server                    │
│  (Local daemon — Effect HttpApi, tools, sessions)   │
│                                                      │
│  +-----------+  +----------+  +------------------+  │
│  | Auth/CRUD |  | Sessions |  | Tool Registry    │  │
│  | Layer     |  | Runner   |  | (18 built-in    │  │
│  |           |  | + Epoch  |  |  + N plugin)    │  │
│  +-----------+  +----------+  +------------------+  │
│        │              │                │             │
│  +-----------+  +----------+  +------------------+  │
│  | Credential|  | Permission| | Skill Chain     │  │
│  | Store     |  | Evaluator| | Orchestrator    │  │
│  +-----------+  +----------+  +------------------+  │
└───────────────────────┬─────────────────────────────┘
                        │ WebSocket / HTTP
┌───────────────────────┴─────────────────────────────┐
│            Cloudflare Worker (SST)                    │
│  (Public API, webhook handling, monitoring)           │
└─────────────────────────────────────────────────────┘
```

### 2.2 Strengths

- **Effect-TS service pattern** — Clean Context.Tag/Service/Layer separation; services are composable and testable at the layer level.
- **Dependency injection** — `Layer.provide(...)` chains make service wiring explicit and auditable.
- **Dual-platform support** — Bun/Node conditional imports via `#imports` in `package.json` (sqlite, pty, filesystem).
- **Permission system** — Fine-grained wildcard-based permission evaluation with user approval prompts.
- **Structured concurrency** — Effect.Scope, fibers, and interruption handling are well-implemented.
- **V1/V2 migration path** — Deprecated V1 schemas preserved with projector bridge for backward compatibility.

### 2.3 Architecture Anti-Patterns & Concerns

#### [CRITICAL] Pervasive `Effect.die` for Expected Control Flow
- **Files:** `packages/core/src/session/input.ts`, `session/context-epoch.ts`, `session/projector.ts`, `session/runner/llm.ts`
- **Count:** 38 matches in `session/` alone; 70+ across `packages/core/src/`
- **Issue:** `Effect.die` creates defects (uncatchable by upstream `Effect.catch`, only `catchDefect`). This:
  - Defeats type-safe error tracking (all callers must know to use `catchDefect`)
  - Masks bugs — `catchDefect` silences programming errors alongside intended control flow
  - Makes error recovery fragile — `retryAgentMismatch` in `llm.ts` uses `catchDefect` to catch `TurnTransitionError` that was thrown via `Effect.die`
- **The codebase already acknowledges this** — documented in `packages/core/src/session/runner/AGENTS.md` as a known anti-pattern.

#### [HIGH] Wildcard Export Leaks All Internals
- **File:** `packages/core/package.json:24` — `"./*": "./src/*.ts"`
- **Issue:** Any consumer can import any internal module as `@opencode-ai/core/<any-path>`, bypassing the intended `public/` and `internal/` boundary. Commented `_internalExports` field acknowledges migration intent.
- **Impact:** Module boundaries are enforced by convention only. A future refactor that renames a private file breaks all consumers.

#### [HIGH] Session Runner Monolith (409 lines)
- **File:** `packages/core/src/session/runner/llm.ts`
- **Concerns handled:** Context epoch orchestration, LLM request building, provider streaming, tool settlement, overflow recovery, step counting, retry logic
- **Recommendation:** Decompose into `TurnOrchestrator`, `ToolSettlementManager`, `ContinuationPolicy` (AGENTS.md already lists this as a TODO)

#### [HIGH] Session God-Module (436 lines, 25+ imports)
- **File:** `packages/core/src/session.ts`
- **Concerns mixed:** listing, CRUD, compaction, search, sharing, logging
- **Recommendation:** Split into `session-crud.ts`, `session-search.ts`, `session-compact.ts`, `session-share.ts`

#### [MEDIUM] No Repository Abstraction
- **Files:** `packages/core/src/credential.ts`, `packages/core/src/session/input.ts`
- **Issue:** Drizzle queries embedded directly in service implementations. No `SessionRepository` or `CredentialRepository` interface.
- **Impact:** Unit testing DB failures requires mocked Drizzle instances rather than simple interface stubs.

#### [MEDIUM] Dual Skill Registries Diverged
- **Paths:** `.dreamcode/skills/` (38 dirs) vs `.opencode/skills/` (37 dirs)
- **Gap:** `token-predictor` present in `.dreamcode/skills/` but missing from `.opencode/skills/`
- **Impact:** Confusion about authoritative source. Chain execution may behave differently depending on which registry path is used.

#### [MEDIUM] Missing Evolution Infrastructure
- **Paths referenced:** `evolution/run_log.jsonl`, `evolution/pieces_writes.jsonl`
- **Actual state:** `evolution/` contains only `agent_score.json`, `guardian_ai.jsonl`, `shipping_questions_log.jsonl` — neither expected file exists despite 40+ recorded runs
- **Impact:** The automated-learning post-step references files that don't exist; persistence enforcement is non-functional

#### [LOW] Permission `findLast` Ordering Sensitivity
- **File:** `packages/opencode/src/permission/index.ts:42-51`
- **Issue:** `findLast` means last matching rule wins. `merge()` (line 213) naively concatenates rulesets from different scopes. A broad `allow` rule at the end can silently override a narrow `deny` rule declared earlier.
- **Best practice:** The permission model should validate invariants on ruleset merge (e.g., broad allows must be at the end of the ruleset).

---

## 3. Security Analysis

### 3.1 🔴 CRITICAL

#### C1 — Auth Credentials in URL Query Parameter + Permissive localhost CORS
- **Files:** `packages/server/src/middleware/authorization.ts:33` + `packages/opencode/src/server/cors.ts:13`
- **OWASP:** A2 (Broken Auth) / A5 (Misconfiguration) / A1 (Broken Access Control)
- **Description:** Two independent issues that combine into a practical exploit:

  **Issue A** (`authorization.ts:33`): The `auth_token` URL query parameter is Base64-decoded and treated as valid Basic auth credentials:
  ```typescript
  const token = url.searchParams.get(AUTH_TOKEN_QUERY)  // "auth_token"
  if (token) return decodeCredential(token)
  ```
  URLs are logged by servers, proxies, and browsers; leak via Referrer headers; visible in `ps aux` and browser history.

  **Issue B** (`cors.ts:13`): `isAllowedCorsOrigin` permits every `http://localhost:*` origin:
  ```typescript
  if (input.startsWith("http://localhost:")) return true
  if (input.startsWith("http://127.0.0.1:")) return true
  ```
  **Combined vector:** Any web page or local application on the same machine (browser extension, dev server, Electron app) can make credentialed requests with the `auth_token` parameter and bypass same-origin policy entirely.

- **Fix:** Remove `auth_token` query parameter support. If legacy clients require it, use HMAC-signed tokens with short expiration. Lock down CORS to specific known ports (19876, 4096).

---

### 3.2 🟠 HIGH

#### H1 — Encryption Key Derived from Deterministic Machine Identity
- **Files:** `packages/core/src/credential/encryption.ts:29-46`, `packages/opencode/src/auth/index.ts:40-42`
- **OWASP:** A2 (Cryptographic Failure)
- **Description:** Both credential stores derive encryption keys from `/etc/machine-id` (Linux) or `$HOME` hash:

  **Core credential store** (`encryption.ts`):
  ```typescript
  function getMachineId(): string {
    if (existsSync("/etc/machine-id")) return readFileSync("/etc/machine-id", "utf-8").trim()
    return createHash("sha256").update(homedir()).digest("hex")  // CI/container fallback
  }
  ```
  - PBKDF2 salt is random (good), but the password is deterministic.
  - Containers, CI runners, and multi-tenant systems share `/etc/machine-id`.
  - Any process with filesystem access derives the same key.

  **OAuth token store** (`auth/index.ts`):
  - Same fallback chain: persisted key → `/etc/machine-id` SHA-256 → `scryptSync(HOME, "dreamcode-auth-salt", 32)`
  - The fallback salt `"dreamcode-auth-salt"` is a compile-time constant; two users with the same HOME path get identical keys.

- **Fix:** Use OS keychain (macOS Keychain, Windows Credential Manager, Linux libsecret) or generate a random 32-byte key on first run stored with `0o600` permissions.

#### H2 — V1 Encryption Weakness (Legacy, Still Readable)
- **File:** `packages/core/src/credential/encryption.ts:112-114`
- **OWASP:** A2 (Cryptographic Failure)
- **Description:** SHA-256(machineId + "dreamcode-credentials-v1") with no PBKDF2 iterations. Legible by anyone who discovers the scheme. `reEncryptCredential()` (line 130) migrates v1→v2 on read, but legacy values remain in the DB until first access.

#### H3 — SQL Schema Type Mismatch Masks Encryption
- **Files:** `packages/core/src/credential/sql.ts:8`, `packages/core/src/credential.ts:144,155`
- **Issue:** Column typed as `text().$type<Credential.Info>()` but stores encrypted strings with casts like `as unknown as Credential.Info`. The type system lies about what is actually stored.
- **Impact:** TypeScript code sees decrypted `Credential.Info` objects; runtime holds encrypted opaque strings. A developer who reads the type assumes values are plaintext in the DB.

#### H4 — OPENCODE_AUTH_CONTENT Bypasses Encryption Entirely
- **File:** `packages/opencode/src/auth/index.ts:144-161`
- **OWASP:** A5 (Security Misconfiguration)
- **Description:** When `OPENCODE_AUTH_CONTENT` env var is set, serialized auth credentials (API keys, OAuth tokens) are read directly with **no encryption at rest**. The comment on line 149 says "encryption is the deployer's responsibility," but:
  - Environment vars are visible via `/proc/self/environ`, debug endpoints, crash dumps
  - No validation that they are filtered from logs
  - WARNING on line 150 only says subprocesses don't inherit it — there is no scrubbing at the log boundary

#### H5 — Shell `eval` with RC Sourcing
- **File:** `packages/opencode/src/shell/shell.ts:170,184`
- **OWASP:** A3 (Injection)
- **Description:** Both zsh and bash wrappers source `~/.zshenv` / `~/.bashrc` and pass the user command through `eval` after `JSON.stringify`:
  ```typescript
  [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
  cd -- "$1"
  eval ${JSON.stringify(command)}
  ```
  While JSON escaping prevents direct injection in the command value, a malicious rc file can execute arbitrary pre-commands. The `ShellEnv` function (line 423 in the shell tool) merges `process.env` including dangerous vars like `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`.

- **Fix:** Strip dangerous environment variables (`LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`, `OPENCODE_AUTH_CONTENT`) from subprocess environment. Consider `exec` instead of `source`+`eval`.

#### H6 — Dynamic Plugin Tool Loading via Filesystem Glob
- **File:** `packages/opencode/src/tool/registry.ts:173-185`
- **OWASP:** A8 (Software Integrity)
- **Description:** The tool registry dynamically imports every `.ts`/`.js` file from `{tool,tools}/*` directories in config paths. No ownership or permission check before import.
- **Risk:** A malicious file dropped by another process (npm postinstall, CI artifact, downloaded tarball) executes arbitrary code.
- **Fix:** Verify file ownership (uid matches current user) and permissions (not world-writable) before importing.

#### H7 — No Rate Limiting on Any Server Endpoint
- **Scope:** All 16 API groups (auth, session, credential, integration, permission)
- **OWASP:** A4 (Insecure Design)
- **Impact:** Enables dictionary attacks on Basic auth password, enumeration of session IDs, resource exhaustion via repeated session creation or prompt execution.

#### H8 — 38+ `Effect.die` Occurrences (Architecture × Security)
- **Count:** 38 in `session/` alone (core/src/session/)
  - `input.ts`: 10 occurrences
  - `projector.ts`: 10 occurrences
  - `context-epoch.ts`: 8 occurrences
  - `runner/llm.ts`: 8 occurrences
  - `execution/local.ts`: 1 occurrence
- **Security angle:** Silent error swallowing — `Effect.die` creates uncatchable defects. `catchDefect` (used in `llm.ts:356-369`) catches programming errors alongside intended control flow. If a security check fails via `Effect.die`, the defect is caught by an unrelated `catchDefect` handler and silently absorbed.

---

### 3.3 🟡 MEDIUM

#### M1 — Filesystem Path Decoding May Permit Traversal
- **File:** `packages/server/src/handlers/fs.ts:16`
- **OWASP:** A1 (Broken Access Control)
- **Issue:** `decodeURIComponent()` on the raw URL path before constructing a `RelativePath`. Path like `/api/fs/read/../../../etc/passwd` depends entirely on `RelativePath` schema for sanitization.
- **Confidence:** Medium — depends on `RelativePath` implementation details not reviewed here.

#### M2 — `innerHTML` Usage in UI Components
- **Files:**
  - `packages/ui/src/v2/components/icon.tsx:89`
  - `packages/ui/src/components/markdown.tsx:91,299,308`
  - `packages/web/src/components/share/content-bash.tsx:51-52`
  - `packages/web/src/components/share/content-markdown.tsx:53`
- **OWASP:** A3 (Cross-Site Scripting)
- **Issue:** SVG icons, markdown, and shared content use `innerHTML`. While the content is LLM-generated (not user-provided via forms), any XSS in the markdown rendering pipeline becomes stored XSS.
- **Confidence:** Medium — depends on whether the markdown renderer sanitizes HTML.

#### M3 — Honeycomb Webhook URL Exposes Internal Domain
- **File:** `packages/infra/monitoring.ts:9`
- **Issue:** Webhook URL constructed as `https://${domain}/honeycomb/webhook` using the internal deployment domain rather than a fixed opaque URL with a random token path.
- **Confidence:** Medium — if the domain or secret path leaks, an attacker can forge alert payloads.

#### M4 — No Structured Audit Logging
- **Issue:** Failed authentications, credential modifications, and permission grants are not logged as structured security events. Security-relevant events (auth failures, permission denials, credential mutations) lack dedicated audit records with timestamps, user, action, resource, and result fields.

---

### 3.4 🟢 LOW

#### L1 — Server Basic Auth Timing Attack
- **File:** `packages/opencode/src/server/auth.ts:28-33`
- **Issue:** String comparison uses `===`; early return if `config.password` is `None` enables username enumeration through timing. Fix with `timingSafeEqual`.

#### L2 — QuickJS Sandbox Insufficient for Untrusted Scripts
- **File:** `packages/opencode/src/workflow/sandbox.ts:81`
- **Issue:** Deletes `Date`, `WeakRef`, `FinalizationRegistry` but leaves `String`, `RegExp`, `Proxy`, `Reflect` intact. The 64 MiB memory limit prevents OOM, but `injectHooks` adds arbitrary host functions. No network/filesystem confinement.

#### L3 — No TLS on Local Server
- **File:** `packages/opencode/src/server/server.ts:149`
- **Impact:** All local IPC in cleartext HTTP. Any local process with packet capture capability can eavesdrop.

#### L4 — CI/CD Secrets Passed to Third-Party Actions
- **File:** `.github/workflows/deploy.yml:36-47`
- **Issue:** `CLOUDFLARE_API_TOKEN`, `STRIPE_SECRET_KEY`, `SENTRY_AUTH_TOKEN`, `PLANETSCALE_SERVICE_TOKEN` passed as env vars to `bun sst deploy`. In `opencode.yml`, `OPENCODE_API_KEY` passed to a GitHub Action from `CANONICAL_REPO` (potentially user-controlled fork).

#### L5 — Subagent Model Cost Amplification
- **File:** `.opencode/AGENTS.md:Section 9`
- **Issue:** Subagents inherit parent model by default. When using expensive models (e.g., `claude-opus`), this causes 3-5× cost amplification. Documented but no automated enforcement.

---

## 4. Prioritized Recommendations

### Immediate (Week 1)

| # | Priority | Finding | Effort | Impact |
|---|---|---|---|---|
| 1 | 🔴 CRITICAL | Remove `auth_token` URL query parameter auth | Low | Eliminates primary credential leak vector |
| 2 | 🔴 CRITICAL | Lock down localhost CORS to specific ports | Low | Prevents localhost CSRF |
| 3 | 🟠 HIGH | Replace `/etc/machine-id` key derivation with OS keychain or random per-machine key | Medium | Credential encryption no longer deterministic |
| 4 | 🟠 HIGH | Add file ownership/permission checks to dynamic plugin importer | Low | Prevents arbitrary plugin code execution |

### Short-Term (Week 2-3)

| # | Priority | Finding | Effort | Impact |
|---|---|---|---|---|
| 5 | 🟠 HIGH | Scrub `OPENCODE_AUTH_CONTENT` before logging; add env-var redaction | Low | Prevents credential leak via logs |
| 6 | 🟠 HIGH | Strip dangerous env vars (`LD_PRELOAD`, etc.) from subprocess env | Low | Prevents shell injection via rc files |
| 7 | 🟠 HIGH | Add rate limiting middleware (auth: 5/min, API: 100/min) | Medium | Prevents brute force, resource exhaustion |
| 8 | 🟠 HIGH | Convert `Effect.die` → `Effect.fail` with tagged errors (session domain first) | High | Restores type-safe error tracking; fixes silent swallowing |

### Medium-Term (Week 4-6)

| # | Priority | Finding | Effort | Impact |
|---|---|---|---|---|
| 9 | 🟡 MEDIUM | Fix SQL schema type to match actual storage (encrypted string, not `Credential.Info`) | Low | Type system honesty; prevents data corruption |
| 10 | 🟡 MEDIUM | Add structured security audit logging | Medium | Enables incident investigation |
| 11 | 🟡 MEDIUM | Validate permission ruleset ordering invariant on merge | Low | Prevents accidental allow-override |
| 12 | 🟡 MEDIUM | Replace `innerHTML` with safe DOM API in UI components | Medium | Eliminates stored XSS vector |
| 13 | 🟡 MEDIUM | Decompose session runner and session.ts | High | Architectural hygiene; maintainability |
| 14 | 🟡 MEDIUM | Remove wildcard export (`./*`) from core package.json | High | Enforces module boundary |
| 15 | 🟡 MEDIUM | Merge dual skill registries; add missing `token-predictor` | Low | Resolves authoritative source confusion |

### Long-Term

| # | Priority | Finding | Effort | Impact |
|---|---|---|---|---|
| 16 | 🟢 LOW | Enable TLS for local server | Medium | Prevents local eavesdropping |
| 17 | 🟢 LOW | Constant-time credential comparison | Low | Prevents timing-based enumeration |
| 18 | 🟢 LOW | Add automated subagent cost warnings | Low | Prevents financial surprise |
| 19 | 🟢 LOW | Initialize evolution infrastructure files on first write | Low | Fixes non-functional memory persistence |
| 20 | 🟢 LOW | Add repository interfaces for testability | High | Improves test coverage quality |

---

## 5. Cross-Reference Matrix

| Finding | The Architect | The Sentinel | The Analyst | Verified |
|---|---|---|---|---|
| `Effect.die` anti-pattern | ✅ 70+ matches | ✅ 38 in session/ | ✅ 38 in session/ | Confirmed via grep |
| Credential encryption key (machine-id) | ✅ encryption.ts:29 | ✅ encryption.ts:29-46 | ✅ auth/index.ts:22-50 | Read both files |
| `auth_token` URL query param | — | ✅ authorization.ts:33 | — | Read and confirmed |
| CORS `localhost:*` permissive | — | ✅ cors.ts:13 | — | Read and confirmed |
| Wildcard export leak | ✅ package.json:24 | — | — | Read and confirmed |
| SQL schema type mismatch | ✅ sql.ts:8 | — | — | Read and confirmed |
| `OPENCODE_AUTH_CONTENT` bypass | — | ✅ auth/index.ts:144 | ✅ auth/index.ts:143-161 | Read and confirmed |
| Shell `eval` + rc sourcing | — | ✅ shell.ts:170,184 | ✅ shell.ts:299-316 | Read and confirmed |
| Dynamic plugin tool loading | — | ✅ registry.ts:173 | ✅ registry.ts:173-185 | Read and confirmed |
| No rate limiting | — | ✅ All endpoints | — | Confirmed by missing middleware |
| `findLast` permission ordering | — | — | ✅ permission/index.ts:42-51 | Read and confirmed |
| Session runner monolith (409 lines) | ✅ llm.ts | — | — | Read and confirmed |
| innerHTML XSS risk | — | — | ✅ 4 files | Confirmed via grep |
| Evolution infrastructure missing | ✅ evolution/ | — | — | `ls evolution/` confirmed |
| Dual skill registries | ✅ 38 vs 37 dirs | — | — | Confirmed |
| V1 encryption weakness | ✅ encryption.ts:112 | — | — | Read and confirmed |

---

## 6. Disagreements & Resolution

| Finding | Disagreement | Resolution |
|---|---|---|
| Shell `eval` severity | The Analyst: MEDIUM; The Sentinel: HIGH | **HIGH** — `eval` with uncontrolled rc sourcing plus env var inheritance of `LD_PRELOAD` is a practical injection vector. Rating unified to HIGH. |
| Dynamic plugin tool loading | The Sentinel: HIGH; others: not rated | **HIGH** — though exploit requires local file write access, the principle of least privilege still requires ownership/permission validation before `import()`. |
| `findLast` permission ordering | The Analyst: MEDIUM; The Sentinel: not flagged | **MEDIUM** — practical exploit requires attacker-controlled config merge, but the ordering sensitivity violates principle of least surprise. |
| No rate limiting | The Sentinel: HIGH; The Analyst: LOW | **HIGH** — no rate limiting on auth endpoints enables online brute-force attacks on Basic auth password. Rating unified to HIGH. |

---

## 7. Methodology Notes

- All file/line references verified against actual source code at commit time.
- Findings rely on static analysis (grep, code reading); no dynamic testing was performed.
- Confidence levels: **HIGH** = direct code observation + no external dependencies; **MEDIUM** = code observation with assumption about external behavior (e.g., schema validation in a dependency); **LOW** = plausible but requires specific conditions not confirmed.
- OWASP Top 10 (2021) used as classification framework.
- The codebase's own AGENTS.md documentation acknowledges several of these issues (wildcard exports, `Effect.die` anti-pattern, credential encryption gap, session runner decomposition). See `packages/core/AGENTS.md`, `packages/core/src/session/runner/AGENTS.md`, `packages/core/src/credential/AGENTS.md`.
