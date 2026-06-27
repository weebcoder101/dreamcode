import { Effect, Layer } from "effect"
import { afterEach, describe, expect } from "bun:test"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { SkillTool } from "../../src/tool/skill"
import { ToolRegistry } from "@/tool/registry"
import { disposeAllInstances } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"
import { Tool } from "@/tool/tool"

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
}

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(ToolRegistry.defaultLayer.pipe(Layer.provide(Ripgrep.defaultLayer)))

describe("tool.skill", () => {
  it.instance("deprecated tool returns stub when Skill.Service is active", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
      const tool = (yield* registry.tools({
        providerID: "opencode" as any,
        modelID: "gpt-5" as any,
        agent,
      })).find((tool) => tool.id === SkillTool.id)
      if (!tool) throw new Error("Skill tool not found")

      const result = yield* tool.execute(
        { name: "tool-skill", prompt: "test prompt" },
        { ...baseCtx, ask: () => Effect.void },
      )

      // When Skill.Service is available (the normal case), the deprecated tool
      // correctly short-circuits to the stub to prevent dual execution.
      expect(result.output).toContain("deprecated")
      expect(result.output).toContain("core skill system")
    }),
  )

  it.instance("deprecated tool returns not-found for unknown skill via stub", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
      const tool = (yield* registry.tools({
        providerID: "opencode" as any,
        modelID: "gpt-5" as any,
        agent,
      })).find((tool) => tool.id === SkillTool.id)
      if (!tool) throw new Error("Skill tool not found")

      const result = yield* tool.execute(
        { name: "missing-skill", prompt: "test prompt" },
        { ...baseCtx, ask: () => Effect.void },
      )

      // Deprecated tool returns success with stub text (not a thrown error)
      expect(result.output).toContain("deprecated")
      expect(result.metadata.skill_executed).toBe("")
    }),
  )
})
