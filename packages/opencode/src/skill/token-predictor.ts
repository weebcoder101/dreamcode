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

import { Effect } from "effect"
import { resolvePythonCommand, resolveSkillsDir, getPythonArgs, writePromptToTmpFile, cleanupTmpFile, validateScriptPath, BASE_SUBPROCESS_ENV } from "./python-resolver.js"
import { createCircuitBreaker, type CircuitBreaker } from "./circuit-breaker.js"
import { categorizeQuestion } from "./question-complexity-schema.js"
import { createHash } from "crypto"
import path from "path"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShippingQuestion {
  readonly question: string
  readonly questionHash: string
  readonly category: string
  readonly complexity: "low" | "medium" | "high"
}

export interface PredictorResult {
  readonly questions: readonly ShippingQuestion[]
  readonly maxComplexity: "low" | "medium" | "high"
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
// Implementation
// ---------------------------------------------------------------------------
// categorizeQuestion is imported from question-complexity-schema.ts (single source of truth)

function resolvePredictorScript(): string {
  const skillsDir = resolveSkillsDir()
  if (!skillsDir) return ""
  return path.join(skillsDir, "token-predictor", "scripts", "predict.py")
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

    // Validate script path before execution
    if (!validateScriptPath(scriptPath)) {
      return yield* Effect.fail(`Script path validation failed: ${scriptPath}`)
    }

    // Write prompt, sessionContext, and neuroResult to temp files — avoids leaking in process listings
    const cwd = params.projectRoot || process.cwd()
    let tmpFile = ""
    let ctxTmpFile = ""
    let neuroTmpFile = ""
    try {
      tmpFile = writePromptToTmpFile(params.prompt, cwd, "tp-")
      if (params.sessionContext) {
        ctxTmpFile = writePromptToTmpFile(params.sessionContext, cwd, "tp-ctx-")
      }
      if (params.neuroResult) {
        neuroTmpFile = writePromptToTmpFile(params.neuroResult, cwd, "tp-neuro-")
      }
    } catch (e) {
      return yield* Effect.fail(`Failed to create temp files: ${e}`)
    }

    // Build args — use temp file paths instead of inline data to avoid ps aux leaks
    const args: string[] = [
      ...pythonArgs,
      scriptPath,
      "--json",
      "--prompt-file",
      tmpFile,
      "--count",
      String(params.count ?? 5),
    ]
    if (params.projectRoot) {
      args.push("--project-root", params.projectRoot)
    }
    if (ctxTmpFile) {
      args.push("--session-context-file", ctxTmpFile)
    }
    if (neuroTmpFile) {
      args.push("--neuro-result-file", neuroTmpFile)
    }

    // Execute script using Bun.spawn (same pattern as chain-executor)
    // Use Effect.ensuring to guarantee temp file cleanup on all paths (success, error, early return)
    const result = yield* Effect.tryPromise({
      try: async () => {
        const proc = Bun.spawn([pythonCmd, ...args], {
          stdout: "pipe",
          stderr: "pipe",
        env: {
          ...BASE_SUBPROCESS_ENV,
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
    }).pipe(Effect.ensuring(
      Effect.sync(() => {
        cleanupTmpFile(tmpFile)
        cleanupTmpFile(ctxTmpFile)
        cleanupTmpFile(neuroTmpFile)
      })
    ))

    if (result.exitCode !== 0) {
      predictorBreaker.recordFailure()
      return yield* Effect.fail(
        `Token predictor exited with code ${result.exitCode}: ${result.stderr.slice(0, 500)}`,
      )
    }

    // Parse JSON output
    const parsed = yield* Effect.try({
      try: () => JSON.parse(result.stdout) as {
        questions: Array<{ question: string; complexity: string }>
        max_complexity: string
        context_hash: string
        signals: Record<string, boolean>
        project_context: string
        timestamp: string
      },
      catch: () => `Failed to parse predictor output: ${result.stdout.slice(0, 500)}`,
    })

    predictorBreaker.recordSuccess()

    // Map to typed result — use real SHA-256 hashes for dedup
    const questions: ShippingQuestion[] = parsed.questions.map((q) => ({
      question: typeof q === "string" ? q : q.question,
      complexity: (typeof q === "object" && "complexity" in q ? q.complexity : "low") as "low" | "medium" | "high",
      questionHash: createHash("sha256").update((typeof q === "string" ? q : q.question).toLowerCase().trim()).digest("hex"),
      category: categorizeQuestion(typeof q === "string" ? q : q.question),
    }))

    // Note: temp file cleanup is guaranteed by Effect.ensuring above

    return {
      questions,
      maxComplexity: (parsed.max_complexity ?? "low") as "low" | "medium" | "high",
      contextHash: parsed.context_hash,
      signals: parsed.signals,
      projectContext: parsed.project_context,
      timestamp: parsed.timestamp,
    }
  })

// ---------------------------------------------------------------------------
// Export generate function directly (no dead service layer)
// ---------------------------------------------------------------------------

export const generate = generateImpl
