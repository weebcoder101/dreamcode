import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { Effect, ConfigProvider, Layer } from "effect"
import { DynamicProviderPlugin } from "../../../src/plugin/provider/dynamic"
import { Npm } from "../../../src/npm"

const mockNpm = Layer.succeed(Npm.Service, {
  add: () => Effect.succeed({ entrypoint: Option.some("/mock/path.js") }),
  remove: () => Effect.void,
  list: () => Effect.succeed([]),
} as Npm.Service)

describe("DynamicProviderPlugin allowlist", () => {
  const originalEnv = process.env.AI_SDK_ALLOWED_PACKAGES

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AI_SDK_ALLOWED_PACKAGES
    } else {
      process.env.AI_SDK_ALLOWED_PACKAGES = originalEnv
    }
  })

  it("allows packages in default allowlist", () =>
    Effect.gen(function* () {
      const plugin = yield* DynamicProviderPlugin
      expect(plugin).toBeDefined()
    }).pipe(Effect.provide(mockNpm), Effect.runPromise))

  it("rejects packages not in allowlist", () =>
    Effect.gen(function* () {
      process.env.AI_SDK_ALLOWED_PACKAGES = "@ai-sdk/openai"
      const plugin = yield* DynamicProviderPlugin
      expect(plugin).toBeDefined()
    }).pipe(
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv())),
      Effect.provide(mockNpm),
      Effect.runPromise,
    ))

  it("respects custom allowlist from env var", () =>
    Effect.gen(function* () {
      process.env.AI_SDK_ALLOWED_PACKAGES = "custom-package,another-package"
      const plugin = yield* DynamicProviderPlugin
      expect(plugin).toBeDefined()
    }).pipe(
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv())),
      Effect.provide(mockNpm),
      Effect.runPromise,
    ))
})
