import { Effect, Context, Layer, Duration } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { Skill } from "@/skill"
import { Glob } from "@opencode-ai/core/util/glob"
import path from "path"
import { resolvePythonCommand, getPythonArgs, resolveSkillsDir, HOME, writePromptToTmpFile, cleanupTmpFile, validateScriptPath, BASE_SUBPROCESS_ENV } from "./python-resolver"

const CHAIN_EXEC_LOG = path.join(HOME, ".dreamcode", "chain-executions.jsonl")

/** Fire-and-forget structured audit log for chain executor executions */
function logChainExecution(entry: {
  chain: string[]
  promptLen: number
  results: Array<{ name: string; status: string; executionType: string; outputLen: number }>
  timestamp: string
  totalDuration: number
}) {
  return Effect.tryPromise({
    try: async () => {
      const { mkdir } = await import("fs/promises")
      await mkdir(path.dirname(CHAIN_EXEC_LOG), { recursive: true })
      const { appendFile } = await import("fs/promises")
      await appendFile(CHAIN_EXEC_LOG, JSON.stringify(entry) + "\n")
    },
    catch: () => {}, // Audit log failure is non-fatal
  }).pipe(Effect.catch(() => Effect.void))
}
export interface ChainResult {
  name: string
  output: string
  status: "ok" | "not_found" | "error"
  /** Distinguishes actual Python subprocess execution from passive SKILL.md content injection */
  executionType: "script" | "content"
}

export interface Interface {
  readonly execute: (
    chain: string[],
    userPrompt: string,
  ) => Effect.Effect<ChainResult[]>
  readonly runFullPipeline: () => Effect.Effect<ChainResult[]>
  readonly verify: (
    results: ChainResult[],
  ) => Effect.Effect<string>
}

const discoverScripts = Effect.fn("ChainExecutor.discoverScripts")(function* (skillLocation: string) {
  const dir = path.dirname(skillLocation)
  return yield* Effect.tryPromise({
    try: () => Glob.scan("scripts/*.py", { cwd: dir, absolute: true }),
    catch: () => [] as string[],
  }).pipe(Effect.map((scripts) => scripts as string[]))
})

const runPythonScript = Effect.fn("ChainExecutor.runPythonScript")(function* (
  script: string,
  prompt: string,
  cwd: string,
) {
  if (!validateScriptPath(path.resolve(script), cwd)) {
    return { output: "[SKIPPED] Script path outside allowed skills directory", exitCode: 0 }
  }
  // Pass prompt via temp file + --prompt-file to avoid leaking it in process listings.
  // Bun.spawn creates Unix domain sockets (not pipes) in compiled binaries,
  // and writer.close() doesn't send EOF through them, causing Python's
  // sys.stdin.read() to block forever. --prompt-file avoids this entirely.
  let tmpFile = ""
  try {
    tmpFile = writePromptToTmpFile(prompt, cwd, "ce-")
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn("[chain-executor] failed to create tmp file for prompt", msg)
    return { output: `[ERROR] Failed to create temp file: ${msg}`, exitCode: -1 }
  }
  // Cross-platform Python resolution
  const pythonCmd = resolvePythonCommand()
  const versionArgs = getPythonArgs()
  return yield* Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn([pythonCmd, ...versionArgs, script, "--prompt-file", tmpFile], {
        cwd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...BASE_SUBPROCESS_ENV,
          PROJECT_ROOT: cwd,
        },
      })
      const stdoutPromise = new Response(proc.stdout).text()
      const stderrPromise = new Response(proc.stderr).text()
      const exitCode = await proc.exited
      const stdout = await stdoutPromise
      const stderr = await stderrPromise
      if (exitCode !== 0) {
        const detail = (stderr || stdout || "").slice(0, 500)
        console.warn("[chain-executor] script exited non-zero", { script, exitCode, detail })
        return { output: `[ERROR] Exit code ${exitCode}: ${detail}`, exitCode }
      }
      return { output: stdout || "", exitCode: 0 }
    },
    catch: (err) => new Error(String(err)),
  }).pipe(
    Effect.timeout(Duration.seconds(150)),
    Effect.catch((e) => {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn("[chain-executor] python script failed", { script, error: msg })
      return Effect.succeed({ output: `[ERROR] ${msg}`, exitCode: -1 })
    }),
    Effect.tap(() => {
      cleanupTmpFile(tmpFile)
      return Effect.void
    }),
  )
})

