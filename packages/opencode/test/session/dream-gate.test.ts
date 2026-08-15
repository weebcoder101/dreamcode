import { describe, expect, test } from "bun:test"
import { gateToolCall, DREAM_GATE_ERROR, type GateVerdict } from "../../src/session/dream-gate"

function makeParts(parts: Array<{ type: string; text?: string }> = []) {
  return parts as any
}

describe("dream-gate", () => {
  test("allows non-mutating tools", () => {
    const verdict = gateToolCall({
      tool: "grep",
      parts: makeParts(),
      bypassAgentCheck: false,
      alreadyGated: () => false,
      markGated: () => {},
    })
    expect(verdict.kind).toBe("allow")
  })

  test("allows mutating tool when plan marker present", () => {
    const verdict = gateToolCall({
      tool: "edit",
      parts: makeParts([{ type: "text", text: "## Approach\nRefactor the loop." }]),
      bypassAgentCheck: false,
      alreadyGated: () => false,
      markGated: () => {},
    })
    expect(verdict.kind).toBe("allow")
  })

  test("blocks first mutating tool without plan marker", () => {
    let gated = false
    const verdict = gateToolCall({
      tool: "write",
      parts: makeParts([{ type: "text", text: "Let me just write the file." }]),
      bypassAgentCheck: false,
      alreadyGated: () => gated,
      markGated: () => {
        gated = true
      },
    })
    expect(verdict.kind).toBe("block")
    expect(gated).toBe(true)
    if (verdict.kind === "block") {
      expect(verdict.output.output).toContain("## Approach")
      expect(verdict.output.metadata.dream_gate_blocked).toBe(true)
      expect(DREAM_GATE_ERROR).toContain("## Verification")
    }
  })

  test("allows subsequent mutating tools after one gate (no deadlock)", () => {
    let gated = false
    const first = gateToolCall({
      tool: "edit",
      parts: makeParts(),
      bypassAgentCheck: false,
      alreadyGated: () => gated,
      markGated: () => {
        gated = true
      },
    })
    expect(first.kind).toBe("block")

    const second = gateToolCall({
      tool: "edit",
      parts: makeParts(),
      bypassAgentCheck: false,
      alreadyGated: () => gated,
      markGated: () => {},
    })
    expect(second.kind).toBe("allow")
  })

  test("bypasses gate for subagents (bypassAgentCheck)", () => {
    const verdict = gateToolCall({
      tool: "edit",
      parts: makeParts(),
      bypassAgentCheck: true,
      alreadyGated: () => false,
      markGated: () => {},
    })
    expect(verdict.kind).toBe("allow")
  })

  test("recognizes Phase markers and Approach bullets", () => {
    for (const text of [
      "## Critical Files\n- src/a.ts",
      "Phase 1: Understand requirements",
      "Approach 1: rewrite; Approach 2: patch",
      "Option 1: X\nOption 2: Y",
      "## Correlations\nsrc/b.ts depends on this",
    ]) {
      const verdict = gateToolCall({
        tool: "edit",
        parts: makeParts([{ type: "text", text }]),
        bypassAgentCheck: false,
        alreadyGated: () => false,
        markGated: () => {},
      })
      expect(verdict.kind, text).toBe("allow")
    }
  })
})
