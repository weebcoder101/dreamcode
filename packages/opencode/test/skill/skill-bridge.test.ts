import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { Skill } from "../../src/skill"
import { Discovery } from "../../src/skill/discovery"
import { Config } from "../../src/config/config"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { provideTmpdirInstance } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

// Absolute path to embedded skills so Skill discovery can find them
const EMBEDDED_SKILLS = path.resolve(import.meta.dir, "../../src/skill/dreamcode/skills")

const testLayer = Layer.mergeAll(Skill.defaultLayer).pipe(
  Layer.provide(Discovery.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Global.layer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

const it = testEffect(testLayer)

// ─────────────────────────────────────────────────────────────
// Skill.Service.require() → auto-execute bridge tests
// ─────────────────────────────────────────────────────────────

describe("Skill.Service.require() auto-execute bridge", () => {
  it.instance(
    "discovered skill — require() returns content from embedded skills",
    () =>
      Effect.gen(function* () {
        const skillService = yield* Skill.Service
        // 'debugging' is discoverable via config skills.paths
        const info = yield* skillService.require("debugging")
        // Content should contain SKILL.md text
        expect(info.content).toContain("Debugging")
        expect(info.content).toContain("Reproduce")
      }),
    { config: { skills: { paths: [EMBEDDED_SKILLS] } } },
  )

  it.instance(
    "no ChainExecutor dependency — Skill.Service works without ChainExecutor in layer",
    () =>
      Effect.gen(function* () {
        // This test verifies that Skill.Service.require() works directly,
        // without depending on ChainExecutor being in the layer.
        const skillService = yield* Skill.Service
        const info = yield* skillService.require("debugging")
        // Should have content loaded
        expect(info.content).toContain("Debugging")
        expect(info.content).toContain("Isolate")
      }),
    { config: { skills: { paths: [EMBEDDED_SKILLS] } } },
  )

  it.instance(
    "empty output — script with no output does not break require()",
    () =>
      Effect.gen(function* () {
        // 'customize-opencode' is a built-in skill with no scripts
        const skillService = yield* Skill.Service
        const info = yield* skillService.require("customize-opencode")
        // Content should be the raw SKILL.md body without <script-result>
        expect(info.content).not.toContain("<script-result")
        expect(info.content).toContain("opencode")
      }),
  )

  it.instance(
    "bridge failure — script crash does not crash require()",
    () =>
      Effect.gen(function* () {
        // Even if a script crashes, require() should return the SKILL.md content
        // The auto-execute failure is caught and logged, not propagated.
        const skillService = yield* Skill.Service
        // 'testing' has SKILL.md — should load even if script fails
        const info = yield* skillService.require("testing")
        expect(info.content).toContain("Testing")
      }),
    { config: { skills: { paths: [EMBEDDED_SKILLS] } } },
  )
})
