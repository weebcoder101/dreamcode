/**
 * persona-tracker.ts — Tracks persona subagent completions and triggers synthesis.
 *
 * When all persona subagents complete, injects a synthesis prompt
 * that tells the Architect to unify all specialist findings.
 */

import { Effect } from "effect"
import { MessageID, PartID, SessionID } from "./schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Session } from "./session"

export interface PersonaResult {
  name: string
  role: string
  output: string
  status: "completed" | "error"
}

export interface PersonaTracker {
  readonly sessionID: string
  readonly remaining: () => number
  readonly complete: (name: string, role: string, output: string, status: "completed" | "error") => Effect.Effect<void>
  readonly waitForAll: () => Effect.Effect<PersonaResult[]>
}

export function create(sessionID: string, total: number): PersonaTracker {
  const results: PersonaResult[] = []
  let remaining = total
  let resolveWait: ((results: PersonaResult[]) => void) | null = null

  const complete = Effect.fn("PersonaTracker.complete")(function* (
    name: string,
    role: string,
    output: string,
    status: "completed" | "error",
  ) {
    results.push({ name, role, output, status })
    remaining--

    if (remaining <= 0 && resolveWait) {
      resolveWait(results)
    }
  })

  const waitForAll = Effect.fn("PersonaTracker.waitForAll")(function* () {
    if (remaining <= 0) return results

    return yield* Effect.callback<PersonaResult[]>((resume) => {
      resolveWait = (r) => resume(Effect.succeed(r))
    })
  })

  return {
    sessionID,
    remaining: () => remaining,
    complete,
    waitForAll,
  }
}

export function buildSynthesisPrompt(results: PersonaResult[]): string {
  const lines = [
    `<synthesis-request>`,
    `All ${results.length} specialist agents have completed their analysis.`,
    ``,
    `Findings from each specialist:`,
    ``,
  ]

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const statusIcon = r.status === "completed" ? "[OK]" : "[FAIL]"
    lines.push(`### ${i + 1}. "${r.name}" (${r.role}) ${statusIcon}`)
    lines.push("")
    if (r.status === "completed") {
      lines.push(r.output)
    } else {
      lines.push(`*Analysis failed: ${r.output}*`)
    }
    lines.push("")
  }

  lines.push(`---`)
  lines.push(`SYNTHESIS INSTRUCTIONS:`)
  lines.push(`1. Review all specialist findings above`)
  lines.push(`2. Identify common themes and disagreements`)
  lines.push(`3. Prioritize findings by severity and confidence`)
  lines.push(`4. Produce a unified, actionable response`)
  lines.push(`5. Include specific code references where applicable`)
  lines.push(`</synthesis-request>`)

  return lines.join("\n")
}

export async function injectSynthesis(
  sessionID: string,
  results: PersonaResult[],
  sessions: Session.Interface,
  providerID: string,
  modelID: string,
): Promise<void> {
  const synthesisPrompt = buildSynthesisPrompt(results)
  const brandedSID = SessionID.make(sessionID)

  const userMessage: SessionV1.User = {
    id: MessageID.ascending(),
    sessionID: brandedSID,
    role: "user",
    agent: "general",
    model: {
      providerID: ProviderV2.ID.make(providerID),
      modelID: ModelV2.ID.make(modelID),
      variant: undefined,
    },
    time: { created: Date.now() },
  }
  await Effect.runPromise(sessions.updateMessage(userMessage))

  const textPart: SessionV1.TextPart = {
    id: PartID.ascending(),
    messageID: userMessage.id,
    sessionID: brandedSID,
    type: "text",
    text: synthesisPrompt,
    synthetic: true,
  }
  await Effect.runPromise(sessions.updatePart(textPart))
}
