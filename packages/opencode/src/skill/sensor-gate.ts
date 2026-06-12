import { Effect, Context, Layer } from "effect"
import * as fs from "fs"
import * as path from "path"
import { execFileSync } from "child_process"
import { InstanceState } from "@/effect/instance-state"
import { buildPrompt } from "./prompt-engine"

export interface SensorGateResult {
  intent: string
  domain_tags: string[]
  risk_level: string
  time_sensitivity: string
  requires_tools: string
  deliverable_type: string
  is_social_greeting: boolean
  primary_skill: string
  support_skills: string[]
  automation: string
  mode: string
  chain: string[]
  guardian_decision: string
  guardian_risk: string
  skill_plan: string
  raw_output: string
  neuro_result?: string
}

function parseSensorGateOutput(output: string): SensorGateResult {
  const lines = output.split("\n")
  const result: SensorGateResult = {
    intent: "",
    domain_tags: [],
    risk_level: "medium",
    time_sensitivity: "medium",
    requires_tools: "files",
    deliverable_type: "multi",
    is_social_greeting: false,
    primary_skill: "",
    support_skills: [],
    automation: "none",
    mode: "STANDARD",
    chain: [],
    guardian_decision: "APPROVED",
    guardian_risk: "low",
    skill_plan: "",
    raw_output: output,
  }

  for (const line of lines) {
    const trimmed = line.trim()

    // Intent Classification
    if (trimmed.startsWith("- intent:")) result.intent = trimmed.slice(10).trim()
    if (trimmed.startsWith("- domain_tags:")) {
      const tags = trimmed.slice(14).trim()
      result.domain_tags = tags.split(",").map((t) => t.trim()).filter(Boolean)
    }
    if (trimmed.startsWith("- risk_level:")) result.risk_level = trimmed.slice(13).trim()
    if (trimmed.startsWith("- time_sensitivity:")) result.time_sensitivity = trimmed.slice(19).trim()
    if (trimmed.startsWith("- requires_tools:")) result.requires_tools = trimmed.slice(17).trim()
    if (trimmed.startsWith("- deliverable_type:")) result.deliverable_type = trimmed.slice(19).trim()
    if (trimmed.startsWith("- is_social_greeting:")) {
      result.is_social_greeting = trimmed.slice(21).trim() === "true"
    }

    // Skill Resolution
    if (trimmed.startsWith("- primary:")) result.primary_skill = trimmed.slice(10).trim()
    if (trimmed.startsWith("- supports:")) {
      const skills = trimmed.slice(11).trim()
      result.support_skills = skills.split(",").map((s) => s.trim()).filter(Boolean)
    }
    if (trimmed.startsWith("- automation:")) result.automation = trimmed.slice(13).trim()
    if (trimmed.startsWith("- mode:")) result.mode = trimmed.slice(7).trim()
    if (trimmed.startsWith("- chain:")) {
      const chain = trimmed.slice(8).trim()
      result.chain = chain.split("→").map((s) => s.trim()).filter(Boolean)
    }

    // Guardian AI
    if (trimmed.startsWith("- decision:")) result.guardian_decision = trimmed.slice(11).trim()
    if (trimmed.startsWith("- risk_level:") && lines.indexOf(line) > lines.findIndex((l) => l.includes("[GUARDIAN]"))) {
      result.guardian_risk = trimmed.slice(13).trim()
    }
  }

  // Extract Skill Plan block
  const skillPlanStart = output.indexOf("Skill Plan:")
  if (skillPlanStart !== -1) {
    const skillPlanEnd = output.indexOf("=", skillPlanStart)
    result.skill_plan = skillPlanEnd !== -1
      ? output.slice(skillPlanStart, skillPlanEnd).trim()
      : output.slice(skillPlanStart).trim()
  }

  return result
}

function runSensorGate(prompt: string, projectRoot: string): SensorGateResult | null {
  const skillsDir = path.join(projectRoot, ".dreamcode", "skills")
  const sensorGate = path.join(skillsDir, "chain-orchestrator", "scripts", "sensor_gate.py")

  if (!fs.existsSync(sensorGate)) return null

  try {
    const output = execFileSync("python3", [sensorGate, "--prompt", prompt], {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: projectRoot,
    })
    return parseSensorGateOutput(output)
  } catch (e) {
    // Sensor gate failed — return null, don't block the response
    return null
  }
}

function runNeuroHarness(prompt: string, projectRoot: string, scanType: string): string | null {
  const skillsDir = path.join(projectRoot, ".dreamcode", "skills")
  const neuroHarness = path.join(skillsDir, "neuro", "scripts", "neuro_harness.py")

  if (!fs.existsSync(neuroHarness)) return null

  try {
    // Build prompt using TypeScript prompt engine
    const promptResult = buildPrompt({
      scanType,
      files: [{ path: "user_prompt", content: prompt }],
      context: prompt.slice(0, 500),
    })

    // Create a temp file with a unique name to avoid race conditions
    const tmpDir = path.join(projectRoot, ".dreamcode", "tmp")
    fs.mkdirSync(tmpDir, { recursive: true })
    const tmpFile = path.join(tmpDir, `prompt_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`)
    fs.writeFileSync(tmpFile, promptResult.userPrompt)

    const output = execFileSync("python3", [
      neuroHarness,
      "--scan-type", scanType,
      "--file", tmpFile,
      "--task", prompt.slice(0, 200),
    ], {
      encoding: "utf8",
      timeout: 60000,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: projectRoot,
    })

    // Clean up temp file
    try { fs.unlinkSync(tmpFile) } catch {}

    return output
  } catch (e) {
    // Neuro harness failed — return null, don't block the response
    return null
  }
}

export interface Interface {
  readonly classify: (prompt: string) => Effect.Effect<SensorGateResult | null>
}

export class Service extends Context.Service<Service, Interface>()("@dreamcode/SensorGate") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const ctx = yield* InstanceState.context

    return Service.of({
      classify: Effect.fn("SensorGate.classify")(function* (prompt: string) {
        const result = runSensorGate(prompt, ctx.directory)
        if (!result) return null

        // Run neuro harness for complex prompts (high risk or DREAM_INNOVATION mode)
        const shouldRunNeuro = result.risk_level === "high" ||
          result.mode === "DREAM_INNOVATION" ||
          result.chain.length > 3

        if (shouldRunNeuro) {
          const scanType = result.risk_level === "high" ? "security" : "full_audit"
          const neuroResult = runNeuroHarness(prompt, ctx.directory, scanType)
          if (neuroResult) {
            result.neuro_result = neuroResult
          }
        }

        return result
      }),
    })
  }),
)

export const defaultLayer = layer

export * as SensorGate from "./sensor-gate"
