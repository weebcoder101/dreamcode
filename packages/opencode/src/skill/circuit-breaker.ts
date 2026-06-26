/**
 * Circuit Breaker — Shared module for execution safety
 *
 * Prevents cascading failures by tracking consecutive failures
 * and opening the circuit after a threshold. Automatically
 * recovers after a cooldown period.
 *
 * Usage:
 *   const breaker = createCircuitBreaker(3, 5 * 60 * 1000)
 *   if (breaker.isCircuitOpen()) return
 *   try { await riskyOperation(); breaker.recordSuccess() }
 *   catch { breaker.recordFailure() }
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CircuitBreakerState {
  readonly consecutiveFailures: number
  readonly isOpen: boolean
  readonly cooldownUntil: number
}

export interface CircuitBreaker {
  readonly recordSuccess: () => void
  readonly recordFailure: () => void
  readonly isCircuitOpen: () => boolean
  readonly reset: () => void
  readonly getState: () => CircuitBreakerState
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCircuitBreaker(
  threshold: number = 3,
  cooldownMs: number = 5 * 60 * 1000,
): CircuitBreaker {
  let state: CircuitBreakerState = {
    consecutiveFailures: 0,
    isOpen: false,
    cooldownUntil: 0,
  }

  const recordSuccess = (): void => {
    state = {
      consecutiveFailures: 0,
      isOpen: false,
      cooldownUntil: 0,
    }
  }

  const recordFailure = (): void => {
    const failures = state.consecutiveFailures + 1
    state = {
      consecutiveFailures: failures,
      isOpen: failures >= threshold,
      cooldownUntil: failures >= threshold
        ? Date.now() + cooldownMs
        : 0,
    }
  }

  const isCircuitOpen = (): boolean => {
    if (!state.isOpen) return false
    // Check if cooldown has expired
    if (Date.now() > state.cooldownUntil) {
      state = {
        consecutiveFailures: 0,
        isOpen: false,
        cooldownUntil: 0,
      }
      return false
    }
    return true
  }

  const reset = (): void => {
    state = {
      consecutiveFailures: 0,
      isOpen: false,
      cooldownUntil: 0,
    }
  }

  const getState = (): CircuitBreakerState => ({ ...state })

  return {
    recordSuccess,
    recordFailure,
    isCircuitOpen,
    reset,
    getState,
  }
}
