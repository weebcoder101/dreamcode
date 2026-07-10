import type { SessionID } from "./schema"
import type { ChainResult } from "@/skill/chain-executor"

// ─── Per-Turn Skill Chain Enforcement ─────────────────────────
const storedGateResultMap = new Map<SessionID, any>()
const storedScriptResultsMap = new Map<SessionID, ChainResult[]>()
const storedContentResultsMap = new Map<SessionID, ChainResult[]>()

// ─── Sensor Gate Toggle ─────────────────────────────────────────
// Global toggle: when true, sensor gate classification is skipped
// for ALL prompts but the skill chain pipeline still runs.
// Set by the TUI toggle button ("GATE" / "GATE OFF").
let sensorGateGloballyDisabled = false

export function setSensorGateGloballyDisabled(disabled: boolean): void {
  sensorGateGloballyDisabled = disabled
}

export function isSensorGateGloballyDisabled(): boolean {
  return sensorGateGloballyDisabled
}

// ─── Persona Round Tracking ────────────────────────────────────
const personaRoundMap = new Map<SessionID, number>()

// ─── Rolling-Window Rate Limiter ─────────────────────────────────
// Max 5 persona spawns per 5-minute window per session.
const RATE_WINDOW_MS = 5 * 60 * 1000
const RATE_MAX_SPAWNS = 5

const spawnHistory = new Map<SessionID, Array<{ timestamp: number; count: number }>>()

function checkRateLimit(sessionID: SessionID): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now()
  const history = spawnHistory.get(sessionID) ?? []
  const valid = history.filter((e) => now - e.timestamp < RATE_WINDOW_MS)
  spawnHistory.set(sessionID, valid)
  const totalSpawns = valid.reduce((sum, e) => sum + e.count, 0)
  if (totalSpawns >= RATE_MAX_SPAWNS) {
    const oldestInWindow = valid[0]
    const resetMs = oldestInWindow ? RATE_WINDOW_MS - (now - oldestInWindow.timestamp) : RATE_WINDOW_MS
    return { allowed: false, remaining: 0, resetMs }
  }
  return { allowed: true, remaining: RATE_MAX_SPAWNS - totalSpawns, resetMs: RATE_WINDOW_MS }
}

function recordSpawn(sessionID: SessionID, count: number) {
  const history = spawnHistory.get(sessionID) ?? []
  history.push({ timestamp: Date.now(), count })
  spawnHistory.set(sessionID, history)
}

function parseExplicitSpawnCount(text: string): number {
  const match = text.match(/(?:spawn|use|run|deploy)\s+(\d+)\s+(?:agent|subagent|specialist|persona)/i)
  return match ? Math.min(parseInt(match[1], 10), RATE_MAX_SPAWNS) : 0
}

export {
  storedGateResultMap,
  storedScriptResultsMap,
  storedContentResultsMap,
  personaRoundMap,
  RATE_WINDOW_MS,
  RATE_MAX_SPAWNS,
  spawnHistory,
  checkRateLimit,
  recordSpawn,
  parseExplicitSpawnCount,
}
