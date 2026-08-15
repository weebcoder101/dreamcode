import { Agent } from "@/agent/agent"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Tool } from "@/tool/tool"
import { ToolJsonSchema } from "@/tool/json-schema"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"

import { Plugin } from "@/plugin"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
import { Effect } from "effect"
import { MessageV2 } from "./message-v2"
import { recordTasteEvent } from "./prompt-taste"
import { Session } from "./session"
import { SessionProcessor } from "./processor"
import { PartID } from "./schema"
import { EffectBridge } from "@/effect/bridge"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { gateToolCall } from "./dream-gate"
import { repairToolInput, type JsonSchema } from "./tool-repair"
import { deadline, timeoutOf } from "@/util/timeout"

// Per-tool timeout ceilings (ms). A hung tool must never hang the whole turn:
// the deadline converts a stuck execution into a structured, recoverable
// TOOL_TIMEOUT result the model can react to. Mirrors DeepSeek Harness
// guard/timeout-policy.
const TOOL_TIMEOUT_MS: Record<string, number> = {
  bash: 300_000,
  task: 900_000,
  apply_patch: 120_000,
  patch: 120_000,
  edit: 120_000,
  write: 120_000,
  webfetch: 60_000,
  websearch: 60_000,
}
const TOOL_TIMEOUT_DEFAULT_MS = 300_000
const TOOL_TIMEOUT_CODE = "TOOL_TIMEOUT"

