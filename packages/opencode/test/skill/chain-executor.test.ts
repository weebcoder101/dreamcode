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

  it.live("verify returns empty for no results", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      const verifyResult = yield* executor.verify([])
      expect(verifyResult).toBe("")
    }),
  )

  it.live("runFullPipeline returns array when no skills dir", () =>
    Effect.gen(function* () {
      const executor = yield* ChainExecutor.Service
      const results = yield* executor.runFullPipeline(["nonexistent-skill"], "test prompt")
      expect(Array.isArray(results)).toBe(true)
    }),
  )
})

// ─────────────────────────────────────────────────────────────
// validateScriptPath pure function tests
// ─────────────────────────────────────────────────────────────

describe("validateScriptPath", () => {
  const cwd = "/tmp/test-project"

  test("rejects empty string", () => {
    expect(ChainExecutor.validateScriptPath("", cwd)).toBe(false)
  })

  test("rejects path traversal escape", () => {
    const malicious = "/tmp/test-project/.dreamcode/skills/../../etc/passwd"
    expect(ChainExecutor.validateScriptPath(malicious, cwd)).toBe(false)
  })

  test("rejects path pointing outside allowed dirs", () => {
    expect(ChainExecutor.validateScriptPath("/bin/sh", cwd)).toBe(false)
  })

  test("rejects absolute path outside project", () => {
    expect(ChainExecutor.validateScriptPath("/usr/local/bin/malware", cwd)).toBe(false)
  })

  test("rejects relative path that escapes cwd", () => {
    const resolved = "/tmp/test-project/../../../etc/passwd"
    expect(ChainExecutor.validateScriptPath(resolved, cwd)).toBe(false)
  })

  test("rejects non-absolute path", () => {
    expect(ChainExecutor.validateScriptPath("relative/path/script.py", cwd)).toBe(false)
  })
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
})
