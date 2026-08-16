import { describe, expect, test } from "bun:test"
import { gateToolCall, DREAM_GATE_ERROR, type GateVerdict } from "../../src/session/dream-gate"

function makeParts(parts: Array<{ type: string; text?: string }> = []) {
  return parts as any
}

describe("dream-gate", () => {
  test("allows non-mutating tools", () => {
    const planned = new Set<string>()
    const verdict = gateToolCall({
      tool: "grep",
      parts: makeParts(),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(verdict.kind).toBe("allow")
  })

  test("allows mutating tool when plan marker present", () => {
    const planned = new Set<string>()
    const verdict = gateToolCall({
      tool: "edit",
      filePath: "/tmp/test.ts",
      parts: makeParts([{ type: "text", text: "## Approach\nRefactor the loop." }]),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(verdict.kind).toBe("allow")
    expect(planned.has("/tmp/test.ts")).toBe(true)
  })

  test("blocks first mutating tool on a file without plan marker", () => {
    const planned = new Set<string>()
    const verdict = gateToolCall({
      tool: "write",
      filePath: "/tmp/a.ts",
      parts: makeParts([{ type: "text", text: "Let me just write the file." }]),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(verdict.kind).toBe("block")
    expect(planned.has("/tmp/a.ts")).toBe(true)
    if (verdict.kind === "block") {
      expect(verdict.output.output).toContain("## Approach")
      expect(verdict.output.metadata.dream_gate_blocked).toBe(true)
      expect(verdict.output.metadata.filePath).toBe("/tmp/a.ts")
      expect(DREAM_GATE_ERROR).toContain("## Verification")
    }
  })

  test("allows subsequent edits to the SAME file after plan emitted", () => {
    const planned = new Set<string>()
    // First call: no plan marker → block
    const first = gateToolCall({
      tool: "edit",
      filePath: "/tmp/a.ts",
      parts: makeParts(),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(first.kind).toBe("block")

    // Second call: file already planned → allow (even without plan marker)
    const second = gateToolCall({
      tool: "edit",
      filePath: "/tmp/a.ts",
      parts: makeParts(),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(second.kind).toBe("allow")
  })

  test("blocks NEW file even after another file was planned", () => {
    const planned = new Set<string>()
    // Plan file A
    gateToolCall({
      tool: "edit",
      filePath: "/tmp/a.ts",
      parts: makeParts([{ type: "text", text: "## Approach\nEdit A" }]),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(planned.has("/tmp/a.ts")).toBe(true)

    // Edit file B (new file, no plan marker) → should block
    const verdict = gateToolCall({
      tool: "edit",
      filePath: "/tmp/b.ts",
      parts: makeParts([{ type: "text", text: "Now edit B." }]),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(verdict.kind).toBe("block")
  })

  test("allows file B after plan marker emitted for it", () => {
    const planned = new Set<string>()
    // Plan file A
    gateToolCall({
      tool: "edit",
      filePath: "/tmp/a.ts",
      parts: makeParts([{ type: "text", text: "## Approach\nEdit A" }]),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })

    // Plan file B
    const verdict = gateToolCall({
      tool: "edit",
      filePath: "/tmp/b.ts",
      parts: makeParts([{ type: "text", text: "## Approach\nEdit B" }]),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(verdict.kind).toBe("allow")
    expect(planned.has("/tmp/b.ts")).toBe(true)

    // Subsequent edit to B → allowed
    const second = gateToolCall({
      tool: "edit",
      filePath: "/tmp/b.ts",
      parts: makeParts(),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(second.kind).toBe("allow")
  })

  test("bypasses gate for subagents (bypassAgentCheck)", () => {
    const planned = new Set<string>()
    const verdict = gateToolCall({
      tool: "edit",
      filePath: "/tmp/a.ts",
      parts: makeParts(),
      bypassAgentCheck: true,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
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
      const planned = new Set<string>()
      const verdict = gateToolCall({
        tool: "edit",
        filePath: "/tmp/test.ts",
        parts: makeParts([{ type: "text", text }]),
        bypassAgentCheck: false,
        alreadyPlanned: (f) => planned.has(f),
        markPlanned: (f) => planned.add(f),
      })
      expect(verdict.kind, text).toBe("allow")
    }
  })

  test("works without filePath (falls back to no-file tracking)", () => {
    const planned = new Set<string>()
    // No filePath: first call blocks
    const first = gateToolCall({
      tool: "write",
      parts: makeParts(),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(first.kind).toBe("block")

    // No filePath: second call also blocks (no file to track)
    const second = gateToolCall({
      tool: "write",
      parts: makeParts(),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(second.kind).toBe("block")
  })
})
