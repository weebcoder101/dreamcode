/**
 * sensor-gate-enforcer.ts — Dreamcode Chain Execution Plugin
 *
 * Injects <chain-execution> plan blocks into the LLM system prompt
 * so the model follows the sensor-gate skill chain via the skill tool.
 *
 * Format: V1 Plugin — `id` + `server()` object (not bare default function)
 */

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
  lines.push("- After persistence, automated-learning MUST capture: what worked, what failed, what to change")
  lines.push("- Log the run to evolution/run_log.jsonl with learning signals")

  if (skillPlan) {
    lines.push("")
    lines.push(skillPlan)
  }

  lines.push("</chain-execution>")
  return lines.join("\n")
}

function buildMemoryContextBlock(): string {
  return [
    "<memory-context>",
    "Available short-term memory (Session Prompts & Run Log):",
    "",
    "Pieces LTM tracks all workstream events (clipboard, vision, audio).",
    "Agent evolution memory is in evolution/run_log.jsonl.",
    "",
    "MEMORY USAGE:",
    "- Search LTM: pieces-ltm_workstream_events_full_text_search",
    "- Read evolution log: evolution/run_log.jsonl",
    "- Agent score: evolution/agent_score.json",
    "",
    "POST-RUN REQUIREMENTS (mandatory — executed by the system automatically):",
    "1. Automated-learning skill captures 3 signals: what worked, what failed, what to change",
    "2. Learning Note is persisted to Pieces LTM via create_pieces_memory (keyDecisions field)",
    "3. Run is logged to evolution/run_log.jsonl with chain metadata, outcome, and fix rules",
    "4. Learnings are available as <learned-knowledge> in future system prompts",
    "5. Effect v4 rule: Effect.catchAll does NOT exist — use Effect.catch instead",
    "</memory-context>",
  ].join("\n")
}

async function sensorGateEnforcer(input: any, options?: any) {
  const enabled = options?.enabled !== false
  if (!enabled) return {}

  return {
    "chat.message": async (chatInput: any, output: any) => {
      const prompt = output.parts
        .filter((p: any) => p?.type === "text" && typeof p.text === "string")
        .map((p: any) => p.text as string)
        .join(" ")
        .trim()

      if (!prompt || prompt.length < 3) return

      sessionPrompts.set(chatInput.sessionID, prompt)
    },

    "experimental.chat.system.transform": async (ctx: any, output: any) => {
      const gateInfo = extractSensorGate(output.system)
      if (!gateInfo || gateInfo.chain.length === 0) return
      if (gateInfo.chain.length === 1 && gateInfo.chain[0] === "context-compactor") return

      output.system.push(buildChainExecutionBlock(gateInfo.chain, gateInfo.skillPlan))
      output.system.push(buildMemoryContextBlock())
    },
  }
}

// V1 plugin object format — required by readV1Plugin for file-based plugins
export default {
  id: "sensor-gate-enforcer",
  server: sensorGateEnforcer,
}
