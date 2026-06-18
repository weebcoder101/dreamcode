import { SessionV1 } from "@opencode-ai/core/v1/session"

export interface SubagentContext {
  /** Last N messages for conversation flow (not full history) */
  recentMessages: SessionV1.WithParts[]
  /** Key file paths mentioned in the context (for file inclusion) */
  mentionedPaths: string[]
  /** Current user prompt text */
  currentPrompt: string
}

const PATH_REGEX = /[\w/.-]+\/\w[\w/.-]*\.\w{2,4}/g
const MAX_RECENT = 15
const PATHS_PER_MSG = 3

export function extractSubagentContext(
  msgs: SessionV1.WithParts[],
  maxMessages: number = MAX_RECENT,
): SubagentContext {
  const recentMessages = msgs.slice(-maxMessages)

  // Scan for file paths in recent messages — important for subagents
  // that need to read files. Extract from both user prompts and assistant
  // tool outputs.
  const mentionedPaths = new Set<string>()
  for (const msg of msgs.slice(-5)) {
    let pathsFound = 0
    for (const part of msg.parts) {
      if (part.type === "text" && !part.ignored) {
        const matches = part.text.match(PATH_REGEX)
        if (matches) {
          for (const p of matches) {
            if (pathsFound >= PATHS_PER_MSG) break
            mentionedPaths.add(p)
            pathsFound++
          }
        }
      }
    }
  }

  // Extract the current user prompt (the active task)
  const lastUser = msgs.findLast((m) => m.info.role === "user")
  const currentPrompt =
    lastUser?.parts
      .filter((p): p is typeof p & { type: "text" } => p.type === "text" && !p.ignored && !p.synthetic)
      .map((p) => p.text)
      .join("\n") ?? ""

  return {
    recentMessages,
    mentionedPaths: [...mentionedPaths].slice(0, 15),
    currentPrompt,
  }
}

export function buildSubagentContextPrompt(
  subagentCtx: SubagentContext,
  maxContextTokens: number = 2000,
): string {
  const lines: string[] = [
    "<active-context>",
    "Below is a compacted summary of the parent conversation for context.",
    "",
  ]

  // Add current task prompt verbatim
  if (subagentCtx.currentPrompt) {
    lines.push(`## Current Task`)
    lines.push(subagentCtx.currentPrompt)
    lines.push("")
  }

  // Add key file paths as structured references
  if (subagentCtx.mentionedPaths.length > 0) {
    lines.push("## Relevant Files")
    for (const fp of subagentCtx.mentionedPaths) {
      lines.push(`- \`${fp}\``)
    }
    lines.push("")
  }

  // Compacted message log — just role labels and key info
  const msgSummary: string[] = []
  for (const msg of subagentCtx.recentMessages.slice(-10)) {
    const role = msg.info.role
    const short = msg.parts
      .filter((p): p is typeof p & { type: "text" } => p.type === "text" && !p.ignored)
      .map((p) => p.text.slice(0, 300))
      .join(" | ")
      .slice(0, 500)
    if (short) msgSummary.push(`[${role}]: ${short}`)
  }

  if (msgSummary.length > 0) {
    lines.push("## Recent Exchange")
    lines.push(...msgSummary)
    lines.push("")
  }

  lines.push(`[System: ${subagentCtx.recentMessages.length} recent messages included. Full history truncated for efficiency and cost savings.]`)
  lines.push("</active-context>")
  return lines.join("\n")
}


