import { LayerNode } from "@opencode-ai/core/effect/layer-node"
\nimport { PermissionV1 } from "@opencode-ai/core/v1/permission"
\nimport path from "path"
\nimport { SessionV1 } from "@opencode-ai/core/v1/session"
\nimport os from "os"
\nimport { SessionID, MessageID, PartID } from "./schema"
\nimport { MessageV2 } from "./message-v2"
\nimport { SessionRevert } from "./revert"
\nimport { Session } from "./session"
\nimport { Agent } from "../agent/agent"
\nimport { Provider } from "@/provider/provider"
\n
\nimport { type Tool as AITool, tool, jsonSchema } from "ai"
\nimport type { JSONSchema7 } from "@ai-sdk/provider"
\nimport { SessionCompaction } from "./compaction"
\nimport { SystemPrompt } from "./system"
\nimport { Instruction } from "./instruction"
\nimport { Plugin } from "../plugin"
\nimport MAX_STEPS from "../session/prompt/max-steps.txt"
\nimport { ToolRegistry } from "@/tool/registry"
\nimport { MCP } from "../mcp"
\nimport { LSP } from "@/lsp/lsp"
\nimport { ulid } from "ulid"
\nimport { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
\nimport { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
\nimport * as Stream from "effect/Stream"
\nimport { Command } from "../command"
\nimport { pathToFileURL, fileURLToPath } from "url"
\nimport { Config } from "@/config/config"
\nimport { ConfigMarkdown } from "@/config/markdown"
\nimport { SessionSummary } from "./summary"
\nimport { NamedError } from "@opencode-ai/core/util/error"
\nimport { SessionProcessor } from "./processor"
\nimport { Tool } from "@/tool/tool"
\nimport { Permission } from "@/permission"
\nimport { Skill } from "@/skill"
\nimport { SensorGate, evaluateSpawnNecessity, type Persona, type SensorGateResult } from "@/skill/sensor-gate"
\nimport { SOCIAL_GREETING_RE } from "@/skill/question-complexity-schema"
\nimport { ChainExecutor, type ChainResult } from "@/skill/chain-executor"
\nimport { SelfEvolve, type LearningSignal } from "@/skill/self-evolve"
\nimport { debugLog } from "@/skill/python-resolver"
\nimport * as PersonaTracker from "./persona-tracker"
\nimport { ContextCompressor } from "./context-compressor"
\nimport { PiecesLTM } from "@/pieces-ltm"
\nimport { extractSubagentContext, buildSubagentContextPrompt } from "./subagent-context"
\nimport { SessionStatus } from "./status"
\nimport { LLM } from "./llm"
\nimport { Shell } from "@/shell/shell"
\nimport { ShellID } from "@/tool/shell/id"
\nimport { FSUtil } from "@opencode-ai/core/fs-util"
\nimport { Truncate } from "@/tool/truncate"
\nimport { Image } from "@/image/image"
\nimport { decodeDataUrl } from "@/util/data-url"
\nimport { Process } from "@/util/process"
\nimport { Cause, Effect, Exit, Latch, Layer, Option, Scope, Context, Schema, Types } from "effect"
\nimport { InstanceState } from "@/effect/instance-state"
\nimport { TaskTool, type TaskPromptOps } from "@/tool/task"
\nimport { SessionRunState } from "./run-state"
\nimport { RuntimeFlags } from "@/effect/runtime-flags"
\nimport { EventV2Bridge } from "@/event-v2-bridge"
\nimport { dieSyncError } from "@/effect/sync-error"
\nimport { Database } from "@opencode-ai/core/database/database"
\nimport { SessionEvent } from "@opencode-ai/core/session/event"
\nimport { SessionMessage } from "@opencode-ai/core/session/message"
\nimport { ModelV2 } from "@opencode-ai/core/model"
\nimport { ProviderV2 } from "@opencode-ai/core/provider"
\nimport { AgentAttachment, FileAttachment, Prompt, Source } from "@opencode-ai/core/session/prompt"
\nimport * as DateTime from "effect/DateTime"
\nimport { eq } from "drizzle-orm"
\nimport { SessionTable } from "@opencode-ai/core/session/sql"
\nimport { SessionReminders } from "./reminders"
\nimport { SessionTools } from "./tools"
\nimport { LLMEvent } from "@opencode-ai/llm"
\n
\n// @ts-ignore
\nglobalThis.AI_SDK_LOG_WARNINGS = false
\n
\nconst decodeMessageInfo = Schema.decodeUnknownExit(SessionV1.Info)
\nconst decodeMessagePart = Schema.decodeUnknownExit(SessionV1.Part)
\n
\nconst STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.
\n
\nIMPORTANT:
\n- You MUST call this tool exactly once at the end of your response
\n- The input must be valid JSON matching the required schema
\n- Complete all necessary research and tool calls BEFORE calling this tool
\n- This tool provides your final answer - no further actions are taken after calling it`
\n
\nconst STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`
\n
\nfunction sanitizeForSystemPrompt(text: string): string {
\n  // Strip ALL closing tags (</tag>) and self-closing tags (<tag/>) before
\n  // HTML/XML escaping to prevent prompt injection via fake system tags.
\n  // An allowlist approach is used: the system only injects opening tags with
\n  // content (e.g. <chain-enforcement>...</chain-enforcement>), so stripping
\n  // closing/self-closing tags prevents attackers from closing system blocks
\n  // or injecting fake blocks — without needing a blocklist that goes stale.
\n  // Order matters: escape HTML/XML metacharacters, & first to avoid double-escaping.
\n  return text
\n    .replace(/<[a-zA-Z][^>]*\/>/g, "")      // self-closing tags: <tag/>
\n    .replace(/<\/[a-zA-Z][^>]*>/g, "")       // closing tags: </tag>
\n    .replace(/&/g, "&amp;")
\n    .replace(/</g, "&lt;")
\n    .replace(/>/g, "&gt;")
\n    .replace(/"/g, "&quot;")
\n}
\n
\nfunction isOrphanedInterruptedTool(part: SessionV1.ToolPart) {
\n  // cleanup() marks abandoned tool_use blocks this way after retries/aborts.
\n  // They are not pending work and must not trigger an assistant-prefill request.
\n  return part.state.status === "error" && part.state.metadata?.interrupted === true
\n}
\n
\nexport interface Interface {
\n  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
\n  readonly prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error>
\n  readonly loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts>
\n  readonly shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError>
\n  readonly command: (input: CommandInput) => Effect.Effect<SessionV1.WithParts, Image.Error>
\n  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
\n}
\n
\nexport class Service extends Context.Service<Service, Interface>()("@dreamcode/SessionPrompt") {}
\n
\nexport const layer = Layer.effect(
\n  Service,
\n  Effect.gen(function* () {
\n    const status = yield* SessionStatus.Service
\n    const sessions = yield* Session.Service
\n    const agents = yield* Agent.Service
\n    const provider = yield* Provider.Service
\n    const processor = yield* SessionProcessor.Service
\n    const compaction = yield* SessionCompaction.Service
\n    const plugin = yield* Plugin.Service
\n    const commands = yield* Command.Service
\n    const config = yield* Config.Service
\n    const permission = yield* Permission.Service
\n    const fsys = yield* FSUtil.Service
\n    const mcp = yield* MCP.Service
\n    const lsp = yield* LSP.Service
\n    const registry = yield* ToolRegistry.Service
\n    const truncate = yield* Truncate.Service
\n    const image = yield* Image.Service
\n    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
\n    const scope = yield* Scope.Scope
\n    const instruction = yield* Instruction.Service
\n    const state = yield* SessionRunState.Service
\n    const revert = yield* SessionRevert.Service
\n    const summary = yield* SessionSummary.Service
\n    const sensorGate = yield* SensorGate.Service
\n    const sys = yield* SystemPrompt.Service
\n    const llm = yield* LLM.Service
\n    const events = yield* EventV2Bridge.Service
\n    const flags = yield* RuntimeFlags.Service
\n    const database = yield* Database.Service
\n    const { db } = database
\n    const skillService = yield* Skill.Service
\n    const chainExecutor = yield* ChainExecutor.Service
\n    const selfEvolve = yield* SelfEvolve.Service
\n    const piecesLTM = yield* PiecesLTM.PiecesLTM
\n
\n    const ops = Effect.fn("SessionPrompt.ops")(function* (opts?: { disableTaskTool?: boolean }) {
\n      return {
\n        cancel: (sessionID: SessionID) => cancel(sessionID),
\n        resolvePromptParts: (template: string) => resolvePromptParts(template),
\n        prompt: (input: PromptInput) => prompt(input).pipe(Effect.catch(Effect.die)),
\n        disableTaskTool: opts?.disableTaskTool ?? false,
\n      } satisfies TaskPromptOps
\n    })
\n
\n    const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
\n      yield* Effect.logInfo("cancel", { "session.id": sessionID })
\n      sensorGateFiredMap.delete(sessionID)
\n      personaRoundMap.delete(sessionID)
\n      spawnHistory.delete(sessionID)
\n      yield* state.cancel(sessionID)
\n    })
\n
\n    const sensorGateFiredMap = new Map<SessionID, boolean>()
\n    const personaRoundMap = new Map<SessionID, number>()
\n    const MAX_PERSONA_ROUNDS = 3
\n
\n    // ─── Rolling-Window Rate Limiter ─────────────────────────────────
\n    // Max 5 persona spawns per 5-minute window per session.
\n    // Prevents compute cost explosion from rapid-fire specialist requests.
\n    const RATE_WINDOW_MS = 5 * 60 * 1000 // 5 minutes
\n    const RATE_MAX_SPAWNS = 5
\n    const spawnHistory = new Map<SessionID, Array<{ timestamp: number; count: number }>>()
\n
\n    function checkRateLimit(sessionID: SessionID): { allowed: boolean; remaining: number; resetMs: number } {
\n      const now = Date.now()
\n      const history = spawnHistory.get(sessionID) ?? []
\n      const valid = history.filter((e) => now - e.timestamp < RATE_WINDOW_MS)
\n      spawnHistory.set(sessionID, valid)
\n      const totalSpawns = valid.reduce((sum, e) => sum + e.count, 0)
\n      if (totalSpawns >= RATE_MAX_SPAWNS) {
\n        const oldestInWindow = valid[0]
\n        const resetMs = oldestInWindow ? RATE_WINDOW_MS - (now - oldestInWindow.timestamp) : RATE_WINDOW_MS
\n        return { allowed: false, remaining: 0, resetMs }
\n      }
\n      return { allowed: true, remaining: RATE_MAX_SPAWNS - totalSpawns, resetMs: RATE_WINDOW_MS }
\n    }
\n
\n    function recordSpawn(sessionID: SessionID, count: number) {
\n      const history = spawnHistory.get(sessionID) ?? []
\n      history.push({ timestamp: Date.now(), count })
\n      spawnHistory.set(sessionID, history)
\n    }
\n
\n    function parseExplicitSpawnCount(text: string): number {
\n      const match = text.match(/(?:spawn|use|run|deploy)\s+(\d+)\s+(?:agent|subagent|specialist|persona)/i)
\n      return match ? Math.min(parseInt(match[1], 10), RATE_MAX_SPAWNS) : 0
\n    }
\n
\n    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
\n      const ctx = yield* InstanceState.context
\n      const parts: Types.DeepMutable<PromptInput["parts"]> = [{ type: "text", text: template }]
\n      const files = ConfigMarkdown.files(template)
\n      const seen = new Set<string>()
\n      yield* Effect.forEach(
\n        files,
\n        Effect.fnUntraced(function* (match) {
\n          const name = match[1]
\n          if (!name) return
\n          if (seen.has(name)) return
\n          seen.add(name)
\n
\n          const filepath = name.startsWith("~/")
\n            ? path.join(os.homedir(), name.slice(2))
\n            : path.resolve(ctx.worktree, name)
\n
\n          const info = yield* fsys.stat(filepath).pipe(Effect.option)
\n          if (Option.isNone(info)) {
\n            const found = yield* agents.get(name)
\n            if (found) parts.push({ type: "agent", name: found.name })
\n            return
\n          }
\n          const stat = info.value
\n          parts.push({
\n            type: "file",
\n            url: pathToFileURL(filepath).href,
\n            filename: name,
\n            mime: stat.type === "Directory" ? "application/x-directory" : "text/plain",
\n          })
\n        }),
\n        { concurrency: "unbounded", discard: true },
\n      )
\n      return parts
\n    })
\n
\n    const title = Effect.fn("SessionPrompt.ensureTitle")(function* (input: {
\n      session: Session.Info
\n      history: SessionV1.WithParts[]
\n      providerID: ProviderV2.ID
\n      modelID: ModelV2.ID
\n    }) {
\n      if (input.session.parentID) return
\n      if (!Session.isDefaultTitle(input.session.title)) return
\n
\n      const real = (m: SessionV1.WithParts) =>
\n        m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
\n      const idx = input.history.findIndex(real)
\n      if (idx === -1) return
\n      if (input.history.filter(real).length !== 1) return
\n
\n      const context = input.history.slice(0, idx + 1)
\n      const firstUser = context[idx]
\n      if (!firstUser || firstUser.info.role !== "user") return
\n      const firstInfo = firstUser.info
\n
\n      const subtasks = firstUser.parts.filter((p): p is SessionV1.SubtaskPart => p.type === "subtask")
\n      const onlySubtasks = subtasks.length > 0 && firstUser.parts.every((p) => p.type === "subtask")
\n
\n      const ag = yield* agents.get("title")
\n      if (!ag) return
\n      const mdl = ag.model
\n        ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
\n        : ((yield* provider.getSmallModel(input.providerID)) ??
\n          (yield* provider.getModel(input.providerID, input.modelID)))
\n      const msgs = onlySubtasks
\n        ? [{ role: "user" as const, content: subtasks.map((p) => p.prompt).join("\n") }]
\n        : yield* MessageV2.toModelMessagesEffect(context, mdl)
\n      const text = yield* llm
\n        .stream({
\n          agent: ag,
\n          user: firstInfo,
\n          system: [],
\n          small: true,
\n          tools: {},
\n          model: mdl,
\n          sessionID: input.session.id,
\n          retries: 2,
\n          messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
\n        })
\n        .pipe(
\n          Stream.filter(LLMEvent.is.textDelta),
\n          Stream.map((e) => e.text),
\n          Stream.mkString,
\n          Effect.orDie,
\n        )
\n      const cleaned = text
\n        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
\n        .split("\n")
\n        .map((line) => line.trim())
\n        .find((line) => line.length > 0)
\n      if (!cleaned) return
\n      const t = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
\n      yield* sessions
\n        .setTitle({ sessionID: input.session.id, title: t })
\n        .pipe(Effect.catchCause((cause) => Effect.logError("failed to generate title", { error: Cause.squash(cause) })))
\n    })
\n
\n    const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: {
\n      task: SessionV1.SubtaskPart
\n      model: Provider.Model
\n      lastUser: SessionV1.User
\n      sessionID: SessionID
\n      session: Session.Info
\n      msgs: SessionV1.WithParts[]
\n    }) {
\n      const { task, model, lastUser, sessionID, session, msgs } = input
\n      const ctx = yield* InstanceState.context
\n      const promptOps = yield* ops()
\n      const { task: taskTool } = yield* registry.named()
\n
\n      const taskModel = task.model ? yield* getModel(task.model.providerID, task.model.modelID, sessionID) : model
\n      const assistantMessage: SessionV1.Assistant = yield* sessions.updateMessage({
\n        id: MessageID.ascending(),
\n        role: "assistant",
\n        parentID: lastUser.id,
\n        sessionID,
\n        mode: task.agent,
\n        agent: task.agent,
\n        variant: lastUser.model.variant,
\n        path: { cwd: ctx.directory, root: ctx.worktree },
\n        cost: 0,
\n        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
\n        modelID: taskModel.id,
\n        providerID: taskModel.providerID,
\n        time: { created: Date.now() },
\n      })
\n      let part: SessionV1.ToolPart = yield* sessions.updatePart({
\n        id: PartID.ascending(),
\n        messageID: assistantMessage.id,
\n        sessionID: assistantMessage.sessionID,
\n        type: "tool",
\n        callID: ulid(),
\n        tool: TaskTool.id,
\n        state: {
\n          status: "running",
\n          input: {
\n            prompt: task.prompt,
\n            description: task.description,
\n            subagent_type: task.agent,
\n            command: task.command,
\n          },
\n          time: { start: Date.now() },
\n        },
\n      })
\n      const taskArgs = {
\n        prompt: task.prompt,
\n        description: task.description,
\n        subagent_type: task.agent,
\n        command: task.command,
\n      }
\n      yield* plugin.trigger(
\n        "tool.execute.before",
\n        { tool: TaskTool.id, sessionID, callID: part.id },
\n        { args: taskArgs },
\n      )
\n
\n      const taskAgent = yield* agents.get(task.agent)
\n      if (!taskAgent) {
\n        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
\n        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
\n        const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
\n        yield* dieSyncError(events.publish(Session.Event.Error, { sessionID, error: error.toObject() }))
\n        throw error
\n      }
\n
\n      let error: Error | undefined
\n      const taskAbort = new AbortController()
\n      const result = yield* taskTool
\n        .execute(taskArgs, {
\n          agent: task.agent,
\n          messageID: assistantMessage.id,
\n          sessionID,
\n          abort: taskAbort.signal,
\n          callID: part.callID,
\n          extra: { bypassAgentCheck: true, promptOps },
\n          messages: msgs,
\n          metadata: (val: { title?: string; metadata?: Record<string, any> }) =>
\n            Effect.gen(function* () {
\n              part = yield* sessions.updatePart({
\n                ...part,
\n                type: "tool",
\n                state: { ...part.state, ...val },
\n              } satisfies SessionV1.ToolPart)
\n            }),
\n          ask: (req: any) =>
\n            permission
\n              .ask({
\n                ...req,
\n                sessionID,
\n                ruleset: Permission.merge(taskAgent.permission, session.permission ?? []),
\n              })
\n              .pipe(Effect.orDie),
\n        })
\n        .pipe(
\n          Effect.catchCause((cause) => {
\n            const defect = Cause.squash(cause)
\n            error = defect instanceof Error ? defect : new Error(String(defect))
\n            return Effect.logError("subtask execution failed", {
\n              error,
\n              agent: task.agent,
\n              description: task.description,
\n            })
\n          }),
\n          Effect.onInterrupt(() =>
\n            Effect.gen(function* () {
\n              taskAbort.abort()
\n              assistantMessage.finish = "tool-calls"
\n              assistantMessage.time.completed = Date.now()
\n              yield* sessions.updateMessage(assistantMessage)
\n              if (part.state.status === "running") {
\n                yield* sessions.updatePart({
\n                  ...part,
\n                  state: {
\n                    status: "error",
\n                    error: "Cancelled",
\n                    time: { start: part.state.time.start, end: Date.now() },
\n                    metadata: part.state.metadata,
\n                    input: part.state.input,
\n                  },
\n                } satisfies SessionV1.ToolPart)
\n              }
\n            }),
\n          ),
\n        )
\n
\n      const attachments = result?.attachments?.map((attachment) => ({
\n        ...attachment,
\n        id: PartID.ascending(),
\n        sessionID,
\n        messageID: assistantMessage.id,
\n      }))
\n
\n      yield* plugin.trigger(
\n        "tool.execute.after",
\n        { tool: TaskTool.id, sessionID, callID: part.id, args: taskArgs },
\n        result,
\n      )
\n
\n      yield* sessions.updateMessage(assistantMessage)
\n
\n      // ── Subagent Cost Propagation ───────────────────────────────────
\n      // CRITICAL: The step-finish part is the SINGLE source of truth for
\n      // subagent cost. DO NOT also add cost to assistantMessage.cost —
\n      // that would double-count (the projector's applyUsage sums step-finish
\n      // parts, and stats.ts also sums message.info.cost). The double-count
\n      // was the root cause of the ~$0.05 discrepancy.
\n      const normalizeTokens = (t: Record<string, unknown> | undefined): SessionV1.StepFinishPart["tokens"] => {
\n        const cache = t?.cache as Record<string, unknown> | undefined
\n        return {
\n          input: (t?.input as number) ?? 0,
\n          output: (t?.output as number) ?? 0,
\n          reasoning: (t?.reasoning as number) ?? 0,
\n          cache: {
\n            read: (cache?.read as number) ?? 0,
\n            write: (cache?.write as number) ?? 0,
\n          },
\n        }
\n      }
\n
\n      const subagentCost_ = Number((result as any)?.subagentCost)
\n      const subagentTokens_ = (result as any)?.subagentTokens
\n      if (Number.isFinite(subagentCost_) && subagentCost_ > 0) {
\n        yield* sessions.updatePart({
\n          id: PartID.ascending(),
\n          messageID: assistantMessage.id,
\n          sessionID: assistantMessage.sessionID,
\n          type: "step-finish",
\n          reason: "completed",
\n          cost: subagentCost_,
\n          tokens: normalizeTokens(subagentTokens_),
\n        } satisfies SessionV1.StepFinishPart)
\n      }
\n
\n      if (result && part.state.status === "running") {
\n        yield* sessions.updatePart({
\n          ...part,
\n          state: {
\n            status: "completed",
\n            input: part.state.input,
\n            title: result.title,
\n            metadata: result.metadata,
\n            output: result.output,
\n            attachments,
\n            time: { ...part.state.time, end: Date.now() },
\n          },
\n        } satisfies SessionV1.ToolPart)
\n      }
\n
\n      if (!result) {
\n        yield* sessions.updatePart({
\n          ...part,
\n          state: {
\n            status: "error",
\n            error: error ? `Tool execution failed: ${error.message}` : "Tool execution failed",
\n            time: {
\n              start: part.state.status === "running" ? part.state.time.start : Date.now(),
\n              end: Date.now(),
\n            },
\n            metadata: part.state.status === "pending" ? undefined : part.state.metadata,
\n            input: part.state.input,
\n          },
\n        } satisfies SessionV1.ToolPart)
\n      }
\n
\n      if (!task.command) return
\n
\n      const summaryUserMsg: SessionV1.User = {
\n        id: MessageID.ascending(),
\n        sessionID,
\n        role: "user",
\n        time: { created: Date.now() },
\n        agent: lastUser.agent,
\n        model: lastUser.model,
\n      }
\n      yield* sessions.updateMessage(summaryUserMsg)
\n      yield* sessions.updatePart({
\n        id: PartID.ascending(),
\n        messageID: summaryUserMsg.id,
\n        sessionID,
\n        type: "text",
\n        text: "Summarize the task tool output above and continue with your task.",
\n        synthetic: true,
\n      } satisfies SessionV1.TextPart)
\n    })
\n
\n    const shellImpl = Effect.fn("SessionPrompt.shellImpl")(function* (input: ShellInput, ready?: Latch.Latch) {
\n      return yield* Effect.uninterruptibleMask((restore) =>
\n        Effect.gen(function* () {
\n          const markReady = ready ? ready.open.pipe(Effect.asVoid) : Effect.void
\n          const { msg, part, cwd } = yield* Effect.gen(function* () {
\n            const ctx = yield* InstanceState.context
\n            const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
\n            if (session.revert) {
\n              yield* revert.cleanup(session)
\n            }
\n            const agent = yield* agents.get(input.agent)
\n            if (!agent) {
\n              const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
\n              const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
\n              const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
\n              yield* dieSyncError(events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() }))
\n              throw error
\n            }
\n            const model = input.model ?? agent.model ?? (yield* currentModel(input.sessionID))
\n            const userMsg: SessionV1.User = {
\n              id: input.messageID ?? MessageID.ascending(),
\n              sessionID: input.sessionID,
\n              time: { created: Date.now() },
\n              role: "user",
\n              agent: input.agent,
\n              model: { providerID: model.providerID, modelID: model.modelID },
\n            }
\n            yield* sessions.updateMessage(userMsg)
\n            const userPart: SessionV1.Part = {
\n              type: "text",
\n              id: PartID.ascending(),
\n              messageID: userMsg.id,
\n              sessionID: input.sessionID,
\n              text: "The following tool was executed by the user",
\n              synthetic: true,
\n            }
\n            yield* sessions.updatePart(userPart)
\n
\n            const msg: SessionV1.Assistant = {
\n              id: MessageID.ascending(),
\n              sessionID: input.sessionID,
\n              parentID: userMsg.id,
\n              mode: input.agent,
\n              agent: input.agent,
\n              cost: 0,
\n              path: { cwd: ctx.directory, root: ctx.worktree },
\n              time: { created: Date.now() },
\n              role: "assistant",
\n              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
\n              modelID: model.modelID,
\n              providerID: model.providerID,
\n            }
\n            yield* sessions.updateMessage(msg)
\n            const started = Date.now()
\n            const part: SessionV1.ToolPart = {
\n              type: "tool",
\n              id: PartID.ascending(),
\n              messageID: msg.id,
\n              sessionID: input.sessionID,
\n              tool: ShellID.ToolID,
\n              callID: ulid(),
\n              state: {
\n                status: "running",
\n                time: { start: started },
\n                input: { command: input.command },
\n              },
\n            }
\n            yield* sessions.updatePart(part)
\n            if (flags.experimentalEventSystem) {
\n              yield* dieSyncError(events.publish(SessionEvent.Shell.Started, {
\n                sessionID: input.sessionID,
\n                messageID: SessionMessage.ID.create(),
\n                timestamp: DateTime.makeUnsafe(started),
\n                callID: part.callID,
\n                command: input.command,
\n              }))
\n            }
\n            return { msg, part, cwd: ctx.directory }
\n          }).pipe(Effect.ensuring(markReady))
\n
\n          const cfg = yield* config.get()
\n          const sh = Shell.preferred(cfg.shell)
\n          const args = Shell.args(sh, input.command, cwd)
\n          let output = ""
\n          let aborted = false
\n
\n          const finish = Effect.uninterruptible(
\n            Effect.gen(function* () {
\n              if (aborted) {
\n                output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
\n              }
\n              const completed = Date.now()
\n              if (flags.experimentalEventSystem) {
\n                yield* dieSyncError(events.publish(SessionEvent.Shell.Ended, {
\n                  sessionID: input.sessionID,
\n                  timestamp: DateTime.makeUnsafe(completed),
\n                  callID: part.callID,
\n                  output,
\n                }))
\n              }
\n              if (!msg.time.completed) {
\n                msg.time.completed = completed
\n                yield* sessions.updateMessage(msg)
\n              }
\n              if (part.state.status === "running") {
\n                part.state = {
\n                  status: "completed",
\n                  time: { ...part.state.time, end: completed },
\n                  input: part.state.input,
\n                  title: "",
\n                  metadata: { output, description: "" },
\n                  output,
\n                }
\n                yield* sessions.updatePart(part)
\n              }
\n            }),
\n          )
\n
\n          const exit = yield* restore(
\n            Effect.gen(function* () {
\n              const shellEnv = yield* plugin.trigger(
\n                "shell.env",
\n                { cwd, sessionID: input.sessionID, callID: part.callID },
\n                { env: {} },
\n              )
\n              const cmd = ChildProcess.make(sh, args, {
\n                cwd,
\n                extendEnv: true,
\n                env: { ...shellEnv.env, TERM: "dumb" },
\n                stdin: "ignore",
\n                forceKillAfter: "3 seconds",
\n              })
\n              const handle = yield* spawner.spawn(cmd)
\n              yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
\n                Effect.gen(function* () {
\n                  output += chunk
\n                  if (part.state.status === "running") {
\n                    part.state.metadata = { output, description: "" }
\n                    yield* sessions.updatePart(part)
\n                  }
\n                }),
\n              )
\n              yield* handle.exitCode
\n            }).pipe(Effect.scoped, Effect.orDie),
\n          ).pipe(Effect.exit)
\n
\n          if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause)) {
\n            aborted = true
\n          }
\n          yield* finish
\n
\n          if (Exit.isFailure(exit) && !aborted && !Cause.hasInterruptsOnly(exit.cause)) {
\n            return yield* Effect.failCause(exit.cause)
\n          }
\n
\n          return { info: msg, parts: [part] }
\n        }),
\n      )
\n    })
\n
\n    const getModel = Effect.fn("SessionPrompt.getModel")(function* (
\n      providerID: ProviderV2.ID,
\n      modelID: ModelV2.ID,
\n      sessionID: SessionID,
\n    ) {
\n      const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit)
\n      if (Exit.isSuccess(exit)) return exit.value
\n      const err = Cause.squash(exit.cause)
\n      if (Provider.ModelNotFoundError.isInstance(err)) {
\n        const hint = err.suggestions?.length ? ` Did you mean: ${err.suggestions.join(", ")}?` : ""
\n        yield* dieSyncError(events.publish(Session.Event.Error, {
\n          sessionID,
\n          error: new NamedError.Unknown({
\n            message: `Model not found: ${err.providerID}/${err.modelID}.${hint}`,
\n          }).toObject(),
\n        }))
\n      }
\n      return yield* Effect.die(err)
\n    })
\n
\n    const currentModel = Effect.fnUntraced(function* (sessionID: SessionID) {
\n      const current = yield* db
\n        .select({ model: SessionTable.model })
\n        .from(SessionTable)
\n        .where(eq(SessionTable.id, sessionID))
\n        .get()
\n        .pipe(Effect.orDie)
\n      if (current?.model) {
\n        return {
\n          providerID: ProviderV2.ID.make(current.model.providerID),
\n          modelID: ModelV2.ID.make(current.model.id),
\n          ...(current.model.variant && current.model.variant !== "default" ? { variant: current.model.variant } : {}),
\n        }
\n      }
\n      const match = yield* sessions
\n        .findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model)
\n        .pipe(Effect.orDie)
\n      if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
\n      return yield* provider.defaultModel().pipe(Effect.orDie)
\n    })
\n
\n    const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput) {
\n      const agentName = input.agent
\n      const ag = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
\n      if (!ag) {
\n        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
\n        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
\n        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
\n        yield* dieSyncError(events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() }))
\n        throw error
\n      }
\n
\n      const current = yield* db
\n        .select({ agent: SessionTable.agent, model: SessionTable.model })
\n        .from(SessionTable)
\n        .where(eq(SessionTable.id, input.sessionID))
\n        .get()
\n        .pipe(Effect.orDie)
\n      const model = input.model ?? ag.model ?? (yield* currentModel(input.sessionID))
\n      const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
\n      const full =
\n        !input.variant && ag.variant && same
\n          ? yield* provider
\n              .getModel(model.providerID, model.modelID)
\n              .pipe(Effect.catchIf(Provider.ModelNotFoundError.isInstance, () => Effect.succeed(undefined)))
\n          : undefined
\n      const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)
\n
\n      const info: SessionV1.User = {
\n        id: input.messageID ?? MessageID.ascending(),
\n        role: "user",
\n        sessionID: input.sessionID,
\n        time: { created: Date.now() },
\n        tools: input.tools,
\n        agent: ag.name,
\n        model: {
\n          providerID: model.providerID,
\n          modelID: model.modelID,
\n          variant,
\n        },
\n        system: input.system,
\n        format: input.format,
\n      }
\n
\n      if (current?.agent !== info.agent) {
\n        yield* dieSyncError(events.publish(SessionEvent.AgentSwitched, {
\n          sessionID: input.sessionID,
\n          messageID: SessionMessage.ID.create(),
\n          timestamp: DateTime.makeUnsafe(info.time.created),
\n          agent: info.agent,
\n        }))
\n      }
\n      if (
\n        current?.model?.providerID !== info.model.providerID ||
\n        current.model.id !== info.model.modelID ||
\n        (current.model.variant === "default" ? undefined : current.model.variant) !== info.model.variant
\n      ) {
\n        yield* dieSyncError(events.publish(SessionEvent.ModelSwitched, {
\n          sessionID: input.sessionID,
\n          messageID: SessionMessage.ID.create(),
\n          timestamp: DateTime.makeUnsafe(info.time.created),
\n          model: {
\n            id: ModelV2.ID.make(info.model.modelID),
\n            providerID: ProviderV2.ID.make(info.model.providerID),
\n            variant: ModelV2.VariantID.make(info.model.variant ?? "default"),
\n          },
\n        }))
\n      }
\n
\n      yield* Effect.addFinalizer(() => instruction.clear(info.id))
\n
\n      type Draft<T> = T extends SessionV1.Part ? Omit<T, "id"> & { id?: string } : never
\n      const assign = (part: Draft<SessionV1.Part>): SessionV1.Part => ({
\n        ...part,
\n        id: part.id ? PartID.make(part.id) : PartID.ascending(),
\n      })
\n
\n      const resolvePart: (part: PromptInput["parts"][number]) => Effect.Effect<Draft<SessionV1.Part>[]> = Effect.fn(
\n        "SessionPrompt.resolveUserPart",
\n      )(function* (part) {
\n        if (part.type === "file") {
\n          if (part.source?.type === "resource") {
\n            const { clientName, uri } = part.source
\n            yield* Effect.logInfo("mcp resource", { clientName, uri, mime: part.mime })
\n            const pieces: Draft<SessionV1.Part>[] = [
\n              {
\n                messageID: info.id,
\n                sessionID: input.sessionID,
\n                type: "text",
\n                synthetic: true,
\n                text: `Reading MCP resource: ${part.filename} (${uri})`,
\n              },
\n            ]
\n            const exit = yield* mcp.readResource(clientName, uri).pipe(Effect.exit)
\n            if (Exit.isSuccess(exit)) {
\n              const content = exit.value
\n              if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
\n              const items = Array.isArray(content.contents) ? content.contents : [content.contents]
\n              for (const c of items) {
\n                if ("text" in c && c.text) {
\n                  pieces.push({
\n                    messageID: info.id,
\n                    sessionID: input.sessionID,
\n                    type: "text",
\n                    synthetic: true,
\n                    text: c.text,
\n                  })
\n                } else if ("blob" in c && c.blob) {
\n                  const mime = "mimeType" in c ? c.mimeType : part.mime
\n                  pieces.push({
\n                    messageID: info.id,
\n                    sessionID: input.sessionID,
\n                    type: "text",
\n                    synthetic: true,
\n                    text: `[Binary content: ${mime}]`,
\n                  })
\n                }
\n              }
\n              pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
\n            } else {
\n              const error = Cause.squash(exit.cause)
\n              yield* Effect.logError("failed to read MCP resource", { error, clientName, uri })
\n              const message = error instanceof Error ? error.message : String(error)
\n              pieces.push({
\n                messageID: info.id,
\n                sessionID: input.sessionID,
\n                type: "text",
\n                synthetic: true,
\n                text: `Failed to read MCP resource ${part.filename}: ${message}`,
\n              })
\n            }
\n            return pieces
\n          }
\n          const url = new URL(part.url)
\n          switch (url.protocol) {
\n            case "data:":
\n              if (part.mime === "text/plain") {
\n                return [
\n                  {
\n                    messageID: info.id,
\n                    sessionID: input.sessionID,
\n                    type: "text",
\n                    synthetic: true,
\n                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
\n                  },
\n                  {
\n                    messageID: info.id,
\n                    sessionID: input.sessionID,
\n                    type: "text",
\n                    synthetic: true,
\n                    text: decodeDataUrl(part.url),
\n                  },
\n                  { ...part, messageID: info.id, sessionID: input.sessionID },
\n                ]
\n              }
\n              break
\n            case "file:": {
\n              yield* Effect.logInfo("file", { mime: part.mime })
\n              const filepath = fileURLToPath(part.url)
\n              const mime = (yield* fsys.isDir(filepath)) ? "application/x-directory" : part.mime
\n
\n              const { read } = yield* registry.named()
\n              const execRead = (args: Parameters<typeof read.execute>[0], extra?: Tool.Context["extra"]) => {
\n                const controller = new AbortController()
\n                return read
\n                  .execute(args, {
\n                    sessionID: input.sessionID,
\n                    abort: controller.signal,
\n                    agent: input.agent!,
\n                    messageID: info.id,
\n                    extra: { bypassCwdCheck: true, ...extra },
\n                    messages: [],
\n                    metadata: () => Effect.void,
\n                    ask: () => Effect.void,
\n                  })
\n                  .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
\n              }
\n
\n              if (mime === "text/plain") {
\n                let offset: number | undefined
\n                let limit: number | undefined
\n                const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
\n                if (range.start != null) {
\n                  const filePathURI = part.url.split("?")[0]
\n                  let start = parseInt(range.start)
\n                  let end = range.end ? parseInt(range.end) : undefined
\n                  if (start === end) {
\n                    const symbols = yield* lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
\n                    for (const symbol of symbols) {
\n                      let r: LSP.Range | undefined
\n                      if ("range" in symbol) r = symbol.range
\n                      else if ("location" in symbol) r = symbol.location.range
\n                      if (r?.start?.line && r?.start?.line === start) {
\n                        start = r.start.line
\n                        end = r?.end?.line ?? start
\n                        break
\n                      }
\n                    }
\n                  }
\n                  offset = Math.max(start, 1)
\n                  if (end) limit = end - (offset - 1)
\n                }
\n                const args = { filePath: filepath, offset, limit }
\n                const pieces: Draft<SessionV1.Part>[] = [
\n                  {
\n                    messageID: info.id,
\n                    sessionID: input.sessionID,
\n                    type: "text",
\n                    synthetic: true,
\n                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
\n                  },
\n                ]
\n                const exit = yield* provider.getModel(info.model.providerID, info.model.modelID).pipe(
\n                  Effect.flatMap((mdl) => execRead(args, { model: mdl })),
\n                  Effect.exit,
\n                )
\n                if (Exit.isSuccess(exit)) {
\n                  const result = exit.value
\n                  pieces.push({
\n                    messageID: info.id,
\n                    sessionID: input.sessionID,
\n                    type: "text",
\n                    synthetic: true,
\n                    text: result.output,
\n                  })
\n                  if (result.attachments?.length) {
\n                    pieces.push(
\n                      ...result.attachments.map((a) => ({
\n                        ...a,
\n                        synthetic: true,
\n                        filename: a.filename ?? part.filename,
\n                        messageID: info.id,
\n                        sessionID: input.sessionID,
\n                      })),
\n                    )
\n                  } else {
\n                    pieces.push({ ...part, mime, messageID: info.id, sessionID: input.sessionID })
\n                  }
\n                } else {
\n                  const error = Cause.squash(exit.cause)
\n                  yield* Effect.logError("failed to read file", { error, filepath })
\n                  const message = error instanceof Error ? error.message : String(error)
\n                  yield* dieSyncError(events.publish(Session.Event.Error, {
\n                    sessionID: input.sessionID,
\n                    error: new NamedError.Unknown({ message }).toObject(),
\n                  }))
\n                  pieces.push({
\n                    messageID: info.id,
\n                    sessionID: input.sessionID,
\n                    type: "text",
\n                    synthetic: true,
\n                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
\n                  })
\n                }
\n                return pieces
\n              }
\n
\n              if (mime === "application/x-directory") {
\n                const args = { filePath: filepath }
\n                const exit = yield* execRead(args).pipe(Effect.exit)
\n                if (Exit.isFailure(exit)) {
\n                  const error = Cause.squash(exit.cause)
\n                  yield* Effect.logError("failed to read directory", { error, filepath })
\n                  const message = error instanceof Error ? error.message : String(error)
\n                  yield* dieSyncError(events.publish(Session.Event.Error, {
\n                    sessionID: input.sessionID,
\n                    error: new NamedError.Unknown({ message }).toObject(),
\n                  }))
\n                  return [
\n                    {
\n                      messageID: info.id,
\n                      sessionID: input.sessionID,
\n                      type: "text",
\n                      synthetic: true,
\n                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
\n                    },
\n                  ]
\n                }
\n                return [
\n                  {
\n                    messageID: info.id,
\n                    sessionID: input.sessionID,
\n                    type: "text",
\n                    synthetic: true,
\n                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
\n                  },
\n                  {
\n                    messageID: info.id,
\n                    sessionID: input.sessionID,
\n                    type: "text",
\n                    synthetic: true,
\n                    text: exit.value.output,
\n                  },
\n                  { ...part, mime, messageID: info.id, sessionID: input.sessionID },
\n                ]
\n              }
\n
\n              return [
\n                {
\n                  messageID: info.id,
\n                  sessionID: input.sessionID,
\n                  type: "text",
\n                  synthetic: true,
\n                  text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
\n                },
\n                {
\n                  id: part.id,
\n                  messageID: info.id,
\n                  sessionID: input.sessionID,
\n                  type: "file",
\n                  url:
\n                    `data:${mime};base64,` +
\n                    Buffer.from(yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die))).toString("base64"),
\n                  mime,
\n                  filename: part.filename!,
\n                  source: part.source,
\n                },
\n              ]
\n            }
\n          }
\n        }
\n
\n        if (part.type === "agent") {
\n          const perm = Permission.evaluate("task", part.name, ag.permission)
\n          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
\n          return [
\n            { ...part, messageID: info.id, sessionID: input.sessionID },
\n            {
\n              messageID: info.id,
\n              sessionID: input.sessionID,
\n              type: "text",
\n              synthetic: true,
\n              text:
\n                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
\n                part.name +
\n                hint,
\n            },
\n          ]
\n        }
\n
\n        return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
\n      })
\n
\n      const resolvedParts = yield* Effect.forEach(input.parts, resolvePart, { concurrency: "unbounded" }).pipe(
\n        Effect.map((x) => x.flat().map(assign)),
\n      )
\n
\n      yield* plugin.trigger(
\n        "chat.message",
\n        {
\n          sessionID: input.sessionID,
\n          agent: input.agent,
\n          model: input.model,
\n          messageID: input.messageID,
\n          variant: input.variant,
\n        },
\n        { message: info, parts: resolvedParts },
\n      )
\n
\n      const parts = yield* Effect.forEach(resolvedParts, (part) =>
\n        part.type === "file" && part.mime.startsWith("image/")
\n          ? image.normalize(part).pipe(
\n              Effect.catchIf(
\n                (error) => error instanceof Image.ResizerUnavailableError,
\n                () => Effect.succeed(part),
\n              ),
\n            )
\n          : Effect.succeed(part),
\n      )
\n
\n      const parsed = decodeMessageInfo(info, { errors: "all", propertyOrder: "original" })
\n      if (Exit.isFailure(parsed)) {
\n        yield* Effect.logError("invalid user message before save", {
\n          sessionID: input.sessionID,
\n          messageID: info.id,
\n          agent: info.agent,
\n          model: info.model,
\n          cause: Cause.pretty(parsed.cause),
\n        })
\n      }
\n      for (const [index, part] of parts.entries()) {
\n        const p = decodeMessagePart(part, { errors: "all", propertyOrder: "original" })
\n        if (Exit.isSuccess(p)) continue
\n        yield* Effect.logError("invalid user part before save", {
\n          sessionID: input.sessionID,
\n          messageID: info.id,
\n          partID: part.id,
\n          partType: part.type,
\n          index,
\n          cause: Cause.pretty(p.cause),
\n          part,
\n        })
\n      }
\n
\n      yield* sessions.updateMessage(info)
\n      for (const part of parts) yield* sessions.updatePart(part)
\n      const nextPrompt = parts.reduce(
\n        (result, part) => {
\n          if (part.type === "text") {
\n            if (part.synthetic) result.synthetic.push(part.text)
\n            else result.text.push(part.text)
\n          }
\n          if (part.type === "file") {
\n            result.files.push(
\n              new FileAttachment({
\n                uri: part.url,
\n                mime: part.mime,
\n                name: part.filename,
\n                source: part.source
\n                  ? new Source({
\n                      start: part.source.text.start,
\n                      end: part.source.text.end,
\n                      text: part.source.text.value,
\n                    })
\n                  : undefined,
\n              }),
\n            )
\n          }
\n          if (part.type === "agent") {
\n            result.agents.push(
\n              new AgentAttachment({
\n                name: part.name,
\n                source: part.source
\n                  ? new Source({
\n                      start: part.source.start,
\n                      end: part.source.end,
\n                      text: part.source.value,
\n                    })
\n                  : undefined,
\n              }),
\n            )
\n          }
\n          return result
\n        },
\n        {
\n          text: [] as string[],
\n          files: [] as FileAttachment[],
\n          agents: [] as AgentAttachment[],
\n          synthetic: [] as string[],
\n        },
\n      )
\n      // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
\n      if (flags.experimentalEventSystem) {
\n        yield* dieSyncError(events.publish(SessionEvent.Prompted, {
\n          sessionID: input.sessionID,
\n          messageID: SessionMessage.ID.create(),
\n          timestamp: DateTime.makeUnsafe(info.time.created),
\n          delivery: "steer",
\n          prompt: new Prompt({
\n            text: nextPrompt.text.join("\n"),
\n            files: nextPrompt.files,
\n            agents: nextPrompt.agents,
\n          }),
\n        }))
\n      }
\n      for (const text of nextPrompt.synthetic) {
\n        // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
\n        if (flags.experimentalEventSystem) {
\n          yield* dieSyncError(events.publish(SessionEvent.Synthetic, {
\n            sessionID: input.sessionID,
\n            messageID: SessionMessage.ID.create(),
\n            timestamp: DateTime.makeUnsafe(info.time.created),
\n            text,
\n          }))
\n        }
\n      }
\n
\n      return { info, parts }
\n    }, Effect.scoped)
\n
\n                const processSensorGatePhase = Effect.fn("SessionPrompt.processSensorGatePhase")(function* (input: any) {
                  const {
                    gateResult, explicitSpawnCount, sessionID, msgs, system, model, ctx,
                    handle, instruction, ops, piecesLTM, selfEvolve, registry, agents,
                    sessions, sensorGate, lastUser, lastUserMsg, userText, tools,
                    sensorGateFiredMap, personaRoundMap, spawnHistory, compaction,
                    isLowConfidence, spawnEval, bypassAgentCheck,
                  } = input
\n                  // ─── End Sensor Gate ────────────────────────────────────────
                  // Return the values modified by this function
                  return {
                    synthesisText: synthesisText!,
                    sensorGateFired: sensorGateFired!,
                  }
                })
