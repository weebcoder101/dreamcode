# Frontend Audit Findings — packages/console

## Summary
- Total .ts/.tsx files inventoried: 230
- Substantive audited: ~190 (i18n translation dictionaries, generated .d.ts, and large mechanical data tables skipped)
- P0: 4, P1: 6, P2: 5, P3: 4
- Coverage: auth, webhooks, billing, zen LLM proxy, core, schema, middleware, scripts, representative routes/components

## Severity legend
- **P0**: security or correctness defect with a realistic exploitation path
- **P1**: info leak / hardening gap with concrete impact
- **P2**: code-quality or hardening with no immediate exploit
- **P3**: cleanup / refactor

## P0 — security / correctness

### F-01  `app/src/routes/data/[...path].ts` + `app/src/lib/stats-proxy.ts`  [P0]
Finding: open HTTP proxy. The catch-all route forwards **every method** (GET/POST/PUT/DELETE/PATCH/OPTIONS) to `stats.opencode.ai` / `stats.dev.opencode.ai`, copies **all request headers verbatim** (including `cookie`, `authorization`, `x-real-ip`), and passes the request body through unchanged. The route has no authentication gate, no allow-list of paths, and no scrubbing of internal headers. Concrete impacts: (a) the console origin can be used to tunnel arbitrary requests to the stats backend, (b) the requester's auth cookies/headers are replayed to the backend via the console origin, (c) a state-changing method (DELETE/PATCH) reaches a backend that is presumably read-only-stats, (d) origin-bound defences on the stats backend are bypassed. This is a textbook SSRF / open-proxy.
Evidence: `data/[...path].ts` builds URL from `params.path`; `stats-proxy.ts` copies `request.headers` into the upstream Headers and forwards the raw body.

### F-02  `app/src/routes/honeycomb/webhook.ts`  [P0]
Finding: pre-validation `console.log(body, JSON.stringify(body, null, 2))` writes the full Honeycomb webhook payload to stdout. The dump happens BEFORE zod validation, so any inbound payload (including attacker-crafted ones) is written to the Cloudflare worker logs. Honeycomb telemetry can carry internal model/URL/error-rate data; even when benign, logging the full body to stdout in a multi-tenant edge log pipeline is a PII / data-volume issue. Same pattern, with even higher PII weight, in stripe/webhook.ts (F-03).
Evidence: line ~7 of `routes/honeycomb/webhook.ts`:
```
console.log(body, JSON.stringify(body, null, 2))
```

### F-03  `app/src/routes/stripe/webhook.ts`  [P0]
Finding: `console.log(body.type, JSON.stringify(body, null, 2))` at the top of `POST` logs the **entire Stripe event** to stdout. Stripe events include customer email, billing address, payment-method last4 + brand, amount, currency, customer.id, subscription.id, invoice.id, discount id, and metadata that may contain internal workspace/user IDs. Also `console.log(JSON.stringify(paymentIntent))` inside the `invoice.payment_failed` / `invoice.payment_action_required` branch dumps the full payment-intent object (last_payment_error.message + billing details). These are PII / financial data written to edge worker logs.
Evidence: top of `POST` in `routes/stripe/webhook.ts`; `console.log(JSON.stringify(paymentIntent))` inside the `invoice.payment_failed` branch.

### F-04  `function/src/auth.ts` (OpenAuth subject callback)  [P0]
Finding: `console.log(response)` writes the full OpenAuth `response` object — including `tokenset.access` (the upstream GitHub/Google access token) — to stdout. This is a credential leak to the worker log pipeline. The line is at the end of the GitHub provider's token-exchange callback. Even on a successful callback the access token should never be logged; the line is clearly leftover debug. The function also logs `creating account for ${email}` and similar debug lines, which are lower severity (PII, not credentials) but should still be removed.
Evidence: `console.log(response)` near the bottom of `function/src/auth.ts` after the `tokenset` exchange.

## P1 — info leak / hardening

### F-05  `app/src/context/auth.ts`  [P1]
Finding: session cookie is set with `secure: false` explicitly. Cookie can travel over plain HTTP, exposing the session token to network observers on any non-HTTPS path. Should be `secure: true` in production (and a per-environment override for local dev). `sameSite` is also not explicitly set on this cookie — defaults to `Lax`, which is acceptable for this flow, but worth being explicit.
Evidence: `auth.ts` session cookie set-cookie header.

