/**
 * Sensor Gate Tests
 *
 * Tests for pure functions: parseSensorGateOutput, evaluateSpawnNecessity,
 * selectPersonas, validateNeuroOutput.
 * All pure/deterministic — zero external dependencies.
 */

import { describe, expect, test } from "bun:test"
import {
  parseSensorGateOutput,
  evaluateSpawnNecessity,
  selectPersonas,
  validateNeuroOutput,
  depthScore,
  type SensorGateResult,
  type Persona,
} from "../../src/skill/sensor-gate"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<SensorGateResult> = {}): SensorGateResult {
  return {
    intent: "test task",
    domain_tags: ["typescript"],
    risk_level: "medium",
    confidence: 0.7,
    complexity: "medium",
    time_sensitivity: "medium",
    requires_tools: "files",
    deliverable_type: "multi",
    is_social_greeting: false,
    primary_skill: "general",
    support_skills: [],
    automation: "none",
    mode: "STANDARD",
    chain: ["general"],
    personas: [],
    guardian_decision: "APPROVED",
    guardian_risk: "low",
    skill_plan: "",
    raw_output: "",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// parseSensorGateOutput
// ---------------------------------------------------------------------------

describe("parseSensorGateOutput", () => {
  test("parses valid multi-line output", () => {
    const output = [
      "Intent Analysis:",
      "- intent: fix the auth bug in login handler",
      "- domain_tags: auth, typescript, security",
      "- risk_level: high",
      "- confidence: 0.85",
      "- complexity: high",
      "- time_sensitivity: high",
      "- requires_tools: files",
      "- deliverable_type: multi",
      "- is_social_greeting: false",
      "Skill Chain:",
      "- primary: security-auditor",
      "- supports: debugging",
      "- automation: none",
      "- mode: STANDARD",
      "- chain: security-auditor → debugging",
      "[GUARDIAN]",
      "- risk_level: high",
    ].join("\n")

    const result = parseSensorGateOutput(output)
    expect(result.intent).toBe("fix the auth bug in login handler")
    expect(result.domain_tags).toEqual(["auth", "typescript", "security"])
    expect(result.risk_level).toBe("high")
    expect(result.confidence).toBe(0.85)
    expect(result.complexity).toBe("high")
    expect(result.is_social_greeting).toBe(false)
    expect(result.primary_skill).toBe("security-auditor")
    expect(result.mode).toBe("STANDARD")
    expect(result.chain).toEqual(["security-auditor", "debugging"])
    expect(result.guardian_risk).toBe("high")
  })

  test("applies defaults for missing fields", () => {
    const result = parseSensorGateOutput("")
    expect(result.intent).toBe("")
    expect(result.domain_tags).toEqual([])
    expect(result.risk_level).toBe("medium")
    expect(result.confidence).toBe(0.5)
    expect(result.mode).toBe("STANDARD")
    expect(result.is_social_greeting).toBe(false)
    expect(result.guardian_decision).toBe("APPROVED")
  })

  test("parses social greeting", () => {
    const output = "- is_social_greeting: true\n- intent: hello"
    const result = parseSensorGateOutput(output)
    expect(result.is_social_greeting).toBe(true)
  })

  test("parses confidence as NaN → defaults to 0.5", () => {
    const output = "- confidence: not-a-number"
    const result = parseSensorGateOutput(output)
    expect(result.confidence).toBe(0.5)
  })

  test("parses chain with arrow separator", () => {
    const output = "- chain: skill-a → skill-b → skill-c"
    const result = parseSensorGateOutput(output)
    expect(result.chain).toEqual(["skill-a", "skill-b", "skill-c"])
  })

  test("parses domain_tags from comma-separated list", () => {
    const output = "- domain_tags: rust, performance, wasm"
    const result = parseSensorGateOutput(output)
    expect(result.domain_tags).toEqual(["rust", "performance", "wasm"])
  })

  test("extracts skill plan block", () => {
    const output = [
      "- mode: DREAM_INNOVATION",
      "Skill Plan:",
      "- primary: breakthrough-overdrive-innovation",
      "- supports: debugging",
      "- mode: DREAM_INNOVATION",
      "==============================",
    ].join("\n")
    const result = parseSensorGateOutput(output)
    expect(result.skill_plan).toContain("Skill Plan:")
    expect(result.skill_plan).toContain("breakthrough-overdrive-innovation")
  })

  test("extracts persona block", () => {
    const output = [
      "[PERSONA] Dynamic Agent Personas",
      "- name: Security Auditor",
      "role: security specialist",
      "focus: auth and credential review",
      "skills: auth, security, tokens",
      "- name: Debugger",
      "role: debugging specialist",
      "focus: error analysis and root cause",
      "skills: debugging, error handling",
      "[NEXT SECTION]",
    ].join("\n")
    const result = parseSensorGateOutput(output)
    expect(result.personas).toHaveLength(2)
    expect(result.personas[0]!.name).toBe("Security Auditor")
    expect(result.personas[0]!.role).toBe("security specialist")
    expect(result.personas[1]!.name).toBe("Debugger")
  })

  test("empty persona block produces no personas", () => {
    const output = "[PERSONA] Dynamic Agent Personas\n[NEXT SECTION]"
    const result = parseSensorGateOutput(output)
    expect(result.personas).toHaveLength(0)
  })

  test("raw_output is preserved", () => {
    const output = "- intent: test"
    const result = parseSensorGateOutput(output)
    expect(result.raw_output).toBe(output)
  })

  test("invalid risk_level defaults to medium", () => {
    const output = "- risk_level: critical"
    const result = parseSensorGateOutput(output)
    expect(result.risk_level).toBe("medium")
  })

  test("risk_level low is accepted", () => {
    const output = "- risk_level: low"
    const result = parseSensorGateOutput(output)
    expect(result.risk_level).toBe("low")
  })

  test("risk_level high is accepted", () => {
    const output = "- risk_level: high"
    const result = parseSensorGateOutput(output)
    expect(result.risk_level).toBe("high")
  })

  test("confidence above 1 is clamped", () => {
    const output = "- confidence: 2.5"
    const result = parseSensorGateOutput(output)
    expect(result.confidence).toBe(1)
  })

  test("negative confidence is clamped to 0", () => {
    const output = "- confidence: -1"
    const result = parseSensorGateOutput(output)
    expect(result.confidence).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// evaluateSpawnNecessity
// ---------------------------------------------------------------------------

describe("evaluateSpawnNecessity", () => {
  test("social greeting → no spawn", () => {
    const result = makeResult({ is_social_greeting: true })
    const eval_ = evaluateSpawnNecessity(result, "hello!")
    expect(eval_.shouldSpawn).toBe(false)
    expect(eval_.suggestedCount).toBe(0)
    expect(eval_.reason).toContain("Social greeting")
  })

  test("TRIVIAL mode → no spawn", () => {
    const result = makeResult({ mode: "TRIVIAL" })
    const eval_ = evaluateSpawnNecessity(result, "fix typo")
    expect(eval_.shouldSpawn).toBe(false)
    expect(eval_.suggestedCount).toBe(0)
    expect(eval_.reason).toContain("Trivial")
  })

  test("user-specified agent count override", () => {
    const result = makeResult()
    const eval_ = evaluateSpawnNecessity(result, "spawn 3 agents for this refactor")
    expect(eval_.shouldSpawn).toBe(true)
    expect(eval_.suggestedCount).toBe(3)
    expect(eval_.reason).toContain("explicitly requested")
  })

  test("user count capped at RATE_MAX_SPAWNS (5)", () => {
    const result = makeResult()
    const eval_ = evaluateSpawnNecessity(result, "spawn 10 agents")
    expect(eval_.suggestedCount).toBe(5)
  })

  test("DREAM_INNOVATION always spawns with min 3", () => {
    const result = makeResult({ mode: "DREAM_INNOVATION" })
    const eval_ = evaluateSpawnNecessity(result, "innovate something")
    expect(eval_.shouldSpawn).toBe(true)
    expect(eval_.suggestedCount).toBeGreaterThanOrEqual(3)
    expect(eval_.reason).toContain("DREAM_INNOVATION")
  })

  test("simple high-confidence task → no spawn", () => {
    const result = makeResult({
      confidence: 0.9,
      risk_level: "low",
      domain_tags: ["typescript"],
      complexity: "low",
    })
    const eval_ = evaluateSpawnNecessity(result, "fix the login button color")
    expect(eval_.shouldSpawn).toBe(false)
    expect(eval_.reason).toContain("Simple high-confidence")
  })

  test("multi-domain task scores higher", () => {
    const result = makeResult({
      domain_tags: ["auth", "database", "frontend"],
      risk_level: "medium",
      confidence: 0.5,
      complexity: "medium",
    })
    const eval_ = evaluateSpawnNecessity(result, "refactor auth flow with new DB schema and UI updates")
    expect(eval_.shouldSpawn).toBe(true)
    expect(eval_.suggestedCount).toBeGreaterThanOrEqual(1)
  })

  test("high risk scores higher", () => {
    const result = makeResult({
      risk_level: "high",
      domain_tags: ["security"],
      confidence: 0.5,
    })
    const eval_ = evaluateSpawnNecessity(result, "review security vulnerability in auth module")
    expect(eval_.shouldSpawn).toBe(true)
    expect(eval_.reason).toContain("High risk")
  })

  test("complex chain scores higher", () => {
    const result = makeResult({
      chain: ["security-auditor", "debugging", "testing", "performance"],
      domain_tags: ["typescript"],
      confidence: 0.5,
    })
    const eval_ = evaluateSpawnNecessity(result, "optimize the full stack")
    expect(eval_.shouldSpawn).toBe(true)
    expect(eval_.reason).toContain("Complex skill chain")
  })

  test("always-skills filtered from chain scoring", () => {
    // Chain with only always-skills should not trigger chain scoring
    const result = makeResult({
      chain: ["breakthrough-overdrive-innovation", "pieces-ltm", "lint-fixer"],
      domain_tags: ["typescript"],
      confidence: 0.5,
      risk_level: "low",
    })
    const eval_ = evaluateSpawnNecessity(result, "small change")
    // effectiveChainLen = 0, so no chain scoring
    expect(eval_.shouldSpawn).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// selectPersonas
// ---------------------------------------------------------------------------

describe("selectPersonas", () => {
  test("TRIVIAL mode → 0 personas", () => {
    const result = makeResult({ mode: "TRIVIAL" })
    const personas = selectPersonas(result)
    expect(personas).toHaveLength(0)
  })

  test("DREAM_INNOVATION mode gets more personas", () => {
    const result = makeResult({
      mode: "DREAM_INNOVATION",
      domain_tags: ["auth", "security", "typescript"],
      risk_level: "high",
    })
    const personas = selectPersonas(result)
    expect(personas.length).toBeGreaterThanOrEqual(1)
  })

  test("matching tags produce persona selection", () => {
    const result = makeResult({
      domain_tags: ["auth", "security"],
      risk_level: "high",
      mode: "STANDARD",
    })
    const personas = selectPersonas(result)
    // Should select security-related personas due to matching tags
    expect(personas.length).toBeGreaterThanOrEqual(1)
  })

  test("no matching tags → 0 personas for low complexity", () => {
    const result = makeResult({
      domain_tags: ["cooking"],
      risk_level: "low",
      complexity: "low",
      mode: "STANDARD",
    })
    const personas = selectPersonas(result)
    expect(personas).toHaveLength(0)
  })

  test("personas have required fields", () => {
    const result = makeResult({
      domain_tags: ["auth", "security", "typescript"],
      risk_level: "high",
      mode: "DREAM_INNOVATION",
    })
    const personas = selectPersonas(result)
    for (const p of personas) {
      expect(p.name).toBeTruthy()
      expect(p.role).toBeTruthy()
      expect(p.focus).toBeTruthy()
      expect(Array.isArray(p.skills)).toBe(true)
      expect(p.task).toBeTruthy()
      expect(Array.isArray(p.goals)).toBe(true)
      expect(p.synthesisGuide).toBeTruthy()
    }
  })
})

// ---------------------------------------------------------------------------
// validateNeuroOutput
// ---------------------------------------------------------------------------

describe("validateNeuroOutput", () => {
  test("valid JSON object → returns safe stringified result", () => {
    const input = JSON.stringify({ status: "success", analysis: "looks good" })
    const result = validateNeuroOutput(input)
    expect(result).toBe(input)
  })

  test("mixed stdout with JSON at end → extracts last JSON", () => {
    const input = [
      "NEURO: Model router selected neurometric/clawpack (+0 secondary)",
      "NEURO: Reasoning: best match for task",
      "NEURO: 3 files, ~4500 tokens, scan=full_audit",
      '{"status": "success", "analysis": "detailed results"}',
    ].join("\n")
    const result = validateNeuroOutput(input)
    // JSON.stringify produces compact JSON without spaces
    expect(result).toBe(JSON.stringify({ status: "success", analysis: "detailed results" }))
  })

  test("malformed JSON → null", () => {
    const result = validateNeuroOutput("this is not json at all")
    expect(result).toBeNull()
  })

  test("non-object JSON (array) → null", () => {
    const result = validateNeuroOutput("[1, 2, 3]")
    expect(result).toBeNull()
  })

  test("non-object JSON (string) → null", () => {
    const result = validateNeuroOutput('"just a string"')
    expect(result).toBeNull()
  })

  test("non-object JSON (null) → null", () => {
    const result = validateNeuroOutput("null")
    expect(result).toBeNull()
  })

  test("empty string → null", () => {
    const result = validateNeuroOutput("")
    expect(result).toBeNull()
  })

  test("JSON embedded in noise → extracts it", () => {
    const obj = { status: "ok" }
    const input = "some noise\nmore noise\n" + JSON.stringify(obj) + "\ntrailing noise"
    const result = validateNeuroOutput(input)
    expect(result).toBe(JSON.stringify(obj))
  })

  test("large JSON truncated to 50KB", () => {
    const bigObj = { data: "x".repeat(60_000) }
    const input = JSON.stringify(bigObj)
    const result = validateNeuroOutput(input)
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(50_001) // JSON.stringify adds quotes
  })

  test("multiple JSON objects → returns last one", () => {
    const input = [
      '{"status": "partial", "step": 1}',
      '{"status": "success", "step": 2}',
    ].join("\n")
    const result = validateNeuroOutput(input)
    expect(result).toBe(JSON.stringify({ status: "success", step: 2 }))
  })
})

// ---------------------------------------------------------------------------
// depthScore
// ---------------------------------------------------------------------------

describe("depthScore", () => {
  test("empty inputs → minimum score is 1", () => {
    // Even with empty inputs, the formula (risk + tagDiversity + chainDepth) / 3
    // with risk=1 (low) gives Math.ceil(1/3) = 1
    const result = depthScore(makeResult({ domain_tags: [], chain: [], risk_level: "low" }))
    expect(result).toBe(1)
  })

  test("single domain, short chain, low risk → 1", () => {
    const result = depthScore(makeResult({
      domain_tags: ["typescript"],
      chain: ["general"],
      risk_level: "low",
    }))
    expect(result).toBe(1)
  })

  test("medium risk, moderate domains → 3", () => {
    const result = depthScore(makeResult({
      domain_tags: ["typescript", "react"],
      chain: ["general", "frontend"],
      risk_level: "medium",
    }))
    expect(result).toBeGreaterThanOrEqual(2)
    expect(result).toBeLessThanOrEqual(4)
  })

  test("high risk, many domains, long chain → 4 (ceiling of (3+5+4)/3 = 4)", () => {
    // risk=3 (high), tagDiversity=5, chainDepth=4 (capped)
    // result = ceil((3+5+4)/3) = ceil(12/3) = 4
    const result = depthScore(makeResult({
      domain_tags: ["typescript", "react", "security", "database", "api"],
      chain: ["general", "security", "quality", "testing", "frontend"],
      risk_level: "high",
    }))
    expect(result).toBe(4)
  })

  test("handles empty domain_tags", () => {
    const result = depthScore(makeResult({ domain_tags: [], chain: ["general"], risk_level: "low" }))
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(5)
  })

  test("handles empty chain", () => {
    const result = depthScore(makeResult({ domain_tags: ["typescript"], chain: [], risk_level: "low" }))
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(5)
  })

  test("clamps to 0-5 range", () => {
    const low = depthScore(makeResult({ domain_tags: [], chain: [], risk_level: "low" }))
    const high = depthScore(makeResult({
      domain_tags: ["a", "b", "c", "d", "e"],
      chain: ["1", "2", "3", "4", "5", "6", "7"],
      risk_level: "high",
    }))
    expect(low).toBeGreaterThanOrEqual(0)
    expect(high).toBeLessThanOrEqual(5)
  })

  test("DREAM_INNOVATION mode does not affect depthScore directly", () => {
    // depthScore is mode-agnostic — mode bonus is applied in selectPersonas
    const standard = depthScore(makeResult({
      mode: "STANDARD",
      domain_tags: ["typescript"],
      chain: ["general"],
      risk_level: "low",
    }))
    const dream = depthScore(makeResult({
      mode: "DREAM_INNOVATION",
      domain_tags: ["typescript"],
      chain: ["general"],
      risk_level: "low",
    }))
    expect(standard).toBe(dream)
  })
})
