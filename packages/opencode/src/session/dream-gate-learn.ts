// ─── Dream Gate Neural Learner ───────────────────────────────────────────
// A dependency-free, trainable scoring layer for the Dream Protocol gate.
//
// Architecture (single-layer neural net / perceptron with online SGD):
//   1. FEATURES — the plan text is projected into 10 interpretable features
//      (approach content, correlations, verification commands, file coverage,
//      alternatives considered, risk signals, ...).
//   2. SCORER — score = Σ w_i·f_i + b. The weights ARE the learned layer;
//      they start at expert-tuned priors and are refined online.
//   3. LEARNING — after each turn, the harness knows the outcome (clean
//      finish vs tool errors / doom loops). That outcome is the label:
//        positive → pull weights up if the plan under-scored
//        negative → push weights down if the plan over-scored
//      Updates use a margin-based perceptron rule with a small learning
//      rate and per-weight clipping (safety bounds).
//   4. ADAPTIVE THRESHOLD — the pass threshold is adapted with EMA toward
//      observed good-plan scores, clamped to safety bounds [θ_min, θ_max]
//      (grounded in the "Adaptive HITL Threshold Learner: EMA-based online
//      learning that converges to team-preferred escalation thresholds
//      within safety bounds" pattern from agentic CI/CD research).
//
// Research grounding:
//   - Perceptron / online learning (Rosenblatt; mistake-bounded online
//     learning) — single-layer NN trained from a label stream.
//   - Adaptive threshold learning with safety bounds (2026 agent harness
//     engineering surveys: "harness reliability at the expense of context
//     efficiency is an infrastructure cost multiplier" — thresholds must
//     adapt per-project, not stay frozen).
//   - Feedback-driven refinement (ACON 2025): learn FROM failure signals
//     already present in the harness (tool errors, doom loops, drift).
//
// Zero external dependencies: features are regex/token based; learning is
// plain arithmetic; persistence is one small JSON file per project.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"

// ─── Model persistence ──────────────────────────────────────────────────
// Stored per-project at <worktree>/.dreamcode/dream-gate-model.json so each
// project's gate calibrates to its own codebase and user's working style.
let modelPath: string | undefined

function setModelPath(filePath: string) {
  modelPath = filePath
}

export function getModelPath(): string | undefined {
  return modelPath
}

interface GateModel {
  version: 2
  weights: number[]
  bias: number
  threshold: number
  stats: { positives: number; negatives: number; nudges: number; blocks: number }
  updatedAt: number
}

// Expert-tuned priors: what a GOOD plan looks like (scale ~0-12 max score).
// approach/correlations/verification sections dominate; concrete commands
// and alternatives matter; risk signals add scrutiny (weight applied when
// the plan touches destructive operations).
const PRIOR_WEIGHTS = [2.0, 2.0, 2.0, 1.0, 1.0, 1.0, 1.5, 0.5, 0.5, 0.5]
const PRIOR_BIAS = 0
const DEFAULT_THRESHOLD = 4.0
const THRESHOLD_MIN = 2.0
const THRESHOLD_MAX = 6.0
const LEARNING_RATE = 0.05
const WEIGHT_CLAMP = [0, 4] as const
const THRESHOLD_EMA_ALPHA = 0.1

let cachedModel: GateModel | undefined
let lastLoadAt = 0
const MODEL_CACHE_TTL_MS = 60_000

function defaultModel(): GateModel {
  return {
    version: 2,
    weights: [...PRIOR_WEIGHTS],
    bias: PRIOR_BIAS,
    threshold: DEFAULT_THRESHOLD,
    stats: { positives: 0, negatives: 0, nudges: 0, blocks: 0 },
    updatedAt: Date.now(),
  }
}

function modelFile(): string | undefined {
  if (modelPath) return modelPath
  return undefined
}

function loadModel(): GateModel {
  const now = Date.now()
  if (cachedModel && now - lastLoadAt < MODEL_CACHE_TTL_MS) return cachedModel
  const file = modelFile()
  if (file && existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf-8")) as GateModel
      if (parsed.version === 2 && Array.isArray(parsed.weights) && parsed.weights.length === PRIOR_WEIGHTS.length) {
        cachedModel = parsed
        lastLoadAt = now
        return parsed
      }
    } catch {
      // Fall through to defaults
    }
  }
  cachedModel = defaultModel()
  lastLoadAt = now
  return cachedModel
}

