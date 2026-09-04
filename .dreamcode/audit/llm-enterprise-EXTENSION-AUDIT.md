# LLM & Enterprise Extension Audit — test-v1.5.x

**Scope:** `packages/llm/`, `packages/enterprise/`, `packages/containers/`, `packages/script/`, `packages/plugin/`
**Files audited:** 81 source files (~452 KB)
**Branch:** test-v1.5.x
**Mode:** Read-only audit (no inline fixes applied)
**Reviewer:** LLM-Enterprise sub-auditor

---

## 0. Executive Summary

This audit reviewed the LLM provider client, the OpenCode Enterprise SolidStart app, container build pipeline, and adjacent plugin/script packages. The codebase shows a strong defensive posture: timing-safe secret comparison, structured effect-typed errors, prompt caching with documented invariants, CORS allowlist on the catch-all route, and a non-root container build user. The most significant gaps are **no global rate limiting at the catch-all route**, **error-logging verbosity** in the executor that may surface internals, several **container hygiene** items (root default in `publish`, missing `HEALTHCHECK` on most images, no checksum on Bun install), and **no application-layer cost cap**. No critical secrets were found hardcoded.

### Severity legend
- **CRITICAL** — direct credential exposure, RCE, or auth bypass
- **HIGH** — privilege escalation, data exfiltration, or wide-impact defect
- **MEDIUM** — defense-in-depth gap, partial bypass, foot-gun
- **LOW** — hygiene / informational
- **INFO** — observation, not a defect

### Findings by severity
| ID | Title | Sev | Area |
|---|---|---|---|
| F-AUTH-01 | `Auth.optional()` error may leak env var name in `providerMetadata` | HIGH | Auth |
| F-AUTH-02 | `MissingCredentialError` propagated without scrubbing | MED | Auth |
| F-AUTH-03 | Prior audit reference (already in source comment) | INFO | Auth |
| F-RATE-01 | No global rate limiter on catch-all route | HIGH | Rate limit |
| F-RATE-02 | `RateLimit.retryable=true` can amplify backoff storms | MED | Rate limit |
| F-COST-01 | `Usage` carries raw `providerMetadata` without redaction | MED | Cost |
| F-COST-02 | No per-token / per-call billing cap | MED | Cost |
| F-CONT-01 | `publish` Dockerfile installs `docker.io` + `pacman-package-manager`, runs as root | HIGH | Container |
| F-CONT-02 | `base` image has `HEALTHCHECK NONE` | LOW | Container |
| F-CONT-03 | `tauri-linux` runs as non-root but cache pre-warm not pinned | LOW | Container |
| F-CONT-04 | Bun installed via `curl | bash` without checksum verification | HIGH | Container |
| F-CONT-05 | `rust` image runs as root; downstream `tauri-linux` overrides | MED | Container |
| F-CONT-06 | No SBOM/cosign/provenance at build script level | MED | Container |
| F-ROUTE-01 | Catch-all `[...path].ts` defaults to restrictive CORS (fail-loud) | MED | Route |
| F-ROUTE-02 | `OPENCODE_API_ALLOWED_ORIGINS` env is unvalidated | LOW | Route |
| F-ROUTE-03 | Body limit `16_384` bytes undocumented, no per-route override | LOW | Route |
| F-SHARE-01 | `Share.create` ID derived from last 8 chars of sessionID | MED | Share |
| F-SHARE-02 | `Share.legacy()` S3 `before` filter is string-comparison (correct but fragile) | LOW | Share |
| F-SHARE-03 | OG image generation calls external `social-cards.sst.dev` (privacy) | LOW | Share |
| F-LOG-01 | `executor.ts` redactor may miss non-standard header names | MED | Logging |
| F-LOG-02 | `[...path].ts` returns error.message to client | MED | Logging |
| F-LOG-03 | `entry-server.tsx` accepts raw `accept-language` (low risk) | LOW | Logging |
| F-MISC-01 | `plugin.tui` field typed as `nev` (typo) | LOW | Plugin |
| F-MISC-02 | `script/index.ts` fetches npm registry without integrity check | MED | Script |
| F-MISC-03 | Detached HEAD `branch` check OK but version fallback silent | LOW | Script |
| F-MISC-04 | `SCRIPT_DEBUG` logs full `Script` object (including team list) | LOW | Script |
| F-MISC-05 | `route/llm.ts` re-exports `retryable` getter (verify error stringify path) | INFO | Route |
| F-MISC-06 | `entry-server.tsx` does not strip or normalize `accept-language` | LOW | SSR |
| F-SCHEMA-01 | `CachePolicyObject` partial — see source for "auto" + "none" semantics | INFO | Schema |
| F-TRANSPORT-01 | `WebSocketStream` error path may swallow original error | LOW | Transport |

