import path from "node:path"
import { Npm } from "../../npm"
import { Effect, Option, Config } from "effect"
import { pathToFileURL } from "url"
import { PluginV2 } from "../../plugin"

const ALLOWED_PACKAGES_DEFAULT = ["@ai-sdk/openai", "@ai-sdk/anthropic", "@ai-sdk/google", "@ai-sdk/mistral", "@ai-sdk/deepseek", "@ai-sdk/togetherai", "@ai-sdk/groq"]

type ProviderFactory = (options: Record<string, unknown>) => unknown

const isProviderFactory = (value: unknown): value is ProviderFactory =>
  typeof value === "function"

export const DynamicProviderPlugin = PluginV2.define({
  id: PluginV2.ID.make("dynamic-provider"),
  effect: Effect.gen(function* () {
    const npm = yield* Npm.Service
    const allowedPackages = yield* Config.string("AI_SDK_ALLOWED_PACKAGES").pipe(
      Config.map((s) => s.split(",").map((p) => p.trim()).filter(Boolean)),
      Config.withDefault(ALLOWED_PACKAGES_DEFAULT),
    )
    const allowed = new Set(allowedPackages)
    return {
      "aisdk.sdk": Effect.fnUntraced(function* (evt) {
        if (evt.sdk) return

        const packageName = evt.package

        if (!packageName.startsWith("file://") && !allowed.has(packageName)) return

        // SECURITY: file:// imports bypass the allowlist. Restrict to
        // configured directories to prevent arbitrary code execution.
        // Use realpathSync to resolve symlinks and prevent traversal attacks.
        const installedPath = yield* Effect.gen(function* () {
          if (packageName.startsWith("file://")) {
            const resolvedPath = packageName.replace("file://", "")
            try {
              const realpath = require("fs").realpathSync(resolvedPath)
              const allowedPrefixes = [
                path.resolve("node_modules"),
                path.resolve(".dreamcode"),
              ]
              if (!allowedPrefixes.some((p) => realpath.startsWith(p + "/") || realpath === p)) {
                return undefined
              }
            } catch {
              return undefined
            }
            return packageName
          }
          const result = yield* npm.add(packageName)
          return Option.getOrUndefined(result.entrypoint)
        }).pipe(
          Effect.catch(() => Effect.succeed(undefined as string | undefined)),
        )
        if (!installedPath) return

        const mod: Record<string, unknown> | undefined = yield* Effect.tryPromise(async () => {
          return (await import(
            installedPath.startsWith("file://") ? installedPath : pathToFileURL(installedPath).href
          )) as Record<string, unknown>
        }).pipe(
          Effect.catch(() => Effect.succeed(undefined as Record<string, unknown> | undefined)),
        )
        if (!mod) return

        const match = Object.keys(mod).find((name) => name.startsWith("create"))
        if (!match) return

        const factory = mod[match]
        if (!isProviderFactory(factory)) return

        evt.sdk = factory(evt.options ?? {})
      }),
    }
  }).pipe(Effect.orDie),
})
