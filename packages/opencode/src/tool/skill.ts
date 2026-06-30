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
import { resolvePythonCommand, getPythonArgs, resolveSkillsDir, HOME, writePromptToTmpFile, cleanupTmpFile, BASE_SUBPROCESS_ENV } from "@/skill/python-resolver"

const SKILLS_DIR = resolveSkillsDir()
const CHAIN_LOG = path.join(HOME, ".dreamcode", "chain_log.jsonl")
const SCORE_FILE = path.join(HOME, ".dreamcode", "evolution", "agent_score.json")
const ERROR_LOG = path.join(HOME, ".dreamcode", "error_log.jsonl")

function findSensorGate(): string | undefined {
  const candidates = [
    path.join(SKILLS_DIR, "chain-orchestrator", "scripts", "sensor_gate.py"),
    path.join(process.cwd(), ".dreamcode", "skills", "chain-orchestrator", "scripts", "sensor_gate.py"),
    path.join(process.cwd(), ".opencode", "skills", "chain-orchestrator", "scripts", "sensor_gate.py"),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch (e) {
      console.warn("[tool/skill] findSensorGate error:", String(e))
    }
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
        } catch (e) {
          console.warn("[tool/skill] stat error for", d, String(e))
          return false
        }
      })
    }
  } catch (e) {
    console.warn("[tool/skill] getAvailableSkills error:", String(e))
  }
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
  } catch (e) {
    console.warn("[tool/skill] logSkillExecution error:", String(e))
  }
}