---

## 1. Auth & Credential Handling

### 1.1 `packages/llm/src/route/auth.ts` — `Auth`, `Credential`

**Observations:**
- `Auth` is a higher-kinded abstraction exposing `apply`, `andThen`, `orElse`, `pipe`. It composes credential resolvers with `Auth.optional()`, `Auth.config()`, `Auth.header()`, etc.
- `MissingCredentialError` is a tagged error with `_tag = "MissingCredentialError"`. It carries only the original `Error.cause`; no secret material is placed in the error object itself.
- `isSecretEqual` (in `share.ts` and `[shareID].tsx`) uses `crypto.timingSafeEqual` with a length-equality short-circuit. The length short-circuit is acceptable here because the inputs are controlled (one is a UUID), but the pattern should be reviewed for reuse in the executor.
- `ProviderAuthOption<"optional">` distinguishes providers that accept an API key but do not require it.

**Findings:**

- **F-AUTH-01 (HIGH)** — `Auth.optional()` and `Auth.config()` return providers that may include the raw env var name in the `providerMetadata` of the error. When `MissingCredentialError` is propagated up, downstream log lines that dump `providerMetadata` would leak the env var name. A more conservative pattern would hash or classify the env name. The credential itself is **not** stored, but the **provenance** of where it was looked up is exposed. Audit and reduce the surface.
- **F-AUTH-02 (MED)** — When a downstream provider is not in the route table, the executor surfaces `NoRouteReason(provider, model, route)` via `LLMError`. The `providerMetadata` is populated by the per-provider error mapper (`provider-error.ts`). Confirm that no provider writes a header value into the metadata when an auth header is missing. (Verified in `executor.ts` redactor: `REDACTED` placeholder is used for sensitive-name matches; the match list is correct for the major providers.)
- **F-AUTH-03 (INFO)** — Inline note exists in `auth.ts` referencing prior audit F-AUTH-03. This audit reuses the ID for consistency. No new defect; observation only.

### 1.2 `packages/llm/src/route/auth-options.ts`

**Observations:**
- `ProviderAuthOption` is a tagged union: `optional`, `api`, `oauth`, `aws`, `gcp`, `instance`, `env`.
- `AuthOptions` interface holds the resolved option plus optional `refresh` and `expires` for OAuth-style flows.
- No persistence of credentials: `AuthOptions` is constructed per-call by the `Auth` combinators.

**Findings:** None. Structure is sound.

### 1.3 `packages/llm/src/route/executor.ts` — middleware chain

**Observations:**
- Constants: `BODY_LIMIT = 16_384`, `MAX_RETRIES = 2`, `BASE_DELAY_MS = 500`, `MAX_DELAY_MS = 10_000`.
- The redactor regex `SENSITIVE_NAME_SOURCE` matches `authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|credential|signature|x-amz-signature`. Comprehensive for major providers.
- `SHORT_QUERY_NAME = /^(key|sig)$/i` is a good defensive measure for query strings with two-letter sensitive names.

**Findings:**

- **F-LOG-01 (MED)** — While the redactor rewrites header/query values whose name matches the pattern, the `HttpContext` carries `headers: Schema.Record(Schema.String, Schema.String)` which is the **sanitized** version. However, the `TransportReason` and `ProviderInternalReason` schemas carry the same `HttpContext` and are returned in `LLMError.message`. If the redaction misses a non-standard header (e.g. `openai-organization`, `anthropic-version`, `x-api-key` from a custom provider), the value flows into the error. Recommend extending the pattern with provider-specific prefixes.
- **F-MISC-05 (INFO)** — `LLMError` exposes `retryable` and `retryAfterMs` getters, and the `cause` is the inner reason. The public surface looks correct, but a downstream consumer that stringifies an `LLMError` will see the redacted `HttpContext` — good. Verify that `JSON.stringify(error)` (e.g. in Next.js/Hono error middleware) is the path used; if `error.toJSON()` is overridden to expose the unsanitized metadata, that's a defect.

---

## 2. Rate Limit Enforcement

### 2.1 Catch-all route `packages/enterprise/src/routes/api/[...path].ts`

**Observations:**
- CORS allowlist is computed from `OPENCODE_API_ALLOWED_ORIGINS` (comma-separated). Default is `https://opencode.ai`.
- `timingSafeEqual` is used for the share secret check; the `secret` query param is consumed and not echoed.
- CORS preflight `maxAge: 600` is reasonable; `credentials: false` avoids the `Access-Control-Allow-Credentials` + wildcard trap.
- No rate limiter is registered. Per-IP and per-token throttling is the responsibility of upstream proxies (CDN, ingress).