\n    const prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error> = Effect.fn(
\n      "SessionPrompt.prompt",
\n    )(function* (input: PromptInput) {
\n      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
\n      yield* revert.cleanup(session)
\n      const message = yield* createUserMessage(input)
\n      yield* sessions.touch(input.sessionID)
\n
\n      const permissions: PermissionV1.Rule[] = []
\n      for (const [t, enabled] of Object.entries(input.tools ?? {})) {
\n        permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
\n      }
\n      if (permissions.length > 0) {
\n        session.permission = permissions
\n        yield* sessions.setPermission({ sessionID: session.id, permission: permissions })
\n      }
\n
\n      if (input.noReply === true) return message
\n      return yield* loop({ sessionID: input.sessionID })
\n    })
\n
\n    const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionID) {
\n      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role !== "user").pipe(Effect.orDie)
\n      if (Option.isSome(match)) return match.value
\n      const msgs = yield* sessions.messages({ sessionID, limit: 1 }).pipe(Effect.orDie)
\n      if (msgs.length > 0) return msgs[0]
\n      throw new Error("Impossible")
\n    })
\n
\n    const SELF_CHECK = `# Self-Check Protocol
\n
\nBefore every response, verify your reasoning:
\n1. Does the plan directly address the user's request?
\n2. What assumptions are you making that could be wrong?
\n3. Are you passing real values, not placeholders or literals?
\n4. What is the most likely failure mode for your approach?`
\n
\n    const runLoop = Effect.fn("SessionPrompt.run")(
\n      function* (sessionID: SessionID) {
\n        const ctx = yield* InstanceState.context
\n        let structured: unknown
\n        let step = 0
\n        let synthesisText: string | undefined
\n        let prevUserMessageID: string | undefined
\n        let titleGenerated = false
\n        let sensorGateFired = sensorGateFiredMap.get(sessionID) ?? false
\n        const session = yield* sessions.get(sessionID).pipe(Effect.orDie)
\n
\n        while (true) {
\n          synthesisText = undefined
\n          yield* status.set(sessionID, { type: "busy" })
\n          yield* Effect.logInfo("loop", { "session.id": sessionID, step })
\n
\n          let msgs = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
\n            Effect.provideService(Database.Service, database),
\n          )
\n
\n          const { user: lastUser, assistant: lastAssistant, finished: lastFinished, tasks } = MessageV2.latest(msgs)
\n
\n          if (!lastUser) throw new Error("No user message found in stream. This should never happen.")
\n
\n          if (prevUserMessageID !== lastUser.id) {
\n            step = 0
\n            prevUserMessageID = lastUser.id
\n          }
\n
\n          const lastAssistantMsg = msgs.findLast(
\n            (msg) => msg.info.role === "assistant" && msg.info.id === lastAssistant?.id,
\n          )
\n          // Some providers return "stop" even when the assistant message contains
\n          // tool calls. Keep the loop running so tool results can be sent back to
\n          // the model, but ignore cleanup-marked interrupted orphans.
\n          const hasToolCalls =
\n            lastAssistantMsg?.parts.some(
\n              (part) => part.type === "tool" && !part.metadata?.providerExecuted && !isOrphanedInterruptedTool(part),
\n            ) ?? false
\n
\n          if (
\n            lastAssistant?.finish &&
\n            !["tool-calls"].includes(lastAssistant.finish) &&
\n            !hasToolCalls &&
\n            lastUser.id < lastAssistant.id
\n          ) {
\n            const orphan = lastAssistantMsg?.parts.find(
\n              (part): part is SessionV1.ToolPart => part.type === "tool" && isOrphanedInterruptedTool(part),
\n            )
\n            if (orphan) {
\n              yield* Effect.logWarning("loop exit with orphaned interrupted tool", {
\n                "session.id": sessionID,
\n                messageID: lastAssistant.id,
\n                tool: orphan.tool,
\n                callID: orphan.callID,
\n              })
\n            }
\n            yield* Effect.logInfo("exiting loop", { "session.id": sessionID })
\n            break
\n          }
\n
\n          step++
\n          if (step === 1 && !titleGenerated) {
\n            titleGenerated = true
\n            yield* title({
\n              session,
\n              modelID: lastUser.model.modelID,
\n              providerID: lastUser.model.providerID,
\n              history: msgs,
\n            }).pipe(Effect.ignore, Effect.forkIn(scope))
\n          }
\n
\n          const model = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)
\n          const task = tasks.pop()
\n
\n          if (task?.type === "subtask") {
\n            yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs })
\n            continue
\n          }
\n
\n          if (task?.type === "compaction") {
\n            const result = yield* compaction.process({
\n              messages: msgs,
\n              parentID: lastUser.id,
\n              sessionID,
\n              auto: task.auto,
\n              overflow: task.overflow,
\n            })
\n            if (result === "stop") break
\n            continue
\n          }
\n
\n          // /compact command — bypass sensor gate, trigger compaction directly
\n          if (!session.parentID) {
\n            const userText = msgs
\n              .filter((m) => m.info.role === "user" && m.info.id === lastUser.id)
\n              .flatMap((m) => m.parts)
\n              .filter((p): p is typeof p & { type: "text" } => p.type === "text" && !p.ignored)
\n              .map((p) => p.text)
\n              .join("\n")
\n            if (userText.trim().startsWith("/compact")) {
\n              yield* compaction.create({
\n                sessionID,
\n                agent: lastUser.agent,
\n                model: lastUser.model,
\n                auto: false,
\n              })
\n              continue
\n            }
\n          }
\n
\n          const agent = yield* agents.get(lastUser.agent)
\n          if (!agent) {
\n            const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
\n            const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
\n            const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
\n            yield* dieSyncError(events.publish(Session.Event.Error, { sessionID, error: error.toObject() }))
\n            throw error
\n          }
\n
\n          // Subagents should NOT trigger auto-compaction — they do focused work
\n          // and compaction during their execution is costly and disruptive.
\n          // Synthesis lock prevents auto-compact while parent agent is mid-response,
\n          // avoiding context-epoch truncation during an active provider turn.
\n          if (
\n            agent.mode !== "subagent" &&
\n            lastFinished &&
\n            lastFinished.summary !== true &&
\n            (yield* compaction.isOverflow({ tokens: lastFinished.tokens, model })) &&
\n            !(yield* compaction.isCompactionLocked)
\n          ) {
\n            yield* compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
\n            continue
\n          }
\n
\n          const maxSteps = agent.steps ?? Infinity
\n          const isLastStep = step >= maxSteps
\n          msgs = yield* SessionReminders.apply({ messages: msgs, agent, session }).pipe(
\n            Effect.provideService(RuntimeFlags.Service, flags),
\n            Effect.provideService(FSUtil.Service, fsys),
\n            Effect.provideService(Session.Service, sessions),
\n          )
\n
\n          const msg: SessionV1.Assistant = {
\n            id: MessageID.ascending(),
\n            parentID: lastUser.id,
\n            role: "assistant",
\n            mode: agent.name,
\n            agent: agent.name,
\n            variant: lastUser.model.variant,
\n            path: { cwd: ctx.directory, root: ctx.worktree },
\n            cost: 0,
\n            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
\n            modelID: model.id,
\n            providerID: model.providerID,
\n            time: { created: Date.now() },
\n            sessionID,
\n          }
\n          yield* sessions.updateMessage(msg)
\n
\n          const finalizeInterruptedAssistant = Effect.gen(function* () {
\n            if (msg.time.completed) return
\n            msg.error ??= MessageV2.fromError(new DOMException("Aborted", "AbortError"), {
\n              providerID: msg.providerID,
\n              aborted: true,
\n            })
\n            msg.time.completed = Date.now()
\n            yield* sessions.updateMessage(msg)
\n          })
\n
\n          const handle = yield* processor
\n            .create({
\n              assistantMessage: msg,
\n              sessionID,
\n              model,
\n            })
\n            .pipe(Effect.onInterrupt(() => finalizeInterruptedAssistant))
\n
\n          const outcome: "break" | "continue" = yield* Effect.gen(function* () {
\n            const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
\n            const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false
\n            const promptOps = yield* ops()
\n
\n            const tools = yield* SessionTools.resolve({
\n              agent,
\n              session,
\n              model,
\n              processor: handle,
\n              bypassAgentCheck,
\n              messages: msgs,
\n              promptOps,
\n            }).pipe(
\n              Effect.provideService(Plugin.Service, plugin),
\n              Effect.provideService(Permission.Service, permission),
\n              Effect.provideService(ToolRegistry.Service, registry),
\n              Effect.provideService(MCP.Service, mcp),
\n              Effect.provideService(Truncate.Service, truncate),
\n            )
\n
\n            if (lastUser.format?.type === "json_schema") {
\n              tools["StructuredOutput"] = createStructuredOutputTool({
\n                schema: lastUser.format.schema,
\n                onSuccess(output) {
\n                  structured = output
\n                },
\n              })
\n            }
\n
\n            if (step === 1)
\n              yield* summary.summarize({ sessionID, messageID: lastUser.id }).pipe(Effect.ignore, Effect.forkIn(scope))
\n
\n            if (step > 1 && lastFinished) {
\n              for (const m of msgs) {
\n                if (m.info.role !== "user" || m.info.id <= lastFinished.id) continue
\n                for (const p of m.parts) {
\n                  if (p.type !== "text" || p.ignored || p.synthetic) continue
\n                  if (!p.text.trim()) continue
\n                  p.text = [
\n                    "<system-reminder>",
\n                    "The user sent the following message:",
\n                    p.text,
\n                    "",
\n                    "Please address this message and continue with your tasks.",
\n                    "</system-reminder>",
\n                  ].join("\n")
\n                }
\n              }
\n            }
\n
\n            yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
\n
\n            const [skills, env, knowledge, instructions, modelMsgs] = yield* Effect.all([
\n              sys.skills(agent),
\n              sys.environment(model),
\n              sys.knowledge().pipe(Effect.catch(() => Effect.succeed(undefined))),
\n              instruction.system().pipe(Effect.orDie),
\n              MessageV2.toModelMessagesEffect(msgs, model),
\n            ])
\n            const system = [...env, ...instructions, ...(skills ? [skills] : []), ...(knowledge ? [knowledge] : []), SELF_CHECK]
\n            const format = lastUser.format ?? { type: "text" as const }
\n            if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
\n
\n            // ─── Sensor Gate: Native Dream Mode ─────────────────────────
\n            // Runs classification + skill chain selection on every user message.
\n            // Only in root sessions — subagents must NOT re-enter persona spawning.
\n            // Also skip when the agent itself is a subagent (mode === "subagent").
\n            // Skip after synthesis — synthesis should NOT auto-spawn subagents.
\n            if (step === 1 && !session.parentID) {
\n              const userText = msgs
\n                .filter((m) => m.info.role === "user" && m.info.id === lastUser.id)
\n                .flatMap((m) => m.parts)
\n                .filter((p): p is typeof p & { type: "text" } => p.type === "text" && !p.ignored)
\n                .map((p) => p.text)
\n                .join("\n")
\n
\n              // Detect synthesis response — skip auto-spawn after synthesis
\n              const lastUserMsg = msgs.findLast(
\n                (m) => m.info.role === "user" && m.info.id === lastUser.id,
\n              )
\n              const isSynthesis = lastUserMsg?.parts.some(
\n                (p) => p.type === "text" && "synthetic" in p && p.synthetic && p.text.startsWith("<synthesis-request>"),
\n              ) ?? false
\n
\n              if (userText.trim() && !isSynthesis) {
\n                const gateResult = yield* sensorGate.classify(userText).pipe(
\n                  Effect.catchCause((cause) =>
\n                    Effect.as(Effect.logError("Sensor gate unavailable", { cause }), null),
\n                  ),
\n                )
\n                const explicitSpawnCount = parseExplicitSpawnCount(userText)
\n                if (gateResult && !gateResult.is_social_greeting) {
\n                  const sgpResult = yield* processSensorGatePhase({
                    gateResult, explicitSpawnCount, sessionID, msgs, system, model, ctx,
                    handle, instruction, ops, piecesLTM, selfEvolve, registry, agents,
                    sessions, sensorGate, lastUser, lastUserMsg, userText, tools,
                    sensorGateFiredMap, personaRoundMap, spawnHistory, compaction,
                    isLowConfidence, spawnEval, bypassAgentCheck,
                  })
                  synthesisText = sgpResult.synthesisText
\n            }
\n            // ─── End Sensor Gate ────────────────────────────────────────
\n
\n            const extraMsgs = synthesisText
\n              ? [{ role: "user" as const, content: synthesisText }]
\n              : []
\n            const personaRound = personaRoundMap.get(sessionID) ?? 0
\n            const finalTools = personaRound >= MAX_PERSONA_ROUNDS
\n              ? Object.fromEntries(Object.entries(tools).filter(([id]) => id !== TaskTool.id)) as typeof tools
\n              : tools
\n            // Lock compaction during synthetic phase — prevents mid-response
\n            // auto-compact from truncating the context epoch. Unlocked after
\n            // process completes (ensuring block below).
\n            yield* compaction.lockCompaction;
\n            const result = yield* handle.process({
\n              user: lastUser,
\n              agent,
\n              permission: session.permission,
\n              sessionID,
\n              parentSessionID: session.parentID,
\n              system,
\n              messages: [...modelMsgs, ...extraMsgs, ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : [])],
\n              tools: finalTools,
\n              model,
\n              toolChoice: format.type === "json_schema" ? "required" : undefined,
\n            }).pipe(
\n              Effect.ensuring(compaction.unlockCompaction)
\n            )
\n
\n            if (structured !== undefined) {
\n              handle.message.structured = structured
\n              handle.message.finish = handle.message.finish ?? "stop"
\n              yield* sessions.updateMessage(handle.message)
\n              return "break" as const
\n            }
\n
\n            const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
\n            if (finished && !handle.message.error) {
\n              // Surface any content-filter finish (e.g. Anthropic stop_reason:
\n              // refusal) as an error. These turns may have produced no visible
\n              // output at all — previously the session went idle silently — or
\n              // partial text that was cut off by the provider's filter.
\n              if (handle.message.finish === "content-filter") {
\n                handle.message.error = new SessionV1.ContentFilterError({
\n                  message: "The response was blocked by the provider's content filter",
\n                }).toObject()
\n                yield* sessions.updateMessage(handle.message)
\n                yield* dieSyncError(events.publish(Session.Event.Error, { sessionID, error: handle.message.error }))
\n                return "break" as const
\n              }
\n              if (format.type === "json_schema") {
\n                handle.message.error = new SessionV1.StructuredOutputError({
\n                  message: "Model did not produce structured output",
\n                  retries: 0,
\n                }).toObject()
\n                yield* sessions.updateMessage(handle.message)
\n                return "break" as const
\n              }
\n            }
\n
\n            if (result === "stop") return "break" as const
\n            if (result === "compact") {
\n              yield* compaction.create({
\n                sessionID,
\n                agent: lastUser.agent,
\n                model: lastUser.model,
\n                auto: true,
\n                overflow: !handle.message.finish,
\n              })
\n            }
\n            return "continue" as const
\n          }).pipe(
\n            Effect.ensuring(instruction.clear(handle.message.id)),
\n            Effect.onInterrupt(() => finalizeInterruptedAssistant),
\n          )
\n          if (outcome === "break") break
\n          continue
\n        }
\n
\n        yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))
\n        return yield* lastAssistant(sessionID)
\n      },
\n    )
\n
\n    const loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts> = (Effect.fn("SessionPrompt.loop")(function* (
\n      input: LoopInput,
\n    ) {
\n      return yield* (state.ensureRunning(input.sessionID, lastAssistant(input.sessionID), runLoop(input.sessionID) as any) as any)
\n    }) as any)
\n
\n    const shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError> = Effect.fn(
\n      "SessionPrompt.shell",
\n    )(function* (input: ShellInput) {
\n      const ready = yield* Latch.make()
\n      return yield* (state.startShell(input.sessionID, lastAssistant(input.sessionID), shellImpl(input, ready), ready) as Effect.Effect<SessionV1.WithParts, Session.BusyError>)
\n    })
\n
\n    const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
\n      yield* Effect.logInfo("command", {
\n        "session.id": input.sessionID,
\n        command: input.command,
\n        agent: input.agent,
\n      })
\n      const cmd = yield* commands.get(input.command)
\n      if (!cmd) {
\n        const available = (yield* commands.list()).map((c) => c.name)
\n        const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
\n        const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
\n        yield* dieSyncError(events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() }))
\n        throw error
\n      }
\n      const agentName = cmd.agent ?? input.agent
\n
\n      const raw = input.arguments.match(argsRegex) ?? []
\n      const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
\n      const templateCommand = yield* Effect.promise(async () => cmd.template)
\n
\n      const placeholders = templateCommand.match(placeholderRegex) ?? []
\n      let last = 0
\n      for (const item of placeholders) {
\n        const value = Number(item.slice(1))
\n        if (value > last) last = value
\n      }
\n
\n      const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
\n        const position = Number(index)
\n        const argIndex = position - 1
\n        if (argIndex >= args.length) return ""
\n        if (position === last) return args.slice(argIndex).join(" ")
\n        return args[argIndex]
\n      })
\n      const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
\n      let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)
\n
\n      if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
\n        template = template + "\n\n" + input.arguments
\n      }
\n
\n      const shellMatches = ConfigMarkdown.shell(template)
\n      if (shellMatches.length > 0) {
\n        const cfg = yield* config.get()
\n        const sh = Shell.preferred(cfg.shell)
\n        const results = yield* Effect.promise(() =>
\n          Promise.all(
\n            shellMatches.map(async ([, cmd]) => (await Process.text([cmd], { shell: sh, nothrow: true })).text),
\n          ),
\n        )
\n        let index = 0
\n        template = template.replace(bashRegex, () => results[index++])
\n      }
\n      template = template.trim()
\n
\n      const taskModel = yield* Effect.gen(function* () {
\n        if (cmd.model) return Provider.parseModel(cmd.model)
\n        if (cmd.agent) {
\n          const cmdAgent = yield* agents.get(cmd.agent)
\n          if (cmdAgent?.model) return cmdAgent.model
\n        }
\n        if (input.model) return Provider.parseModel(input.model)
\n        return yield* currentModel(input.sessionID)
\n      })
\n
\n      yield* getModel(taskModel.providerID, taskModel.modelID, input.sessionID)
\n
\n      const agent = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
\n      if (!agent) {
\n        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
\n        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
\n        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
\n        yield* dieSyncError(events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() }))
\n        throw error
\n      }
\n
\n      const templateParts = yield* resolvePromptParts(template)
\n      const inputFiles = new Set(
\n        input.parts?.filter((part) => new URL(part.url).protocol === "file:").map((part) => fileURLToPath(part.url)),
\n      )
\n      const uniqueTemplateParts = templateParts.filter(
\n        (part) => part.type !== "file" || !inputFiles.has(fileURLToPath(part.url)),
\n      )
\n      const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
\n      const parts = isSubtask
\n        ? [
\n            {
\n              type: "subtask" as const,
\n              agent: agent.name,
\n              description: cmd.description ?? "",
\n              command: input.command,
\n              model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
\n              prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
\n            },
\n          ]
\n        : [...uniqueTemplateParts, ...(input.parts ?? [])]
\n
\n      const userAgent = isSubtask ? (input.agent ?? (yield* agents.defaultInfo()).name) : agent.name
\n      const userModel = isSubtask
\n        ? input.model
\n          ? Provider.parseModel(input.model)
\n          : yield* currentModel(input.sessionID)
\n        : taskModel
\n
\n      yield* plugin.trigger(
\n        "command.execute.before",
\n        { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
\n        { parts },
\n      )
\n
\n      const result = yield* prompt({
\n        sessionID: input.sessionID,
\n        messageID: input.messageID,
\n        model: userModel,
\n        agent: userAgent,
\n        parts,
\n        variant: input.variant,
\n      })
\n      yield* dieSyncError(events.publish(Command.Event.Executed, {
\n        name: input.command,
\n        sessionID: input.sessionID,
\n        arguments: input.arguments,
\n        messageID: result.info.id,
\n      }))
\n      return result
\n    })
\n
\n    return Service.of({
\n      cancel,
\n      prompt,
\n      loop,
\n      shell,
\n      command,
\n      resolvePromptParts,
\n    })
\n  }),
\n)
\n
\nexport const defaultLayer = Layer.suspend(() =>
\n  layer.pipe(
\n    Layer.provide(SessionRunState.defaultLayer),
\n    Layer.provide(SessionStatus.defaultLayer),
\n    Layer.provide(SessionCompaction.defaultLayer),
\n    Layer.provide(SessionProcessor.defaultLayer),
\n    Layer.provide(Command.defaultLayer),
\n    Layer.provide(Permission.defaultLayer),
\n    Layer.provide(MCP.defaultLayer),
\n    Layer.provide(LSP.defaultLayer),
\n    Layer.provide(ToolRegistry.defaultLayer),
\n    Layer.provide(Truncate.defaultLayer),
\n    Layer.provide(Provider.defaultLayer),
\n    Layer.provide(Config.defaultLayer),
\n    Layer.provide(Instruction.defaultLayer),
\n    Layer.provide(FSUtil.defaultLayer),
\n    Layer.provide(Plugin.defaultLayer),
\n    Layer.provide(Session.defaultLayer),
\n    Layer.provide(SessionRevert.defaultLayer),
\n    Layer.provide(SessionSummary.defaultLayer),
\n    Layer.provide(Image.defaultLayer),
\n    Layer.provide(
\n      Layer.mergeAll(
\n        Agent.defaultLayer,
\n        Database.defaultLayer,
\n        SystemPrompt.defaultLayer,
\n        LLM.defaultLayer,
\n        CrossSpawnSpawner.defaultLayer,
\n        RuntimeFlags.defaultLayer,
\n        EventV2Bridge.defaultLayer,
\n        SensorGate.defaultLayer,
\n        Skill.defaultLayer,
\n        ChainExecutor.defaultLayer,
\n        PiecesLTM.defaultLayer,
\n        ContextCompressor.defaultLayer,
\n      ),
\n    ),
\n  ),
\n)
\nconst ModelRef = Schema.Struct({
\n  providerID: ProviderV2.ID,
\n  modelID: ModelV2.ID,
\n})
\n
\nexport const PromptInput = Schema.Struct({
\n  sessionID: SessionID,
\n  messageID: Schema.optional(MessageID),
\n  model: Schema.optional(ModelRef),
\n  agent: Schema.optional(Schema.String),
\n  noReply: Schema.optional(Schema.Boolean),
\n  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
\n    description:
\n      "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
\n  }),
\n  format: Schema.optional(SessionV1.Format),
\n  system: Schema.optional(Schema.String),
\n  variant: Schema.optional(Schema.String),
\n  parts: Schema.Array(
\n    Schema.Union([
\n      SessionV1.TextPartInput,
\n      SessionV1.FilePartInput,
\n      SessionV1.AgentPartInput,
\n      SessionV1.SubtaskPartInput,
\n    ]).annotate({ discriminator: "type" }),
\n  ),
\n})
\nexport type PromptInput = Schema.Schema.Type<typeof PromptInput>
\n
\nexport class LoopInput extends Schema.Class<LoopInput>("SessionPrompt.LoopInput")({
\n  sessionID: SessionID,
\n}) {}
\n
\nexport const ShellInput = Schema.Struct({
\n  sessionID: SessionID,
\n  messageID: Schema.optional(MessageID),
\n  agent: Schema.String,
\n  model: Schema.optional(ModelRef),
\n  command: Schema.String,
\n})
\nexport type ShellInput = Schema.Schema.Type<typeof ShellInput>
\n
\nexport const CommandInput = Schema.Struct({
\n  messageID: Schema.optional(MessageID),
\n  sessionID: SessionID,
\n  agent: Schema.optional(Schema.String),
\n  model: Schema.optional(Schema.String),
\n  arguments: Schema.String,
\n  command: Schema.String,
\n  variant: Schema.optional(Schema.String),
\n  // Inlined (no identifier annotation) to keep the original SDK output — the
\n  // PromptInput call site below references FilePartInput by ref via the
\n  // Schema export in message-v2.ts.
\n  parts: Schema.optional(
\n    Schema.Array(
\n      Schema.Union([
\n        Schema.Struct({
\n          id: Schema.optional(PartID),
\n          type: Schema.Literal("file"),
\n          mime: Schema.String,
\n          filename: Schema.optional(Schema.String),
\n          url: Schema.String,
\n          source: Schema.optional(SessionV1.FilePartSource),
\n        }),
\n      ]).annotate({ discriminator: "type" }),
\n    ),
\n  ),
\n})
\nexport type CommandInput = Schema.Schema.Type<typeof CommandInput>
\n
\n/** @internal Exported for testing */
\nexport function createStructuredOutputTool(input: {
\n  schema: Record<string, any>
\n  onSuccess: (output: unknown) => void
\n}): AITool {
\n  // Remove $schema property if present (not needed for tool input)
\n  const { $schema: _, ...toolSchema } = input.schema
\n
\n  return tool({
\n    description: STRUCTURED_OUTPUT_DESCRIPTION,
\n    inputSchema: jsonSchema(toolSchema as JSONSchema7),
\n    async execute(args) {
\n      // AI SDK validates args against inputSchema before calling execute()
\n      input.onSuccess(args)
\n      return {
\n        output: "Structured output captured successfully.",
\n        title: "Structured Output",
\n        metadata: { valid: true },
\n      }
\n    },
\n    toModelOutput({ output }) {
\n      return {
\n        type: "text",
\n        value: output.output,
\n      }
\n    },
\n  })
\n}
\nconst bashRegex = /!`([^`]+)`/g
\n// Match [Image N] as single token, quoted strings, or non-space sequences
\nconst argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
\nconst placeholderRegex = /\$(\d+)/g
\nconst quoteTrimRegex = /^["']|["']$/g
\n
\nconst sensorGateNode = LayerNode.make(SensorGate.defaultLayer, [])
\nconst chainExecutorNode = LayerNode.make(ChainExecutor.defaultLayer, [])
\n
\nexport const node = (LayerNode.make as any)(layer, [
\n  SessionStatus.node,
\n  Session.node,
\n  Agent.node,
\n  Provider.node,
\n  SessionProcessor.node,
\n  SessionCompaction.node,
\n  Plugin.node,
\n  Command.node,
\n  Config.node,
\n  Permission.node,
\n  FSUtil.node,
\n  MCP.node,
\n  LSP.node,
\n  ToolRegistry.node,
\n  Truncate.node,
\n  Image.node,
\n  CrossSpawnSpawner.node,
\n  Instruction.node,
\n  SessionRunState.node,
\n  SessionRevert.node,
\n  SessionSummary.node,
\n  SystemPrompt.node,
\n  LLM.node,
\n  EventV2Bridge.node,
\n  RuntimeFlags.node,
\n  Database.node,
\n  sensorGateNode,
\n  chainExecutorNode,
\n])
\n
\nexport * as SessionPrompt from "./prompt"
