import { Effect, Ref } from "effect"
import { evaluateSpawnNecessity, WORKFLOW_SKILLS, type Persona } from "@/skill/sensor-gate"
import { type ChainResult } from "@/skill/chain-executor"
import * as PersonaTracker from "./persona-tracker"
import { extractSubagentContext, buildSubagentContextPrompt } from "./subagent-context"
import { sanitizeForSystemPrompt, normalizeTokens, injectChainGapDetection, injectSkillLoadingGap, injectSkillChainObligation, buildUnloadedChainBlockMessage } from "./prompt-utils"
import { storedGateResultMap, storedScriptResultsMap, storedContentResultsMap, checkRateLimit, recordSpawn, RATE_MAX_SPAWNS } from "./prompt-state"
import { recordTaste } from "./prompt-taste"
import { debugLog } from "@/skill/python-resolver"
import { MessageID, PartID } from "./schema"
import { TaskTool } from "@/tool/task"
import { ulid } from "ulid"
import type { SessionID } from "./schema"

// Tracks workflow skills (e.g., deep-research) that recently completed execution per session.
// When the sensor gate chain includes a workflow skill, persona spawning is normally
// blocked. But on subsequent turns, if the same workflow skill is still in the chain,
// this map allows persona spawning to proceed because the workflow already ran.
// Cleared once personas successfully spawn. Keyed by sessionID to prevent cross-session leaks.
const recentlyCompletedWorkflows = new Map<SessionID, Set<string>>()

export interface SensorGatePhaseInput {
  gateResult: any; explicitSpawnCount: number; sessionID: SessionID;
  msgs: any[]; system: string[]; model: any; ctx: any;
  instruction: any; ops: any; piecesLTM: any; selfEvolve: any; registry: any; agents: any;
  sessions: any; sensorGate: any; lastUser: any; lastUserMsg: any; userText: string; tools: any;
  personaRoundMap: Map<SessionID, number>; spawnHistory: any; compaction: any;
  chainExecutor: any; sys: any;
}

