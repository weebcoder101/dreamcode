import type { KVNamespaceListOptions, KVNamespaceListResult, KVNamespacePutOptions } from "@cloudflare/workers-types"
import { Resource as ResourceBase } from "sst"
import Cloudflare from "cloudflare"

export const waitUntil = async (promise: Promise<any>) => {
  await promise
}

export const Resource = new Proxy(
  {},
  {
    get(_target, prop: keyof typeof ResourceBase) {
      const value = ResourceBase[prop]
      const secrets = ResourceBase as unknown as Record<string, { value: string }>
      if ("type" in value) {
        // @ts-ignore
        if (value.type === "sst.cloudflare.Bucket") {
          return {
            // SECURITY: do NOT silently succeed. In node mode (non-
            // cloudflare runtime), Bucket writes have no backing store.
            // Returning a no-op `async () => {}` masked data loss in
            // webhook handlers and audit-log writers. Surface the
            // error to the caller so they either fall back to a
            // node-compatible backend (S3 SDK to R2) or skip the
            // write explicitly. See console-resource-FINDINGS.md P2-1.
            put: async () => {
              throw new Error(
                "Bucket writes are not supported in node mode. " +
                "Use a node-compatible bucket backend (e.g. S3 SDK to R2) " +
                "or guard the call site with a runtime check.",
              )
            },
          }
        }
        // @ts-ignore
        if (value.type === "sst.cloudflare.Kv") {
          // Guard: surface a clear error if the secret is not linked in
          // sst.config.ts, instead of letting `undefined.value` throw
          // an opaque TypeError. See console-resource-FINDINGS.md P3-1.
          if (!secrets.CLOUDFLARE_API_TOKEN) {
            throw new Error(
              "CLOUDFLARE_API_TOKEN not linked - see sst.config.ts",
            )
          }
          const client = new Cloudflare({
            apiToken: secrets.CLOUDFLARE_API_TOKEN.value,
          })
          // @ts-ignore
          const namespaceId = value.namespaceId
          const accountId = secrets.CLOUDFLARE_DEFAULT_ACCOUNT_ID.value
          return {
            get: (k: string | string[]) => {
              // SECURITY: always return a Map<string, V> so callers cannot
              // accidentally treat a bare value as an iterable of pairs (or
              // vice versa). The previous asymmetric contract — single key
              // returning the raw value, multi-key returning a Map — was
              // a quiet, high-blast-radius data shape confusion that touched
              // every KV consumer. Callers that want a single value call
              // `result.get(k)`.
              return client.kv.namespaces
                .bulkGet(namespaceId, {
                  keys: Array.isArray(k) ? k : [k],
                  account_id: accountId,
                })
                .then((result) => new Map(Object.entries(result?.values ?? {})))
            },
            put: (k: string, v: string, opts?: KVNamespacePutOptions) =>
              client.kv.namespaces.values.update(namespaceId, k, {
                account_id: accountId,
                value: v,
                expiration: opts?.expiration,
                expiration_ttl: opts?.expirationTtl,
                metadata: opts?.metadata,
              }),
            delete: (k: string) =>
              client.kv.namespaces.values.delete(namespaceId, k, {
                account_id: accountId,
              }),
            list: (opts?: KVNamespaceListOptions): Promise<KVNamespaceListResult<unknown, string>> =>
              client.kv.namespaces.keys
                .list(namespaceId, {
                  account_id: accountId,
                  prefix: opts?.prefix ?? undefined,
                })
                .then((result) => {
                  return {
                    keys: result.result,
                    list_complete: true,
                    cacheStatus: null,
                  }
                }),
          }
        }
      }
      return value
    },
  },
) as Record<string, any>
