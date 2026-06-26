/**
 * Token Predictor / Shipping Checklist Service
 *
 * Generates unique developer-focused questions about shipping readiness.
 * Integrates with the sensor gate system for DREAM_INNOVATION mode.
 *
 * Features:
 * - Heuristic question generation from project context
 * - Dedup via JSONL log with SHA-256 hash matching
 * - NEURO enrichment when available
 * - Circuit breaker for execution safety (shared module)
 * - 45s periodic timer via per-turn timestamp check
 */

import { Context, Effect, Layer } from "effect"
import { resolvePythonCommand, resolveSkillsDir, getPythonArgs } from "./python-resolver.js"
import { createCircuitBreaker, type CircuitBreaker } from "./circuit-breaker.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShippingQuestion {
  readonly question: string
  readonly questionHash: string
  readonly category: string
}

export interface PredictorResult {
  readonly questions: readonly ShippingQuestion[]
  readonly contextHash: string
  readonly signals: Record<string, boolean>
  readonly projectContext: string
  readonly timestamp: string
}

// ---------------------------------------------------------------------------
// Shared Circuit Breaker (singleton)
// ---------------------------------------------------------------------------

const SCRIPT_TIMEOUT_MS = 10_000 // 10 seconds

export const predictorBreaker: CircuitBreaker = createCircuitBreaker(3, 5 * 60 * 1000)

// ---------------------------------------------------------------------------
// Per-turn 45s timer state
// ---------------------------------------------------------------------------

let lastCheckTime = 0
const CHECK_INTERVAL_MS = 45_000 // 45 seconds

export function shouldRunPeriodicCheck(): boolean {
  const now = Date.now()
  if (now - lastCheckTime < CHECK_INTERVAL_MS) return false
  lastCheckTime = now
  return true
}

export function resetPeriodicTimer(): void {
  lastCheckTime = 0
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface TokenPredictorInterface {
  readonly generate: (params: {
    prompt: string
    projectRoot?: string
    sessionContext?: string
    neuroResult?: string
    count?: number
  }) => Effect.Effect<PredictorResult, string>
}

export class TokenPredictor extends Context.Service<TokenPredictor, TokenPredictorInterface>()("@dreamcode/TokenPredictor") {}

// ---------------------------------------------------------------------------
// Question Categorization (exported for shared use)
// ---------------------------------------------------------------------------

export function categorizeQuestion(q: string): string {
  const lower = q.toLowerCase()
  if (lower.includes("auth") || lower.includes("credential") || lower.includes("token")) return "security"
  if (lower.includes("database") || lower.includes("migration") || lower.includes("query")) return "data"
  if (lower.includes("test") || lower.includes("coverage") || lower.includes("edge case")) return "testing"
  if (lower.includes("deploy") || lower.includes("rollback") || lower.includes("release")) return "deployment"
  if (lower.includes("performance") || lower.includes("latency") || lower.includes("cache")) return "performance"
  if (lower.includes("error") || lower.includes("exception") || lower.includes("fault")) return "reliability"
  if (lower.includes("type") || lower.includes("schema") || lower.includes("validation")) return "types"
  if (lower.includes("backward") || lower.includes("breaking") || lower.includes("migration guide")) return "compatibility"
  return "general"
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function resolvePredictorScript(): string {
  const skillsDir = resolveSkillsDir()
  const scriptPath = `${skillsDir}/token-predictor/scripts/predict.py`
  return scriptPath
}

const generateImpl = (params: {
  prompt: string
  projectRoot?: string
  sessionContext?: string
  neuroResult?: string
  count?: number
}): Effect.Effect<PredictorResult, string> =>
  Effect.gen(function* () {
    // Check circuit breaker
    if (predictorBreaker.isCircuitOpen()) {
      const state = predictorBreaker.getState()
      return yield* Effect.fail(
        `Circuit breaker open. Cooldown until ${new Date(state.cooldownUntil).toISOString()}`,
      )
    }

    const scriptPath = resolvePredictorScript()
    const pythonCmd = resolvePythonCommand()
    const pythonArgs = getPythonArgs()

    // Build args
    const args: string[] = [
      ...pythonArgs,
      scriptPath,
      "--json",
      "--prompt",
      params.prompt,
      "--count",
      String(params.count ?? 5),
    ]
    if (params.projectRoot) {
      args.push("--project-root", params.projectRoot)
    }
    if (params.sessionContext) {
      args.push("--session-context", params.sessionContext)
    }
    if (params.neuroResult) {
      args.push("--neuro-result", params.neuroResult)
    }

    // Execute script using Bun.spawn (same pattern as chain-executor)
    const result = yield* Effect.tryPromise({
      try: async () => {
        const proc = Bun.spawn([pythonCmd, ...args], {
          stdout: "pipe",
          stderr: "pipe",
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            PYTHONPATH: process.env.PYTHONPATH ?? "",
            NEURO_API_KEY: process.env.NEUCODE_NEURO_API_KEY ?? process.env.NEURO_API_KEY ?? "",
            PROJECT_ROOT: params.projectRoot || process.cwd(),
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
          return { exitCode, stdout, stderr }
        } catch (e) {
          clearTimeout(timeout)
          throw e
        }
      },
      catch: (e) => `Failed to spawn predictor script: ${String(e)}`,
    })

    if (result.exitCode !== 0) {
      predictorBreaker.recordFailure()
      return yield* Effect.fail(
        `Token predictor exited with code ${result.exitCode}: ${result.stderr.slice(0, 500)}`,
      )
    }

    // Parse JSON output
    const parsed = yield* Effect.try({
      try: () => JSON.parse(result.stdout) as {
        questions: string[]
        context_hash: string
        signals: Record<string, boolean>
        project_context: string
        timestamp: string
      },
      catch: () => `Failed to parse predictor output: ${result.stdout.slice(0, 200)}`,
    })

    predictorBreaker.recordSuccess()

    // Map to typed result
    const questions: ShippingQuestion[] = parsed.questions.map((q, i) => ({
      question: q,
      questionHash: `q${i}`,
      category: categorizeQuestion(q),
    }))

    return {
      questions,
      contextHash: parsed.context_hash,
      signals: parsed.signals,
      projectContext: parsed.project_context,
      timestamp: parsed.timestamp,
    }
  })

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const TokenPredictorLive = Layer.succeed(TokenPredictor, {
  generate: generateImpl,
})
