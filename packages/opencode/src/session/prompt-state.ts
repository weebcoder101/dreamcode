import type { SessionID } from "./schema"
import type { ChainResult } from "@/skill/chain-executor"

// ─── Per-Turn Skill Chain Enforcement ─────────────────────────
const storedGateResultMap = new Map<SessionID, any>()
const storedScriptResultsMap = new Map<SessionID, ChainResult[]>()
const storedContentResultsMap = new Map<SessionID, ChainResult[]>()

// ─── Sensor Gate Toggle (Persisted) ─────────────────────────────
// Global toggle: when true (GATE button ON, green), sensor gate is in
// FULL mode — classification, skill chain, enforcement, and persona
// spawning all run normally.
// When false (GATE OFF, warning color), the gate is in MINIMAL mode:
// classification, skill chain, and enforcement still run, but persona
// spawning is DISABLED to reduce cost.
// Set by the TUI toggle button ("GATE" / "GATE OFF").
// State is persisted to a JSON file so it survives process restarts.
// Uses a module-level cache to avoid filesystem reads on hot path.
import { join } from "path"
import { tmpdir } from "os"
import { existsSync, readFileSync, writeFileSync, renameSync } from "fs"

const SENSOR_GATE_STATE_FILE = join(tmpdir(), ".opencode-sensor-gate-state.json")

// Gate state: true = ENABLED (ON, full mode — personas spawn),
// false = DISABLED (OFF, minimal cost mode — no personas).
// NOTE: this is the OPPOSITE polarity of the old "sensorGateBlocked" variable,
// which was true when the gate was ON ("blocking"). The rename fixes the
// naming-is-a-lie problem: "blocked" sounded like it blocked personas, but
// blocked=true actually meant the gate was ON (full mode, personas allowed).
let sensorGateEnabled: boolean | null = null

/** Shared signal string so producer (prompt.ts) and consumer (sensor-gate-enforcer.ts) stay coupled. */
export const SENSOR_GATE_MINIMAL_SIGNAL = '<sensor-gate state="minimal">'

function readGateEnabledState(): boolean {
  if (sensorGateEnabled !== null) return sensorGateEnabled
  try {
    if (existsSync(SENSOR_GATE_STATE_FILE)) {
      const data = JSON.parse(readFileSync(SENSOR_GATE_STATE_FILE, "utf-8"))
      // Migrate from old keys:
      //   "disabled": true/false (gate OFF/ON) — v1.4.3 and earlier
      //   "blocked": true/false (gate ON/OFF) — v1.4.4 (inverted semantics)
      //   "enabled": true/false (gate ON/OFF) — current (correct semantics)
      if (data.enabled !== undefined) {
        sensorGateEnabled = data.enabled === true
      } else if (data.blocked !== undefined) {
        // blocked=true meant gate was ON (full mode) — map to enabled=true
        sensorGateEnabled = data.blocked === true
      } else if (data.disabled !== undefined) {
        // disabled=true meant gate was OFF (inactive) — map to enabled=false
        sensorGateEnabled = data.disabled !== true
      } else {
        sensorGateEnabled = true
      }
      return sensorGateEnabled
    }
  } catch {
    // File corrupt or missing — treat as enabled (gate ON)
  }
  sensorGateEnabled = true
  return true
}

function writeGateEnabledState(enabled: boolean): void {
  sensorGateEnabled = enabled
  try {
    // Atomic write: write to temp file then rename (POSIX rename is atomic),
    // so concurrent toggle requests never read a half-written state file.
    const tmp = SENSOR_GATE_STATE_FILE + ".tmp"
    writeFileSync(tmp, JSON.stringify({ enabled }), "utf-8")
    renameSync(tmp, SENSOR_GATE_STATE_FILE)
  } catch {
    // Best-effort persistence — state still works in-memory for this session
  }
}

