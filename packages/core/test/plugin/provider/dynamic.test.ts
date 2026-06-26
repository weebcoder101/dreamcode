import { describe, expect, it as bunIt } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { DynamicProviderPlugin } from "@opencode-ai/core/plugin/provider/dynamic"
import { Npm } from "@opencode-ai/core/npm"
import { testEffect } from "../../lib/effect"
import { model, npmLayer } from "../../plugin/provider-helper"

const pluginLayer = PluginV2.locationLayer.pipe(
  Layer.provideMerge(Layer.succeed(
    Npm.Service,
    Npm.Service.of({
      add: () => Effect.succeed({ directory: "", entrypoint: Option.some("/mock/path.js") }),
      install: () => Effect.void,
      which: () => Effect.succeed(Option.none<string>()),
    }),
  )),
  Layer.provideMerge(EventV2.defaultLayer),
)

function dynamicPlugin(layer = npmLayer) {
  return { id: DynamicProviderPlugin.id, effect: DynamicProviderPlugin.effect.pipe(Effect.provide(layer)) }
}

const it = testEffect(pluginLayer)

describe("DynamicProviderPlugin allowlist", () => {
  it.effect("allows packages in default allowlist", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(dynamicPlugin())
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("test", "test-model"),
          package: "@ai-sdk/openai",
          options: {},
        },
        {},
      )
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("rejects packages not in allowlist", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(dynamicPlugin())
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("test", "test-model"),
          package: "unknown-package",
          options: {},
        },
        {},
      )
      expect(result.sdk).toBeUndefined()
    }),
  )

  it.effect("respects custom allowlist from env var", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(dynamicPlugin())
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("test", "test-model"),
          package: "custom-package",
          options: {},
        },
        {},
      )
      expect(result.sdk).toBeUndefined()
    }),
  )
})
