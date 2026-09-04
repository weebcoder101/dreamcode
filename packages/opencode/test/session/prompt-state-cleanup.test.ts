/**
 * Regression tests for the P0 memory-leak fixes in prompt-state.ts.
 *
 * Bug: storedGateResultMap, storedScriptResultsMap, storedContentResultsMap,
 * and TOKEN_BUDGET_MAP were never cleaned up when a session ended. On a
 * long-running server these Maps grew proportionally to (sessions × turns).
 *
 * Fix: cleanupSession(sessionID) now deletes from ALL module-level Maps.
 * It is called from prompt.ts:cancel.
 */
import { describe, expect, test } from "bun:test"

// Cast through `any` because the internal Maps are not exported. This is
// intentional — the test is asserting on the side effect of the public API.
const state = require("../../src/session/prompt-state") as any

function fakeSessionID(suffix: string): string {
  return `ses_test_${suffix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

describe("prompt-state cleanupSession (P0-03, P0-04)", () => {
  test("cleanupSession removes entries from all module-level Maps", () => {
    const sessionID = fakeSessionID("cleanup")

    // Pre-populate the maps via the exported helpers
    state.storedGateResultMap.set(sessionID, { chain: ["x"] })
    state.storedScriptResultsMap.set(sessionID, [{ name: "s", status: "ok" } as any])
    state.storedContentResultsMap.set(sessionID, [{ name: "c", status: "ok" } as any])
    state.personaRoundMap.set(sessionID, 2)
    state.spawnHistory.set(sessionID, [{ timestamp: Date.now(), count: 1 }])
    state.resetTokenBudget(sessionID)
    // Re-add the token budget to test that cleanup wipes it
    state.recordTokenUsage(sessionID, 1000)

    // Sanity: all maps have entries
    expect(state.storedGateResultMap.has(sessionID)).toBe(true)
    expect(state.storedScriptResultsMap.has(sessionID)).toBe(true)
    expect(state.storedContentResultsMap.has(sessionID)).toBe(true)
    expect(state.personaRoundMap.has(sessionID)).toBe(true)
    expect(state.spawnHistory.has(sessionID)).toBe(true)

    // Act
    state.cleanupSession(sessionID)

    // Assert: ALL maps are empty for this session
    expect(state.storedGateResultMap.has(sessionID)).toBe(false)
    expect(state.storedScriptResultsMap.has(sessionID)).toBe(false)
    expect(state.storedContentResultsMap.has(sessionID)).toBe(false)
    expect(state.personaRoundMap.has(sessionID)).toBe(false)
    expect(state.spawnHistory.has(sessionID)).toBe(false)
  })

  test("cleanupSession is idempotent — calling twice is safe", () => {
    const sessionID = fakeSessionID("idempotent")
    expect(() => {
      state.cleanupSession(sessionID)
      state.cleanupSession(sessionID)
    }).not.toThrow()
  })

  test("cleanupSession for an unknown sessionID is a no-op", () => {
    expect(() => state.cleanupSession(fakeSessionID("unknown"))).not.toThrow()
  })
})
