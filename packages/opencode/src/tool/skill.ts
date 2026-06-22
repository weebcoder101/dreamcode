/**
 * @deprecated Use the core skill tool from @opencode-ai/core/tool/skill instead.
 * This module is retained as a compatibility shim during migration.
 * TODO: Remove this file entirely once migration to core skill system is complete.
 *
 * IMPORTANT: This file provides an ALTERNATE execution path that double-executes
 * skills when the core skill system (src/skill/index.ts) is also loaded.
 * Guard against this with a lazy runtime check in the execute function.
 */
import { Effect, Schema, Duration, Ref } from "effect"
import * as Tool from "./tool"
import * as path from "path"
import * as fs from "fs"
import DESCRIPTION from "./skill.txt"
import { resolvePythonCommand, getPythonArgs, resolveSkillsDir as resolveSkillsDirImpl } from "@/skill/python-resolver"

const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp"

// Re-export resolveSkillsDir from python-resolver
const resolveSkillsDir = resolveSkillsDirImpl

const SKILLS_DIR = resolveSkillsDir()
const CHAIN_LOG = path.join(HOME, ".dreamcode", "chain_log.jsonl")
const SCORE_FILE = path.join(HOME, ".dreamcode", "evolution", "agent_score.json")
const ERROR_LOG = path.join(HOME, ".dreamcode", "error_log.jsonl")

function findSensorGate(): string | undefined {
  const candidates = [
    path.join(SKILLS_DIR, "chain-orchestrator", "scripts", "sensor_gate.py"),
    path.join(process.cwd(), ".dreamcode", "skills", "chain-orchestrator", "scripts", "sensor_gate.py"),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch {}
  }
  return undefined
}

const SENSOR_GATE = findSensorGate()

function getAvailableSkills(): string[] {
  try {
    if (fs.existsSync(SKILLS_DIR)) {
      return fs.readdirSync(SKILLS_DIR).filter((d) => {
        try {
          return fs.statSync(path.join(SKILLS_DIR, d)).isDirectory()
        } catch {
          return false
        }
      })
    }
  } catch {}
  return []
}

function logSkillExecution(skill: string, result: string, score: number) {
  const entry = {
    timestamp: new Date().toISOString(),
    skill,
    result: result.slice(0, 500),
    score,
    source: "native-tool",
  }
  try {
    fs.mkdirSync(path.dirname(CHAIN_LOG), { recursive: true })
    fs.appendFileSync(CHAIN_LOG, JSON.stringify(entry) + "\n")
  } catch {}
}