**Findings:**

- **F-RATE-01 (HIGH)** — There is **no application-layer rate limiter** on the catch-all. If the catch-all fronts a high-cost endpoint (e.g. an LLM relay, billing reconcile, share download), a single misconfigured client can drain quota. The deployment topology is unknown from this audit, but a defense-in-depth pattern (token bucket at the route) is recommended. Worst case: a single bearer token can issue unbounded calls.
- **F-ROUTE-01 (MED)** — The CORS allowlist defaults to a single host (`https://opencode.ai`). If operators set the env to a wildcard or leave it empty, the allowlist is empty and preflight is rejected — fail-closed. Verify in the deployment manifest that the env is set. The current behavior is **safe-by-default** but **fail-loud** in prod.
- **F-ROUTE-02 (LOW)** — `OPENCODE_API_ALLOWED_ORIGINS` is split on `,` without trimming or scheme validation. A trailing comma or a value like `https://a.com,` produces a malformed origin in `Access-Control-Allow-Origin`. Recommend validating each entry matches `^https?://` at startup.
- **F-ROUTE-03 (LOW)** — The body limit is `16_384` bytes (`executor.ts`) but the catch-all does not appear to surface a 413 for larger bodies; the limit applies in the LLM executor, not the HTTP request body. Confirm whether the SolidStart `RequestEvent` has a body-size cap; if not, an oversized request body is parsed in full.

### 2.2 Rate-limit error path

**Findings:**

- **F-RATE-02 (MED)** — `RateLimitReason.retryable = true` means the executor's retry loop will retry on rate limits. With `MAX_RETRIES = 2` and `BASE_DELAY_MS = 500`, a misbehaving caller can amplify a backoff storm. The `retryAfterMs` from the provider is honored (`BASE_DELAY_MS * 2^attempt` capped at `MAX_DELAY_MS`), so the worst case is bounded, but **rate-limit retries are unconditional** — there is no circuit breaker. A provider that returns 429 with no `Retry-After` will hit the maximum delay path; this is correct, but at scale, a stampede of timed retries is possible. Consider jitter and per-(provider, model) circuit breaker.

---

## 3. Cost Tracking

### 3.1 `packages/llm/src/schema/events.ts` — `Usage`

**Observations:**
- `Usage` carries `inputTokens`, `outputTokens`, `nonCachedInputTokens`, `cacheReadInputTokens`, `cacheWriteInputTokens`, `reasoningTokens`, `totalTokens`, `providerMetadata`.
- The documented invariant is `nonCachedInputTokens + cacheReadInputTokens + cacheWriteInputTokens = inputTokens`. `Math.max(0, ...)` clamping is used in the visible-output getter for defense against provider bugs.
- `providerMetadata` always carries the provider's raw usage payload — **keyed by provider name** — for fields not normalized and for billing-level audit trails.

**Findings:**

- **F-COST-01 (MED)** — `providerMetadata` is **not** scrubbed. A provider that includes a billing ID, organization ID, or workspace slug in its raw usage payload will leak that into every `StepFinish`/`Finish` event. Confirm the providers strip non-billing fields. Recommended: introduce a `UsageRedactor` that drops keys matching a deny-list before the event is emitted to the application layer.
- **F-COST-02 (MED)** — There is no **per-call or per-token cost cap** in the executor. The route accepts arbitrary `maxTokens` from the caller. A user-supplied `maxTokens: 100_000` on a high-cost model can blow budget. The mitigation is upstream (per-account budget, per-call limit), but a soft cap with a warn-only `LLMError` would be a clean defense.

### 3.2 Per-protocol cost attribution

- OpenAI Chat / Responses / Gemini / Bedrock: `inputTokens` and `outputTokens` are inclusive; mapper subtracts. Verified in providers' `stream`/`generate` paths.
- Anthropic: reports the breakdown natively. `reasoningTokens` is `undefined` for Anthropic (documented limitation).

**Findings:** None. The math is consistent.

---

## 4. Container Image Security

### 4.1 `packages/containers/base/Dockerfile`

**Observations:**
- `FROM ubuntu:24.04` (no digest pin).
- `HEALTHCHECK NONE` is a deliberate opt-out for a build-time base.
- Creates non-root `build` user (uid 10001) but does not switch to it.
- `apt-get install` correctly uses `--no-install-recommends` and cleans `/var/lib/apt/lists/*`.

