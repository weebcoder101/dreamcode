import { describe, expect, test } from "bun:test"
import {
  needsVerification,
  toolCallsMadeMutation,
  turnRanVerification,
  MUTATING_TOOLS,
} from "../../src/session/verify-gate"

function toolPart(tool: string, input: unknown, status = "completed") {
  return { type: "tool", tool, state: { status, input } } as any
}

describe("verify-gate", () => {
  test("mutating tool set covers edit/write/apply_patch/patch", () => {
    expect(MUTATING_TOOLS.has("edit")).toBe(true)
    expect(MUTATING_TOOLS.has("write")).toBe(true)
    expect(MUTATING_TOOLS.has("apply_patch")).toBe(true)
    expect(MUTATING_TOOLS.has("patch")).toBe(true)
    expect(MUTATING_TOOLS.has("grep")).toBe(false)
  })

  test("toolCallsMadeMutation detects completed edits", () => {
    expect(toolCallsMadeMutation([toolPart("edit", {})])).toBe(true)
    expect(toolCallsMadeMutation([toolPart("grep", {})])).toBe(false)
    expect(toolCallsMadeMutation([toolPart("bash", { command: "ls" })])).toBe(false)
  })

  test("turnRanVerification detects test commands", () => {
    const parts = [
      toolPart("bash", { command: "bun test" }),
      toolPart("bash", { command: "npm run typecheck" }),
      toolPart("bash", { command: "pytest tests/" }),
      toolPart("bash", { command: "tsc --noEmit" }),
    ]
    for (const p of parts) {
      expect(turnRanVerification([p]), p.state.input.command).toBe(true)
    }
  })

  test("turnRanVerification does not flag plain reads", () => {
    expect(turnRanVerification([toolPart("bash", { command: "git status" })])).toBe(false)
    expect(turnRanVerification([toolPart("bash", { command: "ls -la" })])).toBe(false)
  })

  test("lsp counts as verification", () => {
    expect(turnRanVerification([toolPart("lsp", {})])).toBe(true)
  })

  test("needsVerification true when edits without verification", () => {
    expect(
      needsVerification({
        parts: [toolPart("edit", {})],
        alreadyVerified: false,
        alreadyPrompted: false,
      }),
    ).toBe(true)
  })

  test("needsVerification false when verification ran", () => {
    expect(
      needsVerification({
        parts: [toolPart("edit", {}), toolPart("bash", { command: "bun test" })],
        alreadyVerified: false,
        alreadyPrompted: false,
      }),
    ).toBe(false)
  })

  test("needsVerification false when already prompted", () => {
    expect(
      needsVerification({
        parts: [toolPart("edit", {})],
        alreadyVerified: false,
        alreadyPrompted: true,
      }),
    ).toBe(false)
  })

  test("needsVerification false for read-only turns", () => {
    expect(
      needsVerification({
        parts: [toolPart("grep", {}), toolPart("bash", { command: "git diff" })],
        alreadyVerified: false,
        alreadyPrompted: false,
      }),
    ).toBe(false)
  })
})
