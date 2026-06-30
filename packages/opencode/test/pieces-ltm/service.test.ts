import { describe, expect, test } from "bun:test"
import { buildMemorySummary, classifyMemory } from "../../src/pieces-ltm/service"
import type { PersistInput, MemoryType } from "../../src/pieces-ltm/service"

// Pure function tests — no Effect dependencies
describe("pieces-ltm.classifyMemory", () => {
  const testClassify = (taskDescription: string, memoryType?: MemoryType): MemoryType => {
    return classifyMemory({
      chainName: "test",
      taskDescription,
      outcome: "success",
      ...(memoryType ? { memoryType } : {}),
    } as PersistInput)
  }

  test("classifies bugfix from 'fix' keyword", () => {
    expect(testClassify("fix the login bug")).toBe("bugfix")
  })

  test("classifies bugfix from 'error' keyword", () => {
    expect(testClassify("error in payment processing")).toBe("bugfix")
  })

  test("classifies bugfix from 'bug' keyword", () => {
    expect(testClassify("bug in user authentication")).toBe("bugfix")
  })

  test("classifies decision from 'decided' keyword", () => {
    expect(testClassify("decided to use Postgres")).toBe("decision")
  })

  test("classifies decision from 'chose' keyword", () => {
    expect(testClassify("chose React over Vue")).toBe("decision")
  })

  test("classifies decision from 'architecture' keyword", () => {
    expect(testClassify("architecture review completed")).toBe("decision")
  })

  test("classifies breakthrough from 'breakthrough' keyword", () => {
    expect(testClassify("breakthrough in performance")).toBe("breakthrough")
  })

  test("classifies learn from 'learned' keyword", () => {
    expect(testClassify("learned about generics")).toBe("learn")
  })

  test("classifies learn from 'discovered' keyword", () => {
    expect(testClassify("discovered the root cause")).toBe("learn")
  })

  test("classifies incident from 'incident' keyword", () => {
    expect(testClassify("incident in production")).toBe("incident")
  })

  test("defaults to standup when no keywords match", () => {
    expect(testClassify("general work update")).toBe("standup")
  })

  test("uses explicit memoryType when provided", () => {
    expect(testClassify("fix bug", "decision")).toBe("decision")
  })

  test("bugfix is preferred over standup when both match ambiguously", () => {
    expect(testClassify("a fix and a feature")).toBe("bugfix")
  })
})

describe("pieces-ltm.buildMemorySummary", () => {
  const input: PersistInput = {
    chainName: "Test Chain",
    taskDescription: "Fix authentication bug",
    outcome: "success",
  }

  test("includes chain name in summary", () => {
    const summary = buildMemorySummary(input)
    expect(summary).toContain("Test Chain")
  })

  test("includes task description", () => {
    const summary = buildMemorySummary(input)
    expect(summary).toContain("Fix authentication bug")
  })

  test("includes outcome", () => {
    const summary = buildMemorySummary(input)
    expect(summary).toContain("success")
  })

  test("includes files changed section when provided", () => {
    const withFiles: PersistInput = { ...input, filesChanged: ["src/auth.ts", "src/config.ts"] }
    const summary = buildMemorySummary(withFiles)
    expect(summary).toContain("Files Changed")
    expect(summary).toContain("src/auth.ts")
    expect(summary).toContain("src/config.ts")
  })

  test("omits files changed section when not provided", () => {
    const summary = buildMemorySummary(input)
    expect(summary).not.toContain("Files Changed")
  })

  test("includes key decisions section when provided", () => {
    const withDecisions: PersistInput = { ...input, keyDecisions: ["Use Postgres", "Migrate in Q3"] }
    const summary = buildMemorySummary(withDecisions)
    expect(summary).toContain("Key Decisions")
    expect(summary).toContain("Use Postgres")
    expect(summary).toContain("Migrate in Q3")
  })

  test("omits key decisions section when not provided", () => {
    const summary = buildMemorySummary(input)
    expect(summary).not.toContain("Key Decisions")
  })

  test("includes metrics section when provided", () => {
    const withMetrics: PersistInput = { ...input, metrics: { latency: "100ms", throughput: "500rps" } }
    const summary = buildMemorySummary(withMetrics)
    expect(summary).toContain("Metrics")
    expect(summary).toContain("latency: 100ms")
    expect(summary).toContain("throughput: 500rps")
  })

  test("omits metrics section when not provided", () => {
    const summary = buildMemorySummary(input)
    expect(summary).not.toContain("Metrics")
  })

  test("includes timestamp in ISO format", () => {
    const summary = buildMemorySummary(input)
    expect(summary).toContain("**Time:**")
    expect(summary).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})
