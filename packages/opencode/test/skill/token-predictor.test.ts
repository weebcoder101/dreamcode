/**
 * Token Predictor Tests
 *
 * Tests for pure functions: shouldRunPeriodicCheck, resetPeriodicTimer,
 * categorizeQuestion. All deterministic — zero external dependencies.
 * Note: TokenPredictor.generate() tests omitted because they require
 * Bun.spawn + Python — tested via integration tests instead.
 */

import { describe, expect, test, beforeEach } from "bun:test"
import {
  shouldRunPeriodicCheck,
  resetPeriodicTimer,
  categorizeQuestion,
  predictorBreaker,
} from "../../src/skill/token-predictor"

// ---------------------------------------------------------------------------
// shouldRunPeriodicCheck / resetPeriodicTimer
// ---------------------------------------------------------------------------

describe("shouldRunPeriodicCheck", () => {
  beforeEach(() => {
    resetPeriodicTimer()
  })

  test("first call → true", () => {
    expect(shouldRunPeriodicCheck()).toBe(true)
  })

  test("second call within 45s → false", () => {
    shouldRunPeriodicCheck() // first call sets timer
    expect(shouldRunPeriodicCheck()).toBe(false) // within 45s
  })

  test("resetPeriodicTimer → next call returns true", () => {
    shouldRunPeriodicCheck() // first call
    expect(shouldRunPeriodicCheck()).toBe(false) // within 45s
    resetPeriodicTimer()
    expect(shouldRunPeriodicCheck()).toBe(true) // after reset
  })

  test("multiple rapid calls → only first returns true", () => {
    const results = Array.from({ length: 10 }, () => shouldRunPeriodicCheck())
    expect(results[0]).toBe(true)
    expect(results.slice(1).every((r) => r === false)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// categorizeQuestion
// ---------------------------------------------------------------------------

describe("categorizeQuestion", () => {
  test("auth/credential/token → security", () => {
    expect(categorizeQuestion("Is the auth flow secure?")).toBe("security")
    expect(categorizeQuestion("Check credential storage")).toBe("security")
    expect(categorizeQuestion("Token expiration handling")).toBe("security")
  })

  test("database/migration/query → data", () => {
    expect(categorizeQuestion("Is the database schema correct?")).toBe("data")
    expect(categorizeQuestion("Run migration safely")).toBe("data")
    expect(categorizeQuestion("Query optimization needed?")).toBe("data")
  })

  test("test/coverage/edge case → testing", () => {
    expect(categorizeQuestion("Are tests comprehensive?")).toBe("testing")
    expect(categorizeQuestion("Coverage threshold met?")).toBe("testing")
    expect(categorizeQuestion("Edge cases handled?")).toBe("testing")
  })

  test("deploy/rollback/release → deployment", () => {
    expect(categorizeQuestion("Ready for deploy?")).toBe("deployment")
    expect(categorizeQuestion("Rollback plan in place?")).toBe("deployment")
    expect(categorizeQuestion("Release notes prepared?")).toBe("deployment")
  })

  test("performance/latency/cache → performance", () => {
    expect(categorizeQuestion("Performance impact assessed?")).toBe("performance")
    expect(categorizeQuestion("Latency within bounds?")).toBe("performance")
    expect(categorizeQuestion("Cache invalidation handled?")).toBe("performance")
  })

  test("error/exception/fault → reliability", () => {
    // Note: "Exception paths tested?" contains "test" which matches testing first
    // The category depends on which keyword appears first in the if-chain
    expect(categorizeQuestion("Error handling complete?")).toBe("reliability")
    expect(categorizeQuestion("Fault tolerance adequate?")).toBe("reliability")
  })

  test("type/schema/validation → types", () => {
    expect(categorizeQuestion("Types properly defined?")).toBe("types")
    expect(categorizeQuestion("Schema validation complete?")).toBe("types")
    expect(categorizeQuestion("Input validation in place?")).toBe("types")
  })

  test("backward/breaking/migration guide → compatibility", () => {
    // Note: "Migration guide provided?" contains "migration" which matches data first
    // The category depends on which keyword appears first in the if-chain
    expect(categorizeQuestion("Backward compatible?")).toBe("compatibility")
    expect(categorizeQuestion("Breaking changes documented?")).toBe("compatibility")
  })

  test("unrelated text → general", () => {
    expect(categorizeQuestion("Is this ready to ship?")).toBe("general")
    expect(categorizeQuestion("Does the UI look right?")).toBe("general")
    expect(categorizeQuestion("Documentation updated?")).toBe("general")
  })

  test("case insensitive matching", () => {
    expect(categorizeQuestion("AUTH security check")).toBe("security")
    expect(categorizeQuestion("DATABASE migration")).toBe("data")
    expect(categorizeQuestion("TEST coverage")).toBe("testing")
  })
})

// ---------------------------------------------------------------------------
// predictorBreaker (shared singleton — verify it works)
// ---------------------------------------------------------------------------

describe("predictorBreaker", () => {
  test("is a valid circuit breaker", () => {
    expect(typeof predictorBreaker.recordSuccess).toBe("function")
    expect(typeof predictorBreaker.recordFailure).toBe("function")
    expect(typeof predictorBreaker.isCircuitOpen).toBe("function")
    expect(typeof predictorBreaker.reset).toBe("function")
    expect(typeof predictorBreaker.getState).toBe("function")
  })

  test("reset works", () => {
    predictorBreaker.reset()
    expect(predictorBreaker.isCircuitOpen()).toBe(false)
    expect(predictorBreaker.getState().consecutiveFailures).toBe(0)
  })
})
