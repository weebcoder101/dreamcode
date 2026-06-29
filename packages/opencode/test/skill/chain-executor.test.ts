import { describe, expect, test } from "bun:test"
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
import { InstanceState } from "@/effect/instance-state"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap-service"
import { provideTmpdirInstance } from "../fixture/fixture"
import path from "path"

// noop bootstrap so InstanceStore doesn't try to run real bootstrap
const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const instanceStoreLayer = InstanceStore.defaultLayer.pipe(Layer.provide(noopBootstrap))

// Absolute path to embedded skills so Skill discovery can find them in tmpdir
const EMBEDDED_SKILLS = path.resolve(import.meta.dir, "../../src/skill/dreamcode/skills")

// Test layer with InstanceState so Skill discovery works properly
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
  Layer.provide(instanceStoreLayer),
)

const it = testEffect(testLayer)

// Config that tells Skill discovery where the embedded skills live
const skillsConfig = { skills: { paths: [EMBEDDED_SKILLS] } } as any

// ─────────────────────────────────────────────────────────────
// ChainExecutor service tests
// ─────────────────────────────────────────────────────────────

describe("ChainExecutor", () => {
  it.live("empty chain returns empty results", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      const results = yield* executor.execute([], "test prompt")
      expect(results).toEqual([])
    }),
  )

  it.instance("real skill 'debugging' is found and returns content", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      const results = yield* executor.execute(["debugging"], "test prompt")
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe("debugging")
      expect(results[0].status).toBe("ok")
      expect(results[0].output).toContain("debugging")
      expect(results[0].output.length).toBeGreaterThan(50)
    }),
    { config: skillsConfig },
  )

  it.instance("real skill 'testing' is found and returns content", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      const results = yield* executor.execute(["testing"], "test prompt")
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe("testing")
      expect(results[0].status).toBe("ok")
      expect(results[0].output.toLowerCase()).toContain("testing")
      expect(results[0].output.length).toBeGreaterThan(50)
    }),
    { config: skillsConfig },
  )

  it.instance("real skill 'quality' is found and returns content", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      const results = yield* executor.execute(["quality"], "test prompt")
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe("quality")
      expect(results[0].status).toBe("ok")
      expect(results[0].output).toContain("quality")
      expect(results[0].output.length).toBeGreaterThan(50)
    }),
    { config: skillsConfig },
  )

  it.instance("non-existent skill returns not_found", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      const results = yield* executor.execute(["completely-fake-skill-xyz"], "test prompt")
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe("completely-fake-skill-xyz")
      expect(results[0].status).toBe("not_found")
    }),
  )

  it.instance("mixed chain: real skills found, fake skill not_found", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      const results = yield* executor.execute(
        ["debugging", "completely-fake-skill-xyz", "testing"],
        "test prompt",
      )
      expect(results).toHaveLength(3)
      expect(results[0].status).toBe("ok")        // debugging found
      expect(results[1].status).toBe("not_found")  // fake not found
      expect(results[2].status).toBe("ok")        // testing found
      expect(results[0].output).toContain("debugging")
      expect(results[2].output.toLowerCase()).toContain("testing")
    }),
    { config: skillsConfig },
  )

  it.instance("chain order is preserved", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      const chain = ["quality", "security", "testing"]
      const results = yield* executor.execute(chain, "test prompt")
      expect(results).toHaveLength(3)
      expect(results[0].name).toBe("quality")
      expect(results[1].name).toBe("security")
      expect(results[2].name).toBe("testing")
    }),
    { config: skillsConfig },
  )

  it.live("verify returns warning string when no results and no enforcer", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      const verifyResult = yield* executor.verify([])
      // Should return a visible warning, not empty string
      expect(typeof verifyResult).toBe("string")
      expect(verifyResult.length).toBeGreaterThan(0)
    }),
  )

  it.live("runFullPipeline returns array when no skills dir", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      const results = yield* executor.runFullPipeline()
      expect(Array.isArray(results)).toBe(true)
    }),
  )
})

// ─────────────────────────────────────────────────────────────
// Integration: real skill with scripts via tmpdir
// ─────────────────────────────────────────────────────────────