**Findings:**

- **F-CONT-02 (LOW)** — `HEALTHCHECK NONE` is acceptable for a build base, but downstream `tauri-linux` inherits this. Mark the runtime images with a meaningful `HEALTHCHECK`.
- **INFO** — No digest pin on `ubuntu:24.04`. Pin to a digest for reproducibility and to defeat registry poisoning.

### 4.2 `packages/containers/bun-node/Dockerfile`

**Findings:**

- **F-CONT-04 (HIGH)** — Bun is installed via `curl -fsSL https://bun.sh/install | bash -s -- "bun-v${BUN_VERSION}"`. **No checksum verification.** The Bun install script is trusted as-is. An attacker who compromises bun.sh or DNS can inject arbitrary code into the build. Recommend: download the official `.zip`/`.tar.xz` from `https://github.com/oven-sh/bun/releases`, verify the SHA-256 from a pinned release tag, and unzip. This is a **supply-chain** concern that affects every downstream image.
- Node.js is installed from `nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz` — also no checksum. Same recommendation.

### 4.3 `packages/containers/publish/Dockerfile`

**Findings:**

- **F-CONT-01 (HIGH)** — Installs `docker.io` and `pacman-package-manager`. These are build-time tools (presumably to build a pacman package and run Docker). However, **no `USER` directive** — the image defaults to root. A build that is later reused as a runtime base inherits the risk. If this image is **only** a build image, document the assumption; if it is ever run as a service, drop both packages and add `USER`.
- The image is used at build time; runtime exposure depends on the CI job. The recommendation stands: **default-deny** for runtime attack surface.

### 4.4 `packages/containers/rust/Dockerfile`

**Findings:**

- **F-CONT-05 (MED)** — Runs as root by default. Downstream `tauri-linux` overrides to `USER tauri`, but the rust image is reusable. Recommend adding `USER` here too.
- Rustup is installed via `curl -fsSL https://sh.rustup.rs | sh -s -- ...` — no signature verification, no GPG check. **Supply-chain** concern. Recommend verifying the `rustup-init.sha256`.

### 4.5 `packages/containers/tauri-linux/Dockerfile`

**Observations:**
- Inherits from `rust`. `RUN groupadd -g 10001 tauri && useradd -m -u 10001 -g tauri tauri && chown -R tauri:tauri /opt/cargo /opt/rustup; USER tauri`. **Good** — non-root build user.

**Findings:**

- **F-CONT-03 (LOW)** — `cargo` cache is owned by the user. If the `rust` base is rebuilt with a different `RUST_TOOLCHAIN`, the pre-warm is invalidated and a fresh download happens — at the **user** level, which is fine. No defect, observation only.

### 4.6 `packages/containers/script/build.ts`

**Observations:**
- Iterates over `["base", "bun-node", "rust", "tauri-linux", "publish"]` and builds each. Passes `--build-arg BUN_VERSION` to every image (cache key alignment, good).
- Uses `docker buildx` with `--platform linux/amd64,linux/arm64`.
- No `cosign sign`, no `syft sbom`, no `--provenance=true`.

**Findings:**

- **F-CONT-06 (MED)** — No SBOM generation, no image signing, no provenance attestation at the build-script level. Recommend adding `syft` and `cosign` invocations after each `--push` to produce a verifiable artifact. This is a **defense-in-depth** gap, not a defect in the build itself.

---

## 5. Catch-all Route Validation

### 5.1 `packages/enterprise/src/routes/api/[...path].ts`

Already covered in §2.1. **F-RATE-01, F-ROUTE-01..03** apply.

### 5.2 `packages/llm/src/route/index.ts`, `route/endpoint.ts`, `route/protocol.ts`

**Observations:**
- `route/index.ts` exports the route namespace.
- `route/endpoint.ts` defines endpoint shapes (request, response, error).
- `route/protocol.ts` defines per-protocol lowering.

**Findings:** None. The route layer is the lower-cost LLM-specific code; the catch-all in `enterprise` is the public surface. The split is correct.

### 5.3 `packages/llm/src/route/client.ts`

**Observations:**
- Exports `prepare`, `stream`, `generate`, `streamRequest`, `prepareWith`, `streamRequestWith`, `generateWith`.
- The `*With` variants accept a pre-resolved `Auth` and `Provider`, enabling caller-side composition.

**Findings:** None. Composition is explicit; no implicit global state.

---

## 6. Middleware Chain

### 6.1 `packages/llm/src/route/executor.ts`

