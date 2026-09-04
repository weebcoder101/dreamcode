# DreamCode Stats & Enterprise — Deep Audit Findings

**Audit scope**: `/home/ronya/dreamcode/packages/stats` and `/home/ronya/dreamcode/packages/enterprise`
**Audit dimensions**: quality, architecture, internal logic, security (incl. authz on share/newsletter routes), API, engineering, harness/tooling
**Excluded from scope**: credential stores, provider list, model IDs, pricing, public SDK surface, design tokens, AGENTS.md/CLAUDE.md/README persona files, patches/vendor/LICENSE, node_modules/dist/build/.turbo/migration SQL/migration snapshots/images/lockfiles

**FILES READ: 56/56 for stats, 23/23 for enterprise**

## Coverage

| Package | Files in scope | Files read | Source paths |
|---|---|---|---|
| `packages/stats` | 56 (after removing 3 `.turbo` logs) | 56 | server:10, core:22, app:21, extras (README/AGENTS/.gitignore):3 |
| `packages/enterprise` | 23 (after removing 1 `.turbo` log) | 23 | src: 13, root: 9, public: 1 (banner SVG, no findings) |

Confirmed file coverage: every file in `filtered_stats` and `filtered_enterprise` was read into the IPython dicts `stats_files_text` and `ent_files_text` (relative paths). All `bun run typecheck` invocations on `stats/app`, `stats/core`, `stats/server`, and `enterprise` pass after the fixes below (no TypeScript errors introduced).

## Severity summary

| Severity | Count | Status |
|---|---|---|
| **P0 (critical)** | 3 | 2 fixed, 1 downgraded by fixes (latent risk, requires migration) |
| **P1 (high)** | 5 | 5 fixed |
| **P2 (medium)** | 1 | 1 fixed |
| **P3 (low / hardening)** | 7 | All deferred (informational; documented below) |

## Fixed in this PR

| Sev | Title | File | Change |
|---|---|---|---|
| P0 | Share viewer authz bypass | `enterprise/src/routes/share/[shareID].tsx` | getData() now requires `?secret=<uuid>` query param, verifies with `timingSafeEqual` (length-checked), returns 404 on missing/mismatch. Response strips secret. Cache-Control → `private, no-store`. |
| P0 | Open CORS on enterprise API | `enterprise/src/routes/api/[...path].ts` | Replaced `.use(cors())` with allowlist from `OPENCODE_API_ALLOWED_ORIGINS` env var (default `https://opencode.ai`), `credentials: false`, 600s preflight cache. |
| P1 | Newsletter email-bombing / quota abuse | `stats/app/src/routes/api/newsletter.ts` | Added per-IP rate limit (5s cooldown), Content-Length cap (8KB), RFC 5322-lite email regex with 254-char cap, corrected 415 "Unsupported content type" error. |
| P1 | Stats ingest no body size / event count cap | `stats/server/src/router.ts` | Added `MAX_INGEST_BODY_BYTES = 1 MiB` and `MAX_INGEST_EVENTS = 10_000`, both returning 413 on exceed. |
| P1 | Stats ingest empty-secret defense-in-depth | `stats/server/src/router.ts` | `isAuthorized()` now early-returns false when `Resource.LakeIngestConfig.secret` is empty or missing. |
| P1 | Model catalog uncached external fetch | `stats/app/src/routes/model-catalog.ts` | Added in-process TTL cache (5 min default, configurable via `STATS_MODEL_CATALOG_TTL_MS`). |
| P1 | Storage.list() no-prefix footgun | `enterprise/src/core/storage.ts` | Emits `console.warn` when called without a non-empty prefix; surfaces regressions without breaking the existing test contract. |
| P2 | Dockerfile missing USER directive | `stats/server/Dockerfile` | Added `USER bun` before `CMD`. |

## Findings — full detail

