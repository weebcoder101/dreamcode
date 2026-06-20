import { Effect, Context, Layer, Duration } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import * as Stream from "effect/Stream"
import { ChildProcess } from "effect/unstable/process"
import { InstanceState } from "@/effect/instance-state"
import { Skill } from "@/skill"
import { Glob } from "@opencode-ai/core/util/glob"
import path from "path"

const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp"

function validateScriptPath(resolved: string): boolean {
  const allowed = path.resolve(HOME, ".config", "dreamcode", "skills")
  return resolved.startsWith(allowed)
}

export interface ChainResult {
  name: string
  output: string
  status: "ok" | "not_found" | "error"
}

export interface Interface {
  readonly execute: (
    chain: string[],
    userPrompt: string,
  ) => Effect.Effect<ChainResult[]>
  readonly runFullPipeline: (
    chain: string[],
    userPrompt: string,
  ) => Effect.Effect<ChainResult[]>
  readonly verify: (
    results: ChainResult[],
  ) => Effect.Effect<string>
}

const discoverScripts = Effect.fn("ChainExecutor.discoverScripts")(function* (skillLocation: string) {
  const dir = path.dirname(skillLocation)
  try {
    const scripts = yield* Effect.tryPromise({
      try: () => Glob.scan("scripts/*.py", { cwd: dir, absolute: true }),
      catch: () => [] as string[],
    })
    return scripts as string[]
  } catch {
    return [] as string[]
  }
})

const runPythonScript = Effect.fn("ChainExecutor.runPythonScript")(function* (
  script: string,
  prompt: string,
  cwd: string,
) {
  if (!validateScriptPath(path.resolve(script))) {
    return "[SKIPPED] Script path outside allowed skills directory"
  }
  const promptBytes = new TextEncoder().encode(prompt)
  const child = yield* ChildProcess.make({
    command: "python3",
    args: [script, "--stdin"],
    stdin: Stream.make(promptBytes),
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  })
  const output = yield* child.stdout
    .pipe(Stream.toString)
    .pipe(Effect.timeout(Duration.seconds(150)))
    .pipe(Effect.catch(() => Effect.succeed("")))
  return output
})

const runPythonScriptAdvanced = Effect.fn("ChainExecutor.runPythonScriptAdvanced")(function* (
  script: string,
  args: string[],
  cwd: string,
) {
  if (!validateScriptPath(path.resolve(script))) {
    return ""
  }
  const child = yield* ChildProcess.make({
    command: "python3",
    args: [script, ...args],
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  })
  const output = yield* child.stdout
    .pipe(Stream.toString)
    .pipe(Effect.timeout(Duration.seconds(300)))
    .pipe(Effect.catch(() => Effect.succeed("")))
  return output
})

export const execute = Effect.fn("ChainExecutor.execute")(function* (
  chain: string[],
  userPrompt: string,
) {
  const skillService = yield* Skill.Service
  const ctx = yield* InstanceState.contextOrNull
  const cwd = ctx?.directory ?? process.cwd()
  const results: ChainResult[] = []

  for (const skillName of chain) {
    const skillInfo = yield* skillService.require(skillName).pipe(Effect.option)
    if (skillInfo._tag === "None") {
      results.push({ name: skillName, output: "", status: "not_found" })
      continue
    }

    const skill = skillInfo.value
    // Discover Python scripts in the skill's scripts/ directory
    const scripts = yield* discoverScripts(skill.location)

    if (scripts.length === 0) {
      // No script to execute — inject skill content as passive result
      results.push({
        name: skillName,
        output: skill.content,
        status: "ok",
      })
      continue
    }

    // Execute the first discovered script
    const script = scripts[0]
    const result = yield* runPythonScript(script, userPrompt, cwd).pipe(
      Effect.catch((err) =>
        Effect.succeed(`[ERROR] Script execution failed: ${err}`)
      ),
    )

    results.push({
      name: skillName,
      output: result || "[SKILL EXECUTED: no output]",
      status: result ? "ok" : "error",
    })
  }

  return results
})

export const runFullPipeline = Effect.fn("ChainExecutor.runFullPipeline")(function* (
  chain: string[],
  userPrompt: string,
) {
  const ctx = yield* InstanceState.contextOrNull
  const cwd = ctx?.directory ?? process.cwd()
  const skillsDir = path.join(HOME, ".config", "dreamcode", "skills")
  const executorScript = path.join(skillsDir, "chain-orchestrator", "scripts", "orchestrator.py")

  // First run the normal chain execution
  const results = yield* execute(chain, userPrompt)

  // Then if the Python executor script exists, run the full pipeline
  try {
    const exists = yield* Effect.tryPromise({
      try: () => Bun.file(executorScript).exists(),
      catch: () => false,
    })
    if (exists) {
      const pipelineResult = yield* runPythonScriptAdvanced(
        executorScript,
        ["--mode", chain.length > 3 ? "DREAM_INNOVATION" : "STANDARD", "--prompt", userPrompt],
        cwd,
      ).pipe(
        Effect.catch(() => Effect.succeed("")),
      )
      if (pipelineResult) {
        results.push({
          name: "chain-executor-pipeline",
          output: pipelineResult,
          status: "ok",
        })
      }
    }
  } catch {
    // Pipeline script not available — skip
  }

  return results
})

export const verify = Effect.fn("ChainExecutor.verify")(function* (results: ChainResult[]) {
  const ctx = yield* InstanceState.contextOrNull
  const cwd = ctx?.directory ?? process.cwd()
  const skillsDir = path.join(HOME, ".config", "dreamcode", "skills")
  const enforcerScript = path.join(skillsDir, "chain-orchestrator", "scripts", "enforcer.py")

  try {
    const exists = yield* Effect.tryPromise({
      try: () => Bun.file(enforcerScript).exists(),
      catch: () => false,
    })
    if (!exists) return ""

    const summary = results
      .map((r) => `${r.name}: ${r.status}`)
      .join("\n")

    const verifierResult = yield* runPythonScriptAdvanced(
      enforcerScript,
      ["--results", summary],
      cwd,
    ).pipe(
      Effect.catch(() => Effect.succeed("")),
    )

    return verifierResult || ""
  } catch {
    return ""
  }
})

export class Service extends Context.Service<Service, Interface>()("@dreamcode/ChainExecutor") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return Service.of({
      execute: (chain, userPrompt) => execute(chain, userPrompt),
      runFullPipeline: (chain, userPrompt) => runFullPipeline(chain, userPrompt),
      verify: (results) => verify(results),
    })
  }),
)

export const defaultLayer = layer

export const node = LayerNode.make(layer, [])

export * as ChainExecutor from "./chain-executor"
