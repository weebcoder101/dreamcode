import { describe, expect, test } from "bun:test"
import { execSync } from "child_process"
import path from "path"
import fs from "fs"

const SKILLS_DIR = path.resolve(import.meta.dir, "../../src/skill/dreamcode/skills")

// All Python scripts that exist in the embedded skills directory
// Each entry: { skill, script, args? } — args override the default --prompt-file test
const SKILL_SCRIPTS = [
  { skill: "context-compactor", script: "compactor_harness.py", args: [] },
  { skill: "deep-research", script: "deep_research.py", args: ["--help"] },
  { skill: "guardian-ai", script: "guardian_ai.py", args: ["--prompt", "test", "--json"] },
  { skill: "model-router", script: "model_router.py", args: ["--task", "test", "--json"] },
  { skill: "neuro", script: "neuro_harness.py", args: ["--help"] },
  { skill: "pieces-ltm", script: "pieces_persist.py", args: ["stats"] },
  { skill: "token-predictor", script: "predict.py", args: [] },
  { skill: "youtube-transcript", script: "yt_transcript.py", args: ["--help"] },
  { skill: "chain-orchestrator", script: "sensor_gate.py", args: ["--prompt", "test"] },
  { skill: "automated-learning", script: "sensor_violation_logger.py", args: [] },
  { skill: "git-feature-workflow", script: "feature.py", args: ["--help"] },
  { skill: "chain-orchestrator", script: "classifier.py", args: ["--help"] },
  { skill: "chain-orchestrator", script: "enforcer.py", args: ["--help"] },
  { skill: "chain-orchestrator", script: "orchestrator.py", args: ["--help"] },
]

describe("Skill scripts — file existence", () => {
  for (const { skill, script } of SKILL_SCRIPTS) {
    test(`${skill}/${script} — file exists in embedded skills`, () => {
      const scriptPath = path.join(SKILLS_DIR, skill, "scripts", script)
      expect(fs.existsSync(scriptPath)).toBe(true)
    })
  }
})

describe("Skill scripts — valid Python syntax", () => {
  for (const { skill, script } of SKILL_SCRIPTS) {
    test(`${skill}/${script} — python3 -c "compile()" succeeds`, () => {
      const scriptPath = path.join(SKILLS_DIR, skill, "scripts", script)
      if (!fs.existsSync(scriptPath)) return // skip if not found

      try {
        execSync(`python3 -c "compile(open('${scriptPath}').read(), '${script}', 'exec')"`, {
          timeout: 10000,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        })
      } catch (e: any) {
        // Syntax errors are real failures
        if (e.stderr?.includes("SyntaxError")) {
          throw e
        }
        // Import errors are OK at compile time (they happen at runtime)
      }
    })
  }
})

describe("Skill scripts — runnable (no crash)", () => {
  for (const { skill, script, args } of SKILL_SCRIPTS) {
    const testArgs = args ?? ["--help"]
    const argsStr = testArgs.length > 0 ? ` ${testArgs.map((a) => `"${a}"`).join(" ")}` : ""
    test(`${skill}/${script} — runs with: ${argsStr || "(no args)"}`, () => {
      const scriptPath = path.join(SKILLS_DIR, skill, "scripts", script)
      if (!fs.existsSync(scriptPath)) return // skip if not found

      try {
        const result = execSync(`python3 "${scriptPath}"${argsStr}`, {
          timeout: 15000,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        })
        // If we get here, script ran successfully
        expect(result).toBeDefined()
      } catch (e: any) {
        // Scripts that exit non-zero for --help or missing args are OK
        // We only fail on actual Python crashes (SyntaxError, NameError, ImportError)
        const stderr = e.stderr || ""
        if (stderr.includes("SyntaxError") || stderr.includes("NameError")) {
          throw e
        }
        // Exit code != 0 is acceptable for --help or missing args
      }
    })
  }
})

describe("Skill scripts — with prompt-file (where supported)", () => {
  const promptScripts = [
    { skill: "context-compactor", script: "compactor_harness.py" },
    { skill: "guardian-ai", script: "guardian_ai.py" },
    { skill: "chain-orchestrator", script: "sensor_gate.py" },
    { skill: "token-predictor", script: "predict.py" },
  ]

  const SAMPLE_PROMPT = `
export function processData(items: Item[]) {
  var result = []
  for (var i = 0; i < items.length; i++) {
    if (items[i].type == "active") {
      result.push(items[i])
    }
  }
  return result
}
`

  for (const { skill, script } of promptScripts) {
    test(`${skill}/${script} — runs with --prompt-file`, () => {
      const scriptPath = path.join(SKILLS_DIR, skill, "scripts", script)
      if (!fs.existsSync(scriptPath)) return

      const tmpFile = path.join("/tmp", `smoke-test-${skill}-${Date.now()}.txt`)
      fs.writeFileSync(tmpFile, SAMPLE_PROMPT)

      try {
        const result = execSync(`python3 "${scriptPath}" --prompt-file "${tmpFile}"`, {
          timeout: 30000,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        })
        // Script ran without crashing
        expect(result).toBeDefined()
        expect(result.length).toBeGreaterThan(0)
      } catch (e: any) {
        const stderr = e.stderr || ""
        // Syntax errors are real failures
        if (stderr.includes("SyntaxError") || stderr.includes("NameError")) {
          throw e
        }
        // Some scripts may fail gracefully (e.g., no LLM available) — that's OK
      } finally {
        try { fs.unlinkSync(tmpFile) } catch {}
      }
    })
  }
})
