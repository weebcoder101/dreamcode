import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import * as fs from "fs"
import * as path from "path"
import { execFileSync } from "child_process"
import DESCRIPTION from "./skill.txt"

const PROJECT_ROOT = process.cwd()
const SKILLS_DIR = path.join(PROJECT_ROOT, ".dreamcode", "skills")
const SENSOR_GATE = path.join(SKILLS_DIR, "chain-orchestrator", "scripts", "sensor_gate.py")
const CHAIN_LOG = path.join(PROJECT_ROOT, ".dreamcode", "chain_log.jsonl")
const SCORE_FILE = path.join(PROJECT_ROOT, "evolution", "agent_score.json")

function getAvailableSkills(): string[] {
  try {
    if (!fs.existsSync(SENSOR_GATE)) return []
    const result = execFileSync("python3", [SENSOR_GATE, "--list-skills"], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
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
    score.history = score.history.slice(-100)
    fs.writeFileSync(SCORE_FILE, JSON.stringify(score, null, 2))
  } catch {
    // Silently fail if scoring unavailable
  }
}

export const Parameters = Schema.Struct({
  skill: Schema.String.annotate({ description: "Skill name from the 37-skill graph" }),
  prompt: Schema.String.annotate({ description: "Task prompt to pass to the skill" }),
  run_sensor_gate: Schema.optional(Schema.Boolean).annotate({
    description: "Run sensor gate classification first (default: true, MANDATORY)",
  }),
})

type Metadata = {
  skill_executed: string
  score: number
}

export const SkillTool = Tool.define<typeof Parameters, Metadata>(
  "skill",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const results: string[] = []
          let score = 0
          const runGate = params.run_sensor_gate !== false

          if (runGate && fs.existsSync(SENSOR_GATE)) {
            try {
              const gateResult = execFileSync(
                "python3",
                [SENSOR_GATE, "--prompt", params.prompt],
                { encoding: "utf8", timeout: 15000, stdio: ["pipe", "pipe", "pipe"] }
              )
              results.push(`[SENSOR GATE]\n${gateResult}`)
              score += 10
              recordScore("sensor_gate_run", 10, `Sensor gate executed for skill: ${params.skill}`)
            } catch (e) {
              results.push(`[SENSOR GATE FAILED]: ${e}`)
              score -= 25
              recordScore("sensor_gate_skipped", -25, `Sensor gate failed: ${e}`)
            }
          }

          const skillDir = path.join(SKILLS_DIR, params.skill)
          const skillScript = path.join(skillDir, "scripts", `${params.skill}.py`)
          const skillMd = path.join(skillDir, "SKILL.md")

          if (fs.existsSync(skillScript)) {
            try {
              const skillResult = execFileSync(
                "python3",
                [skillScript, "--prompt", params.prompt],
                { encoding: "utf8", timeout: 60000, stdio: ["pipe", "pipe", "pipe"] }
              )
              results.push(`[SKILL: ${params.skill}]\n${skillResult}`)
              score += 5
              recordScore("skill_executed", 5, `Skill ${params.skill} executed`)
              if (params.skill.includes("dream") || params.skill.includes("breakthrough")) {
                score += 15
                recordScore("dream_completed", 15, "Dream cycle completed")
              }
              logSkillExecution(params.skill, skillResult, score)
            } catch (e) {
              results.push(`[SKILL ERROR]: ${e}`)
              score -= 15
              recordScore("skill_skipped", -15, `Skill ${params.skill} failed: ${e}`)
            }
          } else if (fs.existsSync(skillMd)) {
            const content = fs.readFileSync(skillMd, "utf8")
            results.push(`[SKILL LOADED: ${params.skill}]\n${content.slice(0, 1000)}`)
            score += 5
            recordScore("skill_executed", 5, `Skill ${params.skill} loaded from SKILL.md`)
          } else {
            results.push(`[SKILL NOT FOUND: ${params.skill}] Available: ${getAvailableSkills().join(", ")}`)
            score -= 15
            recordScore("skill_skipped", -15, `Skill ${params.skill} not found`)
          }

          return {
            title: `Executed skill: ${params.skill}`,
            output: results.join("\n\n"),
            metadata: {
              skill_executed: params.skill,
              score,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
