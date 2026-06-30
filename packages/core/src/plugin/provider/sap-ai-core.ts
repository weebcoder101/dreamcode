import { Npm } from "../../npm"
import { Effect, Option } from "effect"
import { pathToFileURL } from "url"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

export const SapAICorePlugin = PluginV2.define({
  id: PluginV2.ID.make("sap-ai-core"),
  effect: Effect.gen(function* () {
    const npm = yield* Npm.Service
    return {
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.make("sap-ai-core")) return
        const serviceKey =
          process.env.AICORE_SERVICE_KEY ??
          (typeof evt.options.serviceKey === "string" ? evt.options.serviceKey : undefined)
        // SECURITY: Do NOT mutate process.env globally. The SAP AI SDK reads
        // AICORE_SERVICE_KEY from process.env, but we pass it directly to the
        // SDK factory instead of polluting the global environment.
        // if (serviceKey && !process.env.AICORE_SERVICE_KEY) process.env.AICORE_SERVICE_KEY = serviceKey

        const installedPath = evt.package.startsWith("file://")
          ? evt.package
          : Option.getOrUndefined((yield* npm.add(evt.package).pipe(Effect.orDie)).entrypoint)
        if (!installedPath) throw new Error(`Package ${evt.package} has no import entrypoint`)

        const mod = yield* Effect.promise(async () => {
          return (await import(
            installedPath.startsWith("file://") ? installedPath : pathToFileURL(installedPath).href
          )) as Record<string, (options: Record<string, unknown>) => unknown>
        }).pipe(Effect.orDie)
        const match = Object.keys(mod).find((name) => name.startsWith("create"))
        if (!match) throw new Error(`Package ${evt.package} has no provider factory export`)

        evt.sdk = mod[match](
          serviceKey
            ? { deploymentId: process.env.AICORE_DEPLOYMENT_ID, resourceGroup: process.env.AICORE_RESOURCE_GROUP }
            : {},
        )
      }),
      "aisdk.language": Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.make("sap-ai-core")) return
        evt.language = evt.sdk(evt.model.api.id)
      }),
    }
  }),
})