### F-06  `app/src/context/auth.ts`  [P1]
Finding: `generateSessionToken()` returns `crypto.randomUUID()` (16 random bytes) but the session id is the entire string. The session id space is ~122 bits, which is fine; the issue is that the cookie does not set `__Host-` prefix or `Domain` — the cookie is not pinned to the apex. Combined with `secure: false`, a sibling subdomain can read the cookie in some hosting models.
Evidence: `generateSessionToken` + set-cookie.

### F-07  `app/src/routes/auth/[...callback].ts`  [P1]
Finding: when the OAuth callback fails, the error response body includes `cause: Object.fromEntries(url.searchParams.entries())`. The query string is the raw OAuth callback URL — it includes `error`, `error_description`, `state`, and (in some providers) the `code` (depending on when the failure is raised). Echoing all of this back to the user can leak debug info. The provider's own error_description often contains sensitive context (account state, internal IDs). Should log internally and return a generic message to the client.
Evidence: error branch in `routes/auth/[...callback].ts`.

### F-08  `app/src/routes/zen/util/handler.ts`  [P1]
Finding: when a workspace has a BYOK provider configured, `updateProviderKey(authInfo, providerInfo)` copies the user's provider credentials into `providerInfo.apiKey`. The same object is then passed to `providerInfo.modifyHeaders(headers, providerInfo.apiKey, stickyId)` and the request URL/body are logged via `logger.debug("REQUEST URL: " + reqUrl)` and `logger.debug("REQUEST: " + reqBody.substring(0, 300) + "...")`. The body does not contain the API key (it is set in the upstream `authorization` header), but the headers are forwarded to the upstream provider with the key — that's expected — and the request body substring can include the user's prompt, which may contain PII. `logger.debug` is gated on non-production, so this is dev-only, but worth flagging that prompt content is logged.
Evidence: `handler.ts` `logger.debug` calls in `retriableRequest`; `updateProviderKey` mutating `providerInfo.apiKey`.

### F-09  `app/src/routes/zen/util/handler.ts`  [P1]
Finding: streaming pump has a dead `|| Promise.resolve()` branch. `reader?.read()` returns a Promise (always truthy), so the `||` is unreachable. The intent was probably to handle `reader === undefined` (no upstream body). When the upstream returns 200 with no body, `res.body` may be null, the stream is `null`, and the next iteration will throw a non-typed `TypeError: Cannot read properties of undefined (reading 'read')` that bubbles to the catch and surfaces as 500. Replace the `||` with an explicit `if (reader == null) { c.close(); return }`.
Evidence: `pump()` function in `handler.ts`.

### F-10  `console-core/billing.ts`  [P1]
Finding: `reload()` calls `Billing.reload()` after acquiring a row lock; if the Stripe call inside `Billing.reload()` throws, the lock row is not cleared and the workspace is stuck with `timeReloadLockedTill = now + 1 minute` (best case) or forever (worst case, if the row update is itself the throw). The reload lock column has no `try/finally`. A second concurrent reload attempt during the locked window will silently no-op (`lock.rowsAffected === 0` early return) and the user's auto-reload never resumes until the lock expires. The minimum hardening: clear the lock in a `catch` block, or wrap the entire reload in a try/finally.
Evidence: `reload()` in `console-core/billing.ts`.

## P2 — hardening / code quality

### F-11  `console-core/billing.ts`  [P2]
Finding: `reload()` uses `customerID!` and `paymentMethodID!` non-null assertions in some paths. If a billing row exists but `customerID` is null (e.g. mid-checkout race), the assertion passes through TS but throws at runtime. Should narrow with an explicit `if (!customerID) throw new Error(...)` instead of `!`.
Evidence: `Billing.reload()` / `charge()`.

