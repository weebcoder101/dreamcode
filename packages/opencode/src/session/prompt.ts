import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import os from "os"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { SessionRevert } from "./revert"
import { Session } from "./session"
import { Agent } from "../agent/agent"
import { Provider } from "@/provider/provider"
import { type Tool as AITool, tool, jsonSchema } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { SessionCompaction } from "./compaction"
import { SystemPrompt } from "./system"
import { Instruction } from "./instruction"
import { Plugin } from "../plugin"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { ToolRegistry } from "@/tool/registry"
import { MCP } from "../mcp"
import { LSP } from "@/lsp/lsp"
import { ulid } from "ulid"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as Stream from "effect/Stream"
import { Command } from "../command"
import { pathToFileURL, fileURLToPath } from "url"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionProcessor } from "./processor"
import { Tool } from "@/tool/tool"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { SensorGate, evaluateSpawnNecessity, type Persona, type SensorGateResult } from "@/skill/sensor-gate"
import { SOCIAL_GREETING_RE } from "@/skill/question-complexity-schema"
import { ChainExecutor, type ChainResult } from "@/skill/chain-executor"
import { SelfEvolve, type LearningSignal } from "@/skill/self-evolve"
import { debugLog } from "@/skill/python-resolver"
import * as PersonaTracker from "./persona-tracker"
import { ContextCompressor } from "./context-compressor"
import { PiecesLTM } from "@/pieces-ltm"
import { extractSubagentContext, buildSubagentContextPrompt } from "./subagent-context"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { Shell } from "@/shell/shell"
import { ShellID } from "@/tool/shell/id"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Truncate } from "@/tool/truncate"
import { Image } from "@/image/image"
import { decodeDataUrl } from "@/util/data-url"
import { Process } from "@/util/process"
import { Cause, Effect, Exit, Latch, Layer, Option, Scope, Context, Schema, Types } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { SessionRunState } from "./run-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { dieSyncError } from "@/effect/sync-error"
import { Database } from "@opencode-ai/core/database/database"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AgentAttachment, FileAttachment, Prompt, Source } from "@opencode-ai/core/session/prompt"
import * as DateTime from "effect/DateTime"
import { eq } from "drizzle-orm"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionReminders } from "./reminders"
import { SessionTools } from "./tools"
import { LLMEvent } from "@opencode-ai/llm"
// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false
import {
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
} from "./prompt-utils"
import { ensureTitle } from "./prompt-title"
import { handleSubtask as handleSubtaskFn } from "./prompt-subtask"
import { shellImpl as shellImplFn } from "./prompt-shell"
import { processSensorGatePhase as processSensorGatePhaseFn } from "./prompt-sensor-gate-phase"
import { command as commandFn } from "./prompt-command"
import { createUserMessage as createUserMessageFn } from "./prompt-user-message"
import {
  ModelRef,
  PromptInput,
  LoopInput,
  ShellInput,
  CommandInput,
  createStructuredOutputTool,
  bashRegex,
  argsRegex,
  placeholderRegex,
  quoteTrimRegex,
  STRUCTURED_OUTPUT_SYSTEM_PROMPT,
} from "./prompt-schemas"
import {
  storedGateResultMap,
  storedScriptResultsMap,
  storedContentResultsMap,
  personaRoundMap,
  spawnHistory,
  checkRateLimit,
  recordSpawn,
  parseExplicitSpawnCount,
  RATE_MAX_SPAWNS,
  isSensorGateGloballyDisabled,
} from "./prompt-state"
import { summarizeTaste, refreshProfile } from "./prompt-taste"
const decodeMessageInfo = Schema.decodeUnknownExit(SessionV1.Info)
const decodeMessagePart = Schema.decodeUnknownExit(SessionV1.Part)

