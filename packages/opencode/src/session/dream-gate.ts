import { SessionV1 } from "@opencode-ai/core/v1/session"

/**
 * Dream Protocol enforcement gate.
 *
 * The Dream Protocol (diverge → correlate → compare → critique → execute)
 * is enforced mechanically at the tool-dispatch boundary, not just by prose
 * in the system prompt. Before the first mutating tool call of a turn, the
 * harness checks whether the model has already emitted a plan marker in its
 * text. If it has not, the mutating call is rejected with a structured error
 * that instructs the model to produce its plan first.
 *
 * This mirrors the Claude Code stop-hook pattern: the gate does not silently
 * block work, it feeds a deterministic signal back into the loop so the model
 * corrects course. The model is only gated ONCE per assistant message — after
 * the rejection it is free to proceed, so no legitimate task can deadlock.
 */

export const MUTATING_TOOLS = new Set(["edit", "write", "apply_patch", "patch"])

const PLAN_MARKER_RE =
  /##\s*(?:Approach|Plan|Critical Files|Verification)|(?:^|\n)#+?\s*(?:Approach|Plan|Analysis|Correlations?)\b|Approach [1-5][:.)]|Option [1-5][:.)]|Phase [1-5]\b|Dream Protocol/i

const GATE_ERROR_TITLE = "Dream Protocol: plan first"

export const DREAM_GATE_ERROR = `## Dream Protocol Gate

You attempted a mutating file operation (edit/write/apply_patch) before completing the
Dream Protocol's planning phases. Mutating operations are gated until you emit your plan.

Produce, as text before any further mutating tool call:

## Approach
- The approach you are taking, and 1-2 alternatives you considered and rejected, with why.

## Correlations
- The files/modules this change touches, and what upstream/downstream code it affects.

## Verification
- The exact check (test/build/lint/command) that will prove this change works before you
  report it done.

Then proceed with the edit. Do not repeat the same gated tool call before planning.`

export type GateVerdict =
  | { kind: "allow" }
  | {
      kind: "block"
      output: {
        title: string
        metadata: Record<string, any>
        output: string
      }
    }

function hasPlanMarker(parts: SessionV1.Part[]): boolean {
  for (const part of parts) {
    if (part.type !== "text") continue
    if (PLAN_MARKER_RE.test(part.text)) return true
  }
  return false
}

/**
 * Decide whether a tool call must be gated. Only the FIRST mutating tool call
 * of an assistant message is gated (tracked via `alreadyGated`), so a model
 * that ignores the rejection once is still allowed to proceed — the gate is a
 * course-correction signal, never a deadlock.
 */
export function gateToolCall(input: {
  tool: string
  parts: SessionV1.Part[]
  bypassAgentCheck: boolean
  alreadyGated: () => boolean
  markGated: () => void
}): GateVerdict {
  const { tool, parts, bypassAgentCheck, alreadyGated, markGated } = input

  if (bypassAgentCheck) return { kind: "allow" }
  if (!MUTATING_TOOLS.has(tool)) return { kind: "allow" }
  if (alreadyGated()) return { kind: "allow" }
  if (hasPlanMarker(parts)) return { kind: "allow" }

  markGated()
  return {
    kind: "block",
    output: {
      title: GATE_ERROR_TITLE,
      metadata: { dream_gate_blocked: true, tool },
      output: DREAM_GATE_ERROR,
    },
  }
}