### F-12  `app/src/routes/zen/util/handler.ts`  [P2]
Finding: `logger.debug` in `retriableRequest` logs `reqBody.substring(0, 300) + "..."`. The 300-char prefix is fine in dev, but the prefix can include user prompts verbatim. If debug is ever flipped on in production (or a remote-debug environment), PII is logged. Either redact the `messages` / `prompt` fields before logging, or log only the request URL + model + token count.
Evidence: `logger.debug("REQUEST: " + reqBody.substring(0, 300) + "...")`.

### F-13  `app/src/lib/stats-proxy.ts`  [P2]
Finding: `data/[...path].ts` uses the URL path join `path.join(target, ...params.path)`. If `params.path` contains a leading `..` or absolute path, the join may escape the intended `/api/metrics/...` namespace on the stats backend. `path.join` normalises `..` segments, so the join is safe here in practice, but worth a regression test to lock the behaviour.
Evidence: `data/[...path].ts` URL assembly.

### F-14  `function/src/auth.ts`  [P2]
Finding: `if (Resource.App.stage !== "production" && !email.endsWith("@anoma.ly"))` — a hard-coded dev-only email-domain gate. If the email domain is ever typo'd or changed, the dev environment silently rejects all but one user. Move the allowed-dev-domains to a `Resource.DEV_ALLOWED_DOMAINS` list or env var.
Evidence: the dev gate in `function/src/auth.ts`.

### F-15  `app/src/context/auth.ts`  [P2]
Finding: `setSession` is called on every `getActor` request that needs to refresh the cookie expiry. There is no jitter on the expiry; if a swarm of requests all hit the same `now()`-derived window, all of them issue a Set-Cookie. Cheap, but the cookie write has no `Max-Age` matching the `expires` — should be aligned.
Evidence: `setSession` in `context/auth.ts`.

## P3 — cleanup / refactor

### F-16  `app/src/i18n/**`  [P3 — out of scope]
Finding: 19 translation dictionary files. Per audit instructions, skipped.

### F-17  Generated `.d.ts` files in `console-resource` / `console-core`  [P3 — out of scope]
Finding: auto-generated type declarations; out of scope.

### F-18  `app/src/routes/zen/index.tsx`  [P3]
Finding: commented-out `HttpHeader` cache-control directive at the top of the file. Dead code; remove or wire up.
Evidence: top of `zen/index.tsx`.

### F-19  `app/src/routes/black/subscribe/[plan].tsx`  [P3]
Finding: `stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY!)` — non-null assertion on an env var. If the var is missing the bundle loads a stripe Promise that throws on first use. Should validate at build time and fail loud, not at first payment.
Evidence: top of `black/subscribe/[plan].tsx`.

---

## Cross-file notes

### X-01  No CSP, no Trusted Types
- Console has no `Content-Security-Policy` header anywhere in `app/src/middleware.ts` or any route. A CSP would mitigate the open-proxy and webhook-logging issues by limiting outbound fetches and inline script execution. Not auto-fixed; logged as architecture gap.

### X-02  Edge worker logs are the de-facto audit log
- `console.log` in webhook handlers (`honeycomb`, `stripe`) and `function/src/auth.ts` write to stdout, which Cloudflare Workers ships to Logpush. Multiple P0s (F-02, F-03, F-04) all share the same root cause: there is no log-redaction layer. Recommend a `logger.scrub(value)` helper that masks `tokenset.access`, `payment_method.card`, `customer.email` before write.

### X-03  Rate-limiting exists but is per-key, not per-IP for free tier
- `ipRateLimiter.ts` and `keyRateLimiter.ts` are wired in `handler.ts`, but for the "free" / anonymous model tier the choice of limiter is based on `modelInfo.allowAnonymous`, not on the absence of a key. The current behaviour is correct (anonymous → IP-limiter, key → key-limiter), but a malicious free-tier client with many distinct keys can hammer the endpoint under key-based rate limits. No fix; just note that the per-IP fallback is gated on `allowAnonymous`.

### X-04  i18n translation files
- 19 files under `app/src/i18n/` are pure data (no logic). All skipped per audit instructions.

---

## Counts
- P0: 4 (F-01 open proxy, F-02 honeycomb log, F-03 stripe log, F-04 OpenAuth token log)
- P1: 6 (F-05..F-10)
- P2: 5 (F-11..F-15)
- P3: 4 (F-16..F-19)
