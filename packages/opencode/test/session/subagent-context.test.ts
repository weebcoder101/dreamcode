import { describe, expect } from "bun:test"
import { extractSubagentContext, buildSubagentContextPrompt } from "../../src/session/subagent-context"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import type { ModelV2 } from "@opencode-ai/core/model"

function makeMsg(role: "user" | "assistant", text: string, synthetic = false): SessionV1.WithParts {
  return {
    info: {
      id: MessageID.ascending(),
      sessionID: SessionID.make("test"),
      role,
      agent: "general",
      time: { created: Date.now() },
    } as SessionV1.Info,
    parts: [
      {
        id: PartID.ascending(),
        messageID: "" as any,
        sessionID: SessionID.make("test"),
        type: "text",
        text,
        synthetic,
      } as SessionV1.TextPart,
    ],
  }
}

describe("subagent-context.extractSubagentContext", () => {
  it("extracts current prompt from the last user message", () => {
    const msgs = [
      makeMsg("user", "Hello"),
      makeMsg("assistant", "Hi"),
      makeMsg("user", "Fix the bug in src/main.ts"),
    ]
    const ctx = extractSubagentContext(msgs)
    expect(ctx.currentPrompt).toBe("Fix the bug in src/main.ts")
  })

  it("returns empty prompt when no user messages", () => {
    const ctx = extractSubagentContext([])
    expect(ctx.currentPrompt).toBe("")
  })

  it("ignores synthetic user messages for current prompt", () => {
    const msgs = [
      makeMsg("user", "Synthetic prompt", true),
    ]
    const ctx = extractSubagentContext(msgs)
    expect(ctx.currentPrompt).toBe("") // synthetic text should be ignored
  })

  it("extracts file paths from user messages", () => {
    const msgs = [
      makeMsg("user", "Check src/app.ts and lib/utils.ts for bugs"),
    ]
    const ctx = extractSubagentContext(msgs)
    expect(ctx.mentionedPaths).toContain("src/app.ts")
    expect(ctx.mentionedPaths).toContain("lib/utils.ts")
  })

  it("limits recent messages to MAX_RECENT (15 by default)", () => {
    const msgs = Array.from({ length: 30 }, (_, i) => makeMsg("user", `Message ${i}`))
    const ctx = extractSubagentContext(msgs)
    expect(ctx.recentMessages.length).toBe(15) // default MAX_RECENT
  })

  it("deduplicates mentioned file paths", () => {
    const msgs = [
      makeMsg("user", "Check src/app.ts and src/app.ts again"),
    ]
    const ctx = extractSubagentContext(msgs)
    const occurrences = ctx.mentionedPaths.filter((p) => p === "src/app.ts").length
    expect(occurrences).toBe(1)
  })

  it("returns empty paths when no file patterns found", () => {
    const msgs = [
      makeMsg("user", "Hello how are you?"),
    ]
    const ctx = extractSubagentContext(msgs)
    expect(ctx.mentionedPaths).toEqual([])
  })
})

describe("subagent-context.buildSubagentContextPrompt", () => {
  it("includes current task when present", () => {
    const ctx = { recentMessages: [], mentionedPaths: [], currentPrompt: "Fix the bug" }
    const prompt = buildSubagentContextPrompt(ctx)
    expect(prompt).toContain("Fix the bug")
  })

  it("includes relevant files section when paths exist", () => {
    const ctx = { recentMessages: [], mentionedPaths: ["src/main.ts", "lib/utils.ts"], currentPrompt: "" }
    const prompt = buildSubagentContextPrompt(ctx)
    expect(prompt).toContain("Relevant Files")
    expect(prompt).toContain("src/main.ts")
    expect(prompt).toContain("lib/utils.ts")
  })

  it("excludes relevant files section when no paths", () => {
    const ctx = { recentMessages: [], mentionedPaths: [], currentPrompt: "" }
    const prompt = buildSubagentContextPrompt(ctx)
    expect(prompt).not.toContain("Relevant Files")
  })

  it("wraps output in <active-context> tags", () => {
    const ctx = { recentMessages: [], mentionedPaths: [], currentPrompt: "task" }
    const prompt = buildSubagentContextPrompt(ctx)
    expect(prompt).toContain("<active-context>")
    expect(prompt).toContain("</active-context>")
  })

  it("includes recent exchange summary when messages exist", () => {
    const msgs = [makeMsg("user", "Hello"), makeMsg("assistant", "Hi there")]
    const ctx = { recentMessages: msgs, mentionedPaths: [], currentPrompt: "task" }
    const prompt = buildSubagentContextPrompt(ctx)
    expect(prompt).toContain("Recent Exchange")
  })

  it("handles empty context gracefully", () => {
    const ctx = { recentMessages: [], mentionedPaths: [], currentPrompt: "" }
    const prompt = buildSubagentContextPrompt(ctx)
    expect(prompt).toContain("<active-context>")
    expect(prompt).toContain("</active-context>")
  })
})
