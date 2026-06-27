import { describe, expect, it } from "bun:test"
import { buildPrompt, getSupportedScanTypes } from "../../src/skill/prompt-engine"

describe("prompt-engine", () => {
  describe("buildPrompt", () => {
    it("returns full_audit system prompt for unknown scan type", () => {
      const result = buildPrompt({
        scanType: "nonexistent",
        files: [{ path: "test.ts", content: "const x = 1" }],
      })
      expect(result.scanType).toBe("nonexistent")
      expect(result.systemPrompt).toContain("expert software architect")
      expect(result.fileCount).toBe(1)
    })

    it("returns security system prompt for security scan type", () => {
      const result = buildPrompt({
        scanType: "security",
        files: [{ path: "auth.ts", content: "const token = 'abc'" }],
      })
      expect(result.systemPrompt).toContain("security expert")
      expect(result.systemPrompt).toContain("OWASP Top 10")
    })

    it("returns bug_hunt system prompt", () => {
      const result = buildPrompt({
        scanType: "bug_hunt",
        files: [{ path: "handler.ts", content: "function handle() {}" }],
      })
      expect(result.systemPrompt).toContain("debugging expert")
      expect(result.systemPrompt).toContain("Race conditions")
    })

    it("returns test_gap system prompt", () => {
      const result = buildPrompt({
        scanType: "test_gap",
        files: [{ path: "utils.ts", content: "export const add = (a: number, b: number) => a + b" }],
      })
      expect(result.systemPrompt).toContain("testing expert")
      expect(result.systemPrompt).toContain("coverage gaps")
    })

    it("returns refactor system prompt", () => {
      const result = buildPrompt({
        scanType: "refactor",
        files: [{ path: "big.ts", content: "function doEverything() { /* ... */ }" }],
      })
      expect(result.systemPrompt).toContain("refactoring expert")
      expect(result.systemPrompt).toContain("Code duplication")
    })

    it("formats file contents with markdown code blocks", () => {
      const result = buildPrompt({
        scanType: "full_audit",
        files: [{ path: "src/index.ts", content: "console.log('hello')" }],
      })
      expect(result.userPrompt).toContain("## File: src/index.ts")
      expect(result.userPrompt).toContain("```")
      expect(result.userPrompt).toContain("console.log('hello')")
    })

    it("handles multiple files", () => {
      const result = buildPrompt({
        scanType: "full_audit",
        files: [
          { path: "a.ts", content: "const a = 1" },
          { path: "b.ts", content: "const b = 2" },
        ],
      })
      expect(result.fileCount).toBe(2)
      expect(result.userPrompt).toContain("## File: a.ts")
      expect(result.userPrompt).toContain("## File: b.ts")
    })

    it("appends context when provided", () => {
      const result = buildPrompt({
        scanType: "full_audit",
        files: [{ path: "x.ts", content: "const x = 1" }],
        context: "This is a Express.js REST API",
      })
      expect(result.userPrompt).toContain("Additional context: This is a Express.js REST API")
    })

    it("does not append context when absent", () => {
      const result = buildPrompt({
        scanType: "full_audit",
        files: [{ path: "x.ts", content: "const x = 1" }],
      })
      expect(result.userPrompt).not.toContain("Additional context:")
    })

    it("handles empty content gracefully", () => {
      const result = buildPrompt({
        scanType: "full_audit",
        files: [{ path: "empty.ts", content: "" }],
      })
      expect(result.userPrompt).toContain("## File: empty.ts")
      expect(result.userPrompt).toContain("```")
    })

    it("handles missing path gracefully", () => {
      const result = buildPrompt({
        scanType: "full_audit",
        files: [{ path: "", content: "some code" }],
      })
      expect(result.userPrompt).toContain("## File: unknown")
    })

    it("estimates tokens based on character count / 4", () => {
      const result = buildPrompt({
        scanType: "full_audit",
        files: [{ path: "t.ts", content: "abcd" }],
      })
      const expectedChars = result.systemPrompt.length + result.userPrompt.length
      expect(result.estimatedTokens).toBe(Math.ceil(expectedChars / 4))
    })

    it("fileCount matches input array length", () => {
      const result = buildPrompt({
        scanType: "full_audit",
        files: [
          { path: "a.ts", content: "1" },
          { path: "b.ts", content: "2" },
          { path: "c.ts", content: "3" },
        ],
      })
      expect(result.fileCount).toBe(3)
    })
  })

  describe("getSupportedScanTypes", () => {
    it("returns all 5 scan types", () => {
      const types = getSupportedScanTypes()
      expect(types).toHaveLength(5)
      expect(types).toContain("full_audit")
      expect(types).toContain("security")
      expect(types).toContain("bug_hunt")
      expect(types).toContain("test_gap")
      expect(types).toContain("refactor")
    })

    it("returns a copy (not mutable reference)", () => {
      const types1 = getSupportedScanTypes()
      const types2 = getSupportedScanTypes()
      expect(types1).toEqual(types2)
      expect(types1).not.toBe(types2)
    })
  })
})