export function setSensorGateEnabled(enabled: boolean): void {
  writeGateEnabledState(enabled)
  // Always clear stored gate results on state change so per-turn
  // enforcement doesn't use stale classifications from a prior state.
  // When enabling (gate ON), prevents stale data from leaking through.
  // When disabling (gate OFF), prevents ON-state chain data from
  // persisting into minimal-cost mode.
  storedGateResultMap.clear()
  storedScriptResultsMap.clear()
  storedContentResultsMap.clear()
}

export function isSensorGateEnabled(): boolean {
  return readGateEnabledState()
}

// ─── Periodic Refresh ─────────────────────────────────────────────
// Re-reads the gate state file on a timer so that in-flight subagents
// and enforcer plugins eventually observe toggle changes even when no
// new prompt arrives. Without this, a toggle during active execution
// goes unnoticed until the next user message.
let refreshTimer: ReturnType<typeof setInterval> | null = null

export function startGateRefresh(intervalMs = 10_000): void {
  if (refreshTimer) return
  refreshTimer = setInterval(() => {
    const old = sensorGateEnabled
    readGateEnabledState()
    if (old !== sensorGateEnabled) {
      console.log(`[sensor-gate] State changed: ${old} → ${sensorGateEnabled}`)
    }
  }, intervalMs)
  refreshTimer.unref()
}

export function stopGateRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
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
  // Scan ONLY the tail of the message. Explicit spawn directives live in the
  // user's own closing words; matches deeper in the text come overwhelmingly
  // from pasted transcripts/logs (e.g. "use 4-5 subagents" quoted inside a
  // session dump) and must not trigger the hard spawn override.
  const TAIL_CHARS = 400
  const tail = text.length > TAIL_CHARS ? text.slice(-TAIL_CHARS) : text
  const match = tail.match(/(?:spawn|use|run|deploy)\s+(\d+)\s+(?:agent|subagent|specialist|persona)/i)
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

// ─── Token Budget per Session ───────────────────────────────────
// Prevents runaway token consumption from persona subagents.
// Limits are per-session and reset when a new session starts.
const TOKEN_BUDGET_MAP = new Map<SessionID, { used: number; limit: number }>()

const DEFAULT_TOKEN_LIMITS: Record<string, number> = {
  simple: 50_000,
  medium: 150_000,
  complex: 500_000,
}

export function checkTokenBudget(sessionID: SessionID, complexity: string): boolean {
  const limit = DEFAULT_TOKEN_LIMITS[complexity] ?? DEFAULT_TOKEN_LIMITS.medium
  const current = TOKEN_BUDGET_MAP.get(sessionID)
  if (!current) {
    TOKEN_BUDGET_MAP.set(sessionID, { used: 0, limit })
    return true
  }
  return current.used < current.limit
}

export function recordTokenUsage(sessionID: SessionID, tokens: number) {
  const current = TOKEN_BUDGET_MAP.get(sessionID) ?? { used: 0, limit: DEFAULT_TOKEN_LIMITS.medium }
  current.used += tokens
  TOKEN_BUDGET_MAP.set(sessionID, current)
}

export function resetTokenBudget(sessionID: SessionID) {
  TOKEN_BUDGET_MAP.delete(sessionID)
}

/**
 * Clean up ALL per-session state stored in module-level Maps. Must be called
 * when a session ends (cancel, complete, error) to prevent unbounded memory
 * growth on long-running servers.
 *
 * The 3 "stored*" Maps and TOKEN_BUDGET_MAP were previously leaked — they
 * grew proportionally to (sessions × turns) for the lifetime of the process.
 * See P0-03/P0-04 in the test audit.
 */
export function cleanupSession(sessionID: SessionID) {
  storedGateResultMap.delete(sessionID)
  storedScriptResultsMap.delete(sessionID)
  storedContentResultsMap.delete(sessionID)
  personaRoundMap.delete(sessionID)
  spawnHistory.delete(sessionID)
  TOKEN_BUDGET_MAP.delete(sessionID)
}
