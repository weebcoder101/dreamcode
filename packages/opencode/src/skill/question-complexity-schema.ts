/**
 * Question Complexity Schema
 *
 * Shared schema for complexity-rated questions that drive subagent spawning.
 * Both Python (predict.py) and TypeScript (sensor-gate.ts) use this mapping
 * to determine how many sub-agents to spawn based on question complexity.
 *
 * Complexity → spawn count mapping:
 *   low:    0-1 subagent (trivial questions, simple fixes)
 *   medium: 1-3 subagents (moderate complexity, multi-domain)
 *   high:   2-5 subagents (deep architecture, security, cross-cutting)
 */

// ---------------------------------------------------------------------------
// Complexity → Spawn Count Mapping
// ---------------------------------------------------------------------------

export const COMPLEXITY_SPAWN_MAP = {
  low:    { min: 0, max: 1, fallback: 0, label: "low" },
  medium: { min: 1, max: 3, fallback: 1, label: "medium" },
  high:   { min: 2, max: 5, fallback: 3, label: "high" },
} as const

export type ComplexityLevel = keyof typeof COMPLEXITY_SPAWN_MAP

export interface ComplexityConfig {
  readonly min: number
  readonly max: number
  readonly fallback: number
  readonly label: string
}

// ---------------------------------------------------------------------------
// Rated Question Shape
// ---------------------------------------------------------------------------

export interface RatedQuestion {
  readonly question: string
  readonly questionHash: string
  readonly category: string
  readonly complexity: ComplexityLevel
  readonly lastUsed: number
  readonly hitCount: number
}

// ---------------------------------------------------------------------------
// Numeric score for each complexity level (used in evaluateSpawnNecessity)
// ---------------------------------------------------------------------------

export const COMPLEXITY_SCORES: Record<ComplexityLevel, number> = {
  low: 0,
  medium: 2,
  high: 4,
}

// ---------------------------------------------------------------------------
// Social greeting patterns (shared across sensor gate)
// ---------------------------------------------------------------------------

export const SOCIAL_GREETING_RE = /^\s*(?:(?:say|just|please)\s+)*(hi|hello|hey|thanks|thank you|bye|goodbye|cheers|sup|yo)\b/i

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function complexityFromScore(score: number): ComplexityLevel {
  if (score >= 3) return "high"
  if (score >= 1) return "medium"
  return "low"
}

export function maxComplexityFromQuestions(questions: readonly RatedQuestion[]): ComplexityLevel {
  let maxScore = 0
  for (const q of questions) {
    const score = q.complexity === "high" ? 3 : q.complexity === "medium" ? 2 : 1
    if (score > maxScore) maxScore = score
  }
  return complexityFromScore(maxScore)
}

export function spawnCountForComplexity(complexity: ComplexityLevel): number {
  const config = COMPLEXITY_SPAWN_MAP[complexity]
  // Use the midpoint between min and max as default
  return Math.round((config.min + config.max) / 2)
}

export function isSocialGreeting(text: string): boolean {
  return SOCIAL_GREETING_RE.test(text.trim())
}

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
