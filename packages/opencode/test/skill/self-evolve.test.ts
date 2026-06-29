import { describe, expect, test } from "bun:test"
import { SelfEvolve, DEFAULT_LEARNINGS, type LearningSignal } from "@/skill/self-evolve"

describe("SelfEvolve", () => {
  test("exports DEFAULT_LEARNINGS with 5 entries", () => {
    expect(Array.isArray(DEFAULT_LEARNINGS)).toBe(true)
    expect(DEFAULT_LEARNINGS.length).toBe(5)
  })

  test("each DEFAULT_LEARNINGS entry has required fields", () => {
    for (const entry of DEFAULT_LEARNINGS) {
      expect(typeof entry.whatWorked).toBe("string")
      expect(entry.whatWorked.length).toBeGreaterThan(0)
      expect(typeof entry.whatFailed).toBe("string")
      expect(entry.whatFailed.length).toBeGreaterThan(0)
      expect(typeof entry.whatToChange).toBe("string")
      expect(entry.whatToChange.length).toBeGreaterThan(0)
    }
  })

  test("DEFAULT_LEARNINGS contains Effect v4 API rules", () => {
    const allRules = DEFAULT_LEARNINGS.map((l) => `${l.whatWorked} ${l.whatFailed} ${l.whatToChange}`).join(" ")
    expect(allRules).toMatch(/Effect\.catchAll|Effect\.catch/)
    expect(allRules).toMatch(/Effect\.forkIn/)
    expect(allRules).toMatch(/Effect\.gen/)
    expect(allRules).toMatch(/Schema\.Class/)
    expect(allRules).toMatch(/Layer\.mock/)
  })

  test("SelfEvolve.Service is a valid Effect tag", () => {
    expect(SelfEvolve.Service).toBeDefined()
    expect(typeof SelfEvolve.Service).toBe("object")
    expect((SelfEvolve.Service as { key: string }).key).toBe("@dreamcode/SelfEvolve")
  })

  test("SelfEvolve.defaultLayer is defined and provides the service", () => {
    expect(SelfEvolve.defaultLayer).toBeDefined()
  })

  test("LearningSignal interface shape is valid", () => {
    const signal: LearningSignal = {
      whatWorked: "test worked",
      whatFailed: "test failed",
      whatToChange: "fix the test",
    }
    expect(signal.whatWorked).toBe("test worked")
    expect(signal.whatFailed).toBe("test failed")
    expect(signal.whatToChange).toBe("fix the test")
  })
})
