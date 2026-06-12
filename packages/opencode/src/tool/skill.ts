import { tool } from "ai"
import { z } from "zod"
import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"

const PROJECT_ROOT = process.cwd()
const SKILLS_DIR = path.join(PROJECT_ROOT, ".opencode", "skills")
const SENSOR_GATE = path.join(SKILLS_DIR, "chain-orchestrator", "scripts", "sensor_gate.py")
const CHAIN_LOG = path.join(PROJECT_ROOT, ".opencode", "chain_log.jsonl")
const SCORE_FILE = path.join(PROJECT_ROOT, "evolution", "agent_score.json")

// Load available skills from the 37-skill graph
function getAvailableSkills(): string[] {
  try {
    const skillsPath = path.join(SKILLS_DIR, "chain-orchestrator", "scripts", "sensor_gate.py")
    if (!fs.existsSync(skillsPath)) return []
    const result = execSync(`python3 ${SENSOR_GATE} --list-skills 2>/dev/null || echo ""`, {
      encoding: "utf8",
      timeout: 5000,
    }).trim()
    return result.split("\n").filter(Boolean)
  } catch {
    return [
      "breakthrough-overdrive-innovation",
      "automated-learning",
      "deep-research",
      "neuro",
      "code-hardener",
      "lint-fixer",
      "pieces-ltm",
      "security",
      "testing",
      "debugging",
      "research",
      "documentation",
    ]
  }
}

// Log to chain_log.jsonl
function logSkillExecution(skill: string, result: string, score: number) {
  const entry = {
    timestamp: new Date().toISOString(),
    skill,
    result: result.slice(0, 500),
    score,
    source: "native-tool",
  }
  fs.mkdirSync(path.dirname(CHAIN_LOG), { recursive: true })
  fs.appendFileSync(CHAIN_LOG, JSON.stringify(entry) + "\n")
}

// Record score event
function recordScore(event: string, points: number, details: string) {
  try {
    const scoreDir = path.dirname(SCORE_FILE)
    fs.mkdirSync(scoreDir, { recursive: true })
    let score = { total: 0, history: [] as any[] }
    if (fs.existsSync(SCORE_FILE)) {
      score = JSON.parse(fs.readFileSync(SCORE_FILE, "utf8"))
    }
    score.total += points
    score.history.push({
      timestamp: new Date().toISOString(),
      event,
      points,
      total_after: score.total,
      details,
    })
    // Keep last 100 entries
    score.history = score.history.slice(-100)
    fs.writeFileSync(SCORE_FILE, JSON.stringify(score, null, 2))
  } catch {
    // Silently fail if scoring unavailable
  }
}

export const dreamSkillTool = tool({
  description: `Execute a DreamCode skill from the 37-skill dynamic graph.
MANDATORY: Always run sensor_gate first to classify intent before executing skills.
Available skills include: breakthrough-overdrive-innovation (dream thinking),
automated-learning, deep-research, neuro, code-hardener, lint-fixer, pieces-ltm,
security, testing, debugging, research, documentation.
Score tracking: skill_executed +5, skill_skipped -15, dream_completed +20, dream_skipped -30.`,
  parameters: z.object({
    skill: z.string().describe("Skill name from the 37-skill graph"),
    prompt: z.string().describe("Task prompt to pass to the skill"),
    run_sensor_gate: z.boolean().default(true).describe("Run sensor gate classification first (MANDATORY)"),
  }),
  execute: async ({ skill, prompt, run_sensor_gate }) => {
    const results: string[] = []
    let score = 0

    // MANDATORY: Sensor gate first
    if (run_sensor_gate && fs.existsSync(SENSOR_GATE)) {
      try {
        const gateResult = execSync(
          `python3 ${SENSOR_GATE} --prompt ${JSON.stringify(prompt)} 2>&1 | head -20`,
          { encoding: "utf8", timeout: 15000 }
        )
        results.push(`[SENSOR GATE]\n${gateResult}`)
        score += 10
        recordScore("sensor_gate_run", 10, `Sensor gate executed for skill: ${skill}`)
      } catch (e) {
        results.push(`[SENSOR GATE FAILED]: ${e}`)
        score -= 25
        recordScore("sensor_gate_skipped", -25, `Sensor gate failed: ${e}`)
      }
    }

    // Execute the skill
    const skillDir = path.join(SKILLS_DIR, skill)
    const skillScript = path.join(skillDir, "scripts", `${skill}.py`)
    const skillMd = path.join(skillDir, "SKILL.md")

    if (fs.existsSync(skillScript)) {
      try {
        const skillResult = execSync(
          `python3 ${skillScript} --prompt ${JSON.stringify(prompt)} 2>&1`,
          { encoding: "utf8", timeout: 60000 }
        )
        results.push(`[SKILL: ${skill}]\n${skillResult}`)
        score += 5
        recordScore("skill_executed", 5, `Skill ${skill} executed`)
        if (skill.includes("dream") || skill.includes("breakthrough")) {
          score += 15
          recordScore("dream_completed", 15, "Dream cycle completed")
        }
        logSkillExecution(skill, skillResult, score)
      } catch (e) {
        results.push(`[SKILL ERROR]: ${e}`)
        score -= 15
        recordScore("skill_skipped", -15, `Skill ${skill} failed: ${e}`)
      }
    } else if (fs.existsSync(skillMd)) {
      const content = fs.readFileSync(skillMd, "utf8")
      results.push(`[SKILL LOADED: ${skill}]\n${content.slice(0, 1000)}`)
      score += 5
      recordScore("skill_executed", 5, `Skill ${skill} loaded from SKILL.md`)
    } else {
      results.push(`[SKILL NOT FOUND: ${skill}] Available: ${getAvailableSkills().join(", ")}`)
      score -= 15
      recordScore("skill_skipped", -15, `Skill ${skill} not found`)
    }

    return {
      output: results.join("\n\n"),
      score,
      skill_executed: skill,
      timestamp: new Date().toISOString(),
    }
  },
})

export const dreamSensorGateTool = tool({
  description: `Run the DreamCode sensor gate to classify intent and determine the optimal skill chain.
ALWAYS run this before any non-trivial task. Returns primary skill, chain, and mode.
Score: sensor_gate_run +10, sensor_gate_skipped -25.`,
  parameters: z.object({
    prompt: z.string().describe("The task prompt to classify"),
  }),
  execute: async ({ prompt }) => {
    if (!fs.existsSync(SENSOR_GATE)) {
      recordScore("sensor_gate_skipped", -25, "Sensor gate not found")
      return { error: "Sensor gate not found", score: -25 }
    }
    try {
      const result = execSync(
        `python3 ${SENSOR_GATE} --prompt ${JSON.stringify(prompt)} 2>&1`,
        { encoding: "utf8", timeout: 15000 }
      )
      logSkillExecution("sensor_gate", result, 10)
      recordScore("sensor_gate_run", 10, "Sensor gate executed")
      return { output: result, score: 10, timestamp: new Date().toISOString() }
    } catch (e) {
      recordScore("sensor_gate_skipped", -25, `Sensor gate error: ${e}`)
      return { error: String(e), score: -25 }
    }
  },
})