describe("ChainExecutor integration (tmpdir)", () => {
  it.instance("skill with scripts/ directory executes Python and returns output", () =>
    Effect.gen(function* () {
      const test = yield* InstanceState.contextOrNull
      const dir = test?.directory ?? process.cwd()

      // Create a skill with a Python script in .dreamcode/skills/
      // (validateScriptPath only allows .dreamcode/skills/, not .opencode/skills/)
      const skillDir = path.join(dir, ".dreamcode", "skills", "test-executor")
      const scriptsDir = path.join(skillDir, "scripts")
      yield* Effect.tryPromise({
        try: async () => {
          await Bun.write(
            path.join(skillDir, "SKILL.md"),
            "---\nname: test-executor\ndescription: Has a script\n---\n# Test\nThis skill has a script.\n",
          )
          await Bun.write(
            path.join(scriptsDir, "run.py"),
            'import sys\nprint("hello from test script")\n',
          )
        },
        catch: (e) => new Error(String(e)),
      })

      const executor = yield* ChainExecutor.Service
      const results = yield* executor.execute(["test-executor"], "test prompt")
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe("test-executor")
      expect(results[0].status).toBe("ok")
      expect(results[0].output).toContain("hello from test script")
    }),
    { config: skillsConfig },
  )

  it.instance("skill without scripts/ returns SKILL.md content as passive result", () =>
    Effect.gen(function* () {
      const test = yield* InstanceState.contextOrNull
      const dir = test?.directory ?? process.cwd()

      // Create a skill WITHOUT scripts
      const skillDir = path.join(dir, ".dreamcode", "skills", "test-passive")
      yield* Effect.tryPromise({
        try: async () => {
          await Bun.write(
            path.join(skillDir, "SKILL.md"),
            "---\nname: test-passive\ndescription: Passive skill\n---\n# Passive\nThis skill has no scripts. Content should be injected as-is.\n",
          )
        },
        catch: (e) => new Error(String(e)),
      })

      const executor = yield* ChainExecutor.Service
      const results = yield* executor.execute(["test-passive"], "test prompt")
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe("test-passive")
      expect(results[0].status).toBe("ok")
      expect(results[0].output).toContain("This skill has no scripts")
    }),
    { config: skillsConfig },
  )

  it.instance("crashing script produces error status with stderr detail, not silence", () =>
    Effect.gen(function* () {
      const test = yield* InstanceState.contextOrNull
      const dir = test?.directory ?? process.cwd()

      const skillDir = path.join(dir, ".dreamcode", "skills", "test-crash")
      const scriptsDir = path.join(skillDir, "scripts")
      yield* Effect.tryPromise({
        try: async () => {
          await Bun.write(
            path.join(skillDir, "SKILL.md"),
            "---\nname: test-crash\ndescription: Crashes\n---\n# Crash\n",
          )
          await Bun.write(
            path.join(scriptsDir, "run.py"),
            'import sys\nsys.stderr.write("FATAL: database connection refused\\n")\nsys.exit(1)\n',
          )
        },
        catch: (e) => new Error(String(e)),
      })

      const executor = yield* ChainExecutor.Service
      const results = yield* executor.execute(["test-crash"], "test prompt")
      expect(results).toHaveLength(1)
      expect(results[0].status).toBe("error")
      // Must contain the actual error detail, NOT be empty or a generic placeholder
      expect(results[0].output).toContain("FATAL: database connection refused")
      expect(results[0].output).toContain("Exit code 1")
    }),
    { config: skillsConfig },
  )

  it.instance("script with exit code 2 produces error status", () =>
    Effect.gen(function* () {
      const test = yield* InstanceState.contextOrNull
      const dir = test?.directory ?? process.cwd()

      const skillDir = path.join(dir, ".dreamcode", "skills", "test-exit2")
      const scriptsDir = path.join(skillDir, "scripts")
      yield* Effect.tryPromise({
        try: async () => {
          await Bun.write(
            path.join(skillDir, "SKILL.md"),
            "---\nname: test-exit2\ndescription: Exit 2\n---\n# Exit2\n",
          )
          await Bun.write(
            path.join(scriptsDir, "run.py"),
            'import sys\nprint("partial output before crash")\nsys.exit(2)\n',
          )
        },
        catch: (e) => new Error(String(e)),
      })

      const executor = yield* ChainExecutor.Service
      const results = yield* executor.execute(["test-exit2"], "test prompt")
      expect(results).toHaveLength(1)
      expect(results[0].status).toBe("error")
      expect(results[0].output).toContain("Exit code 2")
    }),
    { config: skillsConfig },
  )

  it.instance("script writing to stderr but exiting 0 is treated as success", () =>
    Effect.gen(function* () {
      const test = yield* InstanceState.contextOrNull
      const dir = test?.directory ?? process.cwd()

      const skillDir = path.join(dir, ".dreamcode", "skills", "test-stderr-ok")
      const scriptsDir = path.join(skillDir, "scripts")
      yield* Effect.tryPromise({
        try: async () => {
          await Bun.write(
            path.join(skillDir, "SKILL.md"),
            "---\nname: test-stderr-ok\ndescription: Stderr ok\n---\n# StderrOk\n",
          )
          await Bun.write(
            path.join(scriptsDir, "run.py"),
            'import sys\nsys.stderr.write("warning: something\\n")\nprint("real output")\nsys.exit(0)\n',
          )
        },
        catch: (e) => new Error(String(e)),
      })

      const executor = yield* ChainExecutor.Service
      const results = yield* executor.execute(["test-stderr-ok"], "test prompt")
      expect(results).toHaveLength(1)
      expect(results[0].status).toBe("ok")
      expect(results[0].output).toContain("real output")
    }),
    { config: skillsConfig },
  )

  it.instance("mixed chain with crashing script shows error for crash, ok for success", () =>
    Effect.gen(function* () {
      const test = yield* InstanceState.contextOrNull
      const dir = test?.directory ?? process.cwd()

      // Create a crashing skill
      const crashDir = path.join(dir, ".dreamcode", "skills", "test-crash-mixed")
      const crashScripts = path.join(crashDir, "scripts")
      yield* Effect.tryPromise({
        try: async () => {
          await Bun.write(
            path.join(crashDir, "SKILL.md"),
            "---\nname: test-crash-mixed\ndescription: Crashes\n---\n# Crash\n",
          )
          await Bun.write(
            path.join(crashScripts, "run.py"),
            'import sys\nsys.stderr.write("BLOWN UP\\n")\nsys.exit(1)\n',
          )
        },
        catch: (e) => new Error(String(e)),
      })

      const executor = yield* ChainExecutor.Service
      const results = yield* executor.execute(
        ["test-crash-mixed", "completely-fake-skill-xyz"],
        "test prompt",
      )
      expect(results).toHaveLength(2)
      // First: crashing script → error with detail
      expect(results[0].name).toBe("test-crash-mixed")
      expect(results[0].status).toBe("error")
      expect(results[0].output).toContain("BLOWN UP")
      // Second: missing skill → not_found
      expect(results[1].name).toBe("completely-fake-skill-xyz")
      expect(results[1].status).toBe("not_found")
    }),
    { config: skillsConfig },
  )

  it.instance("verify returns warning when skillsDir is unavailable", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      const verifyResult = yield* executor.verify([
        { name: "test", output: "ok", status: "ok", executionType: "content" },
      ])
      // With no skills dir, verify should return a visible warning, not empty string
      expect(typeof verifyResult).toBe("string")
      expect(verifyResult.length).toBeGreaterThan(0)
    }),
  )

  it.instance("runFullPipeline returns ChainResult[] (error or empty) when orchestrator not found", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      const results = yield* executor.runFullPipeline()
      // Should NOT throw or hang
      expect(Array.isArray(results)).toBe(true)
      // Every result has the expected shape
      for (const r of results) {
        expect(typeof r.name).toBe("string")
        expect(typeof r.output).toBe("string")
        expect(["ok", "not_found", "error"]).toContain(r.status)
        expect(["script", "content"]).toContain(r.executionType)
      }
    }),
  )
})
