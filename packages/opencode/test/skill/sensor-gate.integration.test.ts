/**
 * Sensor Gate Integration Tests
 *
 * Tests that the real Python classifier subprocess works end-to-end.
 * These are live tests — they require Python3 and the classifier script.
 */

import { describe, expect, test } from "bun:test"
import { resolvePythonCommand, getPythonArgs } from "../../src/skill/python-resolver"
import path from "path"

const SCRIPT_TIMEOUT = 15_000

// Point directly at the source tree skills so integration tests work in dev
const SKILLS_DIR = path.resolve(import.meta.dir, "../../src/skill/dreamcode/skills")

describe("sensor gate integration (Python subprocess)", () => {
  test("classifier.py produces valid JSON output", async () => {
    const classifierScript = path.join(SKILLS_DIR, "chain-orchestrator", "scripts", "classifier.py")
    const pythonCmd = resolvePythonCommand()
    const pythonArgs = getPythonArgs()

    const proc = Bun.spawn([pythonCmd, ...pythonArgs, classifierScript, "--prompt", "fix the login button color", "--json"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })

    const timeout = setTimeout(() => proc.kill(), SCRIPT_TIMEOUT)
    const exitCode = await proc.exited
    clearTimeout(timeout)
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()

    expect(exitCode).toBe(0)
    expect(stderr).toBe("")

    // Should produce parseable JSON
    const parsed = JSON.parse(stdout)
    expect(parsed).toBeDefined()
    expect(typeof parsed).toBe("object")
    // Classifier returns primary_task/detected_tasks/chain etc.
    expect(parsed).toHaveProperty("primary_task")
    expect(typeof parsed.primary_task).toBe("string")
  }, SCRIPT_TIMEOUT + 5000)

  test("classifier.py handles minimal prompt", async () => {
    const classifierScript = path.join(SKILLS_DIR, "chain-orchestrator", "scripts", "classifier.py")
    const pythonCmd = resolvePythonCommand()

    const proc = Bun.spawn([pythonCmd, classifierScript, "--prompt", "a", "--json"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })

    const timeout = setTimeout(() => proc.kill(), SCRIPT_TIMEOUT)
    const exitCode = await proc.exited
    clearTimeout(timeout)

    // Minimal prompt should exit 0 with default-classified JSON
    expect(exitCode).toBe(0)
  }, SCRIPT_TIMEOUT + 5000)

  test("classifier.py --help produces usage text", async () => {
    const classifierScript = path.join(SKILLS_DIR, "chain-orchestrator", "scripts", "classifier.py")
    const pythonCmd = resolvePythonCommand()

    const proc = Bun.spawn([pythonCmd, classifierScript, "--help"], {
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
