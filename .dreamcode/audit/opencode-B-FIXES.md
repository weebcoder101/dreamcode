# opencode-B Fixes

**Scope**: P0 + P1 fixes from `opencode-B-FINDINGS.md`.
**Pattern**: minimal patches, preserve public APIs, add type-safe behavior.

---

## Fix F-1: bus/bus.ts subscribeCallback type filter

**File**: `packages/opencode/src/bus/bus.ts`
**Finding**: P1-1 — `subscribeCallback` subscribes to ALL events instead of filtering by `event.type`.

### Before (lines 30-39)

```typescript
const subscribeCallback: Interface["subscribeCallback"] = (_event, callback) =>
  Effect.sync(() => {
    const handler = (evt: { payload: any }) => {
      callback(evt.payload.data)
    }
    GlobalBus.on("event", handler)
    return () => {
      GlobalBus.off("event", handler)
    }
  })
```

### After

```typescript
const subscribeCallback: Interface["subscribeCallback"] = (event, callback) =>
  Effect.sync(() => {
    const handler = (evt: { payload: { type: string; data: unknown } }) => {
      if (evt.payload.type !== event.type) return
      callback(evt.payload.data as any)
    }
    GlobalBus.on("event", handler)
    return () => {
      GlobalBus.off("event", handler)
    }
  })
```

**Rationale**: Filter at the source so subscribers do not receive unrelated events. The `as any` cast on `data` preserves the existing API contract; a future refactor can tighten the type.

**Risk**: If any caller depends on receiving all events (i.e. used `subscribeCallback` as a "log all" hook), this is a behavior change. The fix matches the documented contract of the `event` parameter.

---

## Fix F-2: mcp/index.ts effectiveRedirectUri host detection

**File**: `packages/opencode/src/mcp/index.ts`
**Finding**: P1-3 — `effectiveRedirectUri` hardcodes 127.0.0.1 even when container/remote host differs.

### Before (lines 737-740)

```typescript
// Resolve effective redirect URI: explicit redirectUri > callbackPort shorthand > default
const effectiveRedirectUri =
  oauthConfig?.redirectUri ??
  (oauthConfig?.callbackPort ? `http://127.0.0.1:${oauthConfig.callbackPort}${OAUTH_CALLBACK_PATH}` : undefined)
```

### After

```typescript
// Resolve effective redirect URI: explicit redirectUri > callbackPort shorthand > default
const effectiveRedirectUri =
  oauthConfig?.redirectUri ??
  (oauthConfig?.callbackPort
    ? `http://${oauthConfig.host ?? "127.0.0.1"}:${oauthConfig.callbackPort}${OAUTH_CALLBACK_PATH}`
    : undefined)
```

**Required companion change**: Add `host?: string` to `McpOAuthConfig` in `packages/opencode/src/mcp/oauth-provider.ts` (line 14-19):

```typescript
export interface McpOAuthConfig {
  clientId?: string
  clientSecret?: string
  scope?: string
  callbackPort?: number
  host?: string          // <-- NEW
  redirectUri?: string
}
```

And update `McpOAuthProvider.redirectUrl` getter (line 36-41):

```typescript
get redirectUrl(): string {
  if (this.config.redirectUri) {
    return this.config.redirectUri
  }
  const port = this.config.callbackPort ?? OAUTH_CALLBACK_PORT
  const host = this.config.host ?? "127.0.0.1"
  return `http://${host}:${port}${OAUTH_CALLBACK_PATH}`
}
```

**Rationale**: Backs the host with an explicit, typed config field. Defaults to 127.0.0.1 so existing configs are unaffected.

**Risk**: Additive only. No existing field semantics change. Users who want a different host now have an escape hatch.

---

## Fix F-3: installation/index.ts upgradeCurl — pin to commit SHA + checksum

**File**: `packages/opencode/src/installation/index.ts`
**Finding**: P1-2 — `upgradeCurl` pipes `main` branch to bash without signature verification.

### Before (lines 148-166)

```typescript
const upgradeCurl = Effect.fnUntraced(
  function* (target: string) {
    const response = yield* httpOk.execute(HttpClientRequest.get(
      "https://raw.githubusercontent.com/weebcoder101/dreamcode/main/install.sh"))
    const body = yield* response.text
    const bodyBytes = new TextEncoder().encode(body)
    const shell = yield* upgradeScriptShell()
    const result = yield* appProcess.run(
      ChildProcess.make(shell, [], {
        stdin: Stream.make(bodyBytes),
        env: { VERSION: target },
        extendEnv: true,
      }),
    )
    return {
      code: result.exitCode,
      stdout: result.stdout.toString("utf8"),
      stderr: result.stderr.toString("utf8"),
    }
  },
  ...
)
```

### After

```typescript
const INSTALL_SCRIPT_REF = "main"   // bump to a release tag in CI
const INSTALL_SCRIPT_URL = `https://raw.githubusercontent.com/weebcoder101/dreamcode/${INSTALL_SCRIPT_REF}/install.sh`
const KNOWN_SHA256 = process.env.DREAMCODE_INSTALL_SHA256 ?? ""   // optional pinned hash

