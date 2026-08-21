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
    // File must NOT be marked as planned on block — the model must emit a
    // real plan before subsequent edits are allowed through.
    expect(planned.has("/tmp/a.ts")).toBe(false)
    if (verdict.kind === "block") {
      expect(verdict.output.output).toContain("## Approach")
      expect(verdict.output.metadata.dream_gate_blocked).toBe(true)
      expect(verdict.output.metadata.filePath).toBe("/tmp/a.ts")
      expect(DREAM_GATE_ERROR).toContain("## Verification")
    }
  })

  test("allows subsequent edits to the SAME file after plan emitted", () => {
    const planned = new Set<string>()
    // First call: no plan marker → block (file NOT marked)
    const first = gateToolCall({
      tool: "edit",
      filePath: "/tmp/a.ts",
      parts: makeParts(),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(first.kind).toBe("block")
    expect(planned.has("/tmp/a.ts")).toBe(false)

    // Second call: still no plan → block again (file still not marked)
    const second = gateToolCall({
      tool: "edit",
      filePath: "/tmp/a.ts",
      parts: makeParts(),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(second.kind).toBe("block")

    // Third call: plan marker present → allow, file now marked
    const third = gateToolCall({
      tool: "edit",
      filePath: "/tmp/a.ts",
      parts: makeParts([{ type: "text", text: "## Approach\nRefactor the loop." }]),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(third.kind).toBe("allow")
    expect(planned.has("/tmp/a.ts")).toBe(true)

    // Fourth call: file already planned → allow (even without plan marker)
    const fourth = gateToolCall({
      tool: "edit",
      filePath: "/tmp/a.ts",
      parts: makeParts(),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(fourth.kind).toBe("allow")
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

  test("ast-edit is never gated (structurally safe)", () => {
    const planned = new Set<string>()
    const verdict = gateToolCall({
      tool: "ast-edit",
      filePath: "/tmp/test.ts",
      parts: makeParts(),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(verdict.kind).toBe("allow")
  })

  test("blocks mutating tool without plan marker", () => {
    const planned = new Set<string>()
    const verdict = gateToolCall({
      tool: "edit",
      filePath: "/tmp/new.ts",
      parts: makeParts([{ type: "text", text: "Just going to edit directly." }]),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(verdict.kind).toBe("block")
  })

  test("allows bare keyword plan markers (no ## prefix)", () => {
    // Models often output plan sections without markdown headers:
    //   Approach
    //   Simple edit...
    //   Correlations
    //   test-mock2.txt is isolated...
    //   Verification
    //   Read file after edit...
    const barePlan = [
      "Approach",
      "Simple test edit on a mock file to verify the edit tool works.",
      "Correlations",
      "test-mock2.txt is an isolated test file with no dependencies.",
      "Verification",
      "Read file after edit to confirm content changed.",
    ].join("\n")

    const planned = new Set<string>()
    const verdict = gateToolCall({
      tool: "edit",
      filePath: "/tmp/test-mock2.txt",
      parts: makeParts([{ type: "text", text: barePlan }]),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(verdict.kind).toBe("allow")
    expect(planned.has("/tmp/test-mock2.txt")).toBe(true)
  })

  test("allows single bare Approach keyword at line start", () => {
    const planned = new Set<string>()
    const verdict = gateToolCall({
      tool: "edit",
      filePath: "/tmp/a.ts",
      parts: makeParts([{ type: "text", text: "Approach\nRewrite the auth module to use session cookies instead of JWT tokens." }]),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(verdict.kind).toBe("allow")
  })

  test("blocks degenerate bare plan (keyword only, no content)", () => {
    const planned = new Set<string>()
    const verdict = gateToolCall({
      tool: "edit",
      filePath: "/tmp/a.ts",
      parts: makeParts([{ type: "text", text: "Approach\nCorrelations\nVerification" }]),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    // Degenerate plan: keywords present but no actual content
    expect(verdict.kind).toBe("block")
    // File must NOT be marked as planned on degenerate block
    expect(planned.has("/tmp/a.ts")).toBe(false)
  })

  test("does not mark file as planned on degenerate plan block", () => {
    const planned = new Set<string>()
    // Degenerate plan (bare keyword, no content)
    const first = gateToolCall({
      tool: "edit",
      filePath: "/tmp/a.ts",
      parts: makeParts([{ type: "text", text: "## Approach" }]),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(first.kind).toBe("block")
    expect(planned.has("/tmp/a.ts")).toBe(false)

    // Subsequent call should still block (file not pre-authorized)
    const second = gateToolCall({
      tool: "edit",
      filePath: "/tmp/a.ts",
      parts: makeParts([{ type: "text", text: "## Approach" }]),
      bypassAgentCheck: false,
      alreadyPlanned: (f) => planned.has(f),
      markPlanned: (f) => planned.add(f),
    })
    expect(second.kind).toBe("block")
  })
})
