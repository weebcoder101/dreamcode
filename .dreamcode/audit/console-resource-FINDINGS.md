# packages/console/resource/ — Audit Findings

**Scope**: 5 files (resource.node.ts, resource.cloudflare.ts, package.json, tsconfig.json, sst-env.d.ts)  
**Date**: 2026-08-26  
**Auditor**: Sumati (personal audit)

## Summary

| Severity | Count |
|----------|-------|
| P0 (Critical) | 0 |
| P1 (High) | 0 |
| P2 (Medium) | 1 |
| P3 (Low) | 1 |

## Findings

### P2-1: `resource.node.ts:30-32` — Bucket.put is a no-op stub
**File**: `packages/console/resource/resource.node.ts`  
**Lines**: 30-33 (in `get()` proxy)

```ts
if (value.type === "sst.cloudflare.Bucket") {
  return {
    put: async () => {},
  }
}
```

**Impact**: When running in non-cloudflare mode (`resource.node.ts`), any code path that calls `Resource.Bucket.put(...)` will silently succeed without writing. This is a fail-open behavior that can mask data loss — e.g. if a webhook handler expects an audit-log write to bucket and the stub returns success, the audit record is lost without error.

**Fix**: Throw or surface an explicit "Bucket writes not supported in node mode" error. Or wire up a node-compatible bucket backend (S3 SDK to R2).

### P3-1: `resource.node.ts:34-37` — Cloudflare client construction assumes `CLOUDFLARE_API_TOKEN` is always linked
**File**: `packages/console/resource/resource.node.ts`  
**Lines**: 36-37

```ts
const client = new Cloudflare({
  apiToken: secrets.CLOUDFLARE_API_TOKEN.value,
})
```

**Impact**: If `CLOUDFLARE_API_TOKEN` is not linked in sst.config.ts but the code path tries to read a Kv resource, `secrets.CLOUDFLARE_API_TOKEN.value` will throw `TypeError: Cannot read properties of undefined (reading 'value')`. The error message won't be actionable for the developer.

**Fix**: Add a guard: `if (!secrets.CLOUDFLARE_API_TOKEN) throw new Error("CLOUDFLARE_API_TOKEN not linked — see sst.config.ts")`.

## Cleanliness

- `resource.cloudflare.ts` is a thin proxy over `env` and is correct.
- No plaintext secret logging.
- No console.log calls.

## Conclusion

Two minor issues, both P2/P3. The plaintext API token in `secrets.CLOUDFLARE_API_TOKEN.value` is expected — it's an SST-managed secret, not user data.

