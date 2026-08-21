// ─── Dynamic Tool Schema Injection (§1.5) ────────────────────────────────
// Route tools by task type to reduce per-request token cost by 30–70%.
// All tool schemas (~5K–50K tokens) are sent with every request even for
// tasks that only need 2–3 tools. This module classifies the user's intent
// and selects the minimal tool set for the task.
//
// Research: Anthropic 2025 — "More tools don't always lead to better
// outcomes... Consider building a few thoughtful tools targeting specific
// high-impact workflows."

export type TaskCategory =
  | "edit"       // Simple file edits (read, edit, write, relations, grep, glob)
  | "research"   // Information gathering (websearch, webfetch, read, grep, glob)
  | "debug"      // Debugging (read, grep, bash, relations, lsp, glob)
  | "build"      // Build/test/verify (bash, read, grep, glob, task)
  | "full"       // Complex tasks — all tools available (default)

/**
 * Tool sets for each task category.
 * "essential" tools are ALWAYS included regardless of category.
 *
 * The CORE set (read/edit/write/apply_patch/bash/grep/glob/relations) is in
 * EVERY category: excluding mutating tools from a category silently breaks
 * the task ("fix the bug" → debug must still be able to edit the fix). Only
 * EXOTIC tools (websearch/webfetch/lsp/ast-edit) vary by category.
 */
const CORE_TOOLS = ["read", "edit", "write", "apply_patch", "patch", "grep", "glob", "bash", "relations"]
const CATEGORY_TOOLS: Record<TaskCategory, string[]> = {
  edit: [...CORE_TOOLS, "ast-edit"],
  research: [...CORE_TOOLS, "websearch", "webfetch"],
  debug: [...CORE_TOOLS, "lsp", "ast-edit"],
  build: [...CORE_TOOLS],
  full: [], // Empty = include all tools
}

/** Tools that are ALWAYS included regardless of category. */
const ESSENTIAL_TOOLS = new Set(["task"])

/**
 * Classify the user's intent from their message text.
 * Returns a TaskCategory that determines which tools to include.
 */
export function classifyTask(userText: string): TaskCategory {
  const text = userText
    .toLowerCase()
    .trim()
    // Strip filename/code tokens BEFORE verb classification: "test.ts"
    // must not trigger the build regex (it matched `\btest\b` and silently
    // dropped the write tool from "create a new file" tasks), "build.gradle"
    // must not trigger build, "run.sh" must not trigger run, etc.
    .replace(/\b[\w./-]+\.\w{1,5}\b/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/"[^"]*"/g, " ")

  // Research / investigation — checked FIRST because "investigate the issue"
  // should be research, not debug. Explicit investigation verbs override
  // ambiguous keywords like "issue" or "error".
  if (/\b(research|investigate|explain|analyze|review|find|search|look up|what is|how does|compare|evaluate)\b/i.test(text)) {
    return "research"
  }

  // Debug / fix — checked AFTER research because "investigate the bug"
  // should be research, but "fix the bug" should be debug.
  if (/\b(debug|fix|error|bug|issue|crash|failing|broken|not working|doesn't work|won't|can't)\b/i.test(text)) {
    return "debug"
  }

  // Build / test / verify
  if (/\b(build|compile|test|lint|typecheck|check|verify|run|make)\b/i.test(text) &&
      !/\b(research|investigate|explain|analyze|review)\b/i.test(text)) {
    return "build"
  }

  // Edit / modify / create
  if (/\b(edit|modify|change|update|refactor|rename|move|copy|create|add|write|implement|build|make|delete|remove)\b/i.test(text)) {
    return "edit"
  }

  // Default: full tool set for complex/ambiguous tasks
  return "full"
}

/**
 * Determine if a tool should be included for the given task category.
 * Essential tools are always included. MCP tools are always included.
 */
export function shouldIncludeTool(toolId: string, category: TaskCategory): boolean {
  // Essential tools are always included
  if (ESSENTIAL_TOOLS.has(toolId)) return true

  // "full" category includes everything
  if (category === "full") return true

  const allowed = CATEGORY_TOOLS[category]
  if (!allowed) return true

  return allowed.includes(toolId)
}

/**
 * Get a human-readable summary of which tools are included for a category.
 */
export function categorySummary(category: TaskCategory): string {
  if (category === "full") return "All tools available"
  const tools = CATEGORY_TOOLS[category] ?? []
  return `Category: ${category} — ${tools.length + ESSENTIAL_TOOLS.size} tools: ${[...ESSENTIAL_TOOLS, ...tools].join(", ")}`
}

export * as ToolCategory from "./tool-category"
