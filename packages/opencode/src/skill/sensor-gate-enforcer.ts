/**
 * Sensor Gate Enforcer Plugin
 *
 * Integrates the sensor gate system with the plugin lifecycle:
 * - 45s periodic timer check on `chat.message`
 * - Token predictor / shipping checklist question generation
 * - NEURO enrichment when available
 * - Circuit breaker for execution safety (shared with TokenPredictor singleton)
 *
 * This plugin hooks into `chat.message` to trigger periodic checks
 * and `experimental.chat.system.transform` to inject questions.
 *
 * State is per-session via a Map keyed by projectRoot to avoid
 * cross-session contamination in multi-directory environments.
 */

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { resetPeriodicTimer, predictorBreaker } from "./token-predictor.js"
import { resolvePythonCommand, resolveSkillsDir, getPythonArgs, writePromptToTmpFile, cleanupTmpFile, validateScriptPath, BASE_SUBPROCESS_ENV } from "./python-resolver.js"
import path from "path"
import { COMPLEXITY_SPAWN_MAP, parseComplexityLevel, type ComplexityLevel } from "./question-complexity-schema.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PredictorResult {
  questions: Array<{ question: string; complexity: string }>
  max_complexity: string
  context_hash: string
  signals: Record<string, boolean>
  project_context: string
  timestamp: string
}

interface SessionState {
  lastPrompt: string
  lastQuestions: Array<{ question: string; complexity: ComplexityLevel }>
  maxComplexity: ComplexityLevel
  lastRunTimestamp: number
  lastCheckTime: number
  pendingPromise: Promise<PredictorResult | null> | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCRIPT_TIMEOUT_MS = 10_000 // 10 seconds
const CHECK_INTERVAL_MS = 45_000 // 45 seconds between periodic checks
const MAX_QUESTIONS = 5
const QUESTIONS_TTL_MS = 60_000 // 60 seconds before questions expire

// ---------------------------------------------------------------------------
// Per-session state (avoids cross-session contamination)
// ---------------------------------------------------------------------------

const sessionStates = new Map<string, SessionState>()

// ---------------------------------------------------------------------------
// Shared Circuit Breaker — imported from token-predictor (singleton)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Script Execution (uses shared predictorBreaker from token-predictor)
// ---------------------------------------------------------------------------

async function runPredictorScript(prompt: string, projectRoot?: string): Promise<PredictorResult | null> {
  if (predictorBreaker.isCircuitOpen()) {
    console.warn("[sensor-gate-enforcer] Circuit breaker open, skipping prediction")
    return null
  }

  const skillsDir = resolveSkillsDir()
  if (!skillsDir) {
    console.warn("[sensor-gate-enforcer] Skills directory not resolved, skipping prediction")
    return null
  }
  const scriptPath = path.join(skillsDir, "token-predictor", "scripts", "predict.py")
  const pythonCmd = resolvePythonCommand()
  const pythonArgs = getPythonArgs()

  // Validate script path before execution
  if (!validateScriptPath(scriptPath)) {
    console.warn("[sensor-gate-enforcer] Script path validation failed:", scriptPath)
    return null
  }

  // Write prompt to temp file — avoids leaking it in process listings
  let tmpFile = ""
  try {
    tmpFile = writePromptToTmpFile(prompt, projectRoot || process.cwd(), "enf-")
  } catch (e) {
    console.warn("[sensor-gate-enforcer] Failed to create temp file for prompt:", e)
    return null
  }

  const args = [
    ...pythonArgs,
    scriptPath,
    "--json",
    "--prompt-file",
    tmpFile,
    "--count",
    String(MAX_QUESTIONS),
  ]
  if (projectRoot) {
    args.push("--project-root", projectRoot)
  }

  try {
    const proc = Bun.spawn([pythonCmd, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...BASE_SUBPROCESS_ENV,
        PROJECT_ROOT: projectRoot || process.cwd(),
      },
    })

    const timeout = setTimeout(() => {
      try {
        proc.kill()
      } catch {
        // Process may have already exited
      }
    }, SCRIPT_TIMEOUT_MS)

    try {
      const exitCode = await proc.exited
      clearTimeout(timeout)
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()

      if (exitCode !== 0) {
        predictorBreaker.recordFailure()
        console.warn("[sensor-gate-enforcer] Predictor script failed:", stderr.slice(0, 500))
        return null
      }

      const result = JSON.parse(stdout) as PredictorResult // eslint-disable-line typescript-eslint/no-unsafe-type-assertion
      predictorBreaker.recordSuccess()
      return result
    } catch (e) {
      clearTimeout(timeout)
      throw e
    }
  } catch (e) {
    predictorBreaker.recordFailure()
    console.warn("[sensor-gate-enforcer] Failed to spawn predictor:", String(e))
    return null
  } finally {
    cleanupTmpFile(tmpFile)
  }
}

// ---------------------------------------------------------------------------
// Plugin Factory
// ---------------------------------------------------------------------------

