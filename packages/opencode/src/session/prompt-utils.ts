import { Effect } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { SessionID } from "./schema"
import type { ChainResult } from "@/skill/chain-executor"
import { debugLog } from "@/skill/python-resolver"

const DEFAULT_KNOWLEDGE_BLOCK = `<learned-knowledge>
Cross-session Effect v4 API rules (persistent across sessions):
- Effect.catchAll does NOT exist in Effect v4 beta — use Effect.catch instead
- Effect.fork and Effect.forkDaemon do NOT exist in Effect v4 — use Effect.forkIn(scope)
- Effect.catch catches all errors including defects; use Effect.catchTag for tagged errors
- Use Effect.gen(function* () { ... }) for composition
- Use Effect.fn('Domain.method') for named/traced effects
- Use Schema.Class for multi-field data; Schema.TaggedErrorClass for typed errors
- Use Bun.spawn() wrapped in Effect.tryPromise for subprocesses in compiled binaries
- Use Layer.mock(Service, { method1, method2 }) for test stubs
</learned-knowledge>`

function sanitizeForSystemPrompt(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/<[a-zA-Z][^>]*\/>/g, "")
    .replace(/<\/[a-zA-Z][^>]*>/g, "")
    .replace(/<[a-zA-Z][^>]*>/g, "")
}

function normalizeTokens(t: Record<string, unknown> | undefined): SessionV1.StepFinishPart["tokens"] {
  const cache = t?.cache as Record<string, unknown> | undefined
  return {
    input: (t?.input as number) ?? 0,
    output: (t?.output as number) ?? 0,
    reasoning: (t?.reasoning as number) ?? 0,
    cache: {
      read: (cache?.read as number) ?? 0,
      write: (cache?.write as number) ?? 0,
    },
  }
}

function isOrphanedInterruptedTool(part: SessionV1.ToolPart) {
  return part.state.status === "error" && part.state.metadata?.interrupted === true
}

function* injectChainGapDetection(
  system: string[],
  gateResult: any,
  chainResults: ChainResult[],
  userText: string,
  chainExecutor: any,
): Generator<Effect.Effect<void, never, never>, void, any> {
  const missingSkills = gateResult.chain.filter(
    (name: string) => !chainResults.some(
      (r: ChainResult) => r.name === name && r.status === "ok",
    ),
  )
  const MANDATED_SKILLS = new Set(["breakthrough-overdrive-innovation"])
  const missingMandated = missingSkills.filter((s: string) => MANDATED_SKILLS.has(s))

  if (missingMandated.length > 0) {
    debugLog("[prompt] Re-executing mandated skills:", missingMandated)
    const reExecuteResult = yield* chainExecutor.execute(missingMandated, userText).pipe(
      Effect.catch(() => Effect.succeed([] as Array<ChainResult>)),
    )
    chainResults.push(...(reExecuteResult as ChainResult[]))
    for (const result of reExecuteResult as ChainResult[]) {
      if (result.status === "ok" && result.output) {
        system.push(`\n<script-result name="${sanitizeForSystemPrompt(result.name)}" source="mandated-rerun">\n${sanitizeForSystemPrompt(result.output.slice(0, 5000))}\n</script-result>`)
      }
    }
    const stillMissing = gateResult.chain.filter(
      (name: string) => !chainResults.some(
        (r: ChainResult) => r.name === name && r.status === "ok",
      ),
    )
    if (stillMissing.length > 0) {
      system.push(
        `\n<chain-gap>WARNING: These skills in the sensor gate chain were NOT executed: ${sanitizeForSystemPrompt(stillMissing.join(", "))}. ` +
        `You MUST ensure each skill in the chain is loaded and its instructions followed before proceeding.` +
        `\nSkipped chain steps degrade the quality of the response.</chain-gap>`,
      )
    }
  } else if (missingSkills.length > 0) {
    system.push(
      `\n<chain-gap>WARNING: These skills in the sensor gate chain were NOT executed: ${sanitizeForSystemPrompt(missingSkills.join(", "))}. ` +
      `You MUST ensure each skill in the chain is loaded and its instructions followed before proceeding.` +
      `\nSkipped chain steps degrade the quality of the response.</chain-gap>`,
    )
  }
}

/**
 * Scan conversation history for completed `skill` tool calls and
 * the `[SKILLS LOADED]` acknowledgment token.
 */
function scanForSkillToolCalls(msgs: any[]): { loaded: Set<string>; acknowledged: boolean } {
  const loaded = new Set<string>()
  let acknowledged = false
  for (const msg of msgs) {
    if (msg.info.role !== "assistant") continue
    for (const part of msg.parts) {
      if (part.type === "tool" && part.tool === "skill" && part.state.status === "completed") {
        loaded.add(part.state.input.name ?? "")
      }
      if (part.type === "text" && part.text?.includes("[SKILLS LOADED]")) {
        acknowledged = true
      }
    }
  }
  return { loaded, acknowledged }
}

