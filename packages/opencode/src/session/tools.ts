import { Agent } from "@/agent/agent"
import { ToolTaxonomy } from "./tool-taxonomy"
import { type TaskCategory, shouldIncludeTool } from "./tool-category"
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
import { recordTasteEvent } from "./prompt-taste"
import { Session } from "./session"
import { SessionProcessor } from "./processor"
import { PartID } from "./schema"
import { EffectBridge } from "@/effect/bridge"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { gateToolCall, MUTATING_TOOLS } from "./dream-gate"
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

// ─── Lazy Tool Discovery (§4.5) ─────────────────────────────────────────
// Re-running ToolJsonSchema.fromTool + ProviderTransform.schema for every
// tool on EVERY turn is pure waste: schemas are byte-stable within a model.
// Cache converted schemas per (model, tool) pair so re-resolution is O(1)
// and the emitted schema bytes stay identical turn-over-turn (KV-cache
// stability). The cache is bounded — if MCP servers hot-swap schemas, the
// entry naturally expires via FIFO eviction.
import type { JSONSchema7 } from "@ai-sdk/provider"

const SCHEMA_CACHE_MAX = 500
const schemaCache = new Map<string, JSONSchema7>()

function cachedSchema(modelApiID: string, toolId: string, build: () => JSONSchema7): JSONSchema7 {
  const key = `${modelApiID}:${toolId}`
  const hit = schemaCache.get(key)
  if (hit) return hit
  const built = build()
  schemaCache.set(key, built)
  if (schemaCache.size > SCHEMA_CACHE_MAX) {
    // FIFO eviction: drop the oldest entries (Map preserves insertion order)
    const overflow = schemaCache.size - SCHEMA_CACHE_MAX
    for (const oldest of schemaCache.keys()) {
      if (overflow <= 0) break
      schemaCache.delete(oldest)
    }
  }
  return built
}

// ─── Agent-Optimized Tool Responses (§4.1) ──────────────────────────────
// Large tool outputs waste tokens and confuse the model. Add a structured
// summary header so the model can quickly grasp the result, and provide
// a progressive disclosure hint for outputs that exceed the threshold.
// Research: Anthropic 2025 — "Structure tool outputs for the agent, not
// the user. Include only what the agent needs to make its next decision."

const AGENT_OPTIMIZED_THRESHOLD = 2000 // chars before adding summary header
const SUMMARY_HEADER_MAX = 200 // chars for the summary header

/**
 * Enhance a tool result with agent-optimized structure.
 * - Short outputs pass through unchanged.
 * - Large outputs get a structured summary header.
 */
// Progressive tool output disclosure (§4.3): progressively disclose
// tool output to avoid overwhelming the model's context window.
// For very large outputs (>10k chars), show first N lines + last M lines
// with a "[X lines omitted]" marker so the model sees both start and end.
const PROGRESSIVE_OMIT_THRESHOLD = 10_000
const PROGRESSIVE_HEAD_LINES = 30
const PROGRESSIVE_TAIL_LINES = 10

function progressiveDisclosure(toolId: string, output: string): string {
  if (!output || output.length < PROGRESSIVE_OMIT_THRESHOLD) return output
  const lines = output.split("\n")
  if (lines.length <= PROGRESSIVE_HEAD_LINES + PROGRESSIVE_TAIL_LINES + 5) return output
  const head = lines.slice(0, PROGRESSIVE_HEAD_LINES).join("\n")
  const tail = lines.slice(-PROGRESSIVE_TAIL_LINES).join("\n")
  const omitted = lines.length - PROGRESSIVE_HEAD_LINES - PROGRESSIVE_TAIL_LINES
  return [
    head,
    `\n[... ${omitted} lines omitted — full output is ${lines.length} lines]\n`,
    tail,
  ].join("\n")
}

function agentOptimizedOutput(toolId: string, output: string): string {
  if (!output || output.length < AGENT_OPTIMIZED_THRESHOLD) return output

  // Apply progressive disclosure first for very large outputs
  const disclosed = progressiveDisclosure(toolId, output)

  const lines = disclosed.split("\n")
  const firstLines = lines.slice(0, 5).join("\n").slice(0, SUMMARY_HEADER_MAX)
  const lineCount = lines.length
  const truncated = lineCount > 50 ? `, first ${Math.min(20, lineCount)} shown` : ""

  return [
    `📋 **Summary:** ${lineCount} lines${truncated}`,
    `> First output: ${firstLines.length > 100 ? firstLines.slice(0, 100) + "..." : firstLines}`,
    "",
    disclosed,
  ].join("\n")
}

// ─── Smart Tool Result Caching (§4.2) ──────────────────────────────────
// Within a single turn, the model sometimes issues identical read/glob/grep
// calls (e.g. reading the same file twice during cross-referencing). Cache
// results within the turn to save tool execution time and avoid wasting
// tokens on duplicate output.

type CacheableToolId = "read" | "grep" | "glob"
const CACHEABLE_TOOLS = new Set<string>(["read", "grep", "glob"])