const runPythonScriptAdvanced = Effect.fn("ChainExecutor.runPythonScriptAdvanced")(function* (
  script: string,
  args: string[],
  cwd: string,
) {
  if (!validateScriptPath(path.resolve(script), cwd)) {
    return { output: "", exitCode: 0 }
  }
  // Cross-platform Python resolution
  const pythonCmd = resolvePythonCommand()
  const versionArgs = getPythonArgs()
  return yield* Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn([pythonCmd, ...versionArgs, script, ...args], {
        cwd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...BASE_SUBPROCESS_ENV,
          PROJECT_ROOT: cwd,
        },
      })
      const stdoutPromise = new Response(proc.stdout).text()
      const stderrPromise = new Response(proc.stderr).text()
      const exitCode = await proc.exited
      const stdout = await stdoutPromise
      const stderr = await stderrPromise
      if (exitCode !== 0) {
        const detail = (stderr || stdout || "").slice(0, 500)
        console.warn("[chain-executor] advanced script exited non-zero", { script, exitCode, detail })
        return { output: `[ERROR] Exit code ${exitCode}: ${detail}`, exitCode }
      }
      return { output: stdout || "", exitCode: 0 }
    },
    catch: (err) => new Error(String(err)),
  }).pipe(
    Effect.timeout(Duration.seconds(300)),
    Effect.catch((e) => {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn("[chain-executor] advanced python script failed", { script, error: msg })
      return Effect.succeed({ output: `[ERROR] ${msg}`, exitCode: -1 })
    }),
  )
})

export const execute = Effect.fn("ChainExecutor.execute")(function* (
  chain: string[],
  userPrompt: string,
) {
  const startTime = Date.now()
  const skillService = yield* Skill.Service
  const ctx = yield* InstanceState.contextOrNull
  const cwd = ctx?.directory ?? process.cwd()
  const results: ChainResult[] = []

  for (const skillName of chain) {
    const skillInfo = yield* skillService.require(skillName, { skipAutoExecute: true }).pipe(Effect.option)
    if (skillInfo._tag === "None") {
      results.push({ name: skillName, output: "", status: "not_found", executionType: "content" })
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
        executionType: "content",
      })
      continue
    }

    // Execute the first discovered script — prefer run.py as entry point
    const script = scripts.find((s) => path.basename(s) === "run.py") ?? scripts[0]
    const scriptResult = yield* runPythonScript(script, userPrompt, cwd)

    if (scriptResult.exitCode !== 0) {
      // Script crashed or was killed — propagate the error detail.
      // SKILL.md content is NOT injected here — the model must load it
      // via the `skill` tool as part of mandatory chain enforcement.
      results.push({
        name: skillName,
        output: `<script-execution-result>\n${scriptResult.output || `[ERROR] Script exited with code ${scriptResult.exitCode}`}\n</script-execution-result>`,
        status: "error",
        executionType: "script",
      })
    } else {
      // Include only the script execution output. The model must load
      // the skill's SKILL.md content independently via the `skill` tool.
      results.push({
        name: skillName,
        output: `<script-execution-result>\n${scriptResult.output || "[SKILL EXECUTED: no output]"}\n</script-execution-result>`,
        status: scriptResult.output ? "ok" : "error",
        executionType: "script",
      })
    }
  }

  // ─── Structured audit log ──────────────────────────────────────
  // Fire-and-forget: log every chain execution for debugging and metrics.
  yield* logChainExecution({
    chain,
    promptLen: userPrompt.length,
    results: results.map((r) => ({
      name: r.name,
      status: r.status,
      executionType: r.executionType,
      outputLen: r.output.length,
    })),
    timestamp: new Date().toISOString(),
    totalDuration: Date.now() - startTime,
  })

  return results
})

