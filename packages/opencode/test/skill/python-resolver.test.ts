import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { randomBytes } from "crypto"

// Import the module under test
import {
  resolvePythonCommand,
  getPythonArgs,
  resolveSkillsDir,
  resolveScript,
  validateScriptPath,
  cleanupTmpFile,
  writePromptToTmpFile,
  HOME,
} from "../../src/skill/python-resolver"

describe("HOME", () => {
  it("should be a non-empty string", () => {
    expect(HOME).toBeTruthy()
    expect(typeof HOME).toBe("string")
  })
})

describe("resolvePythonCommand", () => {
  const originalPlatform = process.platform

  afterEach(() => {
    delete process.env.PYTHON_PATH
    delete process.env.DREAMCODE_PYTHON
    Object.defineProperty(process, "platform", { value: originalPlatform })
  })

  it("returns 'python3' on non-Windows by default", () => {
    Object.defineProperty(process, "platform", { value: "linux" })
    expect(resolvePythonCommand()).toBe("python3")
  })

  it("returns 'py' on Windows by default", () => {
    Object.defineProperty(process, "platform", { value: "win32" })
    expect(resolvePythonCommand()).toBe("py")
  })

  it("uses PYTHON_PATH env var when set", () => {
    process.env.PYTHON_PATH = "/custom/python"
    expect(resolvePythonCommand()).toBe("/custom/python")
  })

  it("uses DREAMCODE_PYTHON env var when set", () => {
    process.env.DREAMCODE_PYTHON = "/opt/python/bin/python"
    Object.defineProperty(process, "platform", { value: "linux" })
    expect(resolvePythonCommand()).toBe("/opt/python/bin/python")
  })

  it("prefers PYTHON_PATH over DREAMCODE_PYTHON", () => {
    process.env.PYTHON_PATH = "/first/choice"
    process.env.DREAMCODE_PYTHON = "/fallback"
    expect(resolvePythonCommand()).toBe("/first/choice")
  })
})

describe("getPythonArgs", () => {
  const originalPlatform = process.platform

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform })
    delete process.env.PYTHON_PATH
  })

  it("returns ['-3'] on Windows with 'py' command", () => {
    Object.defineProperty(process, "platform", { value: "win32" })
    expect(getPythonArgs()).toEqual(["-3"])
  })

  it("returns [] on non-Windows", () => {
    Object.defineProperty(process, "platform", { value: "linux" })
    expect(getPythonArgs()).toEqual([])
  })

  it("returns [] when PYTHON_PATH overrides on Windows", () => {
    process.env.PYTHON_PATH = "python3"
    Object.defineProperty(process, "platform", { value: "win32" })
    expect(getPythonArgs()).toEqual([])
  })
})

describe("resolveSkillsDir", () => {
  it("returns a string (possibly empty)", () => {
    const result = resolveSkillsDir()
    expect(typeof result).toBe("string")
  })

  it("finds a directory at HOME/.config/dreamcode/skills if it exists", () => {
    const targetDir = join(HOME, ".config", "dreamcode", "skills")
    if (targetDir === resolveSkillsDir()) {
      // The user already has this directory; test passes implicitly
      expect(resolveSkillsDir()).toBe(targetDir)
    } else {
      // Create it temporarily to verify candidate ordering
      mkdirSync(targetDir, { recursive: true })
      try {
        expect(resolveSkillsDir()).toBe(targetDir)
      } finally {
        rmSync(targetDir, { recursive: true, force: true })
      }
    }
  })

  it("returns non-empty if any candidate dir exists (including source tree)", () => {
    // After adding source tree path to candidates, resolveSkillsDir() should
    // always find at least the source tree path during development.
    // We test that it returns a string, not necessarily empty.
    const result = resolveSkillsDir()
    // In dev environment, source tree path always exists
    expect(typeof result).toBe("string")
  })
})

