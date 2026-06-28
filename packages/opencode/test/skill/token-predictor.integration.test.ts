/**
 * Token Predictor Integration Tests
 *
 * Tests that the real Python predictor subprocess works end-to-end.
 * These are live tests — they require Python3 and the predict.py script.
 */

import { describe, expect, test } from "bun:test"
import { resolvePythonCommand, getPythonArgs } from "../../src/skill/python-resolver"
import path from "path"

const SCRIPT_TIMEOUT = 15_000
const SKILLS_DIR = path.resolve(import.meta.dir, "../../src/skill/dreamcode/skills")

describe("token predictor integration (Python subprocess)", () => {
  test("predict.py produces valid JSON output", async () => {
    const predictorScript = path.join(SKILLS_DIR, "token-predictor", "scripts", "predict.py")
    const pythonCmd = resolvePythonCommand()
    const pythonArgs = getPythonArgs()

    const proc = Bun.spawn(
      [pythonCmd, ...pythonArgs, predictorScript, "--prompt", "test the login feature", "--json", "--count", "3"],
      {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    const timeout = setTimeout(() => proc.kill(), SCRIPT_TIMEOUT)
    const exitCode = await proc.exited
    clearTimeout(timeout)
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()

    expect(exitCode).toBe(0)
    expect(stderr).toBe("")

    // Should produce parseable JSON with questions array
    const parsed = JSON.parse(stdout)
    expect(parsed).toBeDefined()
    expect(Array.isArray(parsed.questions)).toBe(true)
    expect(parsed.questions.length).toBeGreaterThan(0)
    expect(parsed.questions.length).toBeLessThanOrEqual(3)
    // Each question should be a non-empty string (or object with .question field)
    for (const q of parsed.questions) {
      const text = typeof q === "string" ? q : q.question
      expect(typeof text).toBe("string")
      expect(text.length).toBeGreaterThan(0)
    }
  }, SCRIPT_TIMEOUT + 5000)

  test("predict.py generates different questions for different prompts", async () => {
    const predictorScript = path.join(SKILLS_DIR, "token-predictor", "scripts", "predict.py")
    const pythonCmd = resolvePythonCommand()
    const pythonArgs = getPythonArgs()

    // Run for "security" prompt
    const proc1 = Bun.spawn(
      [pythonCmd, ...pythonArgs, predictorScript, "--prompt", "audit database security", "--json", "--count", "2"],
      { stdout: "pipe", stderr: "pipe" },
    )
    const exit1 = await proc1.exited
    const out1 = await new Response(proc1.stdout).text()
    const parsed1 = JSON.parse(out1)

    // Run for "ui" prompt
    const proc2 = Bun.spawn(
      [pythonCmd, ...pythonArgs, predictorScript, "--prompt", "change button color to blue", "--json", "--count", "2"],
      { stdout: "pipe", stderr: "pipe" },
    )
    const exit2 = await proc2.exited
    const out2 = await new Response(proc2.stdout).text()
    const parsed2 = JSON.parse(out2)

    expect(exit1).toBe(0)
    expect(exit2).toBe(0)
    // Different prompts should produce different questions
    const q1 = parsed1.questions.map((q: any) => (typeof q === "string" ? q : q.question)).join(" ")
    const q2 = parsed2.questions.map((q: any) => (typeof q === "string" ? q : q.question)).join(" ")
    expect(q1).not.toBe(q2)
  }, SCRIPT_TIMEOUT * 2 + 5000)

  test("predict.py --help produces usage text", async () => {
    const predictorScript = path.join(SKILLS_DIR, "token-predictor", "scripts", "predict.py")
    const pythonCmd = resolvePythonCommand()

    const proc = Bun.spawn([pythonCmd, predictorScript, "--help"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })

    const timeout = setTimeout(() => proc.kill(), SCRIPT_TIMEOUT)
    const exitCode = await proc.exited
    clearTimeout(timeout)
    const stdout = await new Response(proc.stdout).text()

    expect(exitCode).toBe(0)
    expect(stdout).toContain("usage:")
    expect(stdout).toContain("--prompt")
  }, SCRIPT_TIMEOUT + 5000)
})
