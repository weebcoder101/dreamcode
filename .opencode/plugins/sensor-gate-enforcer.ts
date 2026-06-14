/**
 * sensor-gate-enforcer.ts — Dreamcode Chain Execution Plugin
 *
 * Lightweight text-only plugin that:
 * - Captures the user prompt via chat.message
 * - Parses the <sensor-gate> block from the system prompt
 * - Injects a <chain-execution> plan block with the skill chain
 *
 * No subprocess calls. No blocking. The LLM follows the chain
 * instructions naturally by calling the skill tool.
 */

import type { Hooks } from "@opencode-ai/plugin"

const sessionPrompts = new Map<string, string>()

function extractSensorGate(system: string[]): { chain: string[]; intent: string; skillPlan: string } | null {
  for (const block of system) {
    const match = block.match(/<sensor-gate>([\s\S]*?)<\/sensor-gate>/)
    if (!match) continue

    const content = match[1]
    const chainLine = content.split("\n").find((l) => l.startsWith("Chain:"))
    if (!chainLine) continue

    const chainStr = chainLine.replace("Chain:", "").trim()
    const chain = chainStr.split("→").map((s) => s.trim()).filter(Boolean)

    const intentLine = content.split("\n").find((l) => l.startsWith("Intent:"))
    const intent = intentLine ? intentLine.replace("Intent:", "").trim() : ""

    const skillPlanStart = content.indexOf("Skill Plan:")
    const skillPlan = skillPlanStart !== -1 ? content.slice(skillPlanStart).trim() : ""

    return { chain, intent, skillPlan }
  }
  return null
}

function buildChainExecutionBlock(chain: string[], skillPlan: string): string {
  const lines = ["<chain-execution>"]

  lines.push("MANDATORY CHAIN: The following skills MUST be executed in order:")
  lines.push("")

  for (let i = 0; i < chain.length; i++) {
    const skill = chain[i]
    const isLast = i === chain.length - 1
    lines.push(`  ${i + 1}. ${skill}${isLast ? " (FINAL — persist results)" : ""}`)
  }

  lines.push("")
  lines.push("EXECUTION RULES:")
  lines.push("- Execute each skill in order using the skill tool")
  lines.push("- Do NOT skip any skill in the chain")
  lines.push("- The FINAL skill (pieces-ltm) MUST persist results to Pieces LTM")
  lines.push("- After persistence, log the run to evolution/run_log.jsonl")

  if (skillPlan) {
    lines.push("")
    lines.push(skillPlan)
  }

  lines.push("</chain-execution>")
  return lines.join("\n")
}

export default async function sensorGateEnforcer(input: any, options?: any): Promise<Hooks> {
  const enabled = options?.enabled !== false
  if (!enabled) return {}

  return {
    "chat.message": async (chatInput, output) => {
      const prompt = output.parts
        .filter((p: any) => p?.type === "text" && typeof p.text === "string")
        .map((p: any) => p.text as string)
        .join(" ")
        .trim()

      if (!prompt || prompt.length < 3) return

      sessionPrompts.set(chatInput.sessionID, prompt)
    },

    "experimental.chat.system.transform": async (ctx, output) => {
      const gateInfo = extractSensorGate(output.system)
      if (!gateInfo || gateInfo.chain.length === 0) return
      if (gateInfo.chain.length === 1 && gateInfo.chain[0] === "context-compactor") return

      output.system.push(buildChainExecutionBlock(gateInfo.chain, gateInfo.skillPlan))
    },
  }
}
