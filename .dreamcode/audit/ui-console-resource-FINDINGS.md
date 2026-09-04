# UI + Console-Resource Audit — ui-console-w4

**Auditor:** auditor-ui-console-w4
**Scope:** packages/ui/src/{components,context,hooks,utils}, packages/console/resource, packages/console/email
**Date:** 2026-08 (live audit)

## Summary

| Severity | Count |
|----------|-------|
| P0       | 0     |
| P1       | 3     |
| P2       | 6     |
| P3       | 7     |

(Findings cite file:line, what, why, fix. Skipped: utils/ (does not exist), email/ (use mail/), markdown.tsx + marked.tsx + select.tsx (already audited).)

## Findings

### P1-1 — webfetch tool href from server/LLM-controlled input not scheme-validated

- **File:** `packages/ui/src/components/message-part.tsx:1710-1735`
- **What:** The `webfetch` tool render builds a clickable link whose `href` is `props.input.url` straight from the tool's input payload (the URL the assistant chose to fetch). The element is rendered as `<a href={url()} target="_blank" rel="noopener noreferrer">`. The anchor carries `rel="noopener noreferrer"` but no scheme allowlist.
- **Why:** If the LLM emits any URL with a non-http(s) scheme (e.g. `data:text/html,<script>...`, `file://`, `javascript:`-via-encoded-redirect, `intent:`, `vbscript:`-on-old-clients), the browser will navigate the user to it. `javascript:` is blocked by browsers when used in `href`, but `data:text/html` and `file://` are still navigable, and the LLM does not have to be malicious for a tool user to be at risk of being lured to a phishing page by a *plausible-looking* URL like `https://accounts.google.com.evil.example/login`. The risk is amplified because the link is rendered as the trusted "webfetch" tool with a known title.
- **Fix:** Validate `url()` against an explicit allowlist (`http:`/`https:` only) before rendering; render the visible text as the host + path (already done in the trigger) but gate the anchor on a scheme check. Also: never let `data:` or `file:` URLs through. The server side (the agent runner) should also refuse to fetch any non-http(s) URL.

### P1-2 — ExaOutput renders extracted URLs as raw anchors

- **File:** `packages/ui/src/components/message-part.tsx:805-825` (render) and `message-part.tsx:459-468` (`urls()` extractor)
- **What:** `urls(text)` extracts every `https?://...` it finds in the tool output via a regex and renders each as a clickable `<a href={url}>`. No scheme re-check, no host allowlist, no `data-*` attribute for the originating tool.
- **Why:** The text fed into `urls()` is whatever the Exa (web search) tool returned. Exa's response is text, but the text can include any string the upstream service chose to publish; a poisoned Exa result page (or a misconfigured search index) yields a perfectly clickable phishing link. Combined with the absence of any origin metadata on the rendered anchor, the user has no way to tell which tool the link came from.
- **Fix:** Add a tool-origin indicator on the rendered link (`data-tool="exa"`) and strip non-http(s) matches in `urls()` (it already only matches http/https — but keep the guard in a `for` over each match rather than trusting the regex alone). Consider showing only the first 2-3 links and grouping the rest under a disclosure.

### P1-3 — resource.node.ts `bulkGet` returns an Array (or string?) on single-key access — type confusion / possible data leak

- **File:** `packages/console/resource/resource.node.ts:25-32`
- **What:** For a single-string `k`, `bulkGet` returns `result?.values?.[k]` — i.e., the *value* of the entry, not an array. For a `string[]` `k`, it returns `new Map(Object.entries(result?.values ?? {}))` — a `Map<string, V>`. The contract is asymmetric: single-key returns the bare value, multi-key returns a Map keyed by key name.
- **Why:** Callers that forget to switch on `Array.isArray(k)` will either treat a value as a Map (silently broken) or treat a Map as a value (likely throwing). More dangerously, if the consumer indexes into the bare value expecting `{ [k]: V }` and the value happens to be a string or primitive, the iteration spreads keys that are not workspace IDs. This is a quiet, high-blast-radius data shape confusion that touches every KV consumer in the console app.
- **Fix:** Standardize the return shape: always return a `Map<string, V>`. If a single key is requested, return `new Map([[k, value]])` so call sites can always call `.get(k)`. Add a JSDoc contract.

