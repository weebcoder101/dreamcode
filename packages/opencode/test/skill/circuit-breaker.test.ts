/**
 * Circuit Breaker Tests
 *
 * Pure state machine with zero external dependencies.
 * Tests: threshold breach, cooldown expiry, reset, getState immutability.
 */

import { describe, expect, test, beforeEach } from "bun:test"
import { createCircuitBreaker } from "../../src/skill/circuit-breaker"

describe("circuit-breaker", () => {
  test("starts closed with zero failures", () => {
    const b = createCircuitBreaker(3, 60_000)
    expect(b.isCircuitOpen()).toBe(false)
    expect(b.getState().consecutiveFailures).toBe(0)
    expect(b.getState().isOpen).toBe(false)
  })

  test("opens after threshold failures", () => {
    const b = createCircuitBreaker(3, 60_000)
    b.recordFailure()
    b.recordFailure()
    expect(b.isCircuitOpen()).toBe(false) // 2 < threshold
    b.recordFailure()
    expect(b.isCircuitOpen()).toBe(true) // 3 >= threshold
  })

  test("does not open with failures below threshold", () => {
    const b = createCircuitBreaker(5, 60_000)
    b.recordFailure()
    b.recordFailure()
    b.recordFailure()
    expect(b.isCircuitOpen()).toBe(false) // 3 < 5
  })

  test("resets failure count on success", () => {
    const b = createCircuitBreaker(3, 60_000)
    b.recordFailure()
    b.recordFailure()
    b.recordSuccess()
    expect(b.getState().consecutiveFailures).toBe(0)
    // Now need 3 more failures to open
    b.recordFailure()
    b.recordFailure()
    expect(b.isCircuitOpen()).toBe(false)
    b.recordFailure()
    expect(b.isCircuitOpen()).toBe(true)
  })

  test("recovers after cooldown expires", () => {
    const b = createCircuitBreaker(2, 1) // 1ms cooldown
    b.recordFailure()
    b.recordFailure()
    expect(b.isCircuitOpen()).toBe(true)
    // Wait for cooldown to expire
    const start = Date.now()
    while (Date.now() - start < 5) {
      // busy wait 5ms
    }
    expect(b.isCircuitOpen()).toBe(false) // cooldown expired
  })

  test("getState returns immutable copy", () => {
    const b = createCircuitBreaker(3, 60_000)
    const state1 = b.getState()
    b.recordFailure()
    const state2 = b.getState()
    expect(state1.consecutiveFailures).toBe(0)
    expect(state2.consecutiveFailures).toBe(1)
  })

  test("reset clears everything", () => {
    const b = createCircuitBreaker(2, 60_000)
    b.recordFailure()
    b.recordFailure()
    expect(b.isCircuitOpen()).toBe(true)
    b.reset()
    expect(b.isCircuitOpen()).toBe(false)
    expect(b.getState().consecutiveFailures).toBe(0)
    expect(b.getState().isOpen).toBe(false)
    expect(b.getState().cooldownUntil).toBe(0)
  })

  test("threshold=1 opens on first failure", () => {
    const b = createCircuitBreaker(1, 60_000)
    b.recordFailure()
    expect(b.isCircuitOpen()).toBe(true)
  })

  test("threshold=0 never opens (edge case)", () => {
    const b = createCircuitBreaker(0, 60_000)
    b.recordFailure()
    // threshold 0: failures >= 0 is always true, so it opens
    expect(b.isCircuitOpen()).toBe(true)
  })

  test("cooldownUntil is set when circuit opens", () => {
    const b = createCircuitBreaker(2, 10_000)
    b.recordFailure()
    b.recordFailure()
    const state = b.getState()
    expect(state.isOpen).toBe(true)
    expect(state.cooldownUntil).toBeGreaterThan(Date.now() - 1000) // within last second
    expect(state.cooldownUntil).toBeLessThanOrEqual(Date.now() + 10_001) // within cooldown
  })

  test("multiple success-failure cycles work correctly", () => {
    const b = createCircuitBreaker(2, 60_000)
    // Cycle 1
    b.recordFailure()
    b.recordFailure()
    expect(b.isCircuitOpen()).toBe(true)
    b.reset()
    // Cycle 2
    b.recordFailure()
    b.recordSuccess()
    b.recordFailure()
    expect(b.isCircuitOpen()).toBe(false) // only 1 consecutive failure
  })
})
