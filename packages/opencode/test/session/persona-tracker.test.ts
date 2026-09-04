import { describe, expect, test } from "bun:test"
import * as PersonaTracker from "../../src/session/persona-tracker"

describe("persona-tracker pure functions", () => {
  describe("buildSynthesisPrompt", () => {
    test("formats a single completed result correctly", () => {
      const result = PersonaTracker.buildSynthesisPrompt([
        { name: "Alice", role: "QA", output: "All tests pass", status: "completed" },
      ])
      expect(result).toContain("<synthesis-request>")
      expect(result).toContain('"Alice" (QA)')
      expect(result).toContain("All tests pass")
      expect(result).toContain("</synthesis-request>")
    })

    test("includes task and goals when provided", () => {
      const result = PersonaTracker.buildSynthesisPrompt([
        { name: "Bob", role: "Dev", output: "Code reviewed", status: "completed", task: "review code", goals: ["find issues"] },
      ])
      expect(result).toContain("Task: review code")
      expect(result).toContain("Goals: find issues")
    })

    test("marks failed results with [FAIL]", () => {
      const result = PersonaTracker.buildSynthesisPrompt([
        { name: "Charlie", role: "Dev", output: "Crashed", status: "error" },
      ])
      expect(result).toContain("[FAIL]")
      expect(result).toContain("*Analysis failed: Crashed*")
    })

    test("includes synthesis guide when present", () => {
      const result = PersonaTracker.buildSynthesisPrompt([
        { name: "Diana", role: "Architect", output: "Design done", status: "completed", synthesisGuide: "Focus on perf" },
      ])
      expect(result).toContain("Synthesis note: Focus on perf")
    })

    test("includes synthesis instructions section", () => {
      const result = PersonaTracker.buildSynthesisPrompt([
        { name: "Eve", role: "QA", output: "Tested", status: "completed" },
      ])
      expect(result).toContain("SYNTHESIS INSTRUCTIONS:")
      expect(result).toContain("Review all specialist findings")
    })

    test("handles multiple results with correct ordering", () => {
      const result = PersonaTracker.buildSynthesisPrompt([
        { name: "A", role: "R1", output: "First", status: "completed" },
        { name: "B", role: "R2", output: "Second", status: "completed" },
      ])
      // Format: ### 1. "A" (R1) [OK]
      const aIdx = result.indexOf('"A" (R1)')
      const bIdx = result.indexOf('"B" (R2)')
      expect(aIdx).toBeGreaterThan(-1)
      expect(bIdx).toBeGreaterThan(-1)
      expect(aIdx).toBeLessThan(bIdx)
    })

    test("returns empty prompt sections for zero results", () => {
      const result = PersonaTracker.buildSynthesisPrompt([])
      expect(result).toContain("<synthesis-request>")
      expect(result).toContain("All 0 specialist agents")
    })
  })

  describe("create tracker", () => {
    test("create returns a tracker with correct sessionID", () => {
      const { Effect } = require("effect")
      const tracker = Effect.runSync(PersonaTracker.create("test-session", 3))
      expect(tracker.sessionID).toBe("test-session")
      expect(typeof tracker.remaining).toBe("function")
      expect(typeof tracker.complete).toBe("function")
      expect(typeof tracker.getAll).toBe("function")
    })

    test("getAll() returns empty array for fresh tracker", () => {
      const { Effect } = require("effect")
      const tracker = Effect.runSync(PersonaTracker.create("test-session", 3))
      const results = Effect.runSync(tracker.getAll())
      expect(results).toEqual([])
    })

    test("remaining() returns total for fresh tracker", () => {
      const { Effect } = require("effect")
      const tracker = Effect.runSync(PersonaTracker.create("test-session", 3))
      const remaining = Effect.runSync(tracker.remaining())
      expect(remaining).toBe(3)
    })

    test("complete decrements remaining count", () => {
      const { Effect } = require("effect")
      const tracker = Effect.runSync(PersonaTracker.create("test-session", 2))
      Effect.runSync(tracker.complete("Alice", "QA", "All clear", "completed"))
      const remaining = Effect.runSync(tracker.remaining())
      expect(remaining).toBe(1)
    })

    test("getAll returns accumulated results after completes", () => {
      const { Effect } = require("effect")
      const tracker = Effect.runSync(PersonaTracker.create("test-session", 2))
      Effect.runSync(tracker.complete("Alice", "QA", "All clear", "completed", {
        task: "test the feature",
        goals: ["find bugs"],
        synthesisGuide: "Include Alice findings",
      }))
      Effect.runSync(tracker.complete("Bob", "Dev", "Found an issue", "completed", {
        task: "review the code",
        goals: ["check quality"],
        synthesisGuide: "Include Bob findings",
      }))
      const results = Effect.runSync(tracker.getAll())
      expect(results).toHaveLength(2)
      expect(results[0].name).toBe("Alice")
      expect(results[0].status).toBe("completed")
      expect(results[1].name).toBe("Bob")
    })
  })
})