function makeCacheKey(toolId: string, args: Record<string, unknown>): string {
  return `${toolId}:${JSON.stringify(args, Object.keys(args).sort())}`
}

/** Create a per-turn cache for deduplicating identical tool calls. */
export function createTurnToolCache(): Map<string, { output: string; title: string; metadata: Record<string, any> }> {
  return new Map()
}

export const resolve = Effect.fn("SessionTools.resolve")(function* (input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  processor: Pick<SessionProcessor.Handle, "message" | "accumulatedText" | "usedTree" | "markUsedTree" | "updateToolCall" | "completeToolCall">
  bypassAgentCheck: boolean
  messages: SessionV1.WithParts[]
  promptOps: TaskPromptOps
  /** Task category for dynamic tool schema injection (§1.5). When set,
   *  only tools relevant to the task are included in the schema, reducing
   *  per-request token cost by 30–70%. "full" includes everything. */
  taskCategory?: TaskCategory
}) {
  const tools: Record<string, AITool> = {}
  const run = yield* EffectBridge.make()
  const plugin = yield* Plugin.Service
  const permission = yield* Permission.Service
  const registry = yield* ToolRegistry.Service
  const mcp = yield* MCP.Service
  const truncate = yield* Truncate.Service

  // Smart tool result cache (§4.2): deduplicates identical read/glob/grep
  // calls within a single turn. Reset on each new message.
  const turnCache = createTurnToolCache()

  // Per-file gate state: the Dream Protocol gate fires once per FILE per
  // assistant message. Once a file is planned, subsequent edits to the same
  // file pass without re-blocking. A new message resets the planned set.
  const plannedFiles = new Set<string>()
  const gateState = {
    alreadyPlanned: (filePath: string) => plannedFiles.has(filePath),
    markPlanned: (filePath: string) => {
      plannedFiles.add(filePath)
    },
  }

  // Correlation tools that satisfy the tree/LSP-first requirement. A mutating
  // edit is only allowed once the model has inspected the call-graph (or read
  // the target) earlier in this turn — tree/LSP before mutation.
  const CORRELATION_TOOLS = new Set(["relations", "lsp", "grep", "glob", "read", "ast-edit"])

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
    // Lazy tool discovery (§4.5): reuse cached schema bytes per (model, tool).
    const schema = cachedSchema(input.model.api.id, item.id, () =>
      ProviderTransform.schema(input.model, ToolJsonSchema.fromTool(item)),
    )
    tools[item.id] = tool({
      description: item.description,
      inputSchema: jsonSchema(schema),
      execute(args, options) {
        return run.promise(
          Effect.gen(function* () {
            // Tool-call repair: DeepSeek-family models repeat a small set of
            // argument mistakes (null optionals, stringified arrays, bare
            // strings where arrays are expected, markdown-linked paths).
            // Repair them in-memory for execution only — the DB part keeps
            // the original args so the message prefix stays byte-identical
            // across requests (KV-cache stability). The repair note in the
            // tool result teaches the model what the correct args should be.
            const repaired = repairToolInput(item.id, args as Record<string, unknown>, schema as unknown as JsonSchema)
            const ctx = context(repaired.args as Record<string, unknown>, options)

            // Correlation-first tracking + Dream Protocol gate (execution path).
            // This is the harness's REAL enforcement point: in-process model
            // loops execute tools directly here, so the gate must live here —
            // the SDK/processor gate alone is bypassed by the CLI loop. A
            // mutating edit is blocked unless the current assistant message
            // carries a plan marker naming the file (tracked per-file via
            // gateState), and the FIRST mutating edit of a turn must follow a
            // correlation step (relations / grep / glob / read).
            if (CORRELATION_TOOLS.has(item.id)) input.processor.markUsedTree()
            let gateNudge: string | undefined = undefined
            if (MUTATING_TOOLS.has(item.id)) {
              const gateArgs = repaired.args as Record<string, unknown> | undefined
              const filePath = gateArgs?.filePath as string | undefined
              const acc = input.processor.accumulatedText
              const accText = typeof acc === "function" ? acc() : acc
              const gate = gateToolCall({
                tool: item.id,
                parts: [{ type: "text" as const, text: accText ?? "" }] as SessionV1.Part[],
                filePath,
                args: gateArgs,
                messageID: input.processor.message.id,
                worktree: input.processor.message.path?.root,
                bypassAgentCheck: input.bypassAgentCheck,
                alreadyPlanned: gateState.alreadyPlanned,
                markPlanned: gateState.markPlanned,
              })
              if (gate.kind === "block") {
                const treeNote = input.processor.usedTree()
                  ? ""
                  : "\n\nTip: Use the `relations` tool (dependentsOf / consumersOf / whoProvides) to inspect the call graph before editing."
                return {
                  title: gate.output.title,
                  metadata: { ...gate.output.metadata, treeFirst: !input.processor.usedTree() },
                  output: gate.output.output + treeNote,
                } as any
              }
              // Learned-gate nudge (plan sufficiency feedback): the plan is
              // valid but thin — let the edit run, then append the nudge to
              // the tool result so the model strengthens the plan next time.
              gateNudge = gate.nudge
            }

            // Smart tool result cache (§4.2): check cache before executing.
            // Only cache read-only, deterministic tools to avoid stale results.
            if (CACHEABLE_TOOLS.has(item.id)) {
              const cacheKey = makeCacheKey(item.id, args as Record<string, unknown>)
              const cached = turnCache.get(cacheKey)
              if (cached) {
                return {
                  ...cached,
                  metadata: { ...cached.metadata, fromCache: true, tool: item.id },
                } as any
              }
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
            // Error taxonomy (§4.4): only enrich *genuine* errors. A successful
            // tool execution (one that returned a value) must never be wrapped
            // as a failure. The previous heuristic scanned raw output for
            // substrings like "error"/"fail"/"timeout", which misclassified any
            // successful result whose content merely *mentioned* those words
            // (reading source files, docs, grep hits for "error-handling") as a
            // failure, attaching a spurious "Error in" / Category / Recovery
            // envelope. The only synthetic error built in this path is the
            // tool-timeout result below, which we enrich explicitly.
            const isSyntheticTimeout = rawResult.metadata?.["tool_timeout"] === true
            if (isSyntheticTimeout) {
              rawResult = {
                ...rawResult,
                metadata: {
                  ...rawResult.metadata,
                  error_taxonomy: true,
                  tool: item.id,
                },
                output: ToolTaxonomy.formatToolError(rawResult.output, item.id),
              } as typeof rawResult
            }
            // Agent-optimized output (§4.1): add structured summary headers
            // for large tool outputs so the model can quickly grasp the result.
            // Gate nudge (§5.2 v2) rides on the same output when the plan was
            // thin but passable.
            const optimizedResult = {
              ...rawResult,
              output: agentOptimizedOutput(item.id, rawResult.output ?? "") + (gateNudge ?? ""),
            }

            const result =
              repaired.notes.length > 0
                ? {
                    ...optimizedResult,
                    metadata: {
                      ...optimizedResult.metadata,
                      tool_input_repaired: item.id,
                    },
                    output: appendRepairNote(optimizedResult.output, repaired.notes),
                  }
                : optimizedResult
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
            // Taste: record the CLI binary for bash calls — real tool
            // preferences (Command Code learns tsup/vitest/clack, not 'bash').
            if (item.id === "bash" && typeof args === "object" && args !== null) {
              const cmd = String((args as Record<string, unknown>).command ?? "").trim()
              const binary = cmd.split(/\s+/)[0]?.replace(/^[$()]+/, "") ?? ""
              if (binary && binary.length > 1 && !binary.includes("\n")) {
                recordTasteEvent({
                  ts: Date.now(),
                  sessionID: ctx.sessionID,
                  type: "tool-use",
                  raw: binary,
                  confidence: 0.5,
                  context: `tools:used=${binary}`,
                })
              }
            }
            // Taste: observe edited/written file paths → folder structure + language signals.
            if (item.id === "edit" || item.id === "write" || item.id === "apply_patch") {
              const fpath =
                typeof args === "object" && args !== null
                  ? (args as Record<string, unknown>).filePath ?? (args as Record<string, unknown>).path
                  : undefined
              if (typeof fpath === "string" && fpath.length > 0) {
                recordTasteEvent({
                  ts: Date.now(),
                  sessionID: ctx.sessionID,
                  type: "edit",
                  raw: fpath,
                  confidence: 0.8,
                  context: `edit:file=${fpath}`,
                })
              }
            }
            // Smart tool result cache (§4.2): store result for deduplication.
            if (CACHEABLE_TOOLS.has(item.id)) {
              const cacheKey = makeCacheKey(item.id, args as Record<string, unknown>)
              turnCache.set(cacheKey, {
                output: output.output ?? "",
                title: output.title ?? "",
                metadata: output.metadata ?? {},
              })
            }

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
    // Lazy tool discovery (§4.5): cache MCP schema conversion per (model, tool).
    const transformed = cachedSchema(input.model.api.id, key, () =>
      ProviderTransform.schema(input.model, schema),
    )
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

  // KV-cache stability: sort tool schemas by ID so the byte sequence
  // is deterministic regardless of MCP/plugin load order. Any schema
  // reorder busts the prefix cache (Spheron 2026).
  let sorted = Object.fromEntries(Object.entries(tools).sort(([a], [b]) => a.localeCompare(b)))

  // Dynamic tool schema injection (§1.5): filter tools by task category
  // to reduce per-request token cost. The model can still call any tool
  // registered in the session — this only affects which schemas are sent
  // in the prompt, shrinking the schema prefix.
  const category = input.taskCategory
  if (category && category !== "full") {
    sorted = Object.fromEntries(
      Object.entries(sorted).filter(([id]) => shouldIncludeTool(id, category))
    )
  }

  return sorted
})

function appendRepairNote(output: string | undefined, notes: string[]): string {
  if (notes.length === 0) return output ?? ""
  const note = `\n\nNote: I received ${notes.join(" ")} Corrected call executed as shown.`
  return output ? `${output}${note}` : note.trimStart()
}

export * as SessionTools from "./tools"
