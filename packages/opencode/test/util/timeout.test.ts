import { describe, expect, test } from "bun:test"
import { withTimeout, deadline, timeoutOf, TimeoutReason } from "../../src/util/timeout"

describe("util.timeout", () => {
  test("should resolve when promise completes before timeout", async () => {
    const fastPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("fast"), 10)
    })

    const result = await withTimeout(fastPromise, 100)
    expect(result).toBe("fast")
  })

  test("should reject when promise exceeds timeout", async () => {
    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("slow"), 200)
    })

    await expect(withTimeout(slowPromise, 50)).rejects.toThrow("Operation timed out after 50ms")
  })
})

describe("util.timeout.deadline", () => {
  test("aborts with TimeoutReason after the deadline", async () => {
    const d = deadline(undefined, 20, "TOOL_TIMEOUT")
    const reason: unknown = await new Promise((resolve) => {
      d.signal.addEventListener("abort", () => resolve(d.signal.reason), { once: true })
    })
    d[Symbol.dispose]()
    expect(reason).toBeInstanceOf(TimeoutReason)
    expect(timeoutOf({ signal: d.signal })).toBeInstanceOf(TimeoutReason)
    expect(timeoutOf({ signal: d.signal }, "TOOL_TIMEOUT")).toBeInstanceOf(TimeoutReason)
    expect(timeoutOf({ signal: d.signal }, "OTHER")).toBeUndefined()
  })

  test("never aborts when ms is not finite", () => {
    const d = deadline(undefined, Number.NaN, "X")
    expect(d.signal.aborted).toBe(false)
    d[Symbol.dispose]()
  })

  test("fuses upstream abort (upstream wins)", async () => {
    const upstream = new AbortController()
    const d = deadline(upstream.signal, 10_000, "TOOL_TIMEOUT")
    upstream.abort(new Error("cancelled"))
    expect(d.signal.aborted).toBe(true)
    expect(timeoutOf(d, "TOOL_TIMEOUT")).toBeUndefined()
    d[Symbol.dispose]()
    // Yield once so Bun's timer tracking sees the deadline timer cleared.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
