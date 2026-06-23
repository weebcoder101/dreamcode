import { describe, expect, it } from "bun:test"
import fs from "fs"
import path from "path"

const skillsDir = path.resolve(import.meta.dir, "../../src/skill/dreamcode/skills")

describe("embedded skills integrity", () => {
  it("contains all 38 expected skill directories", () => {
    const dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory())
    expect(dirs.length).toBe(38)
  })

  it("includes chain-orchestrator, effect, research, security, neuro", () => {
    const names = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    expect(names).toContain("chain-orchestrator")
    expect(names).toContain("effect")
    expect(names).toContain("research")
    expect(names).toContain("security")
    expect(names).toContain("neuro")
  })

  it("all skills have a SKILL.md", () => {
    const dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory())
    for (const dir of dirs) {
      const skillMd = path.join(skillsDir, dir.name, "SKILL.md")
      expect(fs.existsSync(skillMd)).toBe(true)
    }
  })

  it("all skills with scripts/ directories have at least one .py file", () => {
    const dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory())
    for (const dir of dirs) {
      const scriptsDir = path.join(skillsDir, dir.name, "scripts")
      if (fs.existsSync(scriptsDir)) {
        const pyFiles = fs.readdirSync(scriptsDir).filter((f) => f.endsWith(".py"))
        expect(pyFiles.length).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it("chain-orchestrator has orchestrator.py and sensor_gate.py", () => {
    const scriptsDir = path.join(skillsDir, "chain-orchestrator", "scripts")
    const pyFiles = fs.readdirSync(scriptsDir).filter((f) => f.endsWith(".py"))
    expect(pyFiles).toContain("orchestrator.py")
    expect(pyFiles).toContain("sensor_gate.py")
  })
})