function saveModel(model: GateModel): void {
  const file = modelFile()
  if (!file) return
  try {
    const dir = file.slice(0, file.lastIndexOf("/"))
    mkdirSync(dir, { recursive: true })
    model.updatedAt = Date.now()
    writeFileSync(file, JSON.stringify(model, null, 2), { mode: 0o600 })
  } catch {
    // Best-effort — the gate must never fail because persistence failed.
  }
}

/**
 * Point the model at a project. Called once at gate initialization with the
 * worktree directory; safe to call repeatedly (idempotent).
 */
export function initGateLearner(worktreeDir: string): void {
  setModelPath(join(worktreeDir, ".dreamcode", "dream-gate-model.json"))
  // Warm the cache so the first gate decision doesn't pay a disk read, and
  // persist the default model so the file exists before any learning runs.
  const model = loadModel()
  if (!existsSync(modelFile()!)) saveModel(model)
}

// ─── Feature extraction ─────────────────────────────────────────────────

export interface PlanFeatures {
  /** ## Approach / ## Plan section with ≥ 50 chars of real content */
  approachContent: number
  /** ## Correlations section mentioning file names */
  correlationsContent: number
  /** ## Verification section with content */
  verificationContent: number
  /** File references with known extensions, normalized to [0,1] (cap 3) */
  fileRefs: number
  /** The plan text mentions the file being edited (basename or full path) */
  targetFileMention: number
  /** Alternatives/options considered (trade-off language) */
  alternatives: number
  /** Concrete verification command token present (bun test, npx tsc, ...) */
  verificationCommand: number
  /** Plan body depth: chars/500 capped at 1 */
  depth: number
  /** Distinct ## section headers / 4 capped at 1 */
  sectionDiversity: number
  /** Destructive-op language present (delete/rm/drop/migrate/rewrite) */
  riskSignal: number
}

const VERIFICATION_COMMAND_RE =
  /\b(bun|npm|pnpm|yarn|npx|cargo|go|pytest|python|make|gradle|mvn)\s+(test|run|build|check|typecheck|lint|fmt|t)\b|\btsc\b|\btypecheck\b|\blint\b/i
const ALTERNATIVES_RE = /\b(considered|alternative|option \d|instead of|trade-?off|vs\.|compared|rejected)\b/i
const RISK_RE = /\b(delete|rm\b|drop|migrate|overwrite|rewrite|refactor|remove)\b/i

