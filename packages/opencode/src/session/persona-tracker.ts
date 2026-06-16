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
  task?: string
  goals?: string[]
  synthesisGuide?: string
}

export interface PersonaTracker {
  readonly sessionID: string
  readonly remaining: () => number
  readonly complete: (name: string, role: string, output: string, status: "completed" | "error", extra?: { task?: string; goals?: string[]; synthesisGuide?: string }) => Effect.Effect<void>
  readonly waitForAll: () => Effect.Effect<PersonaResult[]>
  readonly getAll: () => PersonaResult[]
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
    extra?: { task?: string; goals?: string[]; synthesisGuide?: string },
  ) {
    results.push({ name, role, output, status, ...extra })
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

  const getAll = (): PersonaResult[] => results.slice()

  return {
    sessionID,
    remaining: () => remaining,
    complete,
    waitForAll,
    getAll,
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
    if (r.task) lines.push(`Task: ${r.task}`)
    if (r.goals?.length) lines.push(`Goals: ${r.goals.join("; ")}`)
    lines.push("")
    if (r.status === "completed") {
      lines.push(r.output)
    } else {
      lines.push(`*Analysis failed: ${r.output}*`)
    }
    if (r.synthesisGuide) {
      lines.push("")
      lines.push(`Synthesis note: ${r.synthesisGuide}`)
    }
    lines.push("")
  }

  lines.push(`---`)
  lines.push(`SYNTHESIS INSTRUCTIONS:`)
  lines.push(`1. Review all specialist findings above, noting each specialist's task and goals`)
  lines.push(`2. Identify common themes and disagreements across findings`)
  lines.push(`3. Cross-reference findings against each specialist's synthesis guide`)
  lines.push(`4. Prioritize by severity, confidence, and relevance`)
  lines.push(`5. Produce a unified, actionable response with specific code references`)
  lines.push(`6. If any findings conflict, note the disagreement and propose resolution`)
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