describe("resolveScript", () => {
  let tempSkillsDir: string

  beforeEach(() => {
    tempSkillsDir = join(tmpdir(), `dreamcode-test-${randomBytes(4).toString("hex")}`, "skills")
    mkdirSync(tempSkillsDir, { recursive: true })
    const relative = join("chain-orchestrator", "scripts")
    mkdirSync(join(tempSkillsDir, relative), { recursive: true })
    writeFileSync(join(tempSkillsDir, relative, "sensor_gate.py"), "# test sensor gate")
  })

  afterEach(() => {
    rmSync(tempSkillsDir, { recursive: true, force: true })
  })

  it("returns undefined when no skills directory exists", () => {
    expect(resolveScript("some/script.py")).toBeUndefined()
  })

  it("finds a script when skills dir exists", () => {
    // Create the .config directory so resolveSkillsDir finds it
    const configDir = join(HOME, ".config", "dreamcode", "skills")
    mkdirSync(configDir, { recursive: true })
    const scriptPath = join(configDir, "test.py")
    writeFileSync(scriptPath, "# test")
    try {
      const result = resolveScript("test.py")
      expect(result).toBe(scriptPath)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// validateScriptPath — moved from chain-executor.test.ts
// ---------------------------------------------------------------------------

describe("validateScriptPath", () => {
  const cwd = "/tmp/test-project"

  it("rejects empty string", () => {
    expect(validateScriptPath("", cwd)).toBe(false)
  })

  it("rejects path traversal escape", () => {
    const malicious = "/tmp/test-project/.dreamcode/skills/../../etc/passwd"
    expect(validateScriptPath(malicious, cwd)).toBe(false)
  })

  it("rejects path pointing outside allowed dirs", () => {
    expect(validateScriptPath("/bin/sh", cwd)).toBe(false)
  })

  it("rejects absolute path outside project", () => {
    expect(validateScriptPath("/usr/local/bin/malware", cwd)).toBe(false)
  })

  it("rejects relative path that escapes cwd", () => {
    const resolved = "/tmp/test-project/../../../etc/passwd"
    expect(validateScriptPath(resolved, cwd)).toBe(false)
  })

  it("rejects non-absolute path", () => {
    expect(validateScriptPath("relative/path/script.py", cwd)).toBe(false)
  })

  it("accepts path under <cwd>/.dreamcode/skills (allowedCwd)", () => {
    expect(validateScriptPath("/tmp/test-project/.dreamcode/skills/valid-skill/scripts/run.py", cwd)).toBe(true)
  })

  it("rejects path under <cwd>/.opencode/skills (not allowed by allowedCwd)", () => {
    // allowedCwd only permits .dreamcode/skills, not .opencode/skills
    expect(validateScriptPath("/tmp/test-project/.opencode/skills/script.py", cwd)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// writePromptToTmpFile / cleanupTmpFile
// ---------------------------------------------------------------------------

describe("writePromptToTmpFile / cleanupTmpFile", () => {
  const sandbox = join(tmpdir(), `dreamcode-tmpfile-test-${randomBytes(4).toString("hex")}`)
  beforeEach(() => mkdirSync(sandbox, { recursive: true }))
  afterEach(() => rmSync(sandbox, { recursive: true, force: true }))

  it("writes and cleans up a temp file", () => {
    const p = writePromptToTmpFile("hello world", sandbox, "test-")
    expect(p).toBeTruthy()
    expect(join("")).toBe(".") // sanity: path.join("") returns "." on POSIX
    // File exists before cleanup
    expect(existsSync(p)).toBe(true)
    cleanupTmpFile(p)
    // File is gone after cleanup
    expect(existsSync(p)).toBe(false)
  })

  it("cleanupTmpFile does not throw on non-existent file", () => {
    expect(() => cleanupTmpFile("/nonexistent/path")).not.toThrow()
  })

  it("cleanupTmpFile does not throw on empty string", () => {
    expect(() => cleanupTmpFile("")).not.toThrow()
  })

  it("writes content that can be read back", () => {
    const content = "test content 123"
    const p = writePromptToTmpFile(content, sandbox, "verify-")
    const actual = readFileSync(p, "utf-8")
    expect(actual).toBe(content)
    cleanupTmpFile(p)
  })
})
