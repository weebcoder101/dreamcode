import { SessionV1 } from "@opencode-ai/core/v1/session"
import {
  initGateLearner,
  planScore,
  learnedThreshold,
  missingPlanSections,
  isDegeneratePlan,
  recordGateEvent,
} from "./dream-gate-learn"

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

// Match plan markers with OR without ## markdown headers. Models often
// output bare keywords ("Approach\n...") without the markdown prefix.
// The (?:^|\n)#*? alternative uses #*? (zero-or-more) so bare keywords
// at line start pass, while ## prefixed headers still match.
const PLAN_MARKER_RE =
  /##\s*(?:Approach|Plan|Critical Files|Verification)|(?:^|\n)#*?\s*(?:Approach|Plan|Analysis|Correlations?)\b|Approach [1-5][:.)]|Option [1-5][:.)]|Phase [1-5]\b|Dream Protocol/i

const GATE_ERROR_TITLE = "Dream Protocol: plan first"

// ─── Low-risk mutation bypass (HARNESS-IMPROVEMENT-PLAN §5.3) ──────────────
// Formatting, import sorting, and other trivial operations don't need
// the full Dream Protocol. They're mechanical, not creative, and gating
// them creates unnecessary friction.
const LOW_RISK_MUTATION_PATTERNS: Array<{ tool: string; argPattern?: RegExp; matchFilePath?: boolean }> = [
  // Mechanical edit DESCRIPTIONS only — filePath must NOT participate: a
  // path like "src/utils/format.ts" is not a low-risk edit, and the old
  // unanchored `format` pattern silently bypassed the gate for those files.
  { tool: "edit", argPattern: /^(sort[\s_-]?imports|format|lint[\s_-]?fix|add[\s_-]?license|prettier[\s_-]?write)\b/i },
  // Writing dotfile configs is mechanical; anchored to the basename so
  // "format.ts" can't false-positive.
  { tool: "write", argPattern: /\.(prettierrc|eslintrc|editorconfig|gitignore|npmrc)(\.\w+)?$/i, matchFilePath: true },
]

function isLowRiskMutation(tool: string, args?: Record<string, unknown>): boolean {
  if (!args) return false
  for (const entry of LOW_RISK_MUTATION_PATTERNS) {
    if (entry.tool !== tool) continue
    const description = typeof args.description === "string" ? args.description : ""
    const filePath = typeof args.filePath === "string" ? args.filePath : ""
    // filePath only participates for write-patterns that explicitly opt in
    const checkStr = entry.matchFilePath ? `${description} ${filePath}` : description
    if (!entry.argPattern || entry.argPattern.test(checkStr)) return true
  }
  return false
}

// ─── Plan quality scoring (HARNESS-IMPROVEMENT-PLAN §5.2) ──────────────────
// The gate only checks for plan *existence* (regex match), not plan *quality*.
// A model could emit "## Approach\nfoo" and pass. Add lightweight scoring:
//   - Has ## Approach with actual content (≥50 chars) → +2
//   - Has ## Correlations with file names → +2
//   - Has ## Verification with specific commands → +2
//   - Mentions specific files (.ts/.tsx/.js/.py/.go/.rs) → +1 each (max 3)
// Threshold: score >= 4 to pass quality gate.