export async function SensorGateEnforcerPlugin(_input: PluginInput): Promise<Hooks> {
  const hooks: Hooks = {
      // --- chat.message: 45s periodic timer check ---
      "chat.message": async (input, output) => {
        // Extract text from parts
        const textParts = output.parts
          .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
          .map((p) => p.text)
        const prompt = textParts.join(" ")
        if (!prompt.trim()) return

        // Check if 45s have elapsed (per-session)
        const chatInput = input as { client?: { directory?: string }; sessionID?: string }
        const sessionKey = `${chatInput.client?.directory ?? "__default__"}:${chatInput.sessionID ?? "global"}`
        let state = sessionStates.get(sessionKey)
        if (state) {
          const now = Date.now()
          if (now - state.lastCheckTime < CHECK_INTERVAL_MS) return
          state.lastCheckTime = now
        } else {
          // First call — create state and allow check
          state = { lastPrompt: "", lastQuestions: [], maxComplexity: "low", lastRunTimestamp: 0, lastCheckTime: Date.now(), pendingPromise: null }
          sessionStates.set(sessionKey, state)
        }

        // Skip if prompt is same as last run (dedup)
        if (prompt === state.lastPrompt && state.lastQuestions.length > 0) return

        state.lastPrompt = prompt
        state.lastRunTimestamp = Date.now()

        // Run predictor — store the pending promise so transform can await it
        state.pendingPromise = runPredictorScript(prompt, chatInput.client?.directory)
          .then((result) => {
            if (result && result.questions.length > 0) {
              const questions = result.questions.map((q) => ({
                question: typeof q === "string" ? q : q.question,
                complexity: parseComplexityLevel(typeof q === "object" && "complexity" in q ? q.complexity : "low"),
              }))
              state.lastQuestions = questions
              state.maxComplexity = parseComplexityLevel(result.max_complexity ?? "low")
              console.log(
                `[sensor-gate-enforcer] Generated ${result.questions.length} shipping checklist questions (max complexity: ${state.maxComplexity})`,
              )
            }
            state.pendingPromise = null
            return result
          })
          .catch((e) => {
            console.warn("[sensor-gate-enforcer] Predictor error:", String(e))
            state.pendingPromise = null
            return null
          })
      },

      // --- experimental.chat.system.transform: inject questions ---
      "experimental.chat.system.transform": async (_input, output) => {
        // Check if sensor gate is in minimal mode via the system-prompt signal.
        // When gate is OFF (minimal), skip shipping checklist injection.
        // Signal string must match SENSOR_GATE_MINIMAL_SIGNAL in prompt-state.ts.
        // NOTE: we repeat the literal here instead of importing across packages
        // (skill/ → session/) to avoid a circular dependency.
        // system may be string[] (array contract) or a bare string depending
        // on the caller; handle both instead of crashing on .some of undefined.
        const sys: unknown = output.system
        const minimalSignal = Array.isArray(sys)
          ? sys.some((s) => String(s).includes('<sensor-gate state="minimal">'))
          : typeof sys === "string" && sys.includes('<sensor-gate state="minimal">')
        if (minimalSignal) return

        type InputWithClient = { client?: { directory?: string }; sessionID?: string }
        const sessionKey = `${(_input as InputWithClient).client?.directory ?? "__default__"}:${(_input as InputWithClient).sessionID ?? "global"}`
        const state = sessionStates.get(sessionKey)
        if (!state) return

        // If a predictor run is in-flight, wait briefly for it (max 8s)
        if (state.pendingPromise) {
          await Promise.race([
            state.pendingPromise,
            new Promise((resolve) => setTimeout(resolve, 8_000)),
          ])
        }

        if (state.lastQuestions.length === 0) return

        const spawnRange = COMPLEXITY_SPAWN_MAP[state.maxComplexity]
        const questionBlock = [
          "",
          `<shipping-checklist complexity="${state.maxComplexity}" suggested-spawns="${spawnRange.min}-${spawnRange.max}">`,
          `Before proceeding, consider these shipping readiness questions (complexity: ${state.maxComplexity}):`,
          ...state.lastQuestions.map((q, i) => {
            const safeQ = q.question.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            return `  ${i + 1}. [${q.complexity}] ${safeQ}`
          }),
          "Answer each question before proceeding with the task.",
          "</shipping-checklist>",
          "",
        ].join("\n")

        // Check TTL BEFORE injecting to avoid stale questions in this turn
        if (Date.now() - state.lastRunTimestamp > QUESTIONS_TTL_MS) {
          state.lastQuestions = []
          return
        }

        if (typeof output.system === "string") {
          output.system = [output.system]
        }
        ;(output.system as string[]).push(questionBlock)
      },

      // --- dispose: cleanup ---
      dispose: async () => {
        resetPeriodicTimer()
        for (const state of sessionStates.values()) {
          state.lastQuestions = []
          state.lastPrompt = ""
          state.pendingPromise = null
        }
        sessionStates.clear()
        predictorBreaker.reset()
      },
    }

    return hooks
}
