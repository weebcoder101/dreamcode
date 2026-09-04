/**
 * Log redaction — strips secrets and sensitive values from structured log output
 * before they reach the log file or stderr.
 *
 * Uses the same pattern library as packages/http-recorder/src/redaction.ts
 * (bearer tokens, API keys, private keys, env-derived secrets) plus log-specific
 * field-name matching for key=value structured logs.
 */

// ── Well-known secret patterns (mirrors http-recorder/redaction.ts) ──────────

const SECRET_PATTERNS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: "bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/g },
  { label: "OpenAI API key", pattern: /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{20,}\b/g },
  { label: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { label: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
  { label: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { label: "private key", pattern: /-----BEGIN\s[A-Z\s]*PRIVATE\sKEY-----[\s\S]*?-----END\s[A-Z\s]*PRIVATE\sKEY-----/g },
]

// ── Env-derived secret values ───────────────────────────────────────────────

const ENV_SECRET_NAMES = /(?:API|AUTH|BEARER|CREDENTIAL|KEY|PASSWORD|SECRET|TOKEN)/i
const SAFE_ENV_VALUES = new Set(["fixture", "test", "test-key"])

const envSecrets = (): ReadonlyArray<{ readonly name: string; readonly value: string }> =>
  Object.entries(process.env).flatMap(([name, value]) => {
    if (!value) return []
    if (!ENV_SECRET_NAMES.test(name)) return []
    if (value.length < 12) return []
    if (SAFE_ENV_VALUES.has(value.toLowerCase())) return []
    return [{ name, value }]
  })

// ── Structured key=value redaction (log-specific) ───────────────────────────
// When the logger outputs key=value pairs, redact values whose keys match
// sensitive field names.

const SENSITIVE_LOG_KEYS = [
  "apiKey",
  "api_key",
  "apikey",
  "access_token",
  "auth",
  "authorization",
  "bearer",
  "client_secret",
  "credential",
  "password",
  "refresh_token",
  "secret",
  "session_key",
  "token",
]

const normalizeKey = (key: string) => key.replace(/[^a-z0-9]/gi, "").toLowerCase()
const sensitiveKeySet = new Set(SENSITIVE_LOG_KEYS.map(normalizeKey))

const KEY_VALUE_PAIR = /(\w[\w.-]*)=(?:"([^"\\]*)"|([^\s"]+))/g

// ── Main redact function ────────────────────────────────────────────────────

/**
 * Redact known secret patterns and env-derived secret values from a log line.
 *
 * Returns the redacted string with all matched secrets replaced by
 * `"[REDACTED]"`.  Also substitutes key=value pairs whose key name matches
 * a sensitive field (e.g. `apiKey=sk-abc…` → `apiKey=[REDACTED]`).
 *
 * F-REDACT-1 (P2): the env-derived secret list is recomputed on every call so
 * that long-running processes pick up new env-derived secrets (e.g. set after
 * module load by a test, plugin reload, or env-mutating tool). The cost of
 * `Object.entries(process.env)` is microseconds.
 */
export const redactLogLine = (line: string): string => {
  if (!line) return line

  // 1. Redact known API key / token / private key patterns
  let result = line
  for (const entry of SECRET_PATTERNS) {
    result = result.replace(entry.pattern, "[REDACTED]")
  }

  // 2. Redact structured key=value pairs whose key is sensitive
  //    e.g.  apiKey=sk-xxx  →  apiKey=[REDACTED]
  result = result.replace(KEY_VALUE_PAIR, (match, key, quoted, unquoted) => {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase()
    if (sensitiveKeySet.has(normalized)) {
      // Keep the key, redact the value
      const rawValue = quoted ?? unquoted
      return `${key}=${rawValue.length > 0 ? "[REDACTED]" : ""}`
    }
    return match
  })

  // 3. Redact env-derived secret values that appear in the log.
  //    Recomputed on every call (no cache) so post-startup env mutations
  //    are caught. The walk is cheap.
  for (const entry of envSecrets()) {
    // Escape the value for use in a regex
    const escaped = entry.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    result = result.replace(new RegExp(escaped, "g"), "[REDACTED]")
  }

  return result
}

/**
 * Force-refresh the cached env secret list (no-op kept for backward
 * compatibility — the cache was removed in F-REDACT-1, so there is nothing
 * to refresh. Tests that mutate process.env mid-process no longer need to
 * call this; the next redactLogLine call will see the new env.
 */
export const refreshEnvSecrets = (): void => {}