function sanitizeMessage(raw: string): string {
  return raw
    .replace(/(sk-[a-zA-Z0-9]{20,})/g, "sk-…[REDACTED]")
    .replace(/(ghp_|gho_|github_pat_)[a-zA-Z0-9_]{36,}/g, "[REDACTED TOKEN]")
    .replace(/(Authorization:\s*Bearer\s+)[a-zA-Z0-9_\-\.]+/gi, "$1[REDACTED]")
    .replace(/(api[-_]?key[-_]?["']?:\s*["']?)[a-zA-Z0-9_\-\.]{16,}/gi, "$1[REDACTED]")
}

function logError(source: string, error: unknown) {
  try {
    const message = sanitizeMessage(error instanceof Error ? error.message : String(error))
    const entry = {
      timestamp: new Date().toISOString(),
      source,
      message,
    }
    fs.mkdirSync(path.dirname(ERROR_LOG), { recursive: true })
    fs.appendFileSync(ERROR_LOG, JSON.stringify(entry) + "\n")
  } catch {
    // Silently fail if error logging unavailable
  }
}

const scoreLock = Effect.runSync(Ref.make(true))

function recordScore(event: string, points: number, details: string) {
  Effect.runSync(Effect.gen(function* () {
    yield* Ref.getAndSet(scoreLock, false)
    try {
      const scoreDir = path.dirname(SCORE_FILE)
      fs.mkdirSync(scoreDir, { recursive: true })
      let score = { total: 0, history: [] as Array<{ timestamp: string; event: string; points: number; total_after: number; details: string }> }
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
    } finally {
      yield* Ref.set(scoreLock, true)
    }
  }))
}

function sanitizeSensorGateOutput(raw: string): string {
  const lines = raw.split("\n")
    .filter(line => !line.startsWith("[SENSOR]") && !line.startsWith("[GUARDIAN]") && !line.startsWith("[ENFORCEMENT]") && !line.startsWith("[AGENTS.md]"))
    .filter(line => !line.startsWith("Skill Plan:") && !line.startsWith("=") && !line.includes("AGENT INSTRUCTIONS"))
    .map(line => line.trim())
    .filter(trimmed => trimmed.startsWith("- intent:") || trimmed.startsWith("- primary:") || trimmed.startsWith("- supports:") || trimmed.startsWith("- mode:") || trimmed.startsWith("- chain:") || trimmed.startsWith("- decision:") || trimmed.startsWith("- risk_level:"))
  return lines.length > 0 ? lines.join("\n") : "Sensor gate completed (internal details suppressed)"
}

// Phase 3: Async version of sensor gate using ChildProcessSpawner
// Prompt is written to a temp file instead of stdin pipe to avoid Bun.spawn
// Unix socket EOF issue in compiled binaries.
const runSensorGateAsync = Effect.fn("SkillTool.runSensorGate")(function* (prompt: string) {
  if (!SENSOR_GATE || !fs.existsSync(SENSOR_GATE)) return ""
  const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp"
  const tmpBase = process.env.XDG_RUNTIME_DIR
    ? path.join(process.env.XDG_RUNTIME_DIR, "dreamcode")
    : path.join(HOME, ".dreamcode", "tmp")
  let tmpDir = ""
  let tmpFile = ""
  try {
    fs.mkdirSync(tmpBase, { recursive: true })
    tmpDir = fs.mkdtempSync(path.join(tmpBase, "sg-"))
    fs.chmodSync(tmpDir, 0o700)
    tmpFile = path.join(tmpDir, "prompt.txt")
    fs.writeFileSync(tmpFile, prompt, "utf-8")
  } catch {
    tmpFile = ""
  }
  // Cross-platform Python resolution
  const pythonCmd = resolvePythonCommand()
  const versionArgs = getPythonArgs()
  const args = tmpFile
    ? [pythonCmd, ...versionArgs, SENSOR_GATE!, "--prompt-file", tmpFile]
    : [pythonCmd, ...versionArgs, SENSOR_GATE!, "--prompt", prompt]
  return yield* Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
      })
      const text = await proc.stdout.text()
      await proc.exited
      // Clean up temp file
      if (tmpFile) {
        try { fs.unlinkSync(tmpFile) } catch {}
        try { fs.rmdirSync(tmpDir) } catch {}
      }
      return text || ""
    },
    catch: (err) => {
      // Clean up temp file on error too
      if (tmpFile) {
        try { fs.unlinkSync(tmpFile) } catch {}
        try { fs.rmdirSync(tmpDir) } catch {}
      }
      return new Error(String(err))
    },
  }).pipe(
    Effect.timeout(Duration.seconds(200)),
    Effect.catch(() => Effect.succeed("")),
  )
})

// Phase 3: Async version of skill script execution
// Prompt is written to a temp file instead of stdin pipe to avoid Bun.spawn
// Unix socket EOF issue in compiled binaries.
const runSkillScriptAsync = Effect.fn("SkillTool.runSkillScript")(function* (script: string, prompt: string) {
  const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp"
  const tmpBase = process.env.XDG_RUNTIME_DIR
    ? path.join(process.env.XDG_RUNTIME_DIR, "dreamcode")
    : path.join(HOME, ".dreamcode", "tmp")
  let tmpDir = ""
  let tmpFile = ""
  try {
    fs.mkdirSync(tmpBase, { recursive: true })
    tmpDir = fs.mkdtempSync(path.join(tmpBase, "sk-"))
    fs.chmodSync(tmpDir, 0o700)
    tmpFile = path.join(tmpDir, "prompt.txt")
    fs.writeFileSync(tmpFile, prompt, "utf-8")
  } catch {
    tmpFile = ""
  }
  // Cross-platform Python resolution
  const pythonCmd = resolvePythonCommand()
  const versionArgs = getPythonArgs()
  const args = tmpFile
    ? [pythonCmd, ...versionArgs, script, "--prompt-file", tmpFile]
    : [pythonCmd, ...versionArgs, script, "--prompt", prompt]
  return yield* Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
      })
      const text = await proc.stdout.text()
      await proc.exited
      // Clean up temp file
      if (tmpFile) {
        try { fs.unlinkSync(tmpFile) } catch {}
        try { fs.rmdirSync(tmpDir) } catch {}
      }
      return text || ""
    },
    catch: (err) => {
      // Clean up temp file on error too
      if (tmpFile) {
        try { fs.unlinkSync(tmpFile) } catch {}
        try { fs.rmdirSync(tmpDir) } catch {}
      }
      return new Error(String(err))
    },
  }).pipe(
    Effect.timeout(Duration.seconds(200)),
    Effect.catch(() => Effect.succeed("")),
  )
})

