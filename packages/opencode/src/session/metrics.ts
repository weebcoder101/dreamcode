// ─── Session Performance Metrics (§8.1) ──────────────────────────────────
// Track per-session metrics for visibility into token usage, cache hit rates,
// and task completion efficiency. Persisted to disk for analytics.

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { Global } from "@opencode-ai/core/global"

export interface SessionMetrics {
  /** Unique session identifier */
  sessionID: string
  /** Timestamp of metric creation */
  createdAt: number
  /** Timestamp of last update */
  updatedAt: number

  // ─── Token Metrics ────────────────────────────────────────────────
  /** Total input tokens consumed */
  totalInputTokens: number
  /** Total output tokens generated */
  totalOutputTokens: number
  /** Total reasoning tokens (CoT) */
  totalReasoningTokens: number
  /** Tokens read from cache */
  cacheReadTokens: number
  /** Tokens written to cache */
  cacheWriteTokens: number
  /** Computed cache hit rate (cacheRead / (cacheRead + cacheWrite + input)) */
  cacheHitRate: number

  // ─── Turn Metrics ─────────────────────────────────────────────────
  /** Number of turns completed */
  turns: number
  /** Number of tool calls made */
  toolCalls: number
  /** Number of gate blocks (Dream Protocol) */
  gateBlocks: number
  /** Number of compactions triggered */
  compactions: number
  /** Average tokens per turn */
  avgTokensPerTurn: number
  /** Average tool calls per turn */
  avgToolCallsPerTurn: number

  // ─── Cost Metrics ─────────────────────────────────────────────────
  /** Estimated cost in USD */
  estimatedCostUSD: number

  // ─── Quality Metrics ──────────────────────────────────────────────
  /** Number of corrections received */
  corrections: number
  /** Number of context drift warnings */
  driftWarnings: number
  /** Number of doom loop detections */
  doomLoopDetections: number
}

const METRICS_DIR = join(Global.Path.data, "metrics")

function ensureDir(dir: string) {
  try { mkdirSync(dir, { recursive: true }) } catch {}
}

function metricsPath(sessionID: string): string {
  return join(METRICS_DIR, `${sessionID}.json`)
}

/**
 * Create a new metrics instance for a session.
 */
export function createMetrics(sessionID: string): SessionMetrics {
  return {
    sessionID,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalReasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheHitRate: 0,
    turns: 0,
    toolCalls: 0,
    gateBlocks: 0,
    compactions: 0,
    avgTokensPerTurn: 0,
    avgToolCallsPerTurn: 0,
    estimatedCostUSD: 0,
    corrections: 0,
    driftWarnings: 0,
    doomLoopDetections: 0,
  }
}

/**
 * Update metrics with new token usage data.
 */
export function updateTokenUsage(
  metrics: SessionMetrics,
  usage: { input: number; output: number; reasoning?: number; cache?: { read: number; write: number } },
  cost?: number,
): SessionMetrics {
  const updated = { ...metrics, updatedAt: Date.now() }
  updated.totalInputTokens += usage.input
  updated.totalOutputTokens += usage.output
  updated.totalReasoningTokens += usage.reasoning ?? 0
  updated.cacheReadTokens += usage.cache?.read ?? 0
  updated.cacheWriteTokens += usage.cache?.write ?? 0

  // Recompute cache hit rate
  const totalCacheable = updated.cacheReadTokens + updated.cacheWriteTokens + updated.totalInputTokens
  updated.cacheHitRate = totalCacheable > 0 ? updated.cacheReadTokens / totalCacheable : 0

  // Recompute averages
  updated.avgTokensPerTurn = updated.turns > 0
    ? Math.round((updated.totalInputTokens + updated.totalOutputTokens) / updated.turns)
    : 0
  updated.avgToolCallsPerTurn = updated.turns > 0
    ? Math.round(updated.toolCalls / updated.turns * 10) / 10
    : 0

  if (cost) updated.estimatedCostUSD += cost
  return updated
}

/**
 * Record a completed turn.
 */
export function recordTurn(metrics: SessionMetrics, toolCallCount: number): SessionMetrics {
  const updated = { ...metrics, updatedAt: Date.now(), turns: metrics.turns + 1 }
  updated.toolCalls += toolCallCount
  updated.avgToolCallsPerTurn = updated.turns > 0
    ? Math.round(updated.toolCalls / updated.turns * 10) / 10
    : 0
  updated.avgTokensPerTurn = updated.turns > 0
    ? Math.round((updated.totalInputTokens + updated.totalOutputTokens) / updated.turns)
    : 0
  return updated
}

/**
 * Record a gate block event.
 */
export function recordGateBlock(metrics: SessionMetrics): SessionMetrics {
  return { ...metrics, updatedAt: Date.now(), gateBlocks: metrics.gateBlocks + 1 }
}

/**
 * Record a compaction event.
 */
export function recordCompaction(metrics: SessionMetrics): SessionMetrics {
  return { ...metrics, updatedAt: Date.now(), compactions: metrics.compactions + 1 }
}

/**
 * Record a correction event.
 */
export function recordCorrection(metrics: SessionMetrics): SessionMetrics {
  return { ...metrics, updatedAt: Date.now(), corrections: metrics.corrections + 1 }
}

/**
 * Record a drift warning.
 */
export function recordDriftWarning(metrics: SessionMetrics): SessionMetrics {
  return { ...metrics, updatedAt: Date.now(), driftWarnings: metrics.driftWarnings + 1 }
}

/**
 * Record a doom loop detection.
 */
export function recordDoomLoop(metrics: SessionMetrics): SessionMetrics {
  return { ...metrics, updatedAt: Date.now(), doomLoopDetections: metrics.doomLoopDetections + 1 }
}

/**
 * Persist metrics to disk.
 */
export function persistMetrics(metrics: SessionMetrics): void {
  ensureDir(METRICS_DIR)
  const path = metricsPath(metrics.sessionID)
  try {
    writeFileSync(path, JSON.stringify(metrics, null, 2))
  } catch {}
}

/**
 * Load metrics from disk.
 */
export function loadMetrics(sessionID: string): SessionMetrics | null {
  const path = metricsPath(sessionID)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SessionMetrics
  } catch {
    return null
  }
}

/**
 * Format metrics as a compact status bar string.
 */
export function formatMetrics(metrics: SessionMetrics): string {
  const cachePct = Math.round(metrics.cacheHitRate * 100)
  const tokensK = Math.round((metrics.totalInputTokens + metrics.totalOutputTokens) / 1000)
  const costStr = metrics.estimatedCostUSD > 0 ? `|$${metrics.estimatedCostUSD.toFixed(3)}` : ""
  return `Cache: ${cachePct}% | Tokens: ${tokensK}K | Tools: ${metrics.toolCalls}${costStr}`
}

export * as SessionMetrics from "./metrics"