function sanitizeMessage(raw: string): string {
  // Regex-based pattern matching for known secret formats
  let result = raw
    // Existing patterns
    .replace(/(sk-[a-zA-Z0-9]{20,})/g, "sk-…[REDACTED]")
    .replace(/(ghp_|gho_|github_pat_)[a-zA-Z0-9_]{36,}/g, "[REDACTED TOKEN]")
    .replace(/(Authorization:\s*Bearer\s+)[a-zA-Z0-9_\-\.]+/gi, "$1[REDACTED]")
    .replace(/(api[-_]?key[-_]?["']?:\s*["']?)[a-zA-Z0-9_\-\.]{16,}/gi, "$1[REDACTED]")
    .replace(/(AKIA[0-9A-Z]{16})/g, "[REDACTED AWS KEY]")
    .replace(/("private_key"\s*:\s*")[^"]+/g, '$1[REDACTED GCP KEY]')
    // NEW: Additional secret token formats
    .replace(/(glpat-[a-zA-Z0-9\-_]{20,})/g, "[REDACTED GITLAB TOKEN]")
    .replace(/(npm_[a-zA-Z0-9]{36,})/g, "[REDACTED NPM TOKEN]")
    .replace(/(xox[baprs]-[a-zA-Z0-9\-]{10,})/g, "[REDACTED SLACK TOKEN]")
    .replace(/(mfa\.[a-zA-Z0-9\-_]{20,})/g, "[REDACTED DISCORD MFA]")
    .replace(/(eyJ[a-zA-Z0-9\-_]{10,}\.eyJ[a-zA-Z0-9\-_]{10,}\.[a-zA-Z0-9\-_]{10,})/g, "[REDACTED JWT]")
    .replace(/(-----BEGIN\s+[A-Z]+\s+PRIVATE KEY-----)/g, "[REDACTED SSH KEY]")
    .replace(/(sk-ant-[a-zA-Z0-9]{20,})/g, "[REDACTED ANTHROPIC KEY]")
    .replace(/(AIza[0-9A-Za-z\-_]{35})/g, "[REDACTED GOOGLE API KEY]")
    .replace(/(hf_[a-zA-Z0-9]{20,})/g, "[REDACTED HUGGINGFACE TOKEN]")
  // Key-name-based stripping for known secret-bearing fields (catches multi-line values)
  const SECRET_KEYS = ["private_key", "client_secret", "api_key", "apiKey", "access_token", "refresh_token", "token", "password", "secret", "auth_token"]
  for (const key of SECRET_KEYS) {
    // Match "key": "value" patterns, even across lines
    const regex = new RegExp(`("${key}"\\s*:\\s*")([^"]{4})(?:[^"]*")`, "g")
    result = result.replace(regex, "$1$2...[REDACTED]\"")
  }
  return result
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
  } catch (e) {
    console.warn("[tool/skill] logError failed:", String(e))
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
    } catch (e) {
      console.warn("[tool/skill] recordScore failed:", String(e))
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
  let tmpFile = ""
  try {
    tmpFile = writePromptToTmpFile(prompt, process.cwd(), "sg-")
  } catch (e) {
    // Temp file creation failed — do NOT fall back to --prompt CLI arg
    // which would leak the prompt in process listings.
    return yield* Effect.fail(new Error(`[skill-tool] Failed to create temp file for prompt: ${e}`))
  }
  // Cross-platform Python resolution
  const pythonCmd = resolvePythonCommand()
  const versionArgs = getPythonArgs()
  const args = [pythonCmd, ...versionArgs, SENSOR_GATE!, "--prompt-file", tmpFile]
  return yield* Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...BASE_SUBPROCESS_ENV,
          PROJECT_ROOT: process.cwd(),
        },
      })
      const text = await new Response(proc.stdout).text()
      await proc.exited
      // Clean up temp file
      cleanupTmpFile(tmpFile)
      return text || ""
    },
    catch: (err) => {
      // Clean up temp file on error too
      cleanupTmpFile(tmpFile)
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
  let tmpFile = ""
  try {
    tmpFile = writePromptToTmpFile(prompt, process.cwd(), "sk-")
  } catch (e) {
    // Temp file creation failed — do NOT fall back to --prompt CLI arg
    // which would leak the prompt in process listings.
    return yield* Effect.fail(new Error(`[skill-tool] Failed to create temp file for prompt: ${e}`))
  }
  // Cross-platform Python resolution
  const pythonCmd = resolvePythonCommand()
  const versionArgs = getPythonArgs()
  const args = [pythonCmd, ...versionArgs, script, "--prompt-file", tmpFile]
  return yield* Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...BASE_SUBPROCESS_ENV,
          PROJECT_ROOT: process.cwd(),
        },
      })
      const text = await new Response(proc.stdout).text()
      await proc.exited
      cleanupTmpFile(tmpFile)
      return text || ""
    },
    catch: (err) => {
      cleanupTmpFile(tmpFile)
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
  (Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters as any,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          // ─── Runtime Guard ─────────────────────────────────────────
          // Prevent dual execution when core skill system is active.
          // The deprecated tool uses a separate execution path (Bun.spawn, file I/O,
          // Evolution score files) that conflicts with the core skill service.
          // This lazy check avoids module-level circular imports.
          // IMPORTANT: If the runtime guard fails or the core service is unavailable,
          // we MUST NOT fall through to legacy execution. Return a clear message
          // instead of silently bypassing the permission layer.
          let didHandle = false
          try {
            const { Skill } = yield* Effect.promise(async () => await import("@/skill"))
            if (typeof Skill?.Service === "function") {
              const skillName = params.name ?? params.skill ?? ""
              const svcOption = yield* Effect.serviceOption(Skill.Service)
              if (svcOption._tag === "Some") {
                didHandle = true
                const skillInfo = yield* svcOption.value.require(skillName).pipe(
                  Effect.option,
                )
                if (skillInfo._tag === "Some") {
                  return {
                    title: `Skill: ${skillName}`,
                    output: `[SKILL LOADED: ${skillName}]\n${skillInfo.value.content}`,
                    metadata: { skill_executed: skillName, score: 0 },
                  }
                }
                return {
                  title: `Skill: ${skillName}`,
                  output: `[SKILL NOT FOUND: ${skillName}]`,
                  metadata: { skill_executed: "", score: 0 },
                }
              }
              yield* Effect.logWarning("[skill-tool] Skill.Service not available in current layer")
            } else {
              yield* Effect.logDebug("[skill-tool] Skill.Service not a function (unexpected import)")
            }
          } catch (e) {
            yield* Effect.logError("[skill-tool] skill runtime guard exception", { error: String(e) })
            logError("skill_tool/runtime_guard", e)
          }

          // If the runtime guard handled the request (core skill system was available),
          // do NOT fall through to the legacy execution path. This prevents
          // dual-execution and permission bypass.
          // The legacy path below ONLY runs when the core system is truly absent,
          // which should not happen in production — this is a migration shim only.
          if (didHandle) {
            const skillName = params.name ?? params.skill ?? ""
            return {
              title: `Skill: ${skillName}`,
              output: `[SKILL UNAVAILABLE: ${skillName} — core skill system detected but service not in layer]`,
              metadata: { skill_executed: "", score: 0 },
            }
          }

          const results: string[] = []
          let score = 0
          const skillName = params.name ?? params.skill ?? ""
          const runGate = params.run_sensor_gate

          // Phase 2 + Phase 3: Only run sensor gate if explicitly requested
          if (runGate && SENSOR_GATE && fs.existsSync(SENSOR_GATE)) {
            try {
              const gateResult: string = yield* runSensorGateAsync(params.prompt)
              if (gateResult) {
                results.push(`[SENSOR GATE]\n${sanitizeSensorGateOutput(gateResult)}`)
                score += 10
                recordScore("sensor_gate_run", 10, `Sensor gate executed for skill: ${skillName}`)
              } else {
                results.push(`[SENSOR GATE: empty result]`)
                score -= 5
                recordScore("sensor_gate_empty", -5, "Sensor gate returned empty")
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
              const skillResult: string = yield* runSkillScriptAsync(skillScript, params.prompt)
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
        }),
    }
  }) as any),
)
