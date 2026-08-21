import { describe, expect, test } from "bun:test"
import {
  extractPlanFeatures,
  planScore,
  isDegeneratePlan,
  missingPlanSections,
  learnedThreshold,
  recordGateEvent,
  finalizeGateLearning,
  initGateLearner,
} from "../../src/session/dream-gate-learn"

function parts(text: string) {
  return [{ type: "text", text }] as any
}

describe("dream-gate-learn", () => {
  test("good plans score far above thin plans", () => {
    const good = parts(
      "## Approach\nRewriting auth to use httpOnly cookies with 7-day expiry. Considered localStorage tokens, rejected for XSS.\n\n" +
        "## Correlations\nsrc/auth.ts consumed by src/middleware.ts and api routes\n\n" +
        "## Verification\nbun test test/auth.test.ts && npx tsc --noEmit",
    )
    const thin = parts("## Approach\nRefactor the loop.")
    const g = planScore(good, "/tmp/auth.ts")
    const t = planScore(thin, "/tmp/auth.ts")
    expect(g.score).toBeGreaterThan(8)
    expect(t.score).toBeLessThan(3)
    expect(g.score).toBeGreaterThan(t.score)
  })

  test("degenerate plan detection only catches empty markers", () => {
    expect(isDegeneratePlan(parts("## Approach"))).toBe(true)
    expect(isDegeneratePlan(parts("## Approach\nRefactor the loop."))).toBe(false)
    expect(isDegeneratePlan(parts("Approach 1: rewrite; Approach 2: patch"))).toBe(false)
    expect(isDegeneratePlan(parts("## Correlations\n- src/a.ts depends on b"))).toBe(false)
  })

  test("missing sections identifies gaps in thin plans", () => {
    const missing = missingPlanSections(parts("## Approach\nRefactor the loop."))
    expect(missing.some((m) => m.includes("Correlations"))).toBe(true)
    expect(missing.some((m) => m.includes("Verification"))).toBe(true)
    const good = missingPlanSections(
      parts(
        "## Approach\nFull rewrite with a verification harness and a migration plan for existing users.\n" +
          "## Correlations\na.ts is consumed by the api layer and the dashboard; both need updating.\n" +
          "## Verification\nbun test test/auth.test.ts && npx tsc --noEmit",
      ),
    )
    expect(good.length).toBe(0)
  })

  test("bare keyword plans score comparably to ## prefixed plans", () => {
    const withHeaders = parts(
      "## Approach\nRewrite auth to use httpOnly cookies with 7-day expiry.\n\n" +
        "## Correlations\nsrc/auth.ts consumed by middleware\n\n" +
        "## Verification\nbun test",
    )
    const bareKeywords = parts(
      "Approach\nRewrite auth to use httpOnly cookies with 7-day expiry.\n\n" +
        "Correlations\nsrc/auth.ts consumed by middleware\n\n" +
        "Verification\nbun test",
    )
    const h = planScore(withHeaders)
    const b = planScore(bareKeywords)
    // Both should score well above the degenerate threshold
    expect(h.score).toBeGreaterThan(5)
    expect(b.score).toBeGreaterThan(5)
    // Bare keywords should score similarly (within 2 points) to ## prefixed
    expect(Math.abs(h.score - b.score)).toBeLessThan(2)
  })

  test("missing sections detects gaps in bare keyword plans", () => {
    const missing = missingPlanSections(parts("Approach\nRefactor the loop."))
    expect(missing.some((m) => m.includes("Correlations"))).toBe(true)
    expect(missing.some((m) => m.includes("Verification"))).toBe(true)
  })

  test("degenerate plan detection handles bare keywords", () => {
    // Bare keyword with no content on the same line or following lines
    expect(isDegeneratePlan(parts("Approach"))).toBe(true)
    expect(isDegeneratePlan(parts("Approach\nCorrelations\nVerification"))).toBe(true)
    // Bare keyword with actual content
    expect(isDegeneratePlan(parts("Approach\nRefactor the loop."))).toBe(false)
  })

  test("target file mention boosts score", () => {
    const withFile = planScore(parts("## Approach\nPlan mentions src/auth.ts in correlations. This is a detailed plan for the auth service."), "/tmp/auth.ts")
    const without = planScore(parts("## Approach\nPlan mentions src/auth.ts in correlations. This is a detailed plan for the auth service."), "/tmp/other.ts")
    expect(withFile.score).toBeGreaterThan(without.score)
  })

  test("positive learning lowers threshold toward observed score (bounded)", () => {
    initGateLearner("/tmp/nonexistent-project-dir")
    const before = learnedThreshold()
    const thin = planScore(parts("## Approach\nRefactor the loop."))
    recordGateEvent("learn-1", { score: thin.score, action: "allow" })
    finalizeGateLearning("learn-1", "stop")
    const after = learnedThreshold()
    // EMA toward a low score with α=0.1: 4.0 + 0.1*(0.66-4.0) ≈ 3.67
    expect(after).toBeLessThan(before)
    expect(after).toBeGreaterThanOrEqual(2.0) // safety floor
  })

  test("negative learning (tool error) does not raise threshold", () => {
    initGateLearner("/tmp/nonexistent-project-dir")
    const before = learnedThreshold()
    const good = planScore(
      parts(
        "## Approach\nDetailed plan with correlations and verification commands for the entire service layer.\n## Correlations\nx.ts\n## Verification\nbun test",
      ),
    )
    recordGateEvent("learn-2", { score: good.score, action: "allow" })
    recordToolErrorProxy("learn-2")
    finalizeGateLearning("learn-2", "tool-calls")
    const after = learnedThreshold()
    // Threshold only adapts on POSITIVE outcomes; negative examples push
    // weights down, not the threshold up.
    expect(after).toBe(before)
  })
})

// Helper: simulate the processor's recordToolError without importing internals
import { recordToolError } from "../../src/session/dream-gate-learn"
function recordToolErrorProxy(id: string) {
  recordToolError(id)
}
