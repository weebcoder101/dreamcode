import { describe, expect, it } from "bun:test"
import { redactLogLine, refreshEnvSecrets } from "../../src/observability/redact"

const KEY = "[REDACTED]"

describe("redactLogLine", () => {
  it("redacts OpenAI API keys", () => {
    expect(redactLogLine('apiKey="sk-proj-abc123def456ghi789jkl012"')).toBe('apiKey=[REDACTED]')
    expect(redactLogLine("apiKey=sk-proj-abc123def456ghi789jkl012")).toBe("apiKey=[REDACTED]")
  })

  it("redacts Anthropic API keys", () => {
    expect(redactLogLine('auth="sk-ant-abc123def456ghi789jkl012mno345"')).toBe("auth=[REDACTED]")
  })

  it("redacts GitHub tokens", () => {
    expect(redactLogLine("token=ghp_abc123def456ghi789jkl012mno345pqr678")).toBe("token=[REDACTED]")
    expect(redactLogLine("token=gho_abc123def456ghi789jkl012mno345pqr678")).toBe("token=[REDACTED]")
    expect(redactLogLine("token=ghu_abc123def456ghi789jkl012mno345pqr678")).toBe("token=[REDACTED]")
  })

  it("redacts Google API keys", () => {
    expect(redactLogLine("key=AIzaSyABC123def456ghi789jkl012mno345pqr678")).toBe("key=[REDACTED]")
  })

  it("redacts bearer tokens in structured logs", () => {
    const line = 'message="Bearer sk-proj-abc123def456ghi789jkl012"'
    expect(redactLogLine(line)).toBe('message="[REDACTED]"')
  })

  it("redacts AWS access keys", () => {
    expect(redactLogLine("using AKIA1234567890123456 in config")).toContain(KEY)
    expect(redactLogLine("using ASIA1234567890123456 in config")).toContain(KEY)
  })

  it("redacts sensitive key=value pairs by field name", () => {
    expect(redactLogLine("apiKey=my-secret-key")).toBe("apiKey=[REDACTED]")
    expect(redactLogLine("api_key=my-secret-key")).toBe("api_key=[REDACTED]")
    expect(redactLogLine("access_token=abc123")).toBe("access_token=[REDACTED]")
    expect(redactLogLine("secret=xyz789")).toBe("secret=[REDACTED]")
    expect(redactLogLine("password=hunter2")).toBe("password=[REDACTED]")
  })

  it("does NOT redact non-sensitive key=value pairs", () => {
    expect(redactLogLine("message=hello")).toBe("message=hello")
    expect(redactLogLine("level=INFO")).toBe("level=INFO")
    expect(redactLogLine("run=abc-123")).toBe("run=abc-123")
    expect(redactLogLine("timestamp=2026-06-25T12:00:00Z")).toBe("timestamp=2026-06-25T12:00:00Z")
  })

  it("handles empty and null-like input", () => {
    expect(redactLogLine("")).toBe("")
    expect(redactLogLine("safe log line")).toBe("safe log line")
  })

  it("redacts env-derived secrets that leak into logs", () => {
    refreshEnvSecrets()
    const entry = Object.entries(process.env).find(
      ([name, value]) =>
        /(?:API|AUTH|KEY|SECRET|TOKEN)/i.test(name) && value && value.length >= 12,
    )
    if (entry) {
      const [, value] = entry
      const line = `message=using-${value}-in-log`
      const result = redactLogLine(line)
      expect(result).not.toContain(value)
      expect(result).toContain(KEY)
    }
    refreshEnvSecrets()
  })

  it("redacts multiple secrets in the same line", () => {
    const line = 'apiKey="sk-proj-abc123" token=ghp_def456789 api_key=secret123'
    const result = redactLogLine(line)
    expect(result).toBe("apiKey=[REDACTED] token=[REDACTED] api_key=[REDACTED]")
  })

  it("redacts private keys", () => {
    const line = "key=-----BEGIN RSA PRIVATE KEY-----\\nabYz...\\n-----END RSA PRIVATE KEY-----"
    expect(redactLogLine(line)).toContain(KEY)
  })
})