export var processSensorGatePhase = Effect.fn("SessionPrompt.processSensorGatePhase")(function* (input: SensorGatePhaseInput) {
  const {
    gateResult, explicitSpawnCount, sessionID, msgs, system, model, ctx,
    instruction, ops, piecesLTM, selfEvolve, registry, agents,
    sessions, sensorGate, lastUser, lastUserMsg, userText, tools,
    personaRoundMap, spawnHistory, compaction, chainExecutor, sys,
  } = input

  yield* Effect.logWarning(`[SENSOR-GATE-DIAG] processSensorGatePhase entered gateResult.chain=${gateResult?.chain?.length ?? 0} personas=${gateResult?.personas?.length ?? 0} mode=${gateResult?.mode ?? "N/A"} explicitUserCount=${explicitSpawnCount}`)

  const currentRound = (personaRoundMap.get(sessionID) ?? 0)
  const MAX_PERSONA_ROUNDS = 3

  // ─── Round Limit Check ──────────────────────────────────────
  // Prevent infinite persona spawning rounds. Each user message can
  // trigger at most MAX_PERSONA_ROUNDS rounds of specialist analysis.
  if (currentRound >= MAX_PERSONA_ROUNDS) {
    yield* Effect.logWarning(`[SENSOR-GATE-DIAG] Max persona rounds reached (${currentRound}/${MAX_PERSONA_ROUNDS}) — skipping persona spawning`)
    return { synthesisText: undefined, sensorGateFired: true }
  }

  // ─── Skill Chain Execution ──────────────────────────────
  if (gateResult?.chain?.length > 0) {
    const chainResults: ChainResult[] = yield* chainExecutor.execute(gateResult.chain, userText).pipe(
      Effect.catch((e) => {
        console.warn("[chain-executor] execute() failed:", e)
        return Effect.succeed([] as ChainResult[])
      }),
    )
    const scriptResults = chainResults.filter(r => r.executionType === "script")
    const contentResults = chainResults.filter(r => r.executionType === "content")
    for (const result of scriptResults) {
      if (result.status === "ok" && result.output) {
        system.push(`\n<script-result name="${sanitizeForSystemPrompt(result.name)}">\n${sanitizeForSystemPrompt(result.output.slice(0, 5000))}\n</script-result>`)
      } else {
        system.push(`\n<script-result name="${sanitizeForSystemPrompt(result.name)}" status="error">\n${sanitizeForSystemPrompt(result.output.slice(0, 2000))}\n</script-result>`)
      }
    }
    if (contentResults.length > 0) {
      const pending = contentResults.map(r => r.name)
      system.push(
        `\n<pending-skill-load requirement="mandatory">` +
        `These skills have NOT been pre-loaded — you MUST load them via the \`skill\` tool: ` +
        `${sanitizeForSystemPrompt(pending.join(", "))}</pending-skill-load>`,
      )
    }
    for (const result of chainResults) {
      if (result.status === "not_found") {
        system.push(`\n<skill-missing name="${sanitizeForSystemPrompt(result.name)}"/>`)
      }
    }

    const allExecOk = chainResults.length > 0 && chainResults.every(r => r.status === "ok")
    if (!allExecOk && (gateResult.complexity === "high" || gateResult.chain.length > 1)) {
      const pipelineResults = yield* chainExecutor.runFullPipeline().pipe(
        Effect.catch((e) => {
          console.warn("[chain-executor] runFullPipeline() failed:", e)
          return Effect.succeed([])
        }),
      )
      for (const result of pipelineResults) {
        if (result.status === "ok" && result.output) {
          system.push(`\n<chain-executor-result name="${sanitizeForSystemPrompt(result.name)}">\n${sanitizeForSystemPrompt(result.output.slice(0, 5000))}\n</chain-executor-result>`)
        } else if (result.status === "error") {
          system.push(`\n<chain-executor-result name="${sanitizeForSystemPrompt(result.name)}" status="warning">\n${sanitizeForSystemPrompt(result.output.slice(0, 2000))}\n</chain-executor-result>`)
        }
      }
      const verifyResult = yield* chainExecutor.verify(chainResults).pipe(
        Effect.catch((e) => {
          console.warn("[chain-executor] verify() failed:", e)
          return Effect.succeed("")
        }),
      )
      if (verifyResult) {
        system.push(`\n<chain-verification>\n${sanitizeForSystemPrompt(verifyResult.slice(0, 2000))}\n</chain-verification>`)
      }
    }

    storedGateResultMap.set(sessionID, gateResult)
    storedScriptResultsMap.set(sessionID, scriptResults)
    storedContentResultsMap.set(sessionID, contentResults)

    yield* injectChainGapDetection(system, gateResult, chainResults, userText, chainExecutor)
    // Pass successfully executed script skills so they're excluded from loading gap
    const preExecutedSkills = scriptResults.filter(r => r.status === "ok").map(r => r.name)
    injectSkillLoadingGap(system, gateResult, msgs, preExecutedSkills)
    injectSkillChainObligation(system, gateResult, scriptResults, contentResults)

    yield* selfEvolve.capture({
      chain: gateResult.chain,
      intent: gateResult.intent ?? "sensor-gate",
      outcome: chainResults.every(r => r.status === "ok") ? "success" : "partial",
      signals: chainResults.filter(r => r.status === "error").map(r => ({
        whatWorked: "",
        whatFailed: `Skill ${r.name} failed: ${r.output.slice(0, 200)}`,
        whatToChange: `Chain skill ${r.name} needs fixing`,
      })),
    }).pipe(Effect.catch((e) => Effect.logWarning(`[sensor-gate] selfEvolve.capture failed: ${e}`)))
    yield* sys.invalidateKnowledgeCache().pipe(Effect.catch(() => Effect.void))

    // Mark workflow skills as recently completed so persona spawning is
    // unblocked on subsequent turns even if the workflow skill is still
    // in the sensor gate chain. Session-scoped to prevent cross-session leaks.
    if (gateResult?.chain?.length > 0) {
      const sessionCompleted = recentlyCompletedWorkflows.get(sessionID) ?? new Set<string>()
      for (const skill of gateResult.chain) {
        if (WORKFLOW_SKILLS.has(skill)) {
          sessionCompleted.add(skill)
        }
      }
      recentlyCompletedWorkflows.set(sessionID, sessionCompleted)
    }
  }

  // ─── Determine personas ─────────────────────────────────
  let evaluation = evaluateSpawnNecessity(gateResult, userText)
  yield* Effect.logWarning(`[SENSOR-GATE-DIAG] evaluateSpawnNecessity shouldSpawn=${evaluation.shouldSpawn} suggestedCount=${evaluation.suggestedCount} reason=${evaluation.reason}`)

  const sessionCompleted = recentlyCompletedWorkflows.get(sessionID) ?? new Set<string>()
  const hasWorkflowSkill = gateResult?.chain?.some((s: string) => {
    // If this workflow skill recently completed for this session, don't block
    // persona spawning. This breaks the infinite loop where deep-research blocks
    // spawning forever because the Python model keeps including it in the chain
    // on every turn.
    if (sessionCompleted.has(s)) return false
    return WORKFLOW_SKILLS.has(s)
  })
  if (hasWorkflowSkill) {
    const blockingSkill = gateResult?.chain?.find((s: string) => WORKFLOW_SKILLS.has(s) && !sessionCompleted.has(s))
    yield* Effect.logWarning(`[SENSOR-GATE-DIAG] Workflow skill override: blockingSkill=${blockingSkill} sessionCompleted=[${[...sessionCompleted].join(",")}] preOverride_shouldSpawn=${evaluation.shouldSpawn}`)
    evaluation = {
      shouldSpawn: false,
      reason: `Chain includes workflow-managed skill "${blockingSkill}" — workflow handles its own agents`,
      suggestedCount: 0,
    }
    debugLog(`[sensor-gate] Workflow skill detected: ${blockingSkill} — overriding spawn decision`)
  }

  // Clean up recently completed workflow tracking. When personas successfully
  // spawn despite a workflow skill being in the chain (because it was recently
  // completed), clear the tracking so stale entries don't accumulate.
  // If spawning remains blocked by a NEW workflow skill, keep tracking so the
  // next turn gets a chance once that new skill also completes.
  if (sessionCompleted.size > 0) {
    if (!hasWorkflowSkill && evaluation.shouldSpawn) {
      // We bypassed the workflow block — personas can spawn. Clear tracking
      // to avoid stale entries accumulating over time.
      recentlyCompletedWorkflows.delete(sessionID)
      debugLog(`[sensor-gate] Cleared recentlyCompletedWorkflows for session ${sessionID} — personas spawned despite workflow in chain`)
    }
    // Otherwise: either a new workflow skill is still blocking (keep tracking),
    // or spawning was suppressed for other reasons (keep tracking so the next
    // turn can still bypass the workflow if it was recently completed).
  }

  if (!evaluation.shouldSpawn) {
    // Diagnostic: log when spawn is denied despite personas being populated.
    // This reveals the broken feedback loop where fallback generates personas
    // but evaluateSpawnNecessity() denies them due to stale default metadata.
    if (gateResult?.personas?.length > 0) {
      yield* Effect.logWarning(
        `[SENSOR-GATE-DIAG] Spawn BLOCKED despite ${gateResult.personas.length} populated personas. ` +
        `domain_tags=${gateResult.domain_tags?.length} chain=${gateResult.chain?.length} ` +
        `confidence=${gateResult.confidence} mode=${gateResult.mode} reason=${evaluation.reason}`,
      )
    }
    debugLog(`[sensor-gate] Spawn skipped: ${evaluation.reason}`)
    recordTaste({
      timestamp: Date.now(), sessionID, domain: gateResult?.mode ?? "unknown",
      spawnDecision: "skipped", suggestedCount: 0, actualCount: 0, personaNames: [],
      gateMode: gateResult?.mode ?? "unknown", chainCount: gateResult?.chain?.length ?? 0,
      skipReason: evaluation.reason,
    })
  }
  let personas: Persona[] = []
  const rateCheck = checkRateLimit(sessionID)
  if (evaluation.shouldSpawn && gateResult?.personas?.length > 0 && rateCheck.allowed) {
    personas = gateResult.personas.slice(0, Math.min(evaluation.suggestedCount, rateCheck.remaining))
    recordSpawn(sessionID, personas.length)
    recordTaste({
      timestamp: Date.now(), sessionID, domain: gateResult?.mode ?? "unknown",
      spawnDecision: "spawned", suggestedCount: evaluation.suggestedCount, actualCount: personas.length,
      personaNames: personas.map(p => p.name), gateMode: gateResult?.mode ?? "unknown",
      chainCount: gateResult?.chain?.length ?? 0,
    })
  } else if (explicitSpawnCount > 0 && rateCheck.allowed) {
    const spawnCount = Math.min(explicitSpawnCount, rateCheck.remaining)
    recordSpawn(sessionID, spawnCount)
    recordTaste({
      timestamp: Date.now(), sessionID, domain: gateResult?.mode ?? "unknown",
      spawnDecision: "explicit-spawn", suggestedCount: explicitSpawnCount, actualCount: spawnCount,
      personaNames: [], gateMode: gateResult?.mode ?? "unknown",
      chainCount: gateResult?.chain?.length ?? 0,
    })
    personas = Array.from({ length: spawnCount }, (_, i): Persona => ({
      name: `Specialist ${i + 1}`,
      role: "Analysis Specialist",
      focus: "Analyzing the user's request from a specialist perspective",
      skills: [],
      task: `Analyze the user's request from your specialist perspective: ${sanitizeForSystemPrompt(userText.slice(0, 200))}`,
      goals: [
        "Identify issues and opportunities in the codebase",
        "Provide specific, actionable findings with file references",
        "Flag any blocking issues or high-priority concerns",
      ],
      synthesisGuide: `Include Specialist ${i + 1}'s findings in the synthesis.`,
    }))
  }

  if (personas.length > 0) {
    personaRoundMap.set(sessionID, currentRound + 1)
  }

  let synthesisText: string | undefined
  if (personas.length > 0) {
    const effectiveRound = (personaRoundMap.get(sessionID) ?? 0)
    const personaLines: string[] = [
      "<persona-system>",
      `You are the ARCHITECT. You have spawned ${personas.length} specialist agent${personas.length > 1 ? "s" : ""}:`,
      "",
    ]
    personas.forEach((p: any, i: number) => {
      personaLines.push(`${i + 1}. "${p.name}" (${p.role})`)
      const taskDisplay = p.task?.length > 120 ? p.task.slice(0, 117) + "..." : (p.task ?? "No task assigned")
      personaLines.push(`   Task: ${taskDisplay}`)
      personaLines.push("")
    })
    personaLines.push(`This is ROUND ${effectiveRound} of specialist analysis.`)
    personaLines.push("Each specialist provides findings asynchronously.")
    personaLines.push("Their results will arrive as user messages. Wait for them before acting.")
    personaLines.push("</persona-system>")
    const rateNow = checkRateLimit(sessionID)
    personaLines.push(`<rate-budget>${rateNow.remaining} of ${RATE_MAX_SPAWNS} specialist spawns remaining in this 5-minute window.</rate-budget>`)
    system.push(personaLines.join("\n"))

    yield* piecesLTM.persist({
      chainName: `sensor-gate-${gateResult?.intent ?? "explicit-override"}`,
      taskDescription: `${personas.length} persona(s) triggered in round ${currentRound + 1}: ${personas.map((p: any) => p.name).join(", ")}`,
      outcome: "success",
      keyDecisions: [`Gate classification: ${gateResult?.intent ?? "explicit-override"}`, `Round: ${currentRound + 1}`],
      memoryType: "standup",
    }).pipe(Effect.catch((e) => Effect.logWarning(`[sensor-gate] piecesLTM.persist failed: ${e}`)))

    yield* Effect.gen(function* () {
      const named = personas.filter((p: any) => p.name && p.skills?.length > 0) as Array<{ name: string; skills: string[]; role: string; focus: string; task?: string; goals?: string[] }>
      if (named.length > 0) {
        yield* selfEvolve.capture({
          chain: named.map((p) => p.skills.join(",")),
          intent: `persona-spawn-round-${currentRound + 1}`,
          outcome: "success",
          signals: named.map((p) => ({
            whatWorked: `Spawning specialist ${p.name} for ${p.role}`,
            whatFailed: "",
            whatToChange: `Specialist ${p.name} (${p.focus}) was spawned in round ${currentRound + 1}`,
          })),
        })
      }
    }).pipe(Effect.catch((e) => Effect.logWarning(`[sensor-gate] selfEvolve.capture failed: ${e}`)))

    const personaTeam = personas.slice(0, Math.min(personas.length, RATE_MAX_SPAWNS))
    const subtaskOps = yield* ops({ disableTaskTool: true })
    const { task: taskTool } = yield* registry.named()
    const abortController = new AbortController()

    const personaAssistantMsg: any = {
      id: MessageID.ascending(),
      role: "assistant",
      parentID: lastUserMsg?.info?.id,
      sessionID,
      mode: "tool_call",
      // CRITICAL: finish MUST be set so the prompt runner's loop break
      // check can succeed. The loop at prompt.ts evaluates
      // `lastAssistant?.finish && ...` — without this field, the persona
      // message has the highest ID (monotonic ascending) and becomes
      // `lastAssistant`, but finish is undefined, so the condition is
      // ALWAYS false and the loop NEVER breaks → infinite turns.
      // See prompt.ts lines 388-406 for the loop-termination guard.
      finish: "tool-calls",
      agent: "general",
      variant: lastUser?.model?.variant,
      path: { cwd: ctx.directory, root: ctx.worktree },
      // cost/tokens MUST be present with zero values because the TUI
      // reads these immediately via message.updated events and crashes
      // with "Missing key at ["info"]["cost"]" when they are absent.
      // Accumulated values are written after all subagents complete
      // below. The initial "0" is temporary and gets overwritten.
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      providerID: model.providerID,
      modelID: model.id,
      time: { created: Date.now() },
    }
    yield* sessions.updateMessage(personaAssistantMsg)

    const personaParts: any[] = yield* Effect.all(
      personaTeam.map((p: any) =>
        Effect.sync(() => ({
          id: PartID.ascending(),
          messageID: personaAssistantMsg.id,
          sessionID,
          type: "tool",
          callID: ulid(),
          tool: TaskTool.id,
          state: {
            status: "running",
            input: { prompt: p.focus, description: `persona:${p.name}`, subagent_type: "general" },
            metadata: {},
            time: { start: Date.now() },
          },
        })),
      ),
    )
    for (const part of personaParts) {
      yield* sessions.updatePart(part)
    }

    const subagentCtx = extractSubagentContext(msgs)
    subagentCtx.requiredSkillChain = gateResult?.chain ?? []
    const contextBlock = buildSubagentContextPrompt(subagentCtx)

    const tracker = yield* PersonaTracker.create(sessionID, personaTeam.length)

    // Shared accumulators for concurrent-safe cost/token tracking.
    // Each subagent writes via Ref.update (atomic); final values are
    // written to the stored message after all personas complete.
    const costRef = yield* Ref.make(0)
    const tokensRef = yield* Ref.make({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })

    yield* Effect.forEach(
      personaTeam,
      Effect.fnUntraced(function* (persona: any, i: number) {
        const part = personaParts[i]!
        const otherCtx = personaTeam.length > 1
          ? "\nOther specialist agents are analyzing related aspects. Do NOT duplicate work.\n"
          : ""

        const chainObligation = (gateResult?.chain?.length > 0)
          ? [
              "",
              "## Required Skill Chain (Parent Sensor Gate)",
              "The parent session's sensor gate requires these chain skills. You MUST load",
              "each one via the `skill` tool before starting your analysis:",
              ...gateResult.chain.map((s: string) =>
                `- \`skill\` name="${sanitizeForSystemPrompt(s)}" — MUST load via tool`
              ),
              "",
              "Rules:",
              "  1. Call the `skill` tool for EACH skill listed above",
              "  2. Follow each skill's workflow instructions after loading",
              "  3. After ALL chain skills are loaded, acknowledge with: [SKILLS LOADED]",
              "  4. FAILURE to load all chain skills will produce INCOMPLETE results",
              "",
            ].join("\n")
          : ""

        const personaPrompt = [
          "## Output Requirements",
          "Provide your findings as a STRUCTURED ANALYSIS with:",
          "1. **Summary**: One paragraph overview",
          "2. **Key Issues**: Bullet list with file:line references",
          "3. **Recommendations**: Actionable fixes with code snippets",
          "4. **Confidence**: High/Medium/Low for each finding",
          "",
          "Be CONCISE. Focus on ACTIONABLE items only.",
          chainObligation,
          otherCtx,
          "## Synthesis Guide",
          persona.synthesisGuide,
          "",
          contextBlock,
          "## User Prompt",
          sanitizeForSystemPrompt(userText.trim()),
          "",
          `## Your Identity`,
          `You are "${persona.name}" — ${persona.role}.`,
          `Your focus area: ${persona.focus}.`,
          ...(personaTeam.length > 1
            ? ["", "## Other Specialists",
              ...personaTeam.filter((_: any, j: number) => j !== i).map((o: any) => `- "${o.name}" (${o.role}) — ${o.focus}`), ""]
            : []),
          "## Task",
          persona.task,
        ].join("\n")

        const updatePart = (status: "completed" | "error", output: string, resultMetadata?: Record<string, any>) =>
          Effect.gen(function* () {
            yield* tracker.complete(persona.name, persona.role, output, status, {
              task: persona.task, goals: persona.goals, synthesisGuide: persona.synthesisGuide,
            })
            const st = part.state as Record<string, any>
            yield* sessions.updatePart({
              ...part,
              state: status === "completed"
                ? { ...st, status: "completed", output, title: persona.name, metadata: { ...st.metadata, ...resultMetadata, persona: persona.name }, time: { start: st.time?.start ?? Date.now(), end: Date.now() } }
                : { ...st, status: "error", error: output, metadata: { ...st.metadata, ...resultMetadata, persona: persona.name }, time: { start: st.time?.start ?? Date.now(), end: Date.now() } },
            })
          }).pipe(Effect.catchCause((cause) => Effect.logWarning("updatePart failed", { cause })))

        return yield* taskTool
          .execute(
            { prompt: personaPrompt, description: `persona:${persona.name}`, subagent_type: "general" },
            {
              agent: "general",
              sessionID,
              messageID: personaAssistantMsg.id,
              messages: subagentCtx.recentMessages,
              abort: abortController.signal,
              callID: (part).callID,
              extra: { bypassAgentCheck: true, promptOps: subtaskOps },
              metadata: (meta: any) => Effect.gen(function* () {
                yield* sessions.updatePart({
                  ...part,
                  state: { ...(part.state as any), title: meta?.title ?? (part.state as any).title, metadata: { ...(part.state as any).metadata, ...meta?.metadata } },
                })
              }),
            },
          )
          .pipe(
            Effect.matchEffect({
              onSuccess: (result: any) => Effect.gen(function* () {
                yield* updatePart("completed", result?.output, result?.metadata)
                const subagentCost_ = Number(result?.subagentCost)
                const subagentTokens_ = result?.subagentTokens
                if (Number.isFinite(subagentCost_) && subagentCost_ > 0) {
                  yield* sessions.updatePart({
                    id: PartID.ascending(),
                    messageID: personaAssistantMsg.id,
                    sessionID,
                    type: "step-finish",
                    reason: "completed",
                    cost: subagentCost_,
                    tokens: normalizeTokens(subagentTokens_),
                  })
                  // Atomically accumulate cost/tokens via Ref for concurrent-safety.
                  // Using Ref.update guarantees no lost updates when multiple
                  // subagents complete simultaneously.
                  yield* Ref.update(costRef, (c) => c + subagentCost_)
                  const norm = normalizeTokens(subagentTokens_)
                  if (norm) {
                    yield* Ref.update(tokensRef, (t) => ({
                      input: t.input + (norm.input ?? 0),
                      output: t.output + (norm.output ?? 0),
                      reasoning: t.reasoning + (norm.reasoning ?? 0),
                      cache: {
                        read: t.cache.read + (norm.cache?.read ?? 0),
                        write: t.cache.write + (norm.cache?.write ?? 0),
                      },
                    }))
                  }
                }
              }),
              onFailure: (error) => {
                abortController.abort()
                return updatePart("error", String(error), undefined)
              },
            }),
          )
      }),
      { concurrency: RATE_MAX_SPAWNS },
    )

    const pollResults = (): Effect.Effect<PersonaTracker.PersonaResult[]> =>
      Effect.gen(function* () {
        const remaining = yield* tracker.remaining()
        if (remaining <= 0) return yield* tracker.getAll()
        yield* Effect.sleep("500 millis")
        return yield* pollResults()
      })

    const allResults = yield* pollResults().pipe(
      Effect.timeout("30 seconds"),
      Effect.catch(() => tracker.getAll()),
    )

    // Write accumulated cost and tokens to the persona assistant message now
    // that all subagents have completed. This avoids the race condition of
    // concurrent subagents overwriting each other's tokens with zero.
    const totalCost = yield* Ref.get(costRef)
    const totalTokens = yield* Ref.get(tokensRef)
    yield* sessions.updateMessage({
      ...personaAssistantMsg,
      cost: totalCost,
      tokens: totalTokens,
    })

    synthesisText = PersonaTracker.buildSynthesisPrompt(allResults)

    // FIX: Use Effect-based synthesis injection instead of async+Effect.runPromise.
    // The old approach via PersonaTracker.injectSynthesis() used Effect.runPromise
    // internally which could fail silently when lacking service context.
    // By running the injection directly in the generator context, all services
    // (Database, EventV2, etc.) are properly provided.
    const synthesisMessage: any = {
      id: MessageID.ascending(),
      sessionID,
      role: "user",
      agent: "general",
      model: {
        providerID: model.providerID,
        modelID: model.id,
        variant: undefined,
      },
      time: { created: Date.now() },
    }
    yield* sessions.updateMessage(synthesisMessage)

    const synthesisPart: any = {
      id: PartID.ascending(),
      messageID: synthesisMessage.id,
      sessionID,
      type: "text",
      text: synthesisText,
      synthetic: true,
    }
    yield* sessions.updatePart(synthesisPart)

    // ─── Persona Window Capping ─────────────────────────────
    // Only keep the last 50 persona assistant messages to prevent
    // UI lag/clogging. Persona messages are identified by their
    // "tool_call" mode and "general" agent.
    const MAX_PERSONA_WINDOWS = 50
    const capMsgs = yield* sessions.messages({ sessionID }).pipe(Effect.catch(() => Effect.succeed([])))
    if (capMsgs.length > 0) {
      const personaMsgs = (capMsgs as any[]).filter(
        (m) => m.info?.mode === "tool_call" && m.info?.agent === "general",
      )
      if (personaMsgs.length > MAX_PERSONA_WINDOWS) {
        const toDelete = personaMsgs.slice(0, personaMsgs.length - MAX_PERSONA_WINDOWS)
        for (const oldMsg of toDelete) {
          yield* sessions.removeMessage({ sessionID, messageID: oldMsg.info.id }).pipe(Effect.catch(() => Effect.void))
        }
        yield* Effect.logWarning(`[SENSOR-GATE-DIAG] Capped persona windows: deleted ${toDelete.length} old persona messages, keeping last ${MAX_PERSONA_WINDOWS}`)
      }
    }
  }

  return {
    synthesisText,
    sensorGateFired: true,
  }
})