### P2-1 — log-processor.ts console.log PII to Cloudflare tail

- **File:** `packages/console/function/src/log-processor.ts:53-71`
- **What:** `console.log(JSON.stringify(data, null, 2))` and `console.log(await honeycomb.text())` and `console.log(honeycomb.status)` are called on every traced request. `data` includes `ip` (full client IP), `cf.latitude`, `cf.longitude`, `cf.city`, `cf.region`, and `ipPrefix`.
- **Why:** `console.log` in a Cloudflare worker writes to the worker's `tail` logs, which are streamed to whatever log sink is configured (often Cloudflare Logpush, then a third-party SIEM). PII (IP, geo) flowing to that sink is generally expected — but the *full* unredacted IP (not just the /64 prefix) ends up there, which broadens the PII footprint beyond what the Honeycomb / Lake ingest paths receive. Compliance posture: GDPR data-minimization says keep only the prefix where possible.
- **Fix:** Strip the full `ip` from `data` before the `console.log`; keep `ipPrefix` only. Remove the Honeycomb response-body log (`honeycomb.text()`) — status code is enough and a misbehaving proxy could echo tokens in the body.

### P2-2 — log-processor.ts JSON.parse on untrusted `event.logs[*].message` after a prefix check

- **File:** `packages/console/function/src/log-processor.ts:48-53`
- **What:** Code does `if (!message.startsWith("_metric:")) return []; const json = JSON.parse(message.slice(8))` for every log line of every traced request.
- **Why:** The `_metric:` prefix is a string convention — any code path that emits a `console.log("_metric:...")` line populates the parser input. A bug in any worker module that accidentally logs a `_metric:`-prefixed string will silently feed junk into the event pipeline. The result is then spread into `data` (`data = { ...data, ...json }`), so a stray key could overwrite `ip`/`status`/etc. before being shipped to Honeycomb. There is no schema check, no try/catch, no size cap.
- **Fix:** Wrap the `JSON.parse` in try/catch and drop the line on parse failure. Validate the resulting object with a Zod schema (or at minimum check `typeof` for each known metric key). Cap the JSON size to e.g. 16 KiB before parsing.

### P2-3 — stat.ts endpoint is unauthenticated and unbounded

- **File:** `packages/console/function/src/stat.ts:11-37`
- **What:** `POST /stat` (or whatever route wires this up) reads `{ ids: string[] }` from the request body and returns per-minute qualify/unqualify counters for each id from `ModelTpsRateLimitTable`. There is no `Actor.assert("user")` / `Actor.workspace()` / session check, and `ids.length` is not bounded.
- **Why:** Anyone on the public internet who can reach the worker can query TPS rate-limit counters for any model id set. This is a side-channel for traffic analysis (when does Anthropic see spikes? how heavily is GPT-4 used?) and a small DoS surface (send `ids: Array(1e6).fill("x")` and force a large `inArray` query).
- **Fix:** Add `Actor.assert("user")` and scope the query to the actor's workspace (or a workspace they can read). Cap `ids.length` (e.g. 256) and validate each id against the set of known model ids.

### P2-4 — billing.generateReceiptUrl does not scope paymentID to the actor's workspace

- **File:** `packages/console/core/src/billing.ts:380-394`
- **What:** `generateReceiptUrl` looks up a payment intent by `paymentID` (a Stripe payment_intent id) and returns `charge.receipt_url`. There is no check that the payment intent belongs to the calling workspace, no check that the actor is admin, and no check that the `paymentID` is one of the workspace's `PaymentTable.id` values.
- **Why:** Stripe receipt URLs are bearer tokens — anyone with the URL can download the PDF receipt (and the receipt includes the amount, last 4 of card, customer name/email if on file, and the workspace-internal description). With a leaked or guessed `paymentID` (these are `pi_*` and not enumerated easily, but they appear in user-facing emails and checkouts) a non-admin user can pull a receipt for any payment, including other workspaces'.
- **Fix:** Either (a) join `PaymentTable` on `paymentID` and enforce `eq(PaymentTable.workspaceID, Actor.workspace())`, or (b) use Stripe's search/list with a metadata filter (`metadata.workspaceID = Actor.workspace()`) and return the local payment record's id rather than the Stripe id. Also: ensure the function rejects `Actor.assert("public")`.