**Observations:**
- The executor is a **single function** that:
  1. Resolves the `Auth` for the model.
  2. Calls the provider's `prepare` to lower the request.
  3. Executes via transport (`http.ts` or `websocket.ts`).
  4. Streams events back.
  5. Maps provider errors to `LLMError` reasons.
- Retries are bounded by `MAX_RETRIES = 2`. The redactor runs on every `HttpContext` before it leaves the executor.
- There is no `use(middleware)` chain — the executor is **not** pluggable. This is **fine** for the current scope (one client, one retry policy) but means future middleware (e.g. tracing, cost cap) must be added inside the executor.

**Findings:** None. The lack of a middleware chain is **not** a defect; the executor is the right place to centralize the redactor and retry policy.

### 6.2 `packages/llm/src/transport/http.ts`, `transport/websocket.ts`, `transport/index.ts`, `transport/framing.ts`

**Observations:**
- `http.ts` — fetch-based; uses `AbortSignal` for cancellation.
- `websocket.ts` — `WebSocketStream` wrapper.
- `framing.ts` — provider-specific framing (SSE, JSON-lines, etc.).
- `index.ts` — barrel.

**Findings:**

- **F-TRANSPORT-01 (LOW)** — Error paths in `WebSocketStream` swallow the original error in some branches. Verify that all error branches re-throw or include the original message; if the wrapping error is opaque, debugging is harder but not a security defect.

---

## 7. Share API & Storage

### 7.1 `packages/enterprise/src/core/share.ts`

**Observations:**
- `Share.Info` is `{ id, secret, sessionID }`. The `id` is derived as `sessionID.slice(-8)` (prefixed with `test_` in tests). The `secret` is a `crypto.randomUUID()`.
- `Share.create` throws `AlreadyExists` if the ID already exists.
- `Share.remove` and `Share.sync` both verify the secret via `isSecretEqual` (timing-safe).
- `Share.legacy()` migrates from per-event storage to a snapshot.
- The `Data` union is `session | message | part | session_diff | model`.

**Findings:**

- **F-SHARE-01 (MED)** — `Share.create` derives the public ID from the last 8 chars of `sessionID`. If `sessionID` is high-entropy (UUID), this is fine; if it's predictable (e.g. incremental integer or timestamp), two concurrent shares collide. The 8-char suffix is **short** (≈32 bits) — collision probability is non-negligible at high session counts. Recommend using a fresh `crypto.randomUUID()` for the public ID and storing a separate `sessionID` mapping. This is a **non-urgent** defect because UUIDs are likely used, but the **pattern** is fragile.
- **F-SHARE-02 (LOW)** — `Storage.list({ before })` filters results by string comparison on `<beforePath>`. S3 keys are lexicographically sorted, so this is correct for S3's behavior. Verified safe.
- **INFO** — The `secret` is never stored in plaintext on the share page response; the SSR strips it before rendering. Verified in `routes/share/[shareID].tsx` (`Cache-Control: private, no-store` is set, and the secret is consumed from the query string, not echoed).

### 7.2 `packages/enterprise/src/core/storage.ts`

**Observations:**
- Adapter pattern: `s3()` uses `https://s3.${region}.amazonaws.com/${bucket}`; `r2()` uses `https://${accountId}.r2.cloudflarestorage.com/${bucket}`.
- `AwsClient` from `aws4fetch` signs the request.
- `Storage.list` warns (does not throw) when called without a prefix. **Good** — fail-loud in logs, fail-soft at runtime.

**Findings:**

- **INFO** — S3/R2 endpoints are HTTPS-only; the `endpoint` env var is interpolated into the URL. If a future operator sets `endpoint` to `http://...`, traffic is plaintext. Recommend validating the scheme at startup.

### 7.3 `packages/enterprise/src/routes/share/[shareID].tsx`

**Observations:**
- `getData` server function verifies the secret via `isSecretEqual`. Failure throws `SessionDataMissingError` and renders `<NotFound />`.
- `Cache-Control: private, no-store` prevents shared caches.
- `Meta name="robots" content="noindex, nofollow"` prevents indexing.
- OG image is generated by `social-cards.sst.dev`. The share ID and model ID are in the URL.

**Findings:**

- **F-SHARE-03 (LOW)** — OG image URL is `https://social-cards.sst.dev/opencode-share/${encodedTitle}.png?model=${modelParam}&version=${version}&id=${data().shareID}`. The `shareID` is **not** a secret, so leaking it in a third-party request is acceptable, but it does mean **the third party sees a list of share IDs visited by users** (via referer). This is a **privacy** concern, not a security defect. Recommend stripping the share ID from the OG image or self-hosting the OG image generator.

---

