/**
 * self-evolve.ts — Self-Evolution Engine
 *
 * Captures learning signals after every non-trivial chain execution and
 * persists them to Pieces LTM. This creates the feedback loop that makes
 * the agent improve continuously.
 *
 * Every persistence writes to Pieces LTM and logs to evolution/pieces_writes.jsonl.
 * On future turns, <learned-knowledge> in the system prompt (from system.ts)
 * retrieves the most recent learned rules and injects them.
 *
 * Usage:
 *   import { SelfEvolve } from "@/skill/self-evolve"
 *   const svc = yield* SelfEvolve.Service
 *   yield* svc.capture({ chain, intent, results, mistakes })
 *
 * This is called automatically by prompt.ts after chain execution.
 * It is also available as an explicit skill for manual invocation.
 */

import { Effect, Context, Layer } from "effect"
import { PiecesLTM } from "@/pieces-ltm"
import type { PersistInput } from "@/pieces-ltm/service"
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const EVOLUTION_DIR = join(homedir(), ".dreamcode", "evolution")
const RUN_LOG = join(EVOLUTION_DIR, "run_log.jsonl")
const PIECES_WRITES = join(EVOLUTION_DIR, "pieces_writes.jsonl")
const DEFAULT_KNOWLEDGE = join(EVOLUTION_DIR, "knowledge.jsonl")

export interface LearningSignal {
  /** What went right — the tool, pattern, or approach that worked */
  whatWorked: string
  /** What went wrong — the tool, pattern, or approach that failed */
  whatFailed: string
  /** The specific rule to change — actionable, e.g. "Effect.catchAll does not exist in Effect v4 — use Effect.catch instead" */
  whatToChange: string
}

export interface CaptureInput {
  chain: string[]
  intent: string
  outcome: "success" | "failed" | "partial"
  signals: LearningSignal[]
  filesChanged?: string[]
  /** e.g. tokens used, iterations, models used */
  metrics?: Record<string, unknown>
}

export interface Interface {
  readonly capture: (input: CaptureInput) => Effect.Effect<void>
  readonly learnings: () => Effect.Effect<LearningSignal[], unknown, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@dreamcode/SelfEvolve") {}

/**
 * Known Effect v4 API differences that the model frequently gets wrong.
 * These are hardcoded as the initial knowledge base and supplemented
 * by Pieces LTM persistence.
 */
export const DEFAULT_LEARNINGS: LearningSignal[] = [
  {
    whatWorked: "Using Effect.gen(function* () { ... }) for composition",
    whatFailed: "Using Effect.catchAll — it does NOT exist in Effect v4 beta",
    whatToChange:
      "Effect.catchAll does NOT exist in Effect v4 beta. Use Effect.catch instead. Effect.catch catches all errors including defects. If you need to catch only tagged errors, use Effect.catchTag.",
  },
  {
    whatWorked: "Using Effect.fn('Domain.method') for named/traced effects",
    whatFailed: "Using Effect.fork or Effect.forkDaemon — they do not exist in Effect v4",
    whatToChange:
      "Effect.fork and Effect.forkDaemon do NOT exist in Effect v4 beta. Use Effect.forkIn(scope) to fork a fiber into a specific scope.",
  },
  {
    whatWorked: "Using Bun.spawn() wrapped in Effect.tryPromise for subprocesses",
    whatFailed: "Using ChildProcess from effect/unstable/process in compiled binaries (breaks Stream imports)",
    whatToChange:
      "In compiled binaries, avoid effect/unstable/process imports. Use Bun.spawn() wrapped in Effect.tryPromise instead. The Bun.spawn stdin pipe deadlocks with writer.close() on compiled binaries — use --prompt-file to pass input.",
  },
  {
    whatWorked: "Using Schema.Class for multi-field data and Schema.TaggedErrorClass for typed errors",
    whatFailed: "Using Schema.Struct for error types (loses branded Error class benefits)",
    whatToChange:
      "Use Schema.Class for multi-field data types. Use Schema.TaggedErrorClass for typed errors that work with Effect.catchTag.",
  },
  {
    whatWorked: "Using Layer.mock for overriding specific service methods in tests",
    whatFailed: "Hand-rolling Layer.succeed(Service, Service.of({...})) when only a few methods need stubbing",
    whatToChange:
      "Use Layer.mock(Service, { method1, method2 }) to stub specific methods. Any unstubbed method throws an UnimplementedError defect, catching accidental calls.",
  },
]

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // PiecesLTM is now resolved via Effect's dependency injection layer system.
    // The SelfEvolve layer's dependencies must include PiecesLTM (handled by
    // the caller's Layer.mergeAll or explicit Layer.provide).
    const ltm = yield* PiecesLTM.PiecesLTM

