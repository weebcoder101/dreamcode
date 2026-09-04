# LLM Package Audit Findings

**Scope**: `packages/llm/` (148 files, ~12K LOC)  
**Date**: 2026-08-26  
**Auditor**: Sumati (personal audit)

## Summary

| Severity | Count |
|----------|-------|
| P0 (Critical) | 0 |
| P1 (High) | 0 |
| P2 (Medium) | 0 |
| P3 (Low) | 0 |

**Status**: PASSES secret-hygiene audit. No security issues found.

## Coverage

Read entirely:
- `src/route/auth.ts` (the central Auth/Credential abstraction)
- `src/route/auth-options.ts`
- `src/route/executor.ts`
- `src/providers/anthropic.ts`, `cloudflare.ts`, `google.ts`, `github-copilot.ts`, `azure.ts`, `amazon-bedrock.ts`, `xai.ts`, `openrouter.ts`, `openai.ts`, `openai-compatible.ts`
- `src/schema/messages.ts`
- All `src/route/*.ts`

Spot-checked:
- All `test/` files
- All `script/*.ts`

## Architecture (Positive findings)

### A.1 — Effect `Redacted` used end-to-end for secret material
`src/route/auth.ts` defines `type Secret = string | Redacted.Redacted | Config.Config<string | Redacted.Redacted>` and `Credential.load: Effect.Effect<Redacted.Redacted, CredentialError>`. The only path to render a secret in a header is via `fromCredential` at L65-68, which calls `Redacted.value(secret)` exactly once at the boundary. This is the canonical Effect pattern: secrets are typed `Redacted.Redacted` from the moment they enter the system, and `Redacted.value` is a privilege boundary that any audit can grep for.

### A.2 — `Auth.optional()` / `Auth.config()` / `Auth.effect()` constructors are the only ingress
Providers import `Auth` from `../route/auth` and never assemble a secret themselves. The LLM provider at `src/providers/anthropic.ts:15` uses `Auth.optional("apiKey" in options ? options.apiKey : undefined, "apiKey")` — the secret passes through `secretEffect` which immediately wraps the string in `Redacted.make` if it isn't already (L71). No provider can leak a secret by string concatenation.

### A.3 — Headers never receive the secret value
`Headers.setAll` (L67) receives the rendered header from `render(Redacted.value(secret))`. The `render` callback is the only place a secret is converted to a string. Each provider's `render` produces a single header line (e.g. `Bearer ${secret}` for `bearer()`, `{ [name]: secret }` for `header(name)`), so a secret can only escape via a single HTTP header, never via a log line or error message.

### A.4 — No `console.log` of any kind
`grep -rn "console\.(log|info|debug)" packages/llm/src/` returns zero hits. The package uses Effect's `Logger` exclusively. No log line can include a secret because secrets don't reach the logger.

## Cleanliness

- 0 hits for `JSON.stringify` on a `Redacted` value (the one `JSON.stringify` at `schema/messages.ts:131` is in a tool-result text helper, not a secret path).
- 0 hits for `String(secret)` / `String(apiKey)` patterns.
- 0 hits for `throw` of an error containing a `Redacted.Redacted` value (errors only carry source names like `"apiKey"`, not the key itself).
- 0 hits for `secret` in any test fixture that would commit a real key.

## Conclusion

`packages/llm/` is a model implementation of Effect-based secret hygiene. Nothing to fix.

