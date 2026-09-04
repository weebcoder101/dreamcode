# Frontend Small Packages — Deep Security & Quality Audit

**Scope:** `packages/stats`, `packages/enterprise`, `packages/web`, `packages/identity`
**Date:** 2026-09-02
**Auditor:** Sumati (senior code audit)
**Method:** full source read of every `.ts`/`.tsx`/`.astro`/`.css` in the four packages + adjacent `packages/function` (share data plane). Each finding graded P0 (critical/exploitable now) → P3 (informational).

---

## Headline Result

| Severity | Count |
|---|---|
| P0 | 0 |
| P1 | 1 |
| P2 | 7 |
| P3 | 4 |

No remote code execution, no credential leakage, no live XSS, and no SQL injection were found. The most serious issue is a **genuine authorization bypass** in the enterprise share-data endpoint (P1). The rest are defense-in-depth, design, and hygiene items.

---

## P1 — Authorization Bypass: `GET /share/:shareID/data` never verifies the secret

**File:** `packages/enterprise/src/routes/api/[...path].ts`
**Code:**
```ts
.get("/share/:shareID/data", ..., async (c) => {
  const { shareID } = c.req.valid("param")
  const { secret } = c.req.valid("query")
  const data = await Share.data(shareID)
  if (!data || data.length === 0) return c.json([], { status: 404 })
  if (!secret) return c.json({ error: "missing secret" }, { status: 401 })
  c.header("Cache-Control", "private, no-store")
  return c.json(data)        // <-- secret is accepted but never compared to share.secret
})
```
`Share.create` mints a random UUID `secret` per share and the route *requires* a `secret` query value, but it never compares that value to the stored `share.secret`. Any caller that supplies a non-empty `secret=` can read the full share payload for any known 8-character `shareID`. This is an authorization check that validates presence, not correctness.

**Impact nuance:** In production the public share page (`web/src/pages/s/[id].astro`) actually serves the same data through `packages/function`'s `/share_data` endpoint, which is intentionally unauthenticated. So the blast radius of *this* endpoint is bounded by whatever clients call the enterprise API directly. It is still a real authz defect and must be fixed: the endpoint's own contract promises secret-gated access.

**Fix applied:** fetch `Share.get(shareID)`, return 404 if absent, then constant-time compare the supplied `secret` to `share.secret` (length guard + `crypto.timingSafeEqual`); return `401 {error:"invalid secret"}` on mismatch. (See edits below.)

---

## P2 — Medium

### P2-1. Share ID is the last 8 chars of the session ID (`sessionID.slice(-8)`)
**File:** `packages/enterprise/src/core/share.ts` → `Share.create`
```ts
id: (isTest ? "test_" : "") + body.sessionID.slice(-8),
```
8 characters (case-sensitive alphanumerics) is enumerable (~few×10¹⁴ worst case, trivially brute-forceable at scale) and, combined with P1, lets an attacker enumerate and read shares. Also collides if two sessions share a suffix. Use a full random UUID for the share id (the `secret` is already a UUID; derive `id` from `crypto.randomUUID()` too).

### P2-2. Secret transmitted as a query-string parameter
**File:** `packages/enterprise/src/routes/api/[...path].ts` (and the web client passes `?secret=`).
Query strings land in access logs, proxy logs, browser history, and `Referer` headers. The secret is the only write-gate for `POST /share/:shareID/sync` and `DELETE /share/:shareID`. Move it to an `Authorization` header or request body.

### P2-3. Wildcard CORS
**File:** `packages/enterprise/src/routes/api/[...path].ts`
```ts
app.basePath("/api").use(cors())   // no origin allowlist -> "*"
```
Applies `Access-Control-Allow-Origin: *` to every API route. For an effectively-public stats/share surface this is low risk, but it should be scoped to known origins before any authenticated route is added.

### P2-4. `function` `/share_data` is unauthenticated (8-char id only)
**File:** `packages/function/src/api.ts`
`GET /share_data?id=` returns the full session JSON for any id. This is **by design** for the public share page, but the trust boundary (8-char id is the only barrier) is documented only in a comment. Recommend: per-share secret in `?secret=`, Origin allowlist, per-id connection/read cap (already noted as `F-AUTH-06`). Out of strict scope but flagged because the web share page depends on it.

### P2-5. `function` `/share_poll` WebSocket is unauthenticated
**File:** `packages/function/src/api.ts` — same trust boundary as P2-4; only the `Upgrade: websocket` header is checked. Documented as `F-AUTH-06`; recommend secret + Origin allowlist + connection cap.

