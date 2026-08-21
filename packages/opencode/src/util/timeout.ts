export function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  let timeout: NodeJS.Timeout
  return Promise.race([
    promise.finally(() => {
      clearTimeout(timeout)
    }),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(label ?? `Operation timed out after ${ms}ms`))
      }, ms)
    }),
  ])
}

/**
 * AbortSignal deadline (DeepSeek Harness util/timeout pattern).
 * Returns a signal that aborts after `ms` with a distinguishable
 * TimeoutReason, fused with the upstream signal so the first abort wins.
 * Use `timeoutOf` to tell "we timed out" apart from "caller cancelled".
 */
export class TimeoutReason extends Error {
  constructor(
    public readonly code: string,
    public readonly timeoutMs: number,
  ) {
    super(`${code} after ${timeoutMs}ms`)
    this.name = "TimeoutReason"
  }
}

export function deadline(
  upstream: AbortSignal | undefined,
  ms: number,
  code: string,
): { signal: AbortSignal; [Symbol.dispose](): void } {
  if (!Number.isFinite(ms) || ms <= 0) {
    return {
      signal: upstream ?? new AbortController().signal,
      [Symbol.dispose]() {},
    }
  }
  const timer = new AbortController()
  const id = setTimeout(() => timer.abort(new TimeoutReason(code, ms)), ms)
  return {
    signal: upstream ? AbortSignal.any([upstream, timer.signal]) : timer.signal,
    [Symbol.dispose]() {
      clearTimeout(id)
    },
  }
}

export function timeoutOf(
  value: { signal?: AbortSignal },
  code?: string,
): TimeoutReason | undefined {
  const reason = value.signal?.reason
  if (!(reason instanceof TimeoutReason)) return undefined
  return code === undefined || reason.code === code ? reason : undefined
}