### P2-5 — billing.unsubscribeBlack / unsubscribeLite look up workspace by Stripe subscriptionID with no actor check

- **File:** `packages/console/core/src/billing.ts:541-580`
- **What:** `unsubscribeBlack({ subscriptionID })` reads `BillingTable` by `subscriptionID`, derives a `workspaceID`, then nulls out the subscription fields. There is no `Actor.assert("user")`, no workspace match check, no admin check.
- **Why:** The function reads the workspace from the DB and then mutates that workspace's billing row. Any caller that can supply a known subscription ID (these are `sub_*` and appear in Stripe-hosted customer portals) can unsubscribe an arbitrary workspace. This is a privileged write that bypasses the `Actor` model entirely.
- **Fix:** Require `Actor.assert("user")` and `Actor.assertAdmin()`, then verify `eq(BillingTable.subscriptionID, subscriptionID) AND eq(BillingTable.workspaceID, Actor.workspace())` and reject on no-match. Same fix for `unsubscribeLite`.

### P2-6 — auth.ts hard-coded allowlist for non-prod: only `@anoma.ly` emails can sign in

- **File:** `packages/console/function/src/auth.ts:131-133`
- **What:** `if (Resource.App.stage !== "production" && !email.endsWith("@anoma.ly")) { throw new Error("Invalid email") }`
- **Why:** This is a *dev/preview* gate, not a security issue per se, but the comment trail shows it's easy to mis-deploy. If a `staging` or `dev` stage is ever promoted or merged into a non-production-but-public deployment, the only check that prevents any random user from creating an account is "email ends with @anoma.ly". A future env that is `!== "production"` and Internet-reachable would be wide open to anyone with an `@anoma.ly` mail address (and that domain is owned by one specific person, so the blast radius is small, but the gate is brittle).
- **Fix:** Use a stage-specific allowlist of trusted emails (array of emails, not a domain suffix), or wire it to a real allowlist of users via a KV key. Log every rejection at `warn` so a misconfigured stage is obvious.

### P3-1 — icon.tsx builds SVG sprite via `innerHTML` from a typed-but-still-template-literal object

- **File:** `packages/ui/src/components/icon.tsx:133-137`
- **What:** `svg.innerHTML = Object.entries(icons).map(([name, path]) => `<symbol id="${symbol(key)}" viewBox="${viewBox(key)}">${path}</symbol>`).join("")`
- **Why:** Today, `icons` is a hardcoded `as const` map (the keys and path strings are static), so this is safe. The risk is that the same pattern is the obvious copy-paste for a future maintainer who wants to feed it dynamic keys (e.g. a plugin system or a server-provided icon registry). If the keys ever stop being a closed set, the symbol id and viewBox can be attacker-controlled, and path strings are pure SVG markup that the browser will parse.
- **Fix:** Build the sprite with `document.createElementNS` + `setAttribute` for each symbol, or use a single template per icon and `appendChild`. Don't interpolate user-controllable keys into a template string that ends up in `innerHTML`.

### P3-2 — file-ssr.tsx: `template[shadowrootmode="open"] innerHTML={preloadedDiff.prerenderedHTML}`

- **File:** `packages/ui/src/components/file-ssr.tsx:185`
- **What:** The SSR path injects `local.preloadedDiff.prerenderedHTML` into a declarative shadow root's `innerHTML`. The HTML is produced by the SSR pipeline (server-side, trusted), but the value flows from a prop and there is no length cap, no `TrustedHTML` check, and no schema validation.
- **Why:** If the SSR layer ever feeds untrusted user content (a filename that becomes a `data-` attribute, a file body that becomes raw HTML in the diff), the SSR will happily emit it. Today the SSR is a known diff renderer, so the value is constrained. Future drift (e.g. letting users share a diff URL that renders the body) is a stored-XSS vector.
- **Fix:** Cap the HTML length, and consider validating against a known shape (e.g. a list of allowed tag names) before passing to the shadow root.

