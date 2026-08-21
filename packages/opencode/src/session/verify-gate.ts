import { SessionV1 } from "@opencode-ai/core/v1/session"

/**
 * Self-verification gate (Claude Code "give Claude a check it can run" pattern).
 *
 * When a turn makes mutating changes (edit/write/apply_patch) and then finishes
 * WITHOUT running any verification command (tests, build, lint, typecheck), the
 * harness injects a synthetic user message that forces a verification pass
 * before the loop exits. This converts "trust the model's claim of done" into
 * "prove it with a check" — the single highest-ROI reliability behavior.
 *
 * The gate fires at most once per user message (tracked via a counter), so it
 * never loops forever: after one verification prompt, the model may either
 * run the check or decline with a reason, and the turn proceeds either way.
 */

export const VERIFY_MARKER = "dream-verify"

const VERIFY_PATTERN =
  /(^|[\n;|&])\s*(pytest|bun test|bunx tsc|bun run (test|check|typecheck|build)|npm (test|run test)|npm run (check|typecheck|lint|build)|\btsc\b|vitest|go test|cargo test|make test|ruby -S rspec|mix test|flutter test|next build|vite build|yarn test|deno test)\b/i

export const MUTATING_TOOLS = new Set(["edit", "write", "apply_patch", "patch"])

export function toolCallsMadeMutation(parts: SessionV1.Part[]): boolean {
  return parts.some((part) => {
    if (part.type !== "tool") return false
    if (!MUTATING_TOOLS.has(part.tool)) return false
    return part.state.status === "completed" || part.state.status === "error"
  })
}

function partRanVerification(part: SessionV1.Part): boolean {
  if (part.type !== "tool") return false
  if (part.tool === "bash" || part.tool === "shell") {
    const input = part.state.input as Record<string, unknown> | undefined
    const command = typeof input?.command === "string" ? input.command : ""
    if (VERIFY_PATTERN.test(command)) return true
    if (typeof input?.prompt === "string" && VERIFY_PATTERN.test(input.prompt)) return true
  }
  // LSP diagnostics are a form of verification (post-edit type/error feedback).
  if (part.tool === "lsp") return true
  return false
}

export function turnRanVerification(parts: SessionV1.Part[]): boolean {
  return parts.some(partRanVerification)
}

export const VERIFY_REMINDER = `<dream-verify>
You made changes to the code but have not yet verified they work. Before reporting
done, run the project's verification: the test suite, a build, a typecheck, or a
lint pass — whichever exists. If a check fails, fix the root cause and re-run until
it passes. If no check exists for this change, state that explicitly and explain
how you confirmed correctness instead.

Respond with either:
1. The verification command you ran and its result (preferred), or
2. A clear reason no verification is applicable, plus how you confirmed the change.
</dream-verify>`

export function needsVerification(input: {
  parts: SessionV1.Part[]
  alreadyVerified: boolean
  alreadyPrompted: boolean
}): boolean {
  if (input.alreadyVerified) return false
  if (input.alreadyPrompted) return false
  if (turnRanVerification(input.parts)) return false
  return toolCallsMadeMutation(input.parts)
}