### P0 — Open CORS on enterprise share API
**Package**: `enterprise`  
**Location**: `enterprise/src/routes/api/[...path].ts:14`  
.use(cors()) with no origin config. Any site could cross-origin POST /api/share (creating shares) and DELETE. FIXED: CORS now restricted to OPENCODE_API_ALLOWED_ORIGINS env var (comma-separated, default https://opencode.ai) with credentials: false and a 600s preflight cache.

### P0 — Predictable shareID (8 hex chars)
**Package**: `enterprise`  
**Location**: `enterprise/src/core/share.ts:127`  
create() sets id = sessionID.slice(-8) — only 32 bits of entropy. Trivially brute-forceable. Downgraded to P1 by the P0-1 fix above (now requires secret), but the shareID is still a part of the URL and the underlying risk is that any future code path that re-introduces an unauth read would re-expose the share. Recommend replacing with crypto.randomUUID() (would require shareID migration; deferred).

### P0 — Share viewer authz bypass
**Package**: `enterprise`  
**Location**: `enterprise/src/routes/share/[shareID].tsx:56-103`  
getData() query took only shareID — no secret check. Anyone with the shareID could read the share. FIXED: getData() now reads the secret from ?secret=<uuid>, verifies with timingSafeEqual, and returns 404 (SessionDataMissingError) on missing/mismatch — no info leak.

### P1 — Storage.list() no-prefix footgun
**Package**: `enterprise`  
**Location**: `enterprise/src/core/storage.ts:111-114 (pre-fix)`  
list() with no args enumerates entire bucket. FIXED: emits console.warn when called without a non-empty prefix. Not a throw (preserves the existing test contract); surfaces regressions in logs.

### P1 — Model catalog uncached external fetch
**Package**: `stats`  
**Location**: `stats/app/src/routes/model-catalog.ts:47-53 (pre-fix)`  
getModelCatalog re-fetched https://models.dev/models.json on every call. FIXED: added in-process TTL cache (5 min default, configurable via STATS_MODEL_CATALOG_TTL_MS).

### P1 — Newsletter endpoint — email-bombing / quota abuse
**Package**: `stats`  
**Location**: `stats/app/src/routes/api/newsletter.ts (whole file)`  
Hardcoded listId, no email validation, no rate limit. FIXED: added in-process per-IP rate limit (5s cooldown), Content-Length cap (8KB), RFC 5322-lite email regex with 254-char cap, and a corrected 415 'Unsupported content type' error. listId left as a hardcoded UUID with a comment (it's a non-secret, but should be SST-managed per stage).

### P1 — Stats ingest empty-secret defense-in-depth
**Package**: `stats`  
**Location**: `stats/server/src/router.ts:55-62 (pre-fix)`  
isAuthorized() had no empty-secret guard. If Resource.LakeIngestConfig.secret is unset, expected would be 'Bearer ' (7 bytes) and any 7-byte 'Bearer ' header would match. FIXED: added early return false when secret is missing/empty.

### P1 — Stats ingest no body size / event count cap
**Package**: `stats`  
**Location**: `stats/server/src/router.ts:8-9, 23-30 (pre-fix)`  
IngestPayload only validated `events` optional. No body or event count cap. FIXED: added MAX_INGEST_BODY_BYTES = 1 MiB (content-length) and MAX_INGEST_EVENTS = 10_000 caps, both returning 413.

### P2 — Dockerfile missing USER directive (runs as root)
**Package**: `stats`  
**Location**: `stats/server/Dockerfile (pre-fix)`  
oven/bun:1.3.14-alpine runs as root. FIXED: added USER bun before CMD.

### P3 — Enterprise vite dev server exposed 0.0.0.0 with allowedHosts:true
**Package**: `enterprise`  
**Location**: `enterprise/vite.config.ts:23-26`  
Dev only; production is a normal web app. Dev server should bind to localhost. Deferred.

### P3 — Share viewer — secret-in-URL leak surface
**Package**: `enterprise`  
**Location**: `enterprise/src/routes/share/[shareID].tsx (post P0-1 fix)`  
The fix requires secret in ?secret= query string. This is consistent with the /api/share pattern, but exposes the secret via HTTP access logs, browser history, and Referer on cross-origin navigations. Better long-term: cookie-based auth via /api/share/:id/auth → httpOnly cookie. Out of scope for this audit. P3 because the leak is limited to the share's intended viewer and the share creator must already trust the viewer with the URL.

### P3 — Social card SSRF — shareID enumerable
**Package**: `enterprise`  
**Location**: `enterprise/src/routes/share/[shareID].tsx:172-175`  
og:image forwards shareID to social-cards.sst.dev. With predictable shareIDs (P0-3 above), an attacker can probe social-cards for share titles. Mitigated by P0-1 (secret now required). P3 because the third-party is internal.

### P3 — Geo stats country-level re-identification risk
**Package**: `stats`  
**Location**: `stats/core/src/domain/home.ts:215-237`  
Country-level aggregates can be re-identifiable for low-volume country+model combinations. K-threshold (don't show countries with < K tokens) recommended. Deferred.

### P3 — Health endpoint discloses stage and publicUrl
**Package**: `stats`  
**Location**: `stats/app/src/routes/api/health.ts`  
Returns {ok, app, stage, publicUrl}. Public health endpoints should be minimal {ok: true}. Deferred.

### P3 — No rate limit on /api/health, /api/ready
**Package**: `stats`  
**Location**: `stats/server/src/router.ts:21-22`  
Public health endpoints. Trivial DoS but easy recovery. P3.

### P3 — Stats server HOST default misconfig
**Package**: `stats`  
**Location**: `stats/server/src/server.ts:16`  
HOST defaults to 0.0.0.0 (TEST-NET-2 documentation address). If env unset, server binds to an unreachable address. Misconfig trap, not a vulnerability. Fix: default to '0.0.0.0' (all interfaces) — deferred because the default value choice is operator-policy.


## Deferred (P3 + 1 latent P0)

These findings are documented for future work but not fixed in this PR (out of scope, requires migration, or requires design-level changes outside this audit).

### P0-3 (latent, mitigated by P0-1)
- **Predictable shareID (8 hex chars)** — `enterprise/src/core/share.ts:127`. `create()` sets `id = sessionID.slice(-8)` = 32 bits of entropy. Brute-forceable in seconds. The P0-1 viewer fix mitigates the read path (secret now required), so the shareID alone cannot expose share contents. The latent risk: any future code path that reads shares without a secret would re-expose them. Recommended fix: replace with `crypto.randomUUID()` — but this would change the shareID format and require a migration of existing shares in the bucket. Deferred.

### P3
- **Secret-in-URL leak surface** — `enterprise/src/routes/share/[shareID].tsx` (post P0-1 fix). The `?secret=<uuid>` query string is consistent with the `/api/share` pattern, but exposes the secret via HTTP access logs, browser history, and Referer on cross-origin navigations. Long-term fix: cookie-based auth via `/api/share/:id/auth` → httpOnly cookie. Out of scope for this audit.
- **Stats server HOST default misconfig** — `stats/server/src/server.ts:16`. Defaults to `0.0.0.0` (TEST-NET-2 documentation address). Misconfig trap, not a vuln. Fix: default to `0.0.0.0` (all interfaces). Operator policy.
- **Health endpoint discloses stage and publicUrl** — `stats/app/src/routes/api/health.ts`. Public health endpoints should return only `{ok: true}`. Info disclosure.
- **Vite dev server exposed 0.0.0.0 + allowedHosts:true** — `enterprise/vite.config.ts:23-26`. Dev only. Should bind to localhost.
- **Geo stats country-level re-identification** — `stats/core/src/domain/home.ts:215-237`. Low-volume country+model combos may be re-identifiable. K-threshold recommended.
- **Social card SSRF — shareID enumerable** — `enterprise/src/routes/share/[shareID].tsx:172-175`. Forwards shareID to social-cards.sst.dev. Mitigated by P0-1 (secret now required). Internal third-party, low risk.
- **No rate limit on /api/health, /api/ready** — `stats/server/src/router.ts:21-22`. Trivial DoS, easy recovery.

## Cross-cutting observations

- **No XSS via `innerHTML`/`set:html`/`dangerouslySetInnerHTML`/`eval(`/`new Function(`** in any stats or enterprise source (regex confirmed). Solid.js auto-escapes JSX by default.
- **API patterns** are consistent: Hono-based router in enterprise, Effect-based HttpRouter in stats server. Both follow the established 200/202/400/401/413/415/429/502/503 conventions.
- **Schema migrations** use Drizzle Kit and are versioned per package. No findings in migration SQL or snapshot files (excluded by audit scope).
- **Storage adapter abstraction** in `enterprise/src/core/storage.ts` cleanly separates S3 and R2. The prefix-warning fix is at the namespace-export level, preserving the adapter interface.

## Files modified

```
packages/enterprise/src/routes/share/[shareID].tsx
packages/enterprise/src/routes/api/[...path].ts
packages/enterprise/src/core/storage.ts
packages/stats/app/src/routes/api/newsletter.ts
packages/stats/app/src/routes/model-catalog.ts
packages/stats/server/src/router.ts
packages/stats/server/Dockerfile
```

All `bun run typecheck` invocations on `stats/app`, `stats/core`, `stats/server`, and `enterprise` pass with the fixes applied. No new dependencies added.
