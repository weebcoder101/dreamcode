import { describe, expect, test } from "bun:test"
import { wrapClientError } from "../src/error-interceptor"

function makeRequest(method = "POST", url = "https://opencode.test/session/s1/prompt_async") {
  return new Request(url, { method })
}

function makeResponse(status = 500, statusText = "Internal Server Error", body?: string) {
  const init: ResponseInit = { status, statusText }
  return body ? new Response(body, init) : new Response(init)
}

describe("wrapClientError", () => {
  test("returns original Error instances unchanged", () => {
    const original = new Error("already an error")
    const result = wrapClientError(original, makeResponse(), makeRequest(), { throwOnError: true })
    expect(result).toBe(original)
  })

  test("wraps a named-error POJO into an Error", () => {
    const pojo = { data: { message: "session not found" } }
    const result = wrapClientError(pojo, makeResponse(404), makeRequest(), { throwOnError: true })
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe("session not found")
  })

  test("falls back to .message field when .data.message is absent", () => {
    const pojo = { message: "rate limited" }
    const result = wrapClientError(pojo, makeResponse(429), makeRequest(), { throwOnError: true })
    expect((result as Error).message).toBe("rate limited")
  })

  test("falls back to .name field when .data.message and .message are absent", () => {
    const pojo = { name: "ValidationError" }
    const result = wrapClientError(pojo, makeResponse(400), makeRequest(), { throwOnError: true })
    expect((result as Error).message).toBe("ValidationError")
  })

  test("uses describe fallback when all fields are missing", () => {
    const pojo = { code: "UNKNOWN" }
    const result = wrapClientError(pojo, makeResponse(502), makeRequest(), { throwOnError: true })
    expect((result as Error).message).toContain("502")
    expect((result as Error).message).toContain("POST")
  })

  test("wraps a string error into an Error", () => {
    const result = wrapClientError("ECONNRESET", makeResponse(), makeRequest(), { throwOnError: true })
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe("ECONNRESET")
  })

  test("wraps an empty-body network error (no response)", () => {
    const result = wrapClientError(undefined, undefined, makeRequest(), { throwOnError: true })
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain("network error (no response)")
    expect((result as Error).message).toContain("POST")
  })

  test("wraps an empty-body response into an Error", () => {
    const result = wrapClientError(null, makeResponse(), makeRequest(), { throwOnError: true })
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain("empty response body")
  })

  test("wraps an empty object into an Error", () => {
    const result = wrapClientError({}, makeResponse(500), makeRequest(), { throwOnError: true })
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain("500")
  })

  test("preserves cause.body and cause.status", () => {
    const pojo = { data: { message: "auth required" } }
    const result = wrapClientError(pojo, makeResponse(401), makeRequest(), { throwOnError: true })
    const cause = (result as Error).cause as { body: unknown; status: number | undefined }
    expect(cause.body).toBe(pojo)
    expect(cause.status).toBe(401)
  })

  test("returns the original error when throwOnError is false", () => {
    const pojo = { data: { message: "ignored" } }
    const result = wrapClientError(pojo, makeResponse(), makeRequest(), { throwOnError: false })
    expect(result).toBe(pojo)
  })

  test("returns the original error when opts is undefined", () => {
    const pojo = { data: { message: "ignored" } }
    const result = wrapClientError(pojo, makeResponse(), makeRequest(), undefined)
    expect(result).toBe(pojo)
  })

  test("includes method and URL in the description", () => {
    const result = wrapClientError(undefined, undefined, new Request("https://my.host/api/v1/test"), {
      throwOnError: true,
    })
    expect((result as Error).message).toContain("GET")
    expect((result).message).toContain("my.host")
  })

  test("includes statusText in the description when present", () => {
    const response = new Response(null, { status: 403, statusText: "Forbidden" })
    const result = wrapClientError(undefined, response, makeRequest(), { throwOnError: true })
    expect((result as Error).message).toContain("Forbidden")
  })
})
