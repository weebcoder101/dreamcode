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

import type { Hooks, PluginInput, Plugin as PluginInstance } from "@opencode-ai/plugin"
import { resetPeriodicTimer, categorizeQuestion, predictorBreaker } from "./token-predictor.js"
import { resolvePythonCommand, resolveSkillsDir, getPythonArgs, writePromptToTmpFile, cleanupTmpFile, validateScriptPath, BASE_SUBPROCESS_ENV } from "./python-resolver.js"
import path from "path"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PredictorResult {
  questions: string[]
  context_hash: string
  signals: Record<string, boolean>
  project_context: string
  timestamp: string
}

interface SessionState {
  lastPrompt: string
  lastQuestions: string[]
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

      const result = JSON.parse(stdout) as PredictorResult
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

export function SensorGateEnforcerPlugin(_input: PluginInput): PluginInstance {
  return async () => {
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
        const sessionKey = `${input.client?.directory ?? "__default__"}:${input.sessionID ?? "global"}`
        let state = sessionStates.get(sessionKey)
        if (state) {
          const now = Date.now()
          if (now - state.lastCheckTime < CHECK_INTERVAL_MS) return
          state.lastCheckTime = now
        } else {
          // First call — create state and allow check
          state = { lastPrompt: "", lastQuestions: [], lastRunTimestamp: 0, lastCheckTime: Date.now(), pendingPromise: null }
          sessionStates.set(sessionKey, state)
        }

        // Skip if prompt is same as last run (dedup)
        if (prompt === state.lastPrompt && state.lastQuestions.length > 0) return

        state.lastPrompt = prompt
        state.lastRunTimestamp = Date.now()

        // Run predictor — store the pending promise so transform can await it
        state.pendingPromise = runPredictorScript(prompt, input.client?.directory)
          .then((result) => {
            if (result && result.questions.length > 0) {
              state!.lastQuestions = result.questions
              console.log(
                `[sensor-gate-enforcer] Generated ${result.questions.length} shipping checklist questions`,
              )
            }
            state!.pendingPromise = null
            return result
          })
          .catch((e) => {
            console.warn("[sensor-gate-enforcer] Predictor error:", String(e))
            state!.pendingPromise = null
            return null
          })
      },

      // --- experimental.chat.system.transform: inject questions ---
      "experimental.chat.system.transform": async (_input, output) => {
        const sessionKey = `${_input.client?.directory ?? "__default__"}:${_input.sessionID ?? "global"}`
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

        const questionBlock = [
          "",
          "<shipping-checklist>",
          "Before proceeding, consider these shipping readiness questions:",
          ...state.lastQuestions.map((q, i) => `  ${i + 1}. ${q.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}`),
          "Answer each question before proceeding with the task.",
          "</shipping-checklist>",
          "",
        ].join("\n")

        output.system.push(questionBlock)

        // Check TTL BEFORE clearing to avoid injecting stale questions
        if (Date.now() - state.lastRunTimestamp > QUESTIONS_TTL_MS) {
          state.lastQuestions = []
        }
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
}