### P2-6. Timing-unsafe secret compare in `Share.sync` / `Share.remove`
**File:** `packages/enterprise/src/core/share.ts`
```ts
if (share.secret !== body.secret) throw new Errors.InvalidSecret(...)
```
Plain `!==` on secrets is a timing oracle. The sibling `function` package already uses `crypto.timingSafeEqual` (good pattern). **Fix applied** for `sync` and `remove`.

### P2-7. Stats newsletter: no email-format validation
**File:** `packages/stats/app/src/routes/api/newsletter.ts`
The endpoint accepts any non-empty `email` string and PUTs it to EmailOctopus. Add an RFC-5322-light regex (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) before sending. Low impact (EmailOctopus rejects bad input) but cleanliness.

---

## P3 — Low / Informational / Quality

### P3-1. `openAPIRouteHandler(app, …)` misuse
**File:** `packages/enterprise/src/routes/api/[...path].ts`
`app.basePath("/api")` is already applied, then `openAPIRouteHandler(app, …)` is mounted at `/doc` — this yields `/api/doc` *inside* an app that already has base path `/api`, risking `/api/api/doc`. Also self-referential: the handler takes the same `app` it lives in. Re-point the doc route to a fresh docs app or correct the base path. No security impact; correctness/quality.

### P3-2. Stats newsletter: no rate limiting
**File:** `packages/stats/app/src/routes/api/newsletter.ts`
Unthrottled subscribe → email-bomb / abuse vector. Requires infra (token bucket); note only.

### P3-3. `function` logs raw request bodies
**File:** `packages/function/src/api.ts` — `console.log("share_data", id)` and `console.log(JSON.stringify(body, null, 2))` for the Feishu webhook. Avoid logging identifiers/payloads in production; use structured, redacted logging.

### P3-4. `content-error.tsx` passes `children` through unescaped
**File:** `packages/web/src/components/share/content-error.tsx`
`{props.children}` is rendered directly. Current callers pass SolidJS VNodes from `formatErrorString(...)` (auto-escaped), so there is no live XSS. Flag as defense-in-depth: if a future caller passes a raw string, it becomes an injection sink. No change required now.

---

## Verified Safe (no finding)

- **Web XSS surface:** `content-markdown.tsx` uses hardened `escapeAttr`/`safeUrl` + shiki (escaped); `content-text.tsx`/`content-code.tsx`/`content-bash.tsx`/`content-diff.tsx` render via Solid text nodes or shiki HTML (no `set:html` of user input). `getDiagnostics`/`getError` build `<pre>`/`<span>` with text content. `copy-button.tsx` only writes to clipboard. `Share.tsx` JSON.stringifies into a `<pre>` text node, gated by `?debug`.
- **Web middleware:** `oc_locale` cookie is `HttpOnly` + `Secure` (prod) + `SameSite=Lax`, 30-day Max-Age; no open-redirect.
- **Stats SQL:** `sqlString`/`sqlIdentifier` correctly escape quotes; identifiers interpolated only from hardcoded config columns (`MODEL_AUTHOR_RULES`, `"model"`, `"provider"`, `"provider_model"`). No user input reaches identifiers. All repos use drizzle parameterized queries + chunked upserts.
- **Stats auth:** `server/src/router.ts` `isAuthorized` uses `timingSafeEqual` correctly.
- **Enterprise i18n:** `resolveTemplate` does `params[key] ?? ""` (no template injection); locale detection only prefix-matches `zh`/`en`.
- **Stats Athena:** `periodStart.toISOString()` is a Date method (not a SQL call); query strings built from validated config.
- **Astra:** `s/[id].astro` SSR only sets static meta tags and passes props to `<Share>`; no `set:html` with user data.

---

## Fixes Applied

1. **P1** — `GET /share/:shareID/data` now loads `Share.get(shareID)` and constant-time-compares the supplied `secret` to `share.secret`; returns `401 invalid secret` on mismatch.
2. **P2-6** — `Share.sync` and `Share.remove` replaced `!==` secret compare with `crypto.timingSafeEqual` (length-guarded).

Both verified with `tsc` in `packages/enterprise`. (P2-1/P2-2/P2-3/P2-4/P2-5/P2-7 and all P3 items are recommend-only; they need design/infra decisions or touch out-of-scope `function` package and were left unmodified per audit constraints.)
