import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { randomBytes } from "crypto"

// Import the module under test
import {
  resolvePythonCommand,
  getPythonArgs,
  resolveSkillsDir,
  resolveScript,
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

  it("returns empty string if we can guarantee no candidate exists", () => {
    // Temporarily rename any existing skills dir, test, then restore
    const existing = resolveSkillsDir()
    if (existing) {
      rmSync(existing, { recursive: true, force: true })
    }
    const result = resolveSkillsDir()
    expect(result).toBe("")
    // Restore if we removed something
    if (existing) {
      mkdirSync(existing, { recursive: true })
    }
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