// Section-matching regex helpers: accept both "## Approach" and bare "Approach"
// at line start. Models vary in whether they emit markdown headers.
const SECTION_APPROACH_RE = /(?:##\s*|(?:^|\n)\s*)Approach[\s\S]{50,}/i
const SECTION_CORRELATIONS_RE = /(?:##\s*|(?:^|\n)\s*)Correlations?[\s\S]{30,}/i
const SECTION_VERIFICATION_RE = /(?:##\s*|(?:^|\n)\s*)Verification[\s\S]{20,}/i

export function planQualityScore(parts: SessionV1.Part[]): number {
  let score = 0
  for (const part of parts) {
    if (part.type !== "text") continue
    const text = part.text

    // Has Approach section with actual content (not just header)
    if (SECTION_APPROACH_RE.test(text)) score += 2

    // Has Correlations section with file names
    if (SECTION_CORRELATIONS_RE.test(text)) score += 2

    // Has Verification section with specific commands
    if (SECTION_VERIFICATION_RE.test(text)) score += 2

    // Mentions specific files
    const fileRefs = (text.match(/\b[\w/.-]+\.(ts|tsx|js|py|go|rs)\b/g) || []).length
    score += Math.min(fileRefs, 3)
  }
  return score
}

const PLAN_QUALITY_THRESHOLD = 2

// ─── Rich gate output (HARNESS-IMPROVEMENT-PLAN §5.1) ─────────────────────
// When the gate blocks, provide context-aware feedback:
//   1. The specific file being blocked
//   2. Suggested correlation tools for that file type
//   3. Example plan structure
//   4. Files that may depend on the target (if relations available)

function inferCorrelationSuggestions(filePath?: string): string {
  if (!filePath) return ""
  const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
  const suggestions: string[] = []

  if (["ts", "tsx", "js", "jsx"].includes(ext)) {
    suggestions.push(
      "`relations` (whoProvides / consumersOf / dependentsOf)",
      "`read` (inspect the file and its imports)",
      "`grep` (find usages across the codebase)",
    )
  } else if (["py"].includes(ext)) {
    suggestions.push(
      "`grep` (find imports and usages)",
      "`read` (inspect the module structure)",
    )
  } else if (["go", "rs"].includes(ext)) {
    suggestions.push(
      "`grep` (find references)",
      "`read` (inspect the file)",
    )
  } else {
    suggestions.push(
      "`grep` or `glob` (find related files)",
      "`read` (inspect the target)",
    )
  }

  if (suggestions.length === 0) return ""
  return `\n\n**Suggested correlation tools for \`${filePath}\`:**\n${suggestions.map((s) => `- ${s}`).join("\n")}`
}

export const DREAM_GATE_ERROR = `## Dream Protocol Gate

You attempted a mutating file operation (edit/write/apply_patch) before emitting a plan.
You MUST emit a plan as plain text before calling edit/write/apply_patch.

The plan can use either format:
  Option A (markdown headers):
    ## Approach
    ## Correlations
    ## Verification

  Option B (bare keywords at line start):
    Approach
    Correlations
    Verification

Required sections:
- Approach: What you will do, and 1-2 alternatives you considered.
- Correlations: Which files this change touches and what depends on them.
- Verification: The exact command that proves this works (test/build/lint).

### Why you were blocked (read this if you already wrote a plan)

The gate only sees text accumulated AFTER the most recent tool result. Every
tool result (relations, read, grep, bash...) resets that buffer. So:

- Plan written BEFORE a correlation/tool call → INVISIBLE to the gate → block.
- Plan written AFTER your last tool call, immediately before the edit → passes.

**To pass, re-issue in ONE message, in this exact order:**
1. Correlation step (if not yet done for this file): relations / lsp / read / grep.
2. The FULL plan text (Approach + Correlations + Verification) — rewritten fresh,
   even if you wrote it earlier in the turn.
3. The edit/write/apply_patch call.

Do NOT retry the edit alone, and do NOT reference a plan from an earlier
message — the gate cannot see it.`

export type GateVerdict =
  | { kind: "allow"; nudge?: string }
  | {
      kind: "block"
      output: {
        title: string
        metadata: Record<string, any>
        output: string
      }
    }

/**
 * Point the gate's learned model at the current project so thresholds and
 * weights calibrate per-project. Idempotent; safe on every gate decision.
 * The worktree is passed explicitly from call sites (they hold the message
 * path); InstanceState.contextOrNull is an Effect and can't be read in this
 * sync hot path.
 */
function ensureLearnerInitialized(worktree?: string): void {
  if (worktree) initGateLearner(worktree)
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
  args?: Record<string, unknown>
  bypassAgentCheck: boolean
  /** Assistant message ID — used to attribute gate events to the turn for
   *  the online learner's feedback loop. Optional; falls back to "". */
  messageID?: string
  /** Project worktree root — used to point the learned model at the
   *  project's weight file. Optional; the gate falls back to prior weights. */
  worktree?: string
  alreadyPlanned: (filePath: string) => boolean
  markPlanned: (filePath: string) => void
}): GateVerdict {
  const { tool, parts, filePath, args, bypassAgentCheck, alreadyPlanned, markPlanned, messageID, worktree } = input

  if (bypassAgentCheck) return { kind: "allow" }
  if (!MUTATING_TOOLS.has(tool)) return { kind: "allow" }

  // Low-risk bypass (§5.3): formatting/organizing operations don't need planning
  if (isLowRiskMutation(tool, args)) return { kind: "allow" }

  // Per-file tracking: if this file has already been planned, allow
  if (filePath && alreadyPlanned(filePath)) return { kind: "allow" }

  // Learned gate: point the model at the project worktree (idempotent).
  ensureLearnerInitialized(worktree)

  // If plan marker present: score it with the learned model (§5.2 v2).
  //   - degenerate (marker with no content)  → hard block, list missing sections
  //   - thin (score < learned threshold)     → allow + nudge (advisory note)
  //   - sufficient (score ≥ threshold)       → clean allow
  // The learned threshold EMA-adapts per project from turn outcomes.
  if (hasPlanMarker(parts)) {
    if (isDegeneratePlan(parts)) {
      const missing = missingPlanSections(parts)
      recordGateEvent(messageID ?? "", { score: 0, action: "block" })
      return {
        kind: "block",
        output: {
          title: "Dream Protocol: plan is empty",
          metadata: { dream_gate_blocked: true, degenerate_plan: true, tool, filePath, missing },
          output:
            `## Dream Protocol Gate\n\nYour plan marker was detected but contains no actual plan. ` +
            `Expand it before mutating — the gate needs:\n\n- ${missing.join("\n- ")}\n\n` +
            `Then re-issue the edit. Do not repeat the same gated tool call before planning.`,
        },
      }
    }
    // Mark the file as planned ONLY after passing the degenerate check.
    // Degenerate plans must not pre-authorize subsequent edits.
    if (filePath) markPlanned(filePath)
    const { score } = planScore(parts, filePath)
    const threshold = learnedThreshold()
    const missing = score < threshold ? missingPlanSections(parts) : []
    const nudge =
      missing.length > 0
        ? `\n\n(plan sufficiency ${score.toFixed(1)}/${threshold.toFixed(1)} — strengthen before finishing: ${missing.join("; ")})`
        : undefined
    recordGateEvent(messageID ?? "", {
      score,
      action: nudge ? "nudge" : "allow",
    })
    return { kind: "allow", ...(nudge ? { nudge } : {}) }
  }

  // First edit to this file, no plan emitted → block with rich feedback.
  // Do NOT mark the file as planned on block — the model must emit a real
  // plan marker before subsequent edits to this file are allowed through.
  const correlationSuggestions = inferCorrelationSuggestions(filePath)
  const fileContext = filePath ? `\n\n**Target file:** \`${filePath}\`` : ""

  return {
    kind: "block",
    output: {
      title: GATE_ERROR_TITLE,
      metadata: { dream_gate_blocked: true, tool, filePath },
      output: DREAM_GATE_ERROR + fileContext + correlationSuggestions,
    },
  }
}