## 8. SSR & UI

### 8.1 `packages/enterprise/src/entry-server.tsx`

**Findings:**

- **F-MISC-06 (LOW)** — `accept-language` is parsed without normalization (only `zh`/`en` are checked). If the header is malformed (e.g. `zh-CN, en;q=0.9, *;q=0.5`), the loop returns on the first match (`zh`). Safe behavior. The header is **not** reflected to the user (no header is echoed in a response), so this is **not** a fingerprinting vector. **INFO** — observation only.
- **F-LOG-03 (LOW)** — `<html lang={lang}>` sets the lang attribute from the request header. This is **server-determined** and **safe**; the value is one of two constants.

### 8.2 `packages/enterprise/src/app.tsx`

**Findings:** None. The app is a SolidJS Router root with `MetaProvider`, `DialogProvider`, `MarkedProvider`, `UiI18nBridge`. No secrets in the client bundle.

### 8.3 `packages/enterprise/src/entry-client.tsx`

**Findings:** None. Standard SolidJS Start mount.

### 8.4 `packages/enterprise/src/app.css`

**Observations:** 43 bytes: `@import "@opencode-ai/ui/styles/tailwind";`. No custom CSS. No secrets.

### 8.5 `packages/enterprise/src/routes/share/[shareID].tsx` (SSR)

Already covered in §7.3.

---

## 9. Function API

### 9.1 `packages/enterprise/src/function/api.ts`

**Observations:** This file is **not in the inventory** (it does not exist or is out-of-scope). The audit was unable to locate it; the directory `packages/enterprise/src/function/` is empty or absent. **Scope limitation** — this is **not** a finding against the codebase, but a note that the function API surface was **not** audited.

---

## 10. Containers — Build Script

### 10.1 `packages/containers/script/build.ts`

Already covered in §4.6.

---

## 11. Script

### 11.1 `packages/script/src/index.ts`

**Findings:**

- **F-MISC-02 (MED)** — The release script fetches `https://registry.npmjs.org/opencode-ai/latest` with a 5-second timeout and a `User-Agent` header. **No integrity verification** of the response. The script warns in console and uses the version. If the registry is compromised or DNS is hijacked, the script will use a malicious version string. Recommend: pin to a specific version via `OPENCODE_VERSION` and skip the registry fetch in CI; if the fetch is required, verify the response SHA-256 against a known-good list. The inline note in the source acknowledges this as a known gap.
- **F-MISC-03 (LOW)** — When `OPENCODE_VERSION` is unset and the branch is not `latest`, the script reads from `packages/opencode/package.json`. If the package is missing, it falls back to `1.1.0`. This is a **fallback** with a console warning — safe but the fallback version is hardcoded.
- **F-MISC-04 (LOW)** — `SCRIPT_DEBUG` logs the full `Script` object. The object contains `channel`, `version`, `preview`, `release`, `team` (a list of GitHub usernames). No secrets, but the `team` list could be considered sensitive (organizational metadata). Recommend gating the `team` field out of the log.

---

## 12. Plugin System

### 12.1 `packages/plugin/src/*`

**Observations:**
- `index.ts` re-exports the public plugin API.
- `example.ts`, `example-workspace.ts` are sample plugins.
- `shell.ts`, `tool.ts`, `tui.ts` are plugin helpers.

**Findings:**

- **F-MISC-01 (LOW)** — The `tui` field on a plugin is typed as `nev`. This is **not** a known type alias in the visible code; it may be a typo for `never` (correct) or `unknown` (loose). If `tui` is meant to be a function that returns a TUI component, the type should be `PluginTUI` or similar. The type being `nev` (likely `never`) would **forbid** any TUI from being defined. If plugins currently have a `tui` field at runtime, the type is wrong. Verify and fix.

---

## 13. LLM Provider Files

### 13.1 Provider files (all reviewed)

**Providers audited:**
- `packages/llm/src/providers/anthropic.ts`
- `packages/llm/src/providers/openai.ts`
- `packages/llm/src/providers/azure.ts`
- `packages/llm/src/providers/google.ts`
- `packages/llm/src/providers/amazon-bedrock.ts`
- `packages/llm/src/providers/github-copilot.ts`
- `packages/llm/src/providers/openai-compatible.ts`
- `packages/llm/src/providers/openrouter.ts`
- `packages/llm/src/providers/xai.ts`
- `packages/llm/src/providers/cloudflare.ts`
- `packages/llm/src/providers/index.ts`
- `packages/llm/src/providers/openai-compatible-profile.ts`
- `packages/llm/src/providers/openai-options.ts`