export const Parameters = Schema.Struct({
  name: Schema.String.annotate({ description: "Skill name from the 37-skill graph" }),
  skill: Schema.optional(Schema.String).annotate({ description: "Skill name (deprecated, use name)" }),
  prompt: Schema.String.annotate({ description: "Task prompt to pass to the skill" }),
  run_sensor_gate: Schema.optional(Schema.Boolean).annotate({
    description: "Run sensor gate classification first (default: false — classification already performed upstream)",
  }),
})

type Metadata = {
  skill_executed: string
  score: number
}

// Phase 4: Re-export shim. This tool is @deprecated in favor of core's SkillTool.
// New code should import from @opencode-ai/core/tool/skill directly.
// The local copy is retained for backward compatibility during migration.
export const SkillTool = Tool.define<typeof Parameters, Metadata, never>(
  "skill",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          // ─── Runtime Guard ─────────────────────────────────────────
          // Prevent dual execution when core skill system is active.
          // The deprecated tool uses a separate execution path (Bun.spawn, file I/O,
          // Evolution score files) that conflicts with the core skill service.
          // This lazy check avoids module-level circular imports.
          try {
            const { Skill } = yield* Effect.promise(async () => await import("@/skill"))
            if (typeof Skill?.Service === "function") {
              return {
                title: `Skill: ${params.name ?? params.skill ?? ""}`,
                output: "[SKILL TOOL: deprecated — delegated to core skill system]",
                metadata: { skill_executed: "", score: 0 },
              }
            }
          } catch {}

          const results: string[] = []
          let score = 0
          const skillName = params.name ?? params.skill ?? ""
          const runGate = params.run_sensor_gate

          // Phase 2 + Phase 3: Only run sensor gate if explicitly requested
          if (runGate && SENSOR_GATE && fs.existsSync(SENSOR_GATE)) {
            try {
              const gateResult = yield* runSensorGateAsync(params.prompt)
              if (gateResult) {
                results.push(`[SENSOR GATE]\n${sanitizeSensorGateOutput(gateResult)}`)
                score += 10
                recordScore("sensor_gate_run", 10, `Sensor gate executed for skill: ${skillName}`)
              } else {
                throw new Error("Sensor gate returned empty result")
              }
            } catch (e) {
              logError("sensor_gate", e)
              results.push(`[SENSOR GATE: skipped (logged)]`)
              score -= 25
              recordScore("sensor_gate_skipped", -25, "Sensor gate failed — see error_log.jsonl")
            }
          }

          const skillDir = path.join(SKILLS_DIR, skillName)
          const skillScript = path.join(skillDir, "scripts", `${skillName}.py`)
          const skillMd = path.join(skillDir, "SKILL.md")

          if (fs.existsSync(skillScript)) {
            try {
              const skillResult = yield* runSkillScriptAsync(skillScript, params.prompt)
              results.push(`[SKILL: ${skillName}]\n${skillResult}`)
              score += 5
              recordScore("skill_executed", 5, `Skill ${skillName} executed`)
              if (skillName.includes("dream") || skillName.includes("breakthrough")) {
                score += 15
                recordScore("dream_completed", 15, "Dream cycle completed")
              }
              logSkillExecution(skillName, skillResult, score)
            } catch (e) {
              logError(`skill:${skillName}`, e)
              results.push(`[SKILL: ${skillName} — failed (logged)]`)
              score -= 15
              recordScore("skill_skipped", -15, `Skill ${skillName} failed — see error_log.jsonl`)
            }
          } else if (fs.existsSync(skillMd)) {
            const content = fs.readFileSync(skillMd, "utf8")
            results.push(`[SKILL LOADED: ${skillName}]\n${content}`)
            score += 5
            recordScore("skill_executed", 5, `Skill ${skillName} loaded from SKILL.md`)
          } else {
            results.push(`[SKILL NOT FOUND: ${skillName}] Available: ${getAvailableSkills().join(", ")}`)
            score -= 15
            recordScore("skill_skipped", -15, `Skill ${skillName} not found`)
          }

          return {
            title: `Executed skill: ${skillName}`,
            output: results.join("\n\n"),
            metadata: {
              skill_executed: skillName,
              score,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