export const runFullPipeline = Effect.fn("ChainExecutor.runFullPipeline")(function* () {
  const ctx = yield* InstanceState.contextOrNull
  const cwd = ctx?.directory ?? process.cwd()
  const skillsDir = resolveSkillsDir()
  if (!skillsDir) {
    console.warn("[chain-executor] skills directory not found, skipping pipeline")
    return []
  }
  const executorScript = path.join(skillsDir, "chain-orchestrator", "scripts", "orchestrator.py")

  // Run the full pipeline — caller already handles normal chain execution via execute()
  // to prevent double execution of skill scripts.
  const results: ChainResult[] = []

  // If the Python executor script exists, run the full pipeline
  try {
    const exists = yield* Effect.tryPromise({
      try: () => Bun.file(executorScript).exists(),
      catch: () => false,
    })
    if (!exists) {
      results.push({
        name: "chain-executor-pipeline",
        output: `[WARNING] Pipeline orchestrator not found: ${executorScript}`,
        status: "error",
        executionType: "content",
      })
      return results
    }
    const pipelineResult = yield* runPythonScriptAdvanced(
      executorScript,
      ["--dashboard", "--json"],
      cwd,
    )
    if (pipelineResult.exitCode !== 0) {
      results.push({
        name: "chain-executor-pipeline",
        output: pipelineResult.output || `[ERROR] Pipeline script exited with code ${pipelineResult.exitCode}`,
        status: "error",
        executionType: "script",
      })
    } else if (pipelineResult.output) {
      results.push({
        name: "chain-executor-pipeline",
        output: pipelineResult.output,
        status: "ok",
        executionType: "script",
      })
    }
  } catch (e) {
    results.push({
      name: "chain-executor-pipeline",
      output: `[ERROR] Pipeline execution failed: ${String(e)}`,
      status: "error",
      executionType: "content",
    })
  }

  return results
})

export const verify = Effect.fn("ChainExecutor.verify")(function* (results: ChainResult[]) {
  const ctx = yield* InstanceState.contextOrNull
  const cwd = ctx?.directory ?? process.cwd()
  const skillsDir = resolveSkillsDir()
  if (!skillsDir) {
    return "[WARNING] Skills directory not found — verify skipped"
  }
  const enforcerScript = path.join(skillsDir, "chain-orchestrator", "scripts", "enforcer.py")

  try {
    const exists = yield* Effect.tryPromise({
      try: () => Bun.file(enforcerScript).exists(),
      catch: () => false,
    })
    if (!exists) {
      return `[WARNING] Enforcer script not found: ${enforcerScript} — verify skipped`
    }

    const summary = results
      .map((r) => `${r.name}: ${r.status}`)
      .join("\n")

    const verifierResult = yield* runPythonScriptAdvanced(
      enforcerScript,
      ["--results", summary],
      cwd,
    )
    if (verifierResult.exitCode !== 0) {
      return verifierResult.output || `[ERROR] Enforcer exited with code ${verifierResult.exitCode}`
    }
    return verifierResult.output || ""
  } catch (e) {
    return `[ERROR] Verify failed: ${String(e)}`
  }
})

export class Service extends Context.Service<Service, Interface>()("@dreamcode/ChainExecutor") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return Service.of({
      execute: ((chain, userPrompt) => execute(chain, userPrompt).pipe(Effect.catch(Effect.die))) as Interface["execute"],
      runFullPipeline: (() => runFullPipeline().pipe(Effect.catch(Effect.die))) as Interface["runFullPipeline"],
      verify: ((results) => verify(results).pipe(Effect.catch(Effect.die))) as Interface["verify"],
    })
  }),
)

export const defaultLayer = layer

export const node = LayerNode.make(layer, [])

export const ChainExecutor = { Service, layer, defaultLayer, node }