export interface Interface {
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error>
  readonly loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts>
  readonly shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError>
  readonly command: (input: CommandInput) => Effect.Effect<SessionV1.WithParts, Image.Error>
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
}
export class Service extends Context.Service<Service, Interface>()("@dreamcode/SessionPrompt") {}
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const processor = yield* SessionProcessor.Service
    const compaction = yield* SessionCompaction.Service
    const plugin = yield* Plugin.Service
    const commands = yield* Command.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const fsys = yield* FSUtil.Service
    const mcp = yield* MCP.Service
    const lsp = yield* LSP.Service
    const registry = yield* ToolRegistry.Service
    const truncate = yield* Truncate.Service
    const image = yield* Image.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Scope.Scope
    const instruction = yield* Instruction.Service
    const state = yield* SessionRunState.Service
    const revert = yield* SessionRevert.Service
    const summary = yield* SessionSummary.Service
    const sensorGate = yield* SensorGate.Service
    const sys = yield* SystemPrompt.Service
    const llm = yield* LLM.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service
    const { db } = database
    const skillService = yield* Skill.Service
    const chainExecutor = yield* ChainExecutor.Service
    const selfEvolve = yield* SelfEvolve.Service
    const piecesLTM = yield* PiecesLTM.PiecesLTM
    const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
      yield* Effect.logInfo("cancel", { "session.id": sessionID })
      personaRoundMap.delete(sessionID)
      spawnHistory.delete(sessionID)
      yield* state.cancel(sessionID)
    })
    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
      const ctx = yield* InstanceState.context
      const parts: Types.DeepMutable<PromptInput["parts"]> = [{ type: "text", text: template }]
      const files = ConfigMarkdown.files(template)
      const seen = new Set<string>()
      yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (!name) return
          if (seen.has(name)) return
          seen.add(name)
          const filepath = name.startsWith("~/")
            ? path.join(os.homedir(), name.slice(2))
            : path.resolve(ctx.worktree, name)
          const info = yield* fsys.stat(filepath).pipe(Effect.option)
          if (Option.isNone(info)) {
            const found = yield* agents.get(name)
            if (found) parts.push({ type: "agent", name: found.name })
            return
          }
          const stat = info.value
          parts.push({
            type: "file",
            url: pathToFileURL(filepath).href,
            filename: name,
            mime: stat.type === "Directory" ? "application/x-directory" : "text/plain",
          })
        }),
        { concurrency: "unbounded", discard: true },
      )
      return parts
    })
    const ops = Effect.fn("SessionPrompt.ops")(function* (opts?: { disableTaskTool?: boolean }) {
      return {
        cancel: (sessionID: SessionID) => cancel(sessionID),
        resolvePromptParts: (template: string) => resolvePromptParts(template),
        prompt: (input: PromptInput) => prompt(input).pipe(Effect.catch(Effect.die)),
        disableTaskTool: opts?.disableTaskTool ?? false,
      } satisfies TaskPromptOps
    })
    const title = Effect.fn("SessionPrompt.ensureTitle")(function* (input: {
      session: Session.Info
      history: SessionV1.WithParts[]
      providerID: ProviderV2.ID
      modelID: ModelV2.ID
    }) {
      return yield* ensureTitle({ ...input, agents, provider, llm, sessions })
    })
    const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: {
      task: SessionV1.SubtaskPart
      model: Provider.Model
      lastUser: SessionV1.User
      sessionID: SessionID
      session: Session.Info
      msgs: SessionV1.WithParts[]
    }) {
      return yield* handleSubtaskFn({
        ...input,
        sessions,
        agents,
        plugin,
        permission,
        registry,
        events,
        ops,
        getModel,
      })
    })
    const shellImpl = Effect.fn("SessionPrompt.shellImpl")(function* (input: ShellInput, ready?: Latch.Latch) {
      return yield* shellImplFn({
        ...input,
        sessions,
        agents,
        config,
        plugin,
        spawner,
        flags,
        revert,
        events,
        currentModel,
      }, ready)
    })
    const getModel = Effect.fn("SessionPrompt.getModel")(function* (
      providerID: ProviderV2.ID,
      modelID: ModelV2.ID,
      sessionID: SessionID,
    ) {
      const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return exit.value
      const err = Cause.squash(exit.cause)
      if (Provider.ModelNotFoundError.isInstance(err)) {
        const hint = err.suggestions?.length ? ` Did you mean: ${err.suggestions.join(", ")}?` : ""
        yield* dieSyncError(events.publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message: `Model not found: ${err.providerID}/${err.modelID}.${hint}`,
          }).toObject(),
        }))
      }
      return yield* Effect.die(err)
    })
    const currentModel = Effect.fnUntraced(function* (sessionID: SessionID) {
      const current = yield* db
        .select({ model: SessionTable.model })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (current?.model) {
        return {
          providerID: ProviderV2.ID.make(current.model.providerID),
          modelID: ModelV2.ID.make(current.model.id),
          ...(current.model.variant && current.model.variant !== "default" ? { variant: current.model.variant } : {}),
        }
      }
      const match = yield* sessions
        .findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model)
        .pipe(Effect.orDie)
      if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
      return yield* provider.defaultModel().pipe(Effect.orDie)
    })
    const createUserMessage = (input: PromptInput): Effect.Effect<SessionV1.WithParts, Image.Error> =>
      createUserMessageFn({
        ...input,
        sessions,
        agents,
        provider,
        plugin,
        events,
        instruction,
        mcp,
        fsys,
        registry,
        lsp,
        image,
        flags,
        db,
        currentModel,
      }) as unknown as Effect.Effect<SessionV1.WithParts, Image.Error>
                const processSensorGatePhase = Effect.fn("SessionPrompt.processSensorGatePhase")(function* (input: {
                  gateResult: any; explicitSpawnCount: number; sessionID: SessionID;
                  msgs: any[]; system: string[]; model: any; ctx: any;
                  handle: any; instruction: any; ops: any; piecesLTM: any; selfEvolve: any; registry: any; agents: any;
                  sessions: any; sensorGate: any; lastUser: any; lastUserMsg: any; userText: string; tools: any;
                  personaRoundMap: Map<SessionID, number>; spawnHistory: any; compaction: any;
                  chainExecutor: any;
                }) {
                  return yield* processSensorGatePhaseFn({ ...input, sys })
                })
    const prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error> = Effect.fn(
      "SessionPrompt.prompt",
    )(function* (input: PromptInput) {
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      yield* revert.cleanup(session)
      const message = yield* createUserMessage(input)
      yield* sessions.touch(input.sessionID)
      const permissions: PermissionV1.Rule[] = []
      for (const [t, enabled] of Object.entries(input.tools ?? {})) {
        permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
      }
      if (permissions.length > 0) {
        session.permission = permissions
        yield* sessions.setPermission({ sessionID: session.id, permission: permissions })
      }
      if (input.noReply === true) return message
      return yield* loop({ sessionID: input.sessionID })
    })
    const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionID) {
      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role !== "user").pipe(Effect.orDie)
      if (Option.isSome(match)) return match.value
      const msgs = yield* sessions.messages({ sessionID, limit: 1 }).pipe(Effect.orDie)
      if (msgs.length > 0) return msgs[0]
      throw new Error("Impossible")
    })
    const SELF_CHECK = `# Self-Check Protocol
Before every response, verify your reasoning:
1. Does the plan directly address the user's request?
2. What assumptions are you making that could be wrong?
3. Are you passing real values, not placeholders or literals?
4. What is the most likely failure mode for your approach?`
    const runLoop = Effect.fn("SessionPrompt.run")(
      function* (sessionID: SessionID) {
        const ctx = yield* InstanceState.context
        let structured: unknown
        let step = 0
        let synthesisText: string | undefined
        let prevUserMessageID: string | undefined
        let titleGenerated = false

        const session = yield* sessions.get(sessionID).pipe(Effect.orDie)
        while (true) {
          synthesisText = undefined
          yield* status.set(sessionID, { type: "busy" })
          yield* Effect.logInfo("loop", { "session.id": sessionID, step })
          let msgs = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
            Effect.provideService(Database.Service, database),
          )
          const { user: lastUser, assistant: lastAssistant, finished: lastFinished, tasks } = MessageV2.latest(msgs)
          if (!lastUser) throw new Error("No user message found in stream. This should never happen.")
          if (prevUserMessageID !== lastUser.id) {
            step = 0
            prevUserMessageID = lastUser.id
          }
          const lastAssistantMsg = msgs.findLast(
            (msg) => msg.info.role === "assistant" && msg.info.id === lastAssistant?.id,
          )
          // Some providers return "stop" even when the assistant message contains
          // tool calls. Keep the loop running so tool results can be sent back to
          // the model, but ignore cleanup-marked interrupted orphans.
          const hasToolCalls =
            lastAssistantMsg?.parts.some(
              (part) => part.type === "tool" && !part.metadata?.providerExecuted && !isOrphanedInterruptedTool(part),
            ) ?? false
          if (
            lastAssistant?.finish &&
            !["tool-calls"].includes(lastAssistant.finish) &&
            !hasToolCalls &&
            lastUser.id < lastAssistant.id
          ) {
            const orphan = lastAssistantMsg?.parts.find(
              (part): part is SessionV1.ToolPart => part.type === "tool" && isOrphanedInterruptedTool(part),
            )
            if (orphan) {
              yield* Effect.logWarning("loop exit with orphaned interrupted tool", {
                "session.id": sessionID,
                messageID: lastAssistant.id,
                tool: orphan.tool,
                callID: orphan.callID,
              })
            }
            yield* Effect.logInfo("exiting loop", { "session.id": sessionID })
            break
          }
          step++
          if (step === 1 && !titleGenerated) {
            titleGenerated = true
            yield* title({
              session,
              modelID: lastUser.model.modelID,
              providerID: lastUser.model.providerID,
              history: msgs,
            }).pipe(Effect.ignore, Effect.forkIn(scope))
            // Refresh codebase profile on first turn (background, non-blocking)
            yield* Effect.sync(() => refreshProfile(process.cwd())).pipe(Effect.ignore, Effect.forkIn(scope))
          }
          const model = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)
          const task = tasks.pop()
          if (task?.type === "subtask") {
            yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs })
            continue
          }
          if (task?.type === "compaction") {
            const result = yield* compaction.process({
              messages: msgs,
              parentID: lastUser.id,
              sessionID,
              auto: task.auto,
              overflow: task.overflow,
            })
            if (result === "stop") break
            continue
          }
          // /compact command — bypass sensor gate, trigger compaction directly
          if (!session.parentID) {
            const userText = msgs
              .filter((m) => m.info.role === "user" && m.info.id === lastUser.id)
              .flatMap((m) => m.parts)
              .filter((p): p is typeof p & { type: "text" } => p.type === "text" && !p.ignored)
              .map((p) => p.text)
              .join("\n")
            if (userText.trim().startsWith("/compact")) {
              yield* compaction.create({
                sessionID,
                agent: lastUser.agent,
                model: lastUser.model,
                auto: false,
              })
              continue
            }
          }
          const agent = yield* agents.get(lastUser.agent)
          if (!agent) {
            const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
            const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
            const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
            yield* dieSyncError(events.publish(Session.Event.Error, { sessionID, error: error.toObject() }))
            throw error
          }
          // Subagents should NOT trigger auto-compaction — they do focused work
          // and compaction during their execution is costly and disruptive.
          // Synthesis lock prevents auto-compact while parent agent is mid-response,
          // avoiding context-epoch truncation during an active provider turn.
          if (
            agent.mode !== "subagent" &&
            lastFinished &&
            lastFinished.summary !== true &&
            (yield* compaction.isOverflow({ tokens: lastFinished.tokens, model })) &&
            !(yield* compaction.isCompactionLocked)
          ) {
            yield* compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
            continue
          }
          const maxSteps = agent.steps ?? Infinity
          const isLastStep = step >= maxSteps
          msgs = yield* SessionReminders.apply({ messages: msgs, agent, session }).pipe(
            Effect.provideService(RuntimeFlags.Service, flags),
            Effect.provideService(FSUtil.Service, fsys),
            Effect.provideService(Session.Service, sessions),
          )
          const msg: SessionV1.Assistant = {
            id: MessageID.ascending(),
            parentID: lastUser.id,
            role: "assistant",
            mode: agent.name,
            agent: agent.name,
            variant: lastUser.model.variant,
            path: { cwd: ctx.directory, root: ctx.worktree },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: model.id,
            providerID: model.providerID,
            time: { created: Date.now() },
            sessionID,
          }
          yield* sessions.updateMessage(msg)
          function finalizeInterruptedAssistant() {
            return Effect.gen(function* () {
              if (msg.time.completed) return
              msg.error ??= MessageV2.fromError(new DOMException("Aborted", "AbortError"), {
                providerID: msg.providerID,
                aborted: true,
              })
              msg.time.completed = Date.now()
              // Preserve any cost/tokens the processor may have accumulated
              // (e.g. from step-finish parts) before publishing. The initial
              // msg has cost=0 and tokens={0}, and publishing those values
              // would overwrite the session-level accumulated tokens in the
              // TUI store — triggering the "tokens become zero" bug.
              // The processor handle may have set handle.message.cost/tokens
              // via step-finish parts even if the LLM was interrupted.
              msg.cost = handle.message.cost ?? msg.cost
              msg.tokens = handle.message.tokens ?? msg.tokens
              yield* sessions.updateMessage(msg)
            })
          }
          const handle = yield* processor
            .create({
              assistantMessage: msg,
              sessionID,
              model,
            })
            .pipe(Effect.onInterrupt(() => finalizeInterruptedAssistant()))
          const outcome: "break" | "continue" = yield* Effect.gen(function* () {
            const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
            const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false
            const promptOps = yield* ops()
            const tools = yield* SessionTools.resolve({
              agent,
              session,
              model,
              processor: handle,
              bypassAgentCheck,
              messages: msgs,
              promptOps,
            }).pipe(
              Effect.provideService(Plugin.Service, plugin),
              Effect.provideService(Permission.Service, permission),
              Effect.provideService(ToolRegistry.Service, registry),
              Effect.provideService(MCP.Service, mcp),
              Effect.provideService(Truncate.Service, truncate),
            )
            if (lastUser.format?.type === "json_schema") {
              tools["StructuredOutput"] = createStructuredOutputTool({
                schema: lastUser.format.schema,
                onSuccess(output) {
                  structured = output
                },
              })
            }
            if (step === 1)
              yield* summary.summarize({ sessionID, messageID: lastUser.id }).pipe(Effect.ignore, Effect.forkIn(scope))
            if (step > 1 && lastFinished) {
              for (const m of msgs) {
                if (m.info.role !== "user" || m.info.id <= lastFinished.id) continue
                for (const p of m.parts) {
                  if (p.type !== "text" || p.ignored || p.synthetic) continue
                  if (!p.text.trim()) continue
                  p.text = [
                    "<system-reminder>",
                    "The user sent the following message:",
                    p.text,
                    "",
                    "Please address this message and continue with your tasks.",
                    "</system-reminder>",
                  ].join("\n")
                }
              }
            }
            yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
            const [skills, env, knowledge, instructions, taste, modelMsgs] = yield* Effect.all([
              sys.skills(agent),
              sys.environment(model),
              // Always return a <learned-knowledge> block — even on LTM failure.
              // Non-deterministic block presence is the #1 cause of DeepSeek
              // KV cache misses (40x cost multiplier: $0.001 → $0.04).
              sys.knowledge().pipe(Effect.catch(() => Effect.succeed(DEFAULT_KNOWLEDGE_BLOCK))),
              instruction.system().pipe(Effect.orDie),
              Effect.sync(() => summarizeTaste()).pipe(Effect.catch(() => Effect.succeed(""))),
              MessageV2.toModelMessagesEffect(msgs, model),
            ])
            const system = [...env, ...instructions, ...(skills ? [skills] : []), ...(knowledge ? [knowledge] : []), ...(taste ? [taste] : []), SELF_CHECK]
            const format = lastUser.format ?? { type: "text" as const }
            if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
             // ─── Sensor Gate: Native Dream Mode ─────────────────────────
             // Runs classification + skill chain selection ONCE per user message
             // (step === 1). On subsequent steps (tool calls, retries), the gate
             // must NOT re-fire — duplicates skill chain execution, corrupts the
             // system prompt with duplicate <script-result> blocks, and confuses
             // the model with conflicting skill-loading instructions.
             // Only in root sessions — subagents must NOT re-enter persona spawning.
             // Skip after synthesis — synthesis should NOT auto-spawn subagents.
             if (step === 1 && !session.parentID) {
              const userText = msgs
                .filter((m) => m.info.role === "user" && m.info.id === lastUser.id)
                .flatMap((m) => m.parts)
                .filter((p): p is typeof p & { type: "text" } => p.type === "text" && !p.ignored)
                .map((p) => p.text)
                .join("\n")
              // Detect synthesis response — skip auto-spawn after synthesis.
              // Only check the LAST user message to avoid a permanent synthesis
              // lock: once ANY prior message triggered synthesis, a cross-message
              // scan would block ALL subsequent user messages from ever re-firing
              // the sensor gate. Each new user message deserves a fresh chance
              // to trigger persona spawning.
              const lastUserMsg = msgs.findLast(
                (m) => m.info.role === "user" && m.info.id === lastUser.id,
              )
              const isSynthesis = lastUserMsg?.parts.some(
                (p) => p.type === "text" && "synthetic" in p && p.synthetic && p.text.startsWith("<synthesis-request>"),
              ) ?? false
              // Skip sensor gate for slash commands — commands handle their own flow.
              const isSlashCommand = userText.trim().startsWith("/")
              // Skip sensor gate for compaction auto-continue — synthetic
              // continuation after a context compaction event. The message is
              // internal (e.g. "Continue if you have next steps...") and should
              // NOT trigger any skill chain or sensor gate classification.
              const isCompactionContinue = lastUserMsg?.parts.some(
                (p): p is typeof p & { metadata: { compaction_continue: boolean } } =>
                  p.type === "text" && (p as any).metadata?.compaction_continue === true,
              ) ?? false
              // Skip sensor gate if session has active subagents running.
              // At step=1 the session is always briefly busy (just set at loop start),
              // so we bypass that check — every new user message must get classified.
              let isSessionBusy = false
              if (step !== 1) {
                const sessionStatus = yield* status.get(sessionID).pipe(Effect.option)
                isSessionBusy = sessionStatus._tag === "Some" && sessionStatus.value.type === "busy"
              } else {
                yield* Effect.logWarning(`[SENSOR-GATE-DIAG] step=1 bypassed isSessionBusy check — fire gate for every new user message`)
              }
              // Sensor Gate Toggle: user can disable sensor gate classification
              // via the TUI toggle button. When disabled, the skill chain pipeline
              // still runs (using the stored gate result from a previous turn).
              const sensorGateToggledOff = isSensorGateGloballyDisabled()
              yield* Effect.logWarning(`[SENSOR-GATE-DIAG] step=${step} parentID=${session.parentID} isSynthesis=${isSynthesis} isSlashCommand=${isSlashCommand} isSessionBusy=${isSessionBusy} isCompactionContinue=${isCompactionContinue} sensorGateToggledOff=${sensorGateToggledOff}`)
              if (userText.trim() && !isSynthesis && !isSlashCommand && !isSessionBusy && !isCompactionContinue && !sensorGateToggledOff) {
                const gateResult = yield* sensorGate.classify(userText).pipe(
                  Effect.catchCause((cause) =>
                    Effect.as(Effect.logError("Sensor gate unavailable", { cause }), null),
                  ),
                )
                const explicitSpawnCount = parseExplicitSpawnCount(userText)
                if (gateResult && !gateResult.is_social_greeting) {
                  const sgpResult = yield* processSensorGatePhase({
                    gateResult, explicitSpawnCount, sessionID, msgs, system, model, ctx,
                    instruction, ops, piecesLTM, selfEvolve, registry, agents,
                    sessions, sensorGate, lastUser, lastUserMsg, userText, tools,
                    personaRoundMap, spawnHistory, compaction, chainExecutor, sys,
                  })
                  synthesisText = sgpResult.synthesisText
                }
              }
            }
            // ─── End Sensor Gate ────────────────────────────────────────
            // ─── Per-Turn Chain Enforcement ────────────────────────────
            // After the gate fires on the first turn, re-inject chain
            // enforcement on EVERY turn so the agent is constantly reminded
            // to load chain skills via the `skill` tool.
            {
              const storedGate = storedGateResultMap.get(sessionID)
              if (storedGate) {
                const storedScripts = storedScriptResultsMap.get(sessionID) ?? []
                const storedContent = storedContentResultsMap.get(sessionID) ?? []
                injectSkillLoadingGap(system, storedGate, msgs)
                injectSkillChainObligation(system, storedGate, storedScripts, storedContent)
              }
            }
            // ─── Pre-Turn Hard Block: unloaded chain skills ──────────
            // If the sensor gate produced a skill chain and the agent has
            // NOT yet loaded all skills via the `skill` tool, inject a
            // hard-block assistant message as context. The agent MUST
            // load skills before the LLM responds to the user query.
            let extraMsgs: Array<{ role: "user" | "assistant"; content: string }> = []
            if (synthesisText) {
              extraMsgs.push({ role: "user" as const, content: synthesisText })
            }
            let preTurnBlocked = false
            const skillEnforcerGate = storedGateResultMap.get(sessionID)
            if (skillEnforcerGate && skillEnforcerGate.chain.length > 0) {
              const { loaded, acknowledged } = scanForSkillToolCalls(msgs)
              const unloaded = skillEnforcerGate.chain.filter((name: string) => !loaded.has(name))
              if (unloaded.length > 0 && !acknowledged) {
                yield* Effect.logWarning(`[SKILL-ENFORCER] Pre-turn block: ${unloaded.length} unloaded chain skills: ${unloaded.join(", ")}`)
                // Use "user" role so the model interprets this as a direct
                // instruction rather than its own prior message (which is
                // easier to ignore or overwrite). Assistant-role context has
                // no normative force — the model can freely contradict it.
                extraMsgs.push({
                  role: "user" as const,
                  content: buildUnloadedChainBlockMessage(unloaded),
                })
                preTurnBlocked = true
              }
            }
            // Task tool is ALWAYS available. Cost control is handled by the
            // rolling-window rate limiter (5 spawns/5 min) + sensor gate's
            // evaluateSpawnNecessity().
            const finalTools = tools
            // Lock compaction during synthetic phase — prevents mid-response
            // auto-compact from truncating the context epoch. Unlocked after
            // process completes (ensuring block below).
            yield* compaction.lockCompaction;
            const result = yield* handle.process({
              user: lastUser,
              agent,
              permission: session.permission,
              sessionID,
              parentSessionID: session.parentID,
              system,
              messages: [...modelMsgs, ...extraMsgs, ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : [])],
              tools: finalTools,
              model,
              toolChoice: format.type === "json_schema" ? "required" : undefined,
            }).pipe(
              Effect.ensuring(compaction.unlockCompaction)
            )
            if (structured !== undefined) {
              handle.message.structured = structured
              handle.message.finish = handle.message.finish ?? "stop"
              yield* sessions.updateMessage(handle.message)
              return "break" as const
            }
            const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
            if (finished && !handle.message.error) {
              // Surface any content-filter finish (e.g. Anthropic stop_reason:
              // refusal) as an error. These turns may have produced no visible
              // output at all — previously the session went idle silently — or
              // partial text that was cut off by the provider's filter.
              if (handle.message.finish === "content-filter") {
                handle.message.error = new SessionV1.ContentFilterError({
                  message: "The response was blocked by the provider's content filter",
                }).toObject()
                yield* sessions.updateMessage(handle.message)
                yield* dieSyncError(events.publish(Session.Event.Error, { sessionID, error: handle.message.error }))
                return "break" as const
              }
              if (format.type === "json_schema") {
                handle.message.error = new SessionV1.StructuredOutputError({
                  message: "Model did not produce structured output",
                  retries: 0,
                }).toObject()
                yield* sessions.updateMessage(handle.message)
                return "break" as const
              }
            }
            // ─── Post-Turn Skill Loading Validation ───────────────────
            // After the LLM responds, check if chain skills were loaded
            // in the current turn. If the pre-turn block fired AND the
            // agent finished without loading skills, re-enforce by
            // overwriting the response content with a re-asserted
            // hard-block message. This ensures the persisted message
            // reflects the enforcement even if SSE already streamed.
            if (storedGateResultMap.has(sessionID)) {
              const storedGate = storedGateResultMap.get(sessionID)!
              if (storedGate.chain.length > 0 && handle.message.finish !== "tool-calls") {
                const { loaded } = scanForSkillToolCalls(msgs)
                const unloaded = storedGate.chain.filter((name: string) => !loaded.has(name))
                if (unloaded.length > 0) {
                  yield* Effect.logWarning(
                    `[SKILL-ENFORCER] Post-turn: agent finished without loading ${unloaded.length} chain skills: ${unloaded.join(", ")}`
                  )
                  // Re-enforce: if the pre-turn block was active and the agent
                  // still ignored it, overwrite the response's text parts with
                  // a re-asserted hard-block. The model MUST acknowledge this
                  // before the user can get an actual response.
                  if (preTurnBlocked) {
                    const reEnforcement = buildUnloadedChainBlockMessage(unloaded)
                    for (const part of handle.message.parts) {
                      if (part.type === "text") {
                        part.text = reEnforcement
                      }
                    }
                    yield* sessions.updateMessage(handle.message)
                  }
                }
              }
            }
            if (result === "stop") return "break" as const
            if (result === "compact") {
              yield* compaction.create({
                sessionID,
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
                overflow: !handle.message.finish,
              })
            }
            return "continue" as const
          }).pipe(
            Effect.ensuring(instruction.clear(handle.message.id)),
            Effect.onInterrupt(() => finalizeInterruptedAssistant),
          )
          if (outcome === "break") break
          continue
        }
        yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))
        return yield* lastAssistant(sessionID)
      },
    )
    const loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts> = (Effect.fn("SessionPrompt.loop")(function* (
      input: LoopInput,
    ) {
      return yield* (state.ensureRunning(input.sessionID, lastAssistant(input.sessionID), runLoop(input.sessionID) as any) as any)
    }) as any)
    const shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError> = Effect.fn(
      "SessionPrompt.shell",
    )(function* (input: ShellInput) {
      const ready = yield* Latch.make()
      return yield* (state.startShell(input.sessionID, lastAssistant(input.sessionID), shellImpl(input, ready) as unknown as Effect.Effect<SessionV1.WithParts, never>, ready) as Effect.Effect<SessionV1.WithParts, Session.BusyError>)
    })
    const command = (input: CommandInput): Effect.Effect<SessionV1.WithParts, Image.Error> =>
      commandFn({
        ...input,
        sessions,
        agents,
        commands,
        config,
        plugin,
        events,
        provider,
        getModel,
        currentModel,
        resolvePromptParts,
        prompt,
      }) as unknown as Effect.Effect<SessionV1.WithParts, Image.Error>
    return Service.of({
      cancel,
      prompt,
      loop,
      shell,
      command,
      resolvePromptParts,
    })
  }),
)
export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(SessionRunState.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(SessionCompaction.defaultLayer),
    Layer.provide(SessionProcessor.defaultLayer),
    Layer.provide(Command.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(MCP.defaultLayer),
    Layer.provide(LSP.defaultLayer),
    Layer.provide(ToolRegistry.defaultLayer),
    Layer.provide(Truncate.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(Image.defaultLayer),
    Layer.provide(
      Layer.mergeAll(
        Agent.defaultLayer,
        Database.defaultLayer,
        SystemPrompt.defaultLayer,
        LLM.defaultLayer,
        CrossSpawnSpawner.defaultLayer,
        RuntimeFlags.defaultLayer,
        EventV2Bridge.defaultLayer,
        SensorGate.defaultLayer,
        Skill.defaultLayer,
        ChainExecutor.defaultLayer,
        SelfEvolve.defaultLayer,
        PiecesLTM.defaultLayer,
        ContextCompressor.defaultLayer,
      ),
    ),
  ),
)

const sensorGateNode = LayerNode.make(SensorGate.defaultLayer, [])
const chainExecutorNode = LayerNode.make(ChainExecutor.defaultLayer, [])
export const node = (LayerNode.make as any)(layer, [
  SessionStatus.node,
  Session.node,
  Agent.node,
  Provider.node,
  SessionProcessor.node,
  SessionCompaction.node,
  Plugin.node,
  Command.node,
  Config.node,
  Permission.node,
  FSUtil.node,
  MCP.node,
  LSP.node,
  ToolRegistry.node,
  Truncate.node,
  Image.node,
  CrossSpawnSpawner.node,
  Instruction.node,
  SessionRunState.node,
  SessionRevert.node,
  SessionSummary.node,
  SystemPrompt.node,
  LLM.node,
  EventV2Bridge.node,
  RuntimeFlags.node,
  Database.node,
  sensorGateNode,
  chainExecutorNode,
])
export { ModelRef, PromptInput, LoopInput, ShellInput, CommandInput, createStructuredOutputTool }
export const SessionPrompt = {
  Service,
  layer,
  defaultLayer,
  node,
  ModelRef,
  PromptInput,
  LoopInput,
  ShellInput,
  CommandInput,
  createStructuredOutputTool,
}

