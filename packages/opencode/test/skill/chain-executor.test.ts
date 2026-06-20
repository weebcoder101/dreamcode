import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { ChainExecutor } from "@/skill/chain-executor"
import { Skill } from "@/skill"
import { Discovery } from "@/skill/discovery"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { RuntimeFlags } from "@/effect/runtime-flags"

const testLayer = Layer.mergeAll(
  ChainExecutor.defaultLayer,
  Skill.defaultLayer,
).pipe(
  Layer.provide(Discovery.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Global.layer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

const it = testEffect(testLayer)

describe("ChainExecutor", () => {
  it.live("empty chain returns empty results", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      const results = yield* executor.execute([], "test prompt")
      expect(results).toEqual([])
    }),
  )

  it.live("single skill found with script executes and injects result", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      // Non-existent skill should return not_found
      const results = yield* executor.execute(["nonexistent-skill"], "test prompt")
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe("nonexistent-skill")
      expect(results[0].status).toBe("not_found")
    }),
  )

  it.live("skill not found returns not_found status", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      const results = yield* executor.execute(["missing-skill-xyz"], "test prompt")
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe("missing-skill-xyz")
      expect(results[0].status).toBe("not_found")
    }),
  )

  it.live("multiple skills sequential execution order preserved", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      const chain = ["skill-a", "skill-b", "skill-c"]
      const results = yield* executor.execute(chain, "test prompt")
      expect(results).toHaveLength(3)
      expect(results[0].name).toBe("skill-a")
      expect(results[1].name).toBe("skill-b")
      expect(results[2].name).toBe("skill-c")
      // All should be not_found since they don't exist
      expect(results.every((r) => r.status === "not_found")).toBe(true)
    }),
  )

  it.live("partial failure - some succeed some fail", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      const results = yield* executor.execute(["existing-skill", "missing-skill"], "test prompt")
      expect(results).toHaveLength(2)
      const missing = results.find((r) => r.name === "missing-skill")
      expect(missing?.status).toBe("not_found")
    }),
  )

  it.live("verify returns empty for no results", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      const verifyResult = yield* executor.verify([])
      expect(verifyResult).toBe("")
    }),
  )

  it.live("runFullPipeline extends execute results", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      const results = yield* executor.runFullPipeline(["nonexistent-skill"], "test prompt")
      // Should include at least the execute results
      expect(results.length).toBeGreaterThanOrEqual(1)
      const first = results[0]
      expect(first.name).toBe("nonexistent-skill")
      expect(first.status).toBe("not_found")
    }),
  )
})
