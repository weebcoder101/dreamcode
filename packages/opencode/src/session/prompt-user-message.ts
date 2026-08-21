import { Effect, Cause, Exit, Scope, Schema } from "effect"
import { type PromptInput } from "./prompt-schemas"
import { FileAttachment, Source, AgentAttachment, Prompt } from "@opencode-ai/core/session/prompt"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionID, MessageID, PartID } from "./schema"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { eq } from "drizzle-orm"
import { ulid } from "ulid"
import { fileURLToPath } from "url"
import { decodeDataUrl } from "@/util/data-url"
import { dieSyncError } from "@/effect/sync-error"
import { NamedError } from "@opencode-ai/core/util/error"
import { Permission } from "@/permission"
import { Tool } from "@/tool/tool"
import * as DateTime from "effect/DateTime"
import { Image } from "@/image/image"
import { LSP } from "@/lsp/lsp"
import { Session } from "./session"

export var createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput & {
  sessions: any
  agents: any
  provider: Provider.Interface
  plugin: any
  events: any
  instruction: any
  mcp: any
  fsys: any
  registry: any
  lsp: LSP.Interface
  image: Image.Interface
  flags: any
  db: any
  currentModel: any
}) { return yield* Effect.scoped(
  Effect.gen(function* () {
    const { sessions, agents, provider, plugin, events, instruction, mcp, fsys, registry, lsp, image, flags, db, currentModel } = input
    const agentName = input.agent
    const ag = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
    if (!ag) {
      const available = (yield* agents.list()).filter((a: any) => !a.hidden).map((a: any) => a.name)
      const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
      const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
      yield* dieSyncError(events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() }))
      throw error
    }
    const current = yield* db
      .select({ agent: SessionTable.agent, model: SessionTable.model })
      .from(SessionTable)
      .where(eq(SessionTable.id, input.sessionID))
      .get()
      .pipe(Effect.orDie)
    const model = input.model ?? ag.model ?? (yield* currentModel(input.sessionID))
    const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
    const full = !input.variant && ag.variant && same
      ? yield* provider.getModel(model.providerID, model.modelID).pipe(
          Effect.catchIf(Provider.ModelNotFoundError.isInstance, () => Effect.succeed(undefined)),
        )
      : undefined
    const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)
    const info: SessionV1.User = {
      id: input.messageID ?? MessageID.ascending(),
      role: "user",
      sessionID: input.sessionID,
      time: { created: Date.now() },
      tools: input.tools,
      agent: ag.name,
      model: {
        providerID: model.providerID,
        modelID: model.modelID,
        variant,
      },
      system: input.system,
      format: input.format,
    }
    if (current?.agent !== info.agent) {
      yield* dieSyncError(events.publish(SessionEvent.AgentSwitched, {
        sessionID: input.sessionID,
        messageID: SessionMessage.ID.create(),
        timestamp: DateTime.makeUnsafe(info.time.created),
        agent: info.agent,
      }))
    }
    if (
      current?.model?.providerID !== info.model.providerID ||
      current.model.id !== info.model.modelID ||
      (current.model.variant === "default" ? undefined : current.model.variant) !== info.model.variant
    ) {
      yield* dieSyncError(events.publish(SessionEvent.ModelSwitched, {
        sessionID: input.sessionID,
        messageID: SessionMessage.ID.create(),
        timestamp: DateTime.makeUnsafe(info.time.created),
        model: {
          id: ModelV2.ID.make(info.model.modelID),
          providerID: ProviderV2.ID.make(info.model.providerID),
          variant: ModelV2.VariantID.make(info.model.variant ?? "default"),
        },
      }))
    }
    yield* Effect.addFinalizer(() => instruction.clear(info.id))
    type Draft<T> = T extends SessionV1.Part ? Omit<T, "id"> & { id?: string } : never
    const assign = (part: Draft<SessionV1.Part>): SessionV1.Part => ({
      ...part,
      id: part.id ? PartID.make(part.id) : PartID.ascending(),
    })
    const resolvePart = (part: any) =>
      Effect.gen(function* () {
      if (part.type === "file") {
        if (part.source?.type === "resource") {
          const { clientName, uri } = part.source
          yield* Effect.logInfo("mcp resource", { clientName, uri, mime: part.mime })
          const pieces: Draft<SessionV1.Part>[] = [
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text: `Reading MCP resource: ${part.filename} (${uri})`,
            },
          ]
          const exit = yield* mcp.readResource(clientName, uri).pipe(Effect.exit)
          if (Exit.isSuccess(exit)) {
             const content = (exit as any).value
            if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
            const items = Array.isArray(content.contents) ? content.contents : [content.contents]
            for (const c of items) {
              if ("text" in c && c.text) {
                pieces.push({
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: c.text,
                })
              } else if ("blob" in c && c.blob) {
                const mime = "mimeType" in c ? c.mimeType : part.mime
                pieces.push({
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `[Binary content: ${mime}]`,
                })
              }
            }
            pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
          } else {
            const error = Cause.squash(exit.cause)
            yield* Effect.logError("failed to read MCP resource", { error, clientName, uri })
            const message = error instanceof Error ? error.message : String(error)
            pieces.push({
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text: `Failed to read MCP resource ${part.filename}: ${message}`,
            })
          }
          return pieces
        }
        const url = new URL(part.url)
        switch (url.protocol) {
          case "data:":
            if (part.mime === "text/plain") {
              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                },
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: decodeDataUrl(part.url),
                },
                { ...part, messageID: info.id, sessionID: input.sessionID },
              ]
            }
            break
          case "file:": {
            yield* Effect.logInfo("file", { mime: part.mime })
            const filepath = fileURLToPath(part.url)
            const mime = (yield* fsys.isDir(filepath)) ? "application/x-directory" : part.mime
            const { read } = yield* registry.named()
            const execRead = (args: any, extra?: any) => {
              const controller = new AbortController()
              return read
                .execute(args, {
                  sessionID: input.sessionID,
                  abort: controller.signal,
                  agent: input.agent!,
                  messageID: info.id,
                  extra: { bypassCwdCheck: true, ...extra },
                  messages: [],
                  metadata: () => Effect.void,
                  ask: () => Effect.void,
                })
                .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
            }
            if (mime === "text/plain") {
              let offset: number | undefined
              let limit: number | undefined
              const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
              if (range.start != null) {
                const filePathURI = part.url.split("?")[0]
                let start = parseInt(range.start)
                let end = range.end ? parseInt(range.end) : undefined
                if (start === end) {
                  const symbols = yield* lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
                  for (const symbol of symbols) {
                    let r: any
                    if ("range" in symbol) r = symbol.range
                    else if ("location" in symbol) r = symbol.location.range
                    if (r?.start?.line && r?.start?.line === start) {
                      start = r.start.line
                      end = r?.end?.line ?? start
                      break
                    }
                  }
                }
                offset = Math.max(start, 1)
                if (end) limit = end - (offset - 1)
              }
              const args = { filePath: filepath, offset, limit }
              const pieces: Draft<SessionV1.Part>[] = [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                },
              ]
              const exit = yield* provider.getModel(info.model.providerID, info.model.modelID).pipe(
                Effect.flatMap((mdl: any) => execRead(args, { model: mdl })),
                Effect.exit,
              )
              if (Exit.isSuccess(exit)) {
                const result = (exit as any).value
                pieces.push({
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: result.output,
                })
                if (result.attachments?.length) {
                  pieces.push(
                    ...result.attachments.map((a: any) => ({
                      ...a,
                      synthetic: true,
                      filename: a.filename ?? part.filename,
                      messageID: info.id,
                      sessionID: input.sessionID,
                    })),
                  )
                } else {
                  pieces.push({ ...part, mime, messageID: info.id, sessionID: input.sessionID })
                }
              } else {
                const error = Cause.squash(exit.cause)
                yield* Effect.logError("failed to read file", { error, filepath })
                const message = error instanceof Error ? error.message : String(error)
                yield* dieSyncError(events.publish(Session.Event.Error, {
                  sessionID: input.sessionID,
                  error: new NamedError.Unknown({ message }).toObject(),
                }))
                pieces.push({
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                })
              }
              return pieces
            }
            if (mime === "application/x-directory") {
              const args = { filePath: filepath }
              const exit = yield* execRead(args).pipe(Effect.exit)
              if (Exit.isFailure(exit)) {
                const error = Cause.squash(exit.cause)
                yield* Effect.logError("failed to read directory", { error, filepath })
                const message = error instanceof Error ? error.message : String(error)
                yield* dieSyncError(events.publish(Session.Event.Error, {
                  sessionID: input.sessionID,
                  error: new NamedError.Unknown({ message }).toObject(),
                }))
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  },
                ]
              }
              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                },
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: exit.value.output,
                },
                { ...part, mime, messageID: info.id, sessionID: input.sessionID },
              ]
            }
            return [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
              },
              {
                id: part.id,
                messageID: info.id,
                sessionID: input.sessionID,
                type: "file",
                url: `data:${mime};base64,` + Buffer.from(yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die))).toString("base64"),
                mime,
                filename: part.filename!,
                source: part.source,
              },
            ]
          }
        }
      }
      if (part.type === "agent") {
        const perm = Permission.evaluate("task", part.name, ag.permission)
        const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
        return [
          { ...part, messageID: info.id, sessionID: input.sessionID },
          {
            messageID: info.id,
            sessionID: input.sessionID,
            type: "text",
            synthetic: true,
            text: " Use the above message and context to generate a prompt and call the task tool with subagent: " + part.name + hint,
          },
        ]
      }
      return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
    })
    const resolvedParts = yield* Effect.forEach(input.parts, resolvePart, { concurrency: "unbounded" }).pipe(
      Effect.map((x: any) => x.flat().map(assign)),
    )
    yield* plugin.trigger(
      "chat.message",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        messageID: input.messageID,
        variant: input.variant,
      },
      { message: info, parts: resolvedParts },
    )
    const parts = yield* Effect.forEach(resolvedParts, (part: any) =>
      part.type === "file" && part.mime.startsWith("image/")
        ? image.normalize(part).pipe(
            Effect.catchIf(
              (error: any) => error instanceof Image.ResizerUnavailableError,
              () => Effect.succeed(part),
            ),
          )
        : Effect.succeed(part),
    )
    const decodeMessageInfo = Schema.decodeUnknownExit(SessionV1.Info)
    const decodeMessagePart = Schema.decodeUnknownExit(SessionV1.Part)
    const parsed = decodeMessageInfo(info, { errors: "all", propertyOrder: "original" })
    if (Exit.isFailure(parsed)) {
      yield* Effect.logError("invalid user message before save", {
        sessionID: input.sessionID,
        messageID: info.id,
        agent: info.agent,
        model: info.model,
        cause: Cause.pretty(parsed.cause),
      })
    }
    for (const [index, part] of parts.entries()) {
      const p = decodeMessagePart(part, { errors: "all", propertyOrder: "original" })
      if (Exit.isSuccess(p)) continue
      yield* Effect.logError("invalid user part before save", {
        sessionID: input.sessionID,
        messageID: info.id,
        partID: part.id,
        partType: part.type,
        index,
        cause: Cause.pretty(p.cause),
        part,
      })
    }
    yield* sessions.updateMessage(info)
    for (const part of parts) yield* sessions.updatePart(part)
    const nextPrompt = parts.reduce(
      (result: any, part: any) => {
        if (part.type === "text") {
          if (part.synthetic) result.synthetic.push(part.text)
          else result.text.push(part.text)
        }
        if (part.type === "file") {
          result.files.push(
            new FileAttachment({
              uri: part.url,
              mime: part.mime,
              name: part.filename,
              source: part.source
                ? new Source({
                    start: part.source.text.start,
                    end: part.source.text.end,
                    text: part.source.text.value,
                  })
                : undefined,
            }),
          )
        }
        if (part.type === "agent") {
          result.agents.push(
            new AgentAttachment({
              name: part.name,
              source: part.source
                ? new Source({
                    start: part.source.start,
                    end: part.source.end,
                    text: part.source.value,
                  })
                : undefined,
            }),
          )
        }
        return result
      },
      {
        text: [] as string[],
        files: [] as FileAttachment[],
        agents: [] as AgentAttachment[],
        synthetic: [] as string[],
      },
    )
    if (flags.experimentalEventSystem) {
      yield* dieSyncError(events.publish(SessionEvent.Prompted, {
        sessionID: input.sessionID,
        messageID: SessionMessage.ID.create(),
        timestamp: DateTime.makeUnsafe(info.time.created),
        delivery: "steer",
        prompt: new Prompt({
          text: nextPrompt.text.join("\n"),
          files: nextPrompt.files,
          agents: nextPrompt.agents,
        }),
      }))
    }
    for (const text of nextPrompt.synthetic) {
      if (flags.experimentalEventSystem) {
        yield* dieSyncError(events.publish(SessionEvent.Synthetic, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: DateTime.makeUnsafe(info.time.created),
          text,
        }))
      }
    }
    return { info, parts }
  }),
)})