export const resolve = Effect.fn("SessionTools.resolve")(function* (input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  processor: Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">
  bypassAgentCheck: boolean
  messages: SessionV1.WithParts[]
  promptOps: TaskPromptOps
}) {
  const tools: Record<string, AITool> = {}
  const run = yield* EffectBridge.make()
  const plugin = yield* Plugin.Service
  const permission = yield* Permission.Service
  const registry = yield* ToolRegistry.Service
  const mcp = yield* MCP.Service
  const truncate = yield* Truncate.Service

  // Per-assistant-message gate state: the Dream Protocol gate fires at most
  // once per message (a course-correction signal, never a deadlock).
  let dreamGated = false
  const gateState = {
    alreadyGated: () => dreamGated,
    markGated: () => {
      dreamGated = true
    },
  }

  const context = (args: Record<string, unknown>, options: ToolExecutionOptions): Tool.Context => ({
    sessionID: input.session.id,
    abort: options.abortSignal!,
    messageID: input.processor.message.id,
    callID: options.toolCallId ?? "",
    extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck, promptOps: input.promptOps },
    agent: input.agent.name,
    messages: input.messages,
    metadata: (val) =>
      input.processor.updateToolCall(options.toolCallId ?? "", (match) => {
        if (!["running", "pending"].includes(match.state.status)) return match
        return {
          ...match,
          state: {
            title: val.title,
            metadata: val.metadata,
            status: "running",
            input: args,
            time: { start: Date.now() },
          },
        }
      }),
    ask: (req) =>
      permission
        .ask({
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId ?? "" },
          ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
        })
        .pipe(Effect.orDie),
  })

  for (const item of yield* registry.tools({
    modelID: ModelV2.ID.make(input.model.api.id),
    providerID: input.model.providerID,
    agent: input.agent,
  })) {
    if (input.promptOps.disableTaskTool && item.id === TaskTool.id) continue
    const schema = ProviderTransform.schema(input.model, ToolJsonSchema.fromTool(item))
    tools[item.id] = tool({
      description: item.description,
      inputSchema: jsonSchema(schema),
      execute(args, options) {
        return run.promise(
          Effect.gen(function* () {
            // Live parts read at gate time: text parts stream into the DB as
            // the assistant message is generated, so a DB read here sees the
            // plan text the model already emitted. input.messages is a
            // pre-stream snapshot and never contains the current message.
            const gateParts = yield* MessageV2.parts(input.processor.message.id).pipe(
              Effect.catch(() => Effect.succeed([] as SessionV1.Part[])),
            )
            const gate = gateToolCall({
              tool: item.id,
              parts: gateParts,
              bypassAgentCheck: input.bypassAgentCheck,
              ...gateState,
            })
            if (gate.kind === "block") {
              yield* input.processor.completeToolCall(options.toolCallId ?? "", gate.output)
              return gate.output
            }
            // Tool-call repair: DeepSeek-family models repeat a small set of
            // argument mistakes (null optionals, stringified arrays, bare
            // strings where arrays are expected, markdown-linked paths).
            // Repair them after the model produces them; tag the result so
            // the model learns for next time.
            const repaired = repairToolInput(item.id, args as Record<string, unknown>, schema as unknown as JsonSchema)
            const ctx = context(repaired.args as Record<string, unknown>, options)
            if (repaired.notes.length > 0) {
              yield* input.processor.updateToolCall(options.toolCallId ?? "", (match) => {
                if (!["running", "pending"].includes(match.state.status)) return match
                return {
                  ...match,
                  state: {
                    ...match.state,
                    input: repaired.args,
                  },
                } as SessionV1.ToolPart
              })
            }
            yield* plugin.trigger(
              "tool.execute.before",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID ?? "" },
              { args },
            )
            // Tool timeout enforcement: a hung tool must never hang the turn.
            // Arm a deadline on the tool's signal; if OUR timer wins, replace
            // the result with a structured TOOL_TIMEOUT error the model can
            // recover from. The upstream signal is restored afterwards.
            const timeoutMs = TOOL_TIMEOUT_MS[item.id] ?? TOOL_TIMEOUT_DEFAULT_MS
            const d = deadline(options.abortSignal, timeoutMs, TOOL_TIMEOUT_CODE)
            let rawResult: Effect.Success<ReturnType<typeof item.execute>>
            try {
              rawResult = yield* item.execute(repaired.args, { ...ctx, abort: d.signal } as any)
              if (timeoutOf(d, TOOL_TIMEOUT_CODE) !== undefined) {
                rawResult = {
                  title: `Tool timed out after ${timeoutMs}ms`,
                  metadata: { tool_timeout: true, timeoutMs, tool: item.id },
                  output: `Error: tool call "${item.id}" timed out after ${timeoutMs}ms. The operation was aborted. Diagnose why (is the command waiting for input? does it need a flag?) and try a focused alternative — do NOT retry the identical call.`,
                } as any
              }
            } finally {
              d[Symbol.dispose]()
            }
            const result =
              repaired.notes.length > 0
                ? {
                    ...rawResult,
                    metadata: {
                      ...rawResult.metadata,
                      tool_input_repaired: item.id,
                    },
                    output: appendRepairNote(rawResult.output, repaired.notes),
                  }
                : rawResult
            const output = {
              ...result,
              attachments: result.attachments?.map((attachment) => ({
                ...attachment,
                id: PartID.ascending(),
                sessionID: ctx.sessionID,
                messageID: input.processor.message.id,
              })),
            }
            yield* plugin.trigger(
              "tool.execute.after",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID ?? "", args },
              output,
            )
            // Taste: record tool usage (non-mutating, cheap append).
            recordTasteEvent({
              ts: Date.now(),
              sessionID: ctx.sessionID,
              type: "tool-use",
              raw: item.id,
              confidence: 0.5,
              context: `tools:used=${item.id}`,
            })
            if (options.abortSignal?.aborted) {
              yield* input.processor.completeToolCall(options.toolCallId ?? "", output)
            }
            return output
          }),
        )
      },
    })
  }

  for (const [key, item] of Object.entries(yield* mcp.tools())) {
    const execute = item.execute
    if (!execute) continue

    const schema = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
    const transformed = ProviderTransform.schema(input.model, schema)
    item.inputSchema = jsonSchema(transformed)
    item.execute = (args, opts) =>
      run.promise(
        Effect.gen(function* () {
          const ctx = context(args, opts)
          yield* plugin.trigger(
            "tool.execute.before",
            { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId },
            { args },
          )
          const result: Awaited<ReturnType<NonNullable<typeof execute>>> = yield* Effect.gen(function* () {
            yield* ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })
            return yield* Effect.promise(() => execute(args, opts))
          }).pipe(
            Effect.withSpan("Tool.execute", {
              attributes: {
                "tool.name": key,
                "tool.call_id": opts.toolCallId,
                "session.id": ctx.sessionID,
                "message.id": input.processor.message.id,
              },
            }),
          )
          yield* plugin.trigger(
            "tool.execute.after",
            { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
            result,
          )

          const textParts: string[] = []
          const attachments: Omit<SessionV1.FilePart, "id" | "sessionID" | "messageID">[] = []
          for (const contentItem of result.content) {
            if (contentItem.type === "text") textParts.push(contentItem.text)
            else if (contentItem.type === "image") {
              attachments.push({
                type: "file",
                mime: contentItem.mimeType,
                url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
              })
            } else if (contentItem.type === "resource") {
              const { resource } = contentItem
              if (resource.text) textParts.push(resource.text)
              if (resource.blob) {
                attachments.push({
                  type: "file",
                  mime: resource.mimeType ?? "application/octet-stream",
                  url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                  filename: resource.uri,
                })
              }
            }
          }

          const truncated = yield* truncate.output(textParts.join("\n\n"), {}, input.agent)
          const metadata = {
            ...result.metadata,
            truncated: truncated.truncated,
            ...(truncated.truncated && { outputPath: truncated.outputPath }),
          }

          const output = {
            title: "",
            metadata,
            output: truncated.content,
            attachments: attachments.map((attachment) => ({
              ...attachment,
              id: PartID.ascending(),
              sessionID: ctx.sessionID,
              messageID: input.processor.message.id,
            })),
            content: result.content,
          }
          if (opts.abortSignal?.aborted) {
            yield* input.processor.completeToolCall(opts.toolCallId, output)
          }
          return output
        }),
      )
    tools[key] = item
  }

  return tools
})

function appendRepairNote(output: string | undefined, notes: string[]): string {
  if (notes.length === 0) return output ?? ""
  const note = `\n\nNote: I received ${notes.join(" ")} Corrected call executed as shown.`
  return output ? `${output}${note}` : note.trimStart()
}

export * as SessionTools from "./tools"
