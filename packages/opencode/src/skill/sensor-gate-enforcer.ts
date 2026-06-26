/**
 * Sensor Gate Enforcer Plugin
 *
 * Integrates the sensor gate system with the plugin lifecycle:
 * - 45s periodic timer check on `chat.message`
 * - Token predictor / shipping checklist question generation
 * - NEURO enrichment when available
 * - Circuit breaker for execution safety (OWN instance, not shared with TokenPredictor)
 *
 * This plugin hooks into `chat.message` to trigger periodic checks
 * and `experimental.chat.system.transform` to inject questions.
 *
 * State is per-session via a Map keyed by projectRoot to avoid
 * cross-session contamination in multi-directory environments.
 */

import type { Hooks, PluginInput, Plugin as PluginInstance } from "@opencode-ai/plugin"
import { shouldRunPeriodicCheck, resetPeriodicTimer, categorizeQuestion } from "./token-predictor.js"
import { resolvePythonCommand, resolveSkillsDir, getPythonArgs } from "./python-resolver.js"
import { createCircuitBreaker } from "./circuit-breaker.js"

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
  pendingPromise: Promise<PredictorResult | null> | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCRIPT_TIMEOUT_MS = 10_000 // 10 seconds
const MAX_QUESTIONS = 5
const QUESTIONS_TTL_MS = 60_000 // 60 seconds before questions expire

// ---------------------------------------------------------------------------
// Per-session state (avoids cross-session contamination)
// ---------------------------------------------------------------------------

const sessionStates = new Map<string, SessionState>()

// ---------------------------------------------------------------------------
// Enforcer's OWN circuit breaker (NOT shared with TokenPredictor)
// ---------------------------------------------------------------------------

const enforcerBreaker = createCircuitBreaker(3, 5 * 60 * 1000)

// ---------------------------------------------------------------------------
// Script Execution (uses enforcer's own circuit breaker)
// ---------------------------------------------------------------------------

async function runPredictorScript(prompt: string, projectRoot?: string): Promise<PredictorResult | null> {
  if (enforcerBreaker.isCircuitOpen()) {
    console.warn("[sensor-gate-enforcer] Circuit breaker open, skipping prediction")
    return null
  }

  const skillsDir = resolveSkillsDir()
  const scriptPath = `${skillsDir}/token-predictor/scripts/predict.py`
  const pythonCmd = resolvePythonCommand()
  const pythonArgs = getPythonArgs()

  const args = [
    ...pythonArgs,
    scriptPath,
    "--json",
    "--prompt",
    prompt,
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
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        PYTHONPATH: process.env.PYTHONPATH ?? "",
        NEURO_API_KEY: process.env.NEUCODE_NEURO_API_KEY ?? process.env.NEURO_API_KEY ?? "",
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
        enforcerBreaker.recordFailure()
        console.warn("[sensor-gate-enforcer] Predictor script failed:", stderr.slice(0, 200))
        return null
      }

      const result = JSON.parse(stdout) as PredictorResult
      enforcerBreaker.recordSuccess()
      return result
    } catch (e) {
      clearTimeout(timeout)
      throw e
    }
  } catch (e) {
    enforcerBreaker.recordFailure()
    console.warn("[sensor-gate-enforcer] Failed to spawn predictor:", String(e))
    return null
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

        // Check if 45s have elapsed
        if (!shouldRunPeriodicCheck()) return

        // Get or create session state
        const sessionKey = input.client?.directory ?? "__default__"
        let state = sessionStates.get(sessionKey)
        if (!state) {
          state = { lastPrompt: "", lastQuestions: [], lastRunTimestamp: 0, pendingPromise: null }
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
        const sessionKey = _input.client?.directory ?? "__default__"
        const state = sessionStates.get(sessionKey)
        if (!state) return

        // If a predictor run is in-flight, wait briefly for it (max 2s)
        if (state.pendingPromise) {
          await Promise.race([
            state.pendingPromise,
            new Promise((resolve) => setTimeout(resolve, 2_000)),
          ])
        }

        if (state.lastQuestions.length === 0) return

        const questionBlock = [
          "",
          "<shipping-checklist>",
          "Before proceeding, consider these shipping readiness questions:",
          ...state.lastQuestions.map((q, i) => `  ${i + 1}. ${q}`),
          "Answer each question before proceeding with the task.",
          "</shipping-checklist>",
          "",
        ].join("\n")

        output.system.push(questionBlock)

        // Clear after injection to avoid re-injection
        // Questions will be regenerated on next 45s cycle if needed
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
        enforcerBreaker.reset()
      },
    }

    return hooks
  }
}