/**
 * Return the list of chain skills that have NOT been loaded via the `skill` tool
 * in the given message history.
 */
function getUnloadedChainSkills(gateResult: any, msgs: any[]): string[] {
  const { loaded } = scanForSkillToolCalls(msgs)
  return gateResult.chain.filter((name: string) => !loaded.has(name))
}

/**
 * Build a hard-block assistant message that tells the LLM to load skills.
 * Used by the pre-turn enforcement gate to skip the LLM turn.
 */
function buildUnloadedChainBlockMessage(unloaded: string[]): string {
  return [
    `<hard-block>`,
    `⚠️ Skill Loading Enforced: ${unloaded.length} chain skill(s) must be loaded before proceeding.`,
    ``,
    `The sensor gate's skill chain requires these skills to be loaded via the \`skill\` tool:`,
    ...unloaded.map((s) => `  - \`skill\` name="${sanitizeForSystemPrompt(s)}"`),
    ``,
    `Call the \`skill\` tool for EACH skill above NOW.`,
    `Do NOT attempt any other work until ALL are loaded.`,
    `After every skill is loaded, acknowledge with: [SKILLS LOADED]`,
    `</hard-block>`,
  ].join("\n")
}

function injectSkillLoadingGap(
  system: string[],
  gateResult: any,
  msgs: any[],
  preExecutedSkills?: string[],
): void {
  const { loaded, acknowledged } = scanForSkillToolCalls(msgs)
  // Skills that were pre-executed by the chain executor (script results injected
  // as <script-result> blocks) should NOT trigger loading warnings — the agent
  // already has their output in context.
  if (preExecutedSkills) {
    for (const name of preExecutedSkills) {
      loaded.add(name)
    }
  }
  const unloadedChainSkills = gateResult.chain.filter((name: string) => !loaded.has(name))
  // If the agent has already acknowledged [SKILLS LOADED] but some skills
  // are still missing from tool calls, trust the acknowledgment — the agent
  // may have loaded them in a prior turn's tool call batch.
  if (unloadedChainSkills.length > 0 && !acknowledged) {
    system.push(
      `\n<skill-loading-gap mode="blocking">CRITICAL: The following required chain skills were NOT loaded via the \`skill\` tool: ${sanitizeForSystemPrompt(unloadedChainSkills.join(", "))}. ` +
      `You CANNOT proceed with the user's request until EVERY chain skill is loaded. ` +
      `Call the \`skill\` tool with name="${sanitizeForSystemPrompt(unloadedChainSkills[0])}" NOW to load the first missing skill. ` +
      `Only respond with a plan to load skills — do NOT attempt to answer the user's question until [SKILLS LOADED] is acknowledged.` +
      `\nSubagents spawned from this session must also load chain skills.</skill-loading-gap>`,
    )
  }
}

function injectSkillChainObligation(
  system: string[],
  gateResult: any,
  scriptResults: ChainResult[],
  contentResults: ChainResult[],
): void {
  const scriptSkillNames = scriptResults.map(r => r.name)
  const contentSkillNames = contentResults.map(r => r.name)
  const chainItems = gateResult.chain.map((name: string) => {
    if (contentSkillNames.includes(name)) {
      return `  [MUST-LOAD] Call \`skill\` with name="${sanitizeForSystemPrompt(name)}" — content NOT injected, REQUIRED to load via tool`
    }
    if (scriptSkillNames.includes(name)) {
      return `  [EXECUTED] Call \`skill\` with name="${sanitizeForSystemPrompt(name)}" — script pre-executed, load SKILL.md for workflow instructions`
    }
    return `  [MUST-LOAD] Call \`skill\` with name="${sanitizeForSystemPrompt(name)}" — REQUIRED to load via tool`
  })
  system.push([
    "",
    "<skill-chain-obligation mode=\"strict\">",
    "The sensor gate has classified this prompt and produced a mandatory skill chain.",
    "Every skill in this chain MUST be loaded via the `skill` tool:",
    "",
    ...chainItems,
    "",
    "Rules:",
    "  1. [MUST-LOAD] skills were NOT pre-injected — you MUST call the `skill` tool to load their content",
    "  2. [EXECUTED] skills had their automation script pre-run; load SKILL.md via `skill` tool for workflow instructions",
    "  3. Follow each skill's workflow instructions after loading",
    "  4. Any subagent you spawn MUST also load the same chain skills",
    "  5. After ALL chain skills are loaded, acknowledge with: [SKILLS LOADED]",
    "  6. FAILURE to load all chain skills will produce INCOMPLETE results",
    "</skill-chain-obligation>",
  ].join("\n"))
}

export {
  DEFAULT_KNOWLEDGE_BLOCK,
  sanitizeForSystemPrompt,
  normalizeTokens,
  isOrphanedInterruptedTool,
  injectChainGapDetection,
  injectSkillLoadingGap,
  injectSkillChainObligation,
  getUnloadedChainSkills,
  buildUnloadedChainBlockMessage,
  scanForSkillToolCalls,
}
