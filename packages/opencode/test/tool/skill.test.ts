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
  it.instance("deprecated tool falls through to legacy path when Skill.Service is not in layer", () =>
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

      // When Skill.Service is NOT in the layer (test context), the runtime guard
      // detects the core system exists but service is unavailable, logs a warning,
      // then falls through to the legacy path which looks for SKILL.md on disk.
      // "tool-skill" doesn't exist, so we get NOT FOUND with available skills list.
      expect(result.output).toBeDefined()
      expect(result.metadata.skill_executed).toBe("")
    }),
  )

  it.instance("deprecated tool returns not-found for unknown skill via legacy path", () =>
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

      // Legacy path: "missing-skill" doesn't exist on disk
      expect(result.output).toBeDefined()
      expect(result.metadata.skill_executed).toBe("")
    }),
  )
})
