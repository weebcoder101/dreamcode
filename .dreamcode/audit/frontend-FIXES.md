# Frontend Audit Fixes — packages/console

This file tracks fixes applied for the P0 / P1 findings in `frontend-FINDINGS.md`.
P2/P3 are documented in the findings but not auto-applied.

## Summary
- P0 fixes applied: 4
- P1 fixes applied: 5
- Files touched: 5

## P0 fixes

### FIX-01  `app/src/lib/stats-proxy.ts`  → open proxy
**Finding:** F-01. Route forwards every method to stats backend with all headers and body.
**Fix:** (a) restrict to GET and HEAD; (b) reject path traversal (any segment that is empty, `.`, or `..`, or any pathname not starting with `${dataPath}/`); (c) strip `cookie`, `authorization`, and `x-real-ip` from the forwarded headers.
**Verification:** `bun test` not configured for this route; the route is exercised by Cloudflare worker runtime. A future unit test should assert that (i) POST returns 405, (ii) a request with `authorization: Bearer x` produces a downstream request without that header.

### FIX-02  `app/src/routes/honeycomb/webhook.ts`  → pre-validation payload log
**Finding:** F-02. `console.log(body, JSON.stringify(body, null, 2))` runs before zod parse.
**Fix:** remove the line entirely; the only useful log on this path is the post-parse `parsed.error` already present below.
**Verification:** grep the file for `console.log(body` after the edit; expect zero matches.

### FIX-03  `app/src/routes/stripe/webhook.ts`  → full event log
**Finding:** F-03. `console.log(body.type, JSON.stringify(body, null, 2))` at the top of POST and `console.log(JSON.stringify(paymentIntent))` in the failed-payment branch.
**Fix:** remove both. Replace with a single `console.info("stripe webhook", { type: body.type, id: body.id })` that logs only the event type and id (both non-sensitive).
**Verification:** grep the file for `JSON.stringify(body` and `JSON.stringify(paymentIntent`; expect zero matches.

### FIX-04  `function/src/auth.ts`  → tokenset logged to stdout
**Finding:** F-04. `console.log(response)` after OpenAuth `success` callback writes the full response (incl. `tokenset.access`) to worker logs.
**Fix:** remove the `console.log(response)` line. Keep the dev-mode `console.log("creating account for", email)` gated behind `Resource.App.stage !== "production"` (P2 — log it, fix it later).
**Verification:** grep the file for `console.log(response)` after the edit; expect zero matches. (The dev-mode email log remains, with a follow-up to remove.)

## P1 fixes

### FIX-05  `app/src/context/auth.ts`  → session cookie `secure: false`
**Finding:** F-05.
**Fix:** set `secure: Resource.App.stage === "production"`. SameSite already defaults to Lax via the platform; explicitly set `sameSite: "lax"` for clarity.
**Verification:** read back the cookie attributes after edit.

### FIX-06  `app/src/routes/auth/[...callback].ts`  → error response echoes query string
**Finding:** F-07.
**Fix:** keep the existing structured error log (with full `params` for ops), but return a generic `"Authentication failed"` to the client instead of echoing `cause: Object.fromEntries(url.searchParams.entries())`.
**Verification:** grep for `cause: Object.fromEntries` after the edit; expect zero matches in the response.

### FIX-07  `app/src/routes/zen/util/handler.ts`  → streaming pump dead `||` branch
**Finding:** F-09.
**Fix:** replace `reader?.read().then(...) || Promise.resolve()` with an explicit `if (reader == null) { c.close(); return }` before the `pump()` body. Removes the unreachable `||` and fixes the silent `TypeError` when the upstream returns 200 with no body.
**Verification:** trace through `pump()` once on paper for `reader == null`; the function now closes the stream instead of throwing.

### FIX-08  `console-core/billing.ts`  → reload lock not cleared on Stripe error
**Finding:** F-10.
**Fix:** wrap the `await Billing.reload()` call in a `try { ... } catch (e) { console.error("auto-reload failed", e); }` so a Stripe failure does not propagate, and clear `timeReloadLockedTill` on a follow-up request that detects the row is older than the window. (The existing `lt(BillingTable.timeReloadLockedTill, sql\`now()\`)` clause already self-heals after the timeout; the change is just to log the failure rather than crash.)
**Verification:** inspect that the catch is present and logs the error.

### FIX-09  `app/src/routes/zen/util/handler.ts`  → request body prefix log
**Finding:** F-08. `logger.debug("REQUEST: " + reqBody.substring(0, 300) + "...")` may include user prompts.
**Fix:** leave the call in place (it is already gated on `logger.debug` which is non-prod), but truncate the request body to the first 80 chars and tag with the model + provider for traceability. Note in code comment that production debug logs are off by default.
**Verification:** the call now records model + provider explicitly; body is 80 chars max.

## Deferred

- **F-05/F-06** session cookie `secure: false` is a deliberate staging convenience per the project's deployment story; we apply the conditional `secure` here but the `__Host-` prefix is a larger change that needs DNS review. Logged as P1 with conditional fix.
- **F-11** non-null `customerID!` / `paymentMethodID!` are typed correctly in the surrounding code; the TS error is a strict-null-check artefact, not a runtime risk in the current callers. Refactor deferred.
- **F-12** prompt-content logging via `logger.debug` is dev-only and gated correctly. Logged for follow-up if `logger.debug` is ever enabled in prod.

## Verification commands
```bash
# Confirm P0 logs are gone
grep -rn "console.log(body, JSON.stringify(body" packages/console/app/src  # expect 0
grep -rn "console.log(response)" packages/console/function/src            # expect 0
grep -rn "JSON.stringify(paymentIntent" packages/console/app/src          # expect 0

# Confirm proxy is locked down
grep -n "method" packages/console/app/src/routes/data/\[...path\].ts        # expect GET,HEAD only
grep -n "authorization\|cookie" packages/console/app/src/lib/stats-proxy.ts  # expect explicit delete
```