    /**
     * Persists multiple learning signals to Pieces LTM with appropriate
     * memory type and a structured summary for future retrieval.
     */
    const capture = Effect.fn("SelfEvolve.capture")(function* (input: CaptureInput) {
      if (input.signals.length === 0) return

      // Ensure evolution directory exists
      try { mkdirSync(EVOLUTION_DIR, { recursive: true }) } catch { /* ignore */ }

      for (const signal of input.signals) {
        // Write to local evolution file (works WITHOUT Pieces LTM)
        const entry = {
          timestamp: new Date().toISOString(),
          chain: input.chain,
          intent: input.intent,
          outcome: input.outcome,
          whatWorked: signal.whatWorked,
          whatFailed: signal.whatFailed,
          whatToChange: signal.whatToChange,
          filesChanged: input.filesChanged,
          metrics: input.metrics,
        }
        try {
          appendFileSync(RUN_LOG, JSON.stringify(entry) + "\n")
          // Also write to knowledge.jsonl for learned-knowledge injection
          appendFileSync(DEFAULT_KNOWLEDGE, JSON.stringify({
            rule: signal.whatToChange,
            context: signal.whatFailed,
            source: input.intent,
            timestamp: entry.timestamp,
          }) + "\n")
        } catch { /* ignore */ }

        // Persist to Pieces LTM (skip if unavailable — non-blocking)
        if (ltm) {
          const persistInput: PersistInput = {
            chainName: input.chain.join(" → "),
            taskDescription: signal.whatToChange,
            outcome: input.outcome === "partial" ? "failed" as const : input.outcome,
            keyDecisions: [
              signal.whatToChange,
              `Context: ${signal.whatFailed}`,
            ],
            filesChanged: input.filesChanged,
            metrics: {
              ...input.metrics,
              signalCount: input.signals.length,
            },
            memoryType: "learn",
          }
          yield* ltm.persist(persistInput).pipe(Effect.catch(() => Effect.void))
        }

        // Write pieces_writes.jsonl log
        try {
          appendFileSync(PIECES_WRITES, JSON.stringify({
            timestamp: entry.timestamp,
            chain: input.chain,
            signal: signal.whatToChange,
            persisted: ltm ? "ltm+file" : "file-only",
          }) + "\n")
        } catch { /* ignore */ }
      }
    })

    /**
     * Returns all known learnings including defaults and any from LTM.
     * Used for injecting into system prompts.
     */
    const learnings = Effect.fn("SelfEvolve.learnings")(function* () {
      // Start with hardcoded default learnings (Effect v4 API rules)
      const signals: LearningSignal[] = [...DEFAULT_LEARNINGS]

      // Read from local knowledge.jsonl (works without Pieces LTM)
      try {
        if (existsSync(DEFAULT_KNOWLEDGE)) {
          const content = readFileSync(DEFAULT_KNOWLEDGE, "utf-8").trim()
          if (content) {
            const lines = content.split("\n").filter(Boolean)
            const seen = new Set(signals.map((s) => s.whatToChange.toLowerCase()))
            for (const line of lines.slice(-50)) { // last 50 entries
              try {
                const entry = JSON.parse(line)
                const rule = entry.rule || entry.description || ""
                if (rule && !seen.has(rule.toLowerCase())) {
                  seen.add(rule.toLowerCase())
                  signals.push({
                    whatWorked: entry.whatWorked || "Learned from previous execution",
                    whatFailed: entry.context || entry.whatFailed || "Previous attempt had issues",
                    whatToChange: rule,
                  })
                }
              } catch { /* skip malformed lines */ }
            }
          }
        }
      } catch { /* ignore */ }

      // Try to supplement with LTM-stored rules (skip if LTM unavailable)
      if (ltm) {
        const raw: unknown = yield* ltm.query({
          query: "learned rules Effect v4 API differences patterns",
          topics: ["learned rules", "Effect v4", "self-evolution"],
        }).pipe(Effect.catch(() => Effect.succeed(null)))

        if (raw && typeof raw === "object") {
          const r = raw as { candidates?: Array<{ description?: string; metadata?: Record<string, unknown> }> }
          if (r.candidates) {
            const sorted = r.candidates
              .filter((c): c is { description: string; metadata?: Record<string, unknown> } =>
                typeof c.description === "string" && c.description.length > 0
              )
              .sort((a, b) => a.description.localeCompare(b.description))
            for (const c of sorted) {
              const rule = c.description
              if (!signals.some((s) => s.whatToChange.toLowerCase() === rule.toLowerCase())) {
                signals.push({
                  whatWorked: "Preserved in Pieces LTM",
                  whatFailed: "See learning note",
                  whatToChange: rule,
                })
              }
            }
          }
        }
      }

      return signals
    })

    return Service.of({ capture, learnings })
  }),
)

// Layer.mergeAll in Effect v4 beta does NOT resolve cross-layer
// dependencies. SelfEvolve requires PiecesLTM.PiecesLTM, so we
// must explicitly provide it via Layer.provide.
export const defaultLayer = layer.pipe(
  Layer.provide(PiecesLTM.defaultLayer),
)

export const SelfEvolve = { Service, layer, defaultLayer }