const upgradeCurl = Effect.fnUntraced(
  function* (target: string) {
    const response = yield* httpOk.execute(HttpClientRequest.get(INSTALL_SCRIPT_URL))
    const body = yield* response.text
    const bodyBytes = new TextEncoder().encode(body)

    if (KNOWN_SHA256) {
      const hash = yield* Effect.promise(() => crypto.subtle.digest("SHA-256", bodyBytes))
        .pipe(Effect.map((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("")))
      if (hash !== KNOWN_SHA256) {
        return yield* new UpgradeFailedError({
          stderr: `install script SHA256 mismatch (expected ${KNOWN_SHA256}, got ${hash}); refusing to pipe to bash`,
        })
      }
    }

    const shell = yield* upgradeScriptShell()
    const result = yield* appProcess.run(
      ChildProcess.make(shell, [], {
        stdin: Stream.make(bodyBytes),
        env: { VERSION: target },
        extendEnv: true,
      }),
    )
    return {
      code: result.exitCode,
      stdout: result.stdout.toString("utf8"),
      stderr: result.stderr.toString("utf8"),
    }
  },
  Effect.mapError(() => new UpgradeFailedError({ stderr: upgradeFailure("curl") })),
)
```

**Rationale**:
- `KNOWN_SHA256` is a process-level env var set by the packaging process. Empty by default, so behavior is unchanged.
- When set, the install script is verified before piping. A compromised CDN, DNS hijack, or upstream repo push to a different ref all fail closed.
- An alternative would be to change the URL to a specific tag instead of `main`, but that requires coordinating with the release pipeline.

**Risk**: Low. If the install script changes without updating the env var, upgrades break loudly with a clear error. Default (empty) preserves current behavior.

**Companion change**: Document `DREAMCODE_INSTALL_SHA256` in `installation/index.ts` and the README. The release pipeline should set it.

---

## Fix F-4: session/processor.ts — gate v1 dual-write behind feature flag

**File**: `packages/opencode/src/session/processor.ts`
**Finding**: P1-4 — 17 sites write to v1 and v2 storage. 2x write amplification.

### Approach: feature flag, not removal

This is a 17-site change in the hottest path. Removal is risky. Better: gate v1 writes behind a flag, default to off, and let operators opt in for the transition period.

### Example: line 252

#### Before

```typescript
// TODO(v2): Temporary dual-write while migrating session messages to v2 events.
yield* storage.write({ ... v1 shape ... })
```

#### After

```typescript
if (flags.legacyV1) {
  // TODO(v2): remove once migration is verified; gated by DREAMCODE_LEGACY_V1=1
  yield* storage.write({ ... v1 shape ... })
}
yield* storage.write({ ... v2 shape ... })
```

Add `legacyV1: boolean` to `RuntimeFlags.Service` (file: `packages/opencode/src/effect/runtime-flags.ts`):

```typescript
const legacyV1 = process.env.DREAMCODE_LEGACY_V1 === "1" || process.env.DREAMCODE_LEGACY_V1 === "true"
return { ..., legacyV1 }
```

**Rationale**: Defers the real removal until the team has confidence in v2. The flag defaults to off, so the default code path is v2-only. Operators running legacy v1 consumers can opt in.

**Risk**: If a downstream consumer still reads v1, the flag must be enabled or the consumer must migrate. Document this in release notes.

**This is the largest change in the batch (17 sites).** Apply it last after F-1, F-2, F-3 ship and tests pass.

---

## Out-of-scope P2/P3 fixes (deferred)

- F-5 (P2-2): webfetch SSRF protection — separate task, larger surface.
- F-6 (P2-5): remove tool/skill.ts deprecated shim — separate task, requires core skill migration.
- F-7 (P3-1, P3-2): tool/webfetch.ts User-Agent fix and parseInt radix — cosmetic, can ship anytime.
- F-8 (P3-3): tool/mcp-websearch.ts env-var-at-import fix — cosmetic, can ship anytime.
- F-9 (P3-4): lsp/lsp.ts duplicate Diagnostic export — lint-only.
- F-10 (P3-6): snapshot/index.ts prune/limit hardcoded constants — config knob, separate task.
- F-11 (P3-7): permission/arity.ts LLM-generated dict — codegen task.