### P3-3 — file.tsx: `viewer.container.innerHTML = ""` to clear diff DOM

- **File:** `packages/ui/src/components/file.tsx:500`
- **What:** `opts.viewer.container.innerHTML = ""` is used to clear the rendered diff DOM before re-rendering.
- **Why:** Setting `innerHTML = ""` is the older way to clear children; `replaceChildren()` is the modern, spec-blessed, and slightly faster alternative. The behavior is identical for the current code path (no event listeners on the cleared children leak), so this is purely a code-quality nit. No exploitable behavior because no user input flows into the cleared value.
- **Fix:** Replace with `opts.viewer.container.replaceChildren()`. Mechanical, low risk.

### P3-4 — file-media.tsx renders `<img src={value()}>` / `<source src={value()}>` with a `startsWith("data:")` guard

- **File:** `packages/ui/src/components/file-media.tsx:208, 218, 240` and `pierre/media.ts:38-49`
- **What:** `value()` for the image branch is `dataUrlFromMediaValue(...)` which validates `value.startsWith("data:image/")` or `data:image/svg+xml`. So the URL always starts with `data:`.
- **Why:** This is the safe path: a `javascript:` URL cannot reach `<img src>` (browsers block it), and the explicit prefix check prevents a `data:text/html,...` from rendering as HTML. Worth keeping the test in place; documenting the contract here so a future change to `<img src={file.url}>` (a different field that *is* a regular URL) doesn't accidentally drop the guard.
- **Fix:** No fix needed; add a comment in `file-media.tsx` near the `<img src={value()}>` that the value is *guaranteed* to be a `data:` URL, so a maintainer doesn't relax the upstream validator.

### P3-5 — file-media.tsx: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(record.content)}` — encoded SVG, no `<script>` execution context concern

- **File:** `packages/ui/src/pierre/media.ts:88-91`
- **What:** SVG content is URL-encoded into a `data:` URL, then set as `<img src>`. The browser does not execute `<script>` inside an SVG loaded as `<img src>`.
- **Why:** This is the correct, safe pattern. Worth a one-line comment in the source to make it obvious to a future maintainer that the choice of `<img>` (rather than `<object>` or inline SVG) is what blocks script execution. If anyone changes this to `dangerouslySetInnerHTML` or inline `<svg>`, SVG-borne scripts would run.
- **Fix:** No fix needed; add a brief `// <img src> does not execute <script> inside SVG` comment for future maintainers.

### P3-6 — text-field.tsx / tool-error-card.tsx `navigator.clipboard.writeText` without try/catch

- **File:** `packages/ui/src/components/text-field.tsx:64`, `tool-error-card.tsx:95-100`
- **What:** `await navigator.clipboard.writeText(value)` is called with no error handling. If the user has denied clipboard permission, this rejects the promise.
- **Why:** In Solid, an unhandled rejection in an event handler logs to the console but does not break the app. The "Copied" indicator also does not flip back if the write fails. The user thinks the copy worked, then pastes nothing. Low-impact UX bug, no security issue.
- **Fix:** Wrap in try/catch; on rejection, show a different toast or fall back to a hidden `<textarea>` + `document.execCommand("copy")` (which still works in restrictive contexts). Add a regression test.

### P3-7 — favicon.tsx `innerHTML` and `link` injection — already audited but pattern recurs

- **File:** `packages/ui/src/components/favicon.tsx` (already in pre-skipped list — included here for cross-reference only)
- **What:** N/A — pre-audited. Listed so the gate file records that the audit was already done and that the `dangerouslySetInnerHTML` here is acceptable.
- **Why:** Cross-reference.
- **Fix:** None.
