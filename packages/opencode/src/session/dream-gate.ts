import { SessionV1 } from "@opencode-ai/core/v1/session"

/**
 * Dream Protocol enforcement gate.
 *
 * The Dream Protocol (diverge → correlate → compare → critique → execute)
 * is enforced mechanically at the tool-dispatch boundary, not just by prose
 * in the system prompt. Before the first mutating tool call on a NEW file,
 * the harness checks whether the model has already emitted a plan marker.
 * If it has not, the mutating call is rejected with a structured error.
 *
 * Per-file gating: once a file has been planned (Approach/Correlations
 * emitted), subsequent edits to the SAME file are allowed without
 * re-triggering the gate. The gate only fires for NEW files that haven't
 * been planned yet. This lets agents consolidate all edits to one file
 * into a single plan, then execute all edits without interruption.
 *
 * The plan is valid within the current assistant message only — a new
 * message resets the planned-file set, requiring a fresh plan for each file.
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
 * Decide whether a tool call must be gated.
 *
 * Per-file tracking: the gate fires for the FIRST mutating call to each
 * file. Once a file is "planned" (plan marker present), subsequent edits
 * to that same file pass without re-blocking. Files without a detectable
 * path fall back to single-gate-per-message behavior.
 */
export function gateToolCall(input: {
  tool: string
  parts: SessionV1.Part[]
  filePath?: string
  bypassAgentCheck: boolean
  alreadyPlanned: (filePath: string) => boolean
  markPlanned: (filePath: string) => void
}): GateVerdict {
  const { tool, parts, filePath, bypassAgentCheck, alreadyPlanned, markPlanned } = input

  if (bypassAgentCheck) return { kind: "allow" }
  if (!MUTATING_TOOLS.has(tool)) return { kind: "allow" }

  // Per-file tracking: if this file has already been planned, allow
  if (filePath && alreadyPlanned(filePath)) return { kind: "allow" }

  // If plan marker present: allow and mark this file as planned
  if (hasPlanMarker(parts)) {
    if (filePath) markPlanned(filePath)
    return { kind: "allow" }
  }

  // First edit to this file, no plan emitted → block
  if (filePath) markPlanned(filePath)
  return {
    kind: "block",
    output: {
      title: GATE_ERROR_TITLE,
      metadata: { dream_gate_blocked: true, tool, filePath },
      output: DREAM_GATE_ERROR,
    },
  }
}