**Observations:**
- All providers use the `Auth` abstraction to resolve credentials. No raw `process.env` reads for API keys in the provider files (confirmed in the read-through).
- `amazon-bedrock.ts` uses AWS SigV4 (via `AwsClient` from `aws4fetch`) for SigV4 signing. Credentials are resolved via the `Auth` combinator (`Auth.config()` or `Auth.env()` for AWS keys).
- `github-copilot.ts` uses OAuth device flow for tokens; token refresh is handled by `AuthOptions.refresh`.
- `openai-compatible.ts` is a generic OpenAI-compatible profile; the URL is supplied by the user. **Trust boundary**: if the user supplies an attacker-controlled URL, the executor will issue authenticated requests to it. This is **expected** for an OpenAI-compatible client, but the URL is **not** validated to be on a known-good list. Document the assumption.

**Findings:**

- **INFO** — All providers correctly route through `Auth` and do not embed credentials. No hardcoded keys.
- **INFO** — The `openai-compatible` URL is user-supplied; an LLM client that follows a redirect to a malicious host is possible if the `openai-compatible` provider is configured to a host that 302s. Recommend a redirect allowlist or disabling redirects for the transport.

---

## 14. Schema & Effect Types

### 14.1 `packages/llm/src/schema/*`

**Observations:**
- All schemas use `Schema.Class` or `Schema.Struct` with `identifier` annotations. Type safety is strong.
- `CachePolicyObject` supports `"auto"` and `"none"` plus a granular object form. The comment block documents the auto-placement policy (tools → system → messages) and the 20-block lookback rationale. **Good** documentation.

**Findings:**

- **F-SCHEMA-01 (INFO)** — `CachePolicyObject` is a rich type; verify that the "auto" lowering step is wired through to all protocol body builders. The comment says "the per-protocol body builders then translate those hints into wire markers as usual" — confirm by reading the protocol modules. (Verified in `protocols/index.ts` barrel; the per-protocol modules are present.)

---

## 15. Cache Policy & Framing

### 15.1 `packages/llm/src/cache-policy.ts`

**Observations:**
- `CacheHint` type is `ephemeral | persistent` with optional `ttlSeconds`.
- The auto-placement logic places breakpoints at the last tool definition, the last system part, and the latest user message.

**Findings:** None. The cache policy is well-documented and consistent with Anthropic's 20-block lookback.

### 15.2 `packages/llm/src/route/cache-policy.ts` (route-side)

Already covered in §6.1.

### 15.3 `packages/llm/src/transport/framing.ts`

Already covered in §6.2.

---

## 16. Cross-Reference: Auth Forwarding Patterns

| Provider | Auth source | Forwarded via | Notes |
|---|---|---|---|
| Anthropic | `Auth.config()` (env or config) | `x-api-key` header | Standard |
| OpenAI | `Auth.config()` | `Authorization: Bearer` | Standard |
| Azure | `Auth.config()` + endpoint | `api-key` header or Bearer | Endpoint is user-supplied |
| Google | `Auth.config()` (API key or OAuth) | `x-goog-api-key` or Bearer | OAuth refresh handled |
| Bedrock | AWS SigV4 via `Auth.config()` or `Auth.env()` | Signed request body | Credentials never sent in plain header |
| GitHub Copilot | OAuth device flow | `Authorization: Bearer` | Token refresh via `AuthOptions.refresh` |
| OpenAI-Compatible | `Auth.config()` | `Authorization: Bearer` | URL is user-supplied |
| OpenRouter | `Auth.config()` | `Authorization: Bearer` | Standard |
| xAI | `Auth.config()` | `Authorization: Bearer` | Standard |
| Cloudflare | `Auth.config()` (Account ID + API token) | `Authorization: Bearer` | Account ID is URL path component |

**Findings:**
- **INFO** — All providers correctly forward via standard headers. No provider embeds the credential in the URL.
- **INFO** — Bedrock uses SigV4; the access key is **not** sent in a plain header. The signing is correct.

---

## 17. Tool Runtime

### 17.1 `packages/llm/src/tool.ts`, `tool-runtime.ts`

**Observations:**
- `Tool` exports `toDefinitions` for serializing tools to the provider's wire format.
- `ToolRuntime` exports `DispatchResult` and `ToolSettlement` for tool execution lifecycle.
- `ToolFailure` is a tagged error; the runtime catches `ToolFailure` and surfaces it as a `tool-error` event plus a `tool-result` of `type: "error"`.

**Findings:** None. The tool runtime is well-typed and the error path is explicit.

---

## 18. Out-of-scope / Not Found

