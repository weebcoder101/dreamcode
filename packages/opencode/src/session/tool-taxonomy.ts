// ─── Tool Error Taxonomy & Self-Healing (§4.4) ────────────────────────────
// Structured error classification so the model understands *what kind* of
// error occurred and *how* to recover. Each category includes a recovery
// suggestion the model can follow without user intervention.

export type ErrorCategory =
  | "PERMISSION_DENIED"
  | "FILE_NOT_FOUND"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "PARSE_ERROR"
  | "CONFLICT"
  | "RESOURCE_EXHAUSTED"
  | "INVALID_INPUT"
  | "UNKNOWN"

export interface ErrorClassification {
  category: ErrorCategory
  recovery: string
  retryable: boolean
}

const TAXONOMY: Record<ErrorCategory, { recovery: string; retryable: boolean }> = {
  PERMISSION_DENIED: {
    recovery: "Ask user for permission, then retry with the permitted tool",
    retryable: true,
  },
  FILE_NOT_FOUND: {
    recovery: "Check path spelling, search with grep/glob to find the correct file, then retry",
    retryable: true,
  },
  TIMEOUT: {
    recovery: "Simplify the operation, add flags to reduce scope, or split into smaller steps",
    retryable: true,
  },
  NETWORK_ERROR: {
    recovery: "Check connectivity, try an alternative source, or use cached data if available",
    retryable: true,
  },
  PARSE_ERROR: {
    recovery: "Verify input format, check schema requirements, and retry with corrected args",
    retryable: true,
  },
  CONFLICT: {
    recovery: "Read the current file state, resolve the conflict, and retry the edit",
    retryable: true,
  },
  RESOURCE_EXHAUSTED: {
    recovery: "Reduce scope, wait briefly, then retry. If rate-limited, use a different approach",
    retryable: true,
  },
  INVALID_INPUT: {
    recovery: "Check parameter types and required fields, fix the input, and retry",
    retryable: true,
  },
  UNKNOWN: {
    recovery: "Read the error message carefully, check the tool's documentation, and try a different approach",
    retryable: false,
  },
}

// Pattern matching: classify raw error messages into categories
const ERROR_PATTERNS: Array<{ pattern: RegExp; category: ErrorCategory }> = [
  { pattern: /permission denied|EACCES|EPERM|forbidden|403/i, category: "PERMISSION_DENIED" },
  { pattern: /ENOENT|file not found|no such file|does not exist|404/i, category: "FILE_NOT_FOUND" },
  { pattern: /timeout|timed out|ETIMEDOUT|deadline exceeded/i, category: "TIMEOUT" },
  { pattern: /ECONNREFUSED|ENOTFOUND|fetch failed|network|502|503|504/i, category: "NETWORK_ERROR" },
  { pattern: /parse|syntax|unexpected token|invalid json|JSON\.parse/i, category: "PARSE_ERROR" },
  { pattern: /conflict|EEXIST|already exists|409|outdated|stale/i, category: "CONFLICT" },
  { pattern: /rate.?limit|429|quota|exceeded|resource exhausted/i, category: "RESOURCE_EXHAUSTED" },
  { pattern: /invalid|bad request|400|required|missing.*param/i, category: "INVALID_INPUT" },
]

/**
 * Classify a raw error message into a structured category with recovery guidance.
 */
export function classifyError(errorMessage: string): ErrorClassification {
  for (const { pattern, category } of ERROR_PATTERNS) {
    if (pattern.test(errorMessage)) {
      return { category, ...TAXONOMY[category] }
    }
  }
  return { category: "UNKNOWN", ...TAXONOMY.UNKNOWN }
}

/**
 * Format a tool error with taxonomy context for the model.
 */
export function formatToolError(errorMessage: string, toolName: string): string {
  const classification = classifyError(errorMessage)
  return [
    `Error in \`${toolName}\`: ${errorMessage}`,
    "",
    `**Category:** ${classification.category}`,
    `**Recovery:** ${classification.recovery}`,
    classification.retryable ? "**Retryable:** Yes — try a corrected version" : "**Retryable:** No — try a different approach",
  ].join("\n")
}

export * as ToolTaxonomy from "./tool-taxonomy"
