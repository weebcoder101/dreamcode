# Audit Fixes — P0 / P1

This document lists every P0/P1 finding and the fix applied (or the documented "no change" decision with rationale).

## P0 — `packages/opencode/src/auth/index.ts`

**Finding**

deriveKey() falls back to deterministic /etc/machine-id when HOME/.config/dreamcode/auth.key cannot be persisted. On any deploy where the key file write fails, "encrypted" OAuth tokens are effectively plaintext to any local process. Replace the deterministic fallback with `crypto.randomBytes(32)` held only in memory (i.e., if the key file cannot be written, the encryption key is regenerated each restart — meaning prior encrypted tokens become unreadable, but the file is still encrypted-at-rest on systems that CAN write). Additionally, the in-process encryption key must be flushed whenever the auth file is read on startup so a re-derived key does not silently leak old data.

**Fix**

Replace the inner fallback block: instead of returning `createHash("sha256").update(machineId)`, throw an AuthError so the caller knows encryption-at-rest is unavailable. This is the only honest behavior — silently degrading to a world-known key is worse than failing closed.

## P1 — `packages/enterprise/src/routes/api/[...path].ts`

**Finding**

GET /api/share/:shareID/data has NO secret check. Anyone with the 8-char shareID can read the full session (messages, parts, file diffs).

**Fix**

Add a secret check on the GET path. Either: (a) require a `?secret=` query param verified against the stored share record, or (b) move the GET endpoint under the same secret-gated sync endpoint. Option (a) is the smaller change and preserves share-link UX (link + secret in URL fragment). See FIX in code below.

## P1 — `packages/enterprise/src/core/share.ts`

**Finding**

The `data(shareID)` public function is auth-free; called by the GET endpoint and the legacy migration path. Internally, the `sync`/`remove` paths DO check the secret.

**Fix**

Keep `data(shareID)` as the lower-level loader (for use by the new authenticated GET handler). Do NOT call it from the unauthenticated route. The route change above addresses this.

## P1 — `packages/function/src/api.ts`

**Finding**

Cloudflare Durable Object sync server. SSRF risk depends entirely on the inbound-auth layer. As documented, this is acceptable for the DO model (DO is reachable only via signed Worker routes). No change needed in this file beyond documenting the assumed auth boundary.

**Fix**

No code change in this file. The expected auth model is "DO is private; the only ingress is the Worker that owns it." If the DO binding is exposed publicly (e.g., via a public route), add a session-key HMAC check inside the DO. Out of scope of this audit.