/** Extract the 10 plan features from the accumulated assistant text. */
export function extractPlanFeatures(parts: SessionV1.Part[], filePath?: string): PlanFeatures {
  const text = parts
    .filter((p): p is SessionV1.TextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n")
  if (!text) {
    return {
      approachContent: 0, correlationsContent: 0, verificationContent: 0, fileRefs: 0,
      targetFileMention: 0, alternatives: 0, verificationCommand: 0, depth: 0,
      sectionDiversity: 0, riskSignal: 0,
    }
  }

  // Accept both "## Approach" (markdown) and bare "Approach" at line start.
  const approachMatch = /(?:##\s*|(?:^|\n)\s*)Approach[\s\S]{50,}/i.test(text) ? 1 : 0
  const correlationsMatch = /(?:##\s*|(?:^|\n)\s*)Correlations?[\s\S]{30,}/i.test(text) ? 1 : 0
  const verificationMatch = /(?:##\s*|(?:^|\n)\s*)Verification[\s\S]{20,}/i.test(text) ? 1 : 0

  const fileRefs = Math.min(
    (text.match(/\b[\w/.-]+\.(ts|tsx|js|jsx|py|go|rs|rb|java|kt|c|cpp|h|sh)\b/g) || []).length,
    3,
  )

  let targetFileMention = 0
  if (filePath) {
    const base = filePath.split("/").pop() ?? ""
    const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    if (text.includes(filePath) || (base.length > 2 && new RegExp(`\\b${escapedBase}\\b`).test(text))) {
      targetFileMention = 1
    }
  }

  const alternatives = ALTERNATIVES_RE.test(text) ? 1 : 0
  const verificationCommand = VERIFICATION_COMMAND_RE.test(text) ? 1 : 0
  const depth = Math.min(text.length / 500, 1)
  // Count both markdown headers (## Section) and bare plan keywords at line start.
  const mdHeaders = text.match(/^#{1,3}\s+.+$/gm) ?? []
  const bareKeywords = text.match(/^\s*(?:Approach|Plan|Analysis|Correlations?|Verification)\s*$/gim) ?? []
  const sectionDiversity = Math.min((mdHeaders.length + bareKeywords.length) / 4, 1)
  const riskSignal = RISK_RE.test(text) ? 1 : 0

  return {
    approachContent: approachMatch,
    correlationsContent: correlationsMatch,
    verificationContent: verificationMatch,
    fileRefs: fileRefs / 3,
    targetFileMention,
    alternatives,
    verificationCommand,
    depth,
    sectionDiversity,
    riskSignal,
  }
}

/** Ordered feature names (for diagnostics + weight interpretation). */
export const FEATURE_NAMES = [
  "approachContent", "correlationsContent", "verificationContent", "fileRefs",
  "targetFileMention", "alternatives", "verificationCommand", "depth",
  "sectionDiversity", "riskSignal",
] as const

function featuresToVector(f: PlanFeatures): number[] {
  return FEATURE_NAMES.map((name) => f[name])
}

// ─── Scoring ─────────────────────────────────────────────────────────────

/** Learned score of a plan in ~[0, 12]. Higher = more sufficient. */
export function planScore(parts: SessionV1.Part[], filePath?: string): { score: number; features: PlanFeatures } {
  const features = extractPlanFeatures(parts, filePath)
  const model = loadModel()
  const vec = featuresToVector(features)
  let score = model.bias
  for (let i = 0; i < vec.length; i++) {
    score += (model.weights[i] ?? 0) * vec[i]!
  }
  return { score, features }
}

/** Current learned pass threshold (EMA-adapted, safety-bounded). */
export function learnedThreshold(): number {
  return loadModel().threshold
}

/**
 * Which sections a plan is missing — used for the nudge message and the
 * degenerate-plan block. Returns human-readable guidance.
 */
export function missingPlanSections(parts: SessionV1.Part[]): string[] {
  const text = parts
    .filter((p): p is SessionV1.TextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n")
  const missing: string[] = []
  // Accept both "## Section" and bare "Section" at line start.
  if (!/(?:##\s*|(?:^|\n)\s*)Approach[\s\S]{50,}/i.test(text)) missing.push("## Approach with concrete steps (what + why)")
  if (!/(?:##\s*|(?:^|\n)\s*)Correlations?[\s\S]{30,}/i.test(text)) missing.push("## Correlations naming the files you'll touch and what depends on them")
  if (!/(?:##\s*|(?:^|\n)\s*)Verification[\s\S]{20,}/i.test(text)) missing.push("## Verification with an exact command (test/build/typecheck)")
  return missing
}

/**
 * True when the plan marker matched but there is effectively no plan
 * (a bare header with < 5 chars of content — e.g. just "## Approach").
 * These are the only plans hard-blocked. Anything with even minimal real
 * content passes (with a nudge when thin): "## Approach\nRefactor the
 * loop." is a thin-but-valid plan and must stay allowed.
 */
export function isDegeneratePlan(parts: SessionV1.Part[]): boolean {
  for (const part of parts) {
    if (part.type !== "text") continue
    // Strip only the marker HEADER, keeping any content that follows it.
    // "Approach 1: rewrite; Approach 2: patch" must keep its content — the
    // strip must not eat the whole line.
    const body = part.text
      .replace(/^#{1,3}\s+(?:Approach|Plan|Analysis|Correlations?|Verification)\b.*$/gim, "")
      .replace(/^(?:Approach|Plan|Analysis|Correlations?|Verification)\s*\d*\s*[:.)-]\s*/gim, "")
      // Also strip bare keywords on their own line (no ## prefix, no content after).
      .replace(/^\s*(?:Approach|Plan|Analysis|Correlations?|Verification)\s*$/gim, "")
      .trim()
    if (body.length >= 5) return false
  }
  return true
}

// ─── Online learning ─────────────────────────────────────────────────────

// Per-message event buffer so finalizeGateLearning can label plans by the
// turn outcome. Bounded: entries are removed on finalize; cap prevents a
// pathological session from growing it forever.
const eventBuffer = new Map<string, { events: Array<{ score: number; action: string }>; hadToolError: boolean }>()

/** Record that the gate made a decision for a plan in this message. */
export function recordGateEvent(messageID: string, event: { score: number; action: "allow" | "nudge" | "block" }): void {
  if (eventBuffer.size > 500) eventBuffer.clear()
  const entry = eventBuffer.get(messageID) ?? { events: [], hadToolError: false }
  entry.events.push(event)
  eventBuffer.set(messageID, entry)
}

/** Record that this message produced a tool error / doom loop (negative signal). */
export function recordToolError(messageID: string): void {
  const entry = eventBuffer.get(messageID) ?? { events: [], hadToolError: false }
  entry.hadToolError = true
  eventBuffer.set(messageID, entry)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Apply one perceptron-style update from a labeled example.
 *   positive (good plan, clean turn): if score < θ → pull weights UP
 *   negative (plan preceded errors):  if score ≥ θ → push weights DOWN
 * Margin-based: update magnitude scales with (θ − score) so near-misses
 * learn less than big misses. Weights are clamped to safety bounds and
 * the threshold adapts via EMA toward good-plan scores.
 */
export function finalizeGateLearning(messageID: string, finishReason: string): void {
  const entry = eventBuffer.get(messageID)
  if (!entry || entry.events.length === 0) return
  eventBuffer.delete(messageID)

  const model = loadModel()
  // Finish reasons vary by provider ("stop", "end_turn", "done", "complete",
  // "finish", ...). Treat ANY terminal non-error finish as positive; a
  // "tool-calls" finish with no errors means the loop continues — neutral.
  const isPositive = !entry.hadToolError && finishReason !== "tool-calls" && finishReason !== "error" && finishReason !== "unknown"
  const isNegative = entry.hadToolError || finishReason === "error"
  if (!isPositive && !isNegative) return

  for (const ev of entry.events) {
    // Only learn from plans that were evaluated (allowed with a score);
    // raw blocks carry no plan signal.
    if (ev.action === "block" || ev.score === 0) continue
    const label = isPositive ? 1 : -1
    const margin = isPositive ? model.threshold - ev.score : ev.score - model.threshold
    if (label === 1 && margin <= 0) continue // already above threshold — nothing to learn
    if (label === -1 && margin <= 0) continue // already below threshold — nothing to learn
    const update = LEARNING_RATE * margin * label
    for (let i = 0; i < model.weights.length; i++) {
      model.weights[i] = clamp(model.weights[i]! + update * 0.25, WEIGHT_CLAMP[0], WEIGHT_CLAMP[1])
    }
  }

  // Threshold adaptation: EMA toward the observed good-plan score,
  // clamped to safety bounds (never below floor, never above ceiling).
  if (isPositive) {
    const goodScore = Math.max(...entry.events.filter((e) => e.action !== "block").map((e) => e.score))
    model.threshold = clamp(
      model.threshold + THRESHOLD_EMA_ALPHA * (goodScore - model.threshold),
      THRESHOLD_MIN,
      THRESHOLD_MAX,
    )
  }

  if (isPositive) model.stats.positives++
  else model.stats.negatives++
  saveModel(model)
}

/** Gate statistics for diagnostics / analytics. */
export function gateStats(): GateModel["stats"] {
  return { ...loadModel().stats }
}

/** Debug rendering of the current model (weights + threshold). */
export function describeModel(): string {
  const m = loadModel()
  const parts = FEATURE_NAMES.map((name, i) => `${name}=${m.weights[i]?.toFixed(2)}`).join(" ")
  return `threshold=${m.threshold.toFixed(2)} bias=${m.bias} ${parts}`
}

export * as DreamGateLearn from "./dream-gate-learn"
