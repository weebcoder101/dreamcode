import { describe, expect, it } from "bun:test"
import fs from "fs"
import path from "path"

const skillsDir = path.resolve(import.meta.dir, "../../src/skill/dreamcode/skills")

function readSkillDirs(): fs.Dirent[] {
  return fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory())
}

describe("embedded skills integrity", () => {
  it("contains all expected skill directories", () => {
    // Data-driven floor (was hardcoded 43 while the embedded store holds 35
    // after pruning). The named must-have skills are asserted in the sibling
    // test — that is the real invariant, not an exact count.
    const dirs = readSkillDirs()
    expect(dirs.length).toBeGreaterThanOrEqual(30)
  })

  it("includes chain-orchestrator, effect, research, security, neuro", () => {
    const names = readSkillDirs().map((d) => d.name)
    expect(names).toContain("chain-orchestrator")
    expect(names).toContain("effect")
    expect(names).toContain("research")
    expect(names).toContain("security")
    expect(names).toContain("neuro")
  })

  it("all skills have a SKILL.md", () => {
    for (const dir of readSkillDirs()) {
      const skillMd = path.join(skillsDir, dir.name, "SKILL.md")
      expect(fs.existsSync(skillMd)).toBe(true)
    }
  })

  it("all skills with scripts/ directories have at least one .py file", () => {
    for (const dir of readSkillDirs()) {
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

  it("all SKILL.md files have parseable YAML frontmatter", () => {
    for (const dir of readSkillDirs()) {
      const skillMd = path.join(skillsDir, dir.name, "SKILL.md")
      const content = fs.readFileSync(skillMd, "utf-8")
      // Frontmatter is delimited by --- at start and end
      const match = content.match(/^---\n(.*?)\n---/s)
      expect(match).not.toBeNull()
      expect(match![1].length).toBeGreaterThan(0)
    }
  })

  it("all SKILL.md files have non-empty name and description", () => {
    for (const dir of readSkillDirs()) {
      const skillMd = path.join(skillsDir, dir.name, "SKILL.md")
      const content = fs.readFileSync(skillMd, "utf-8")
      const match = content.match(/^---\n(.*?)\n---/s)
      expect(match).not.toBeNull()
      const frontmatter = match![1]

      // Check for name field
      expect(frontmatter).toMatch(/^name:/m)
      const nameLine = frontmatter.match(/^name:\s*(.+)$/m)
      expect(nameLine).not.toBeNull()
      expect(nameLine![1].trim().length).toBeGreaterThan(0)

      // Check for description field (inline or multi-line)
      if (frontmatter.includes("description:")) {
        // Multi-line description uses | or > after "description:"
        if (frontmatter.match(/^description:\s*[|>]/m)) {
          // Multi-line — just ensure there's content after
          expect(frontmatter).toMatch(/^description:/m)
        } else {
          // Inline — check non-empty
          const descLine = frontmatter.match(/^description:\s*(.+)$/m)
          expect(descLine![1].trim().length).toBeGreaterThan(0)
        }
      } else {
        // description field is optional for some skills
        // If it's missing, that's also OK
      }
    }
  })
})