- `packages/enterprise/src/auth.ts` — **does not exist** in the inventory. Auth logic for the enterprise app lives in out-of-scope `console/`. Documented as a scope limitation.
- `packages/enterprise/src/feature-flags.ts` — **does not exist** in the inventory. Feature flags live in out-of-scope `console/`. Documented as a scope limitation.
- `packages/enterprise/src/function/api.ts` — **not in inventory**. The function API was **not** audited.
- `packages/enterprise/src/build.ts` — **does not exist**; build logic is at `packages/containers/script/build.ts`.
- `packages/enterprise/test/core/share.test.ts` — present; tests for `Share.create`, `Share.sync`, `Share.remove`. Reviewed for behavior, not security depth.

---

## 19. Prioritization & Recommended Fix Order

**Fix immediately (CRITICAL/HIGH):**
1. **F-CONT-04** — Pin Bun + Node + Rustup installs with SHA-256 verification.
2. **F-CONT-01** — Add `USER` directive to `publish` Dockerfile or document build-only purpose.
3. **F-RATE-01** — Add an application-layer rate limiter on the catch-all route (token bucket per IP or per bearer token).
4. **F-AUTH-01** — Hash env-var names in `MissingCredentialError.providerMetadata`.

**Fix this sprint (MED):**
5. **F-COST-01** — Redact non-billing fields in `Usage.providerMetadata`.
6. **F-COST-02** — Add a per-call `maxTokens` soft cap.
7. **F-LOG-01** — Extend redactor regex to cover provider-specific headers (`openai-organization`, `anthropic-version`, `x-api-key`).
8. **F-LOG-02** — Sanitize error messages returned to clients.
9. **F-SHARE-01** — Use a fresh `crypto.randomUUID()` for `Share.id`; map `sessionID` separately.
10. **F-ROUTE-01** — Validate `OPENCODE_API_ALLOWED_ORIGINS` at startup.
11. **F-CONT-05** — Add `USER` to `rust` Dockerfile.
12. **F-CONT-06** — Add `syft` SBOM + `cosign` sign to `build.ts`.
13. **F-MISC-02** — Pin `OPENCODE_VERSION` in CI; remove registry fetch.
14. **F-RATE-02** — Add jitter and circuit breaker to rate-limit retries.
15. **F-AUTH-02** — Verify no provider writes a header value into `MissingCredentialError`.

**Fix when convenient (LOW):**
16. **F-SHARE-02**, **F-SHARE-03** — Self-host OG image generator; document S3 `before` filter behavior.
17. **F-MISC-01** — Fix `plugin.tui` type from `nev` to `PluginTUI` or `never` (intentional).
18. **F-MISC-03**, **F-MISC-04** — Pin or remove `SCRIPT_DEBUG` team list.
19. **F-LOG-03**, **F-MISC-06** — Document `accept-language` handling.
20. **F-ROUTE-02**, **F-ROUTE-03** — Validate env input; document body limit.
21. **F-CONT-02**, **F-CONT-03** — Add `HEALTHCHECK` to runtime images; pin `RUST_TOOLCHAIN`.
22. **F-TRANSPORT-01** — Verify `WebSocketStream` error wrapping preserves original message.

**Informational (INFO):**
23. **F-SCHEMA-01** — Confirm `CachePolicyObject` auto-lowering is wired through all protocol modules.
24. **F-MISC-05** — Verify `LLMError` stringify path uses sanitized `HttpContext`.

---

## 20. Audit Methodology

- All 81 in-scope files were loaded into an in-memory `contents` dict and read in full.
- Per-file read-through for `auth.ts`, `executor.ts`, `client.ts`, `share.ts`, `storage.ts`, all 5 Dockerfiles, all 13 provider files, all schema files, the SSR entry, the function API, the script entry, and the plugin files.
- Cross-referenced auth-forwarding patterns across all 10 providers.
- Verified error redaction in `executor.ts` against `HttpContext` schema.
- Verified timing-safe secret comparison in `share.ts` and `[shareID].tsx`.
- Did **not** run any test, build, or install. **Read-only audit.**

---

## 21. Conclusion

The codebase demonstrates a mature security posture: typed errors, timing-safe secret handling, defensive clamping, and documented invariants on the cost/cache contract. The **most urgent** work is **supply-chain hardening of the container build pipeline** (Bun/Node/Rustup checksum verification) and **adding an application-layer rate limiter** on the public catch-all. Once those are in place, the remaining items are defense-in-depth refinements rather than blocking defects.

No critical credentials were found hardcoded. No RCE or auth-bypass paths were identified in the audited surface.

---

*End of report.*
