import { produce, reconcile } from "solid-js/store"
import { batch } from "solid-js"
import type { SyncStore, SyncSetStore } from "./sync-store"
import { diag, search } from "./sync-store"
import type { AssistantMessage, Part } from "@opencode-ai/sdk/v2"

export interface HandlersDeps {
  store: SyncStore
  setStore: SyncSetStore
  project: ReturnType<typeof import("./project").useProject>
  sdk: ReturnType<typeof import("./sdk").useSDK>
  touchMessage: (sessionID: string, messageID: string) => void
  touchPart: (sessionID: string, partID: string) => void
  touchDeletedMessage: (sessionID: string, messageID: string) => void
  bootstrap: (input?: { fatal?: boolean }) => Promise<void>
}

export function registerEventHandlers(
  event: ReturnType<typeof import("./event").useEvent>,
  deps: HandlersDeps,
) {
  const { store, setStore, project, sdk, touchMessage, touchPart, touchDeletedMessage, bootstrap } = deps

  event.subscribe((event: any, { workspace }: any) => {
    switch (event.type) {
      case "server.instance.disposed": {
        const hasActiveGeneration = Object.values(store.session_status).some(
          (s: any) => s.type === "busy" || s.type === "retry",
        )
        const hasSessionMessages = Object.keys(store.message).length > 0
        const hasAnySessions = store.session.length > 0
        if (hasActiveGeneration || hasSessionMessages || hasAnySessions) {
          diag(
            `server.instance.disposed SUPPRESSED — activeGen=${hasActiveGeneration} sessionMsgs=${hasSessionMessages} anySessions=${hasAnySessions} sessions=${store.session.length} msgKeys=${Object.keys(store.message).length}`,
          )
          break
        }
        diag(
          `server.instance.disposed FIRING bootstrap — activeGen=${hasActiveGeneration} sessionMsgs=${hasSessionMessages} anySessions=${hasAnySessions}`,
        )
        void bootstrap()
        break
      }

      case "permission.replied": {
        const requests = store.permission[event.properties.sessionID]
        if (!requests) break
        const match = search(requests, event.properties.requestID, (r: any) => r.id)
        if (!match.found) break
        setStore("permission", event.properties.sessionID, produce((draft: any) => { draft.splice(match.index, 1) }))
        break
      }

      case "permission.asked": {
        const request = event.properties
        const requests = store.permission[request.sessionID]
        if (!requests) {
          setStore("permission", request.sessionID, [request])
          break
        }
        const match = search(requests, request.id, (r: any) => r.id)
        if (match.found) {
          setStore("permission", request.sessionID, match.index, reconcile(request))
          break
        }
        setStore("permission", request.sessionID, produce((draft: any) => { draft.splice(match.index, 0, request) }))
        break
      }

      case "question.replied":
      case "question.rejected": {
        const requests = store.question[event.properties.sessionID]
        if (!requests) break
        const match = search(requests, event.properties.requestID, (r: any) => r.id)
        if (!match.found) break
        setStore("question", event.properties.sessionID, produce((draft: any) => { draft.splice(match.index, 1) }))
        break
      }

      case "question.asked": {
        const request = event.properties
        const requests = store.question[request.sessionID]
        if (!requests) {
          setStore("question", request.sessionID, [request])
          break
        }
        const match = search(requests, request.id, (r: any) => r.id)
        if (match.found) {
          setStore("question", request.sessionID, match.index, reconcile(request))
          break
        }
        setStore("question", request.sessionID, produce((draft: any) => { draft.splice(match.index, 0, request) }))
        break
      }

      case "todo.updated":
        setStore("todo", event.properties.sessionID, event.properties.todos)
        break

      case "session.diff":
        setStore("session_diff", event.properties.sessionID, event.properties.diff)
        break

      case "session.deleted": {
        diag(
          `session.deleted id=${event.properties.info.id} title="${(event.properties.info.title ?? "").slice(0, 60)}"`,
        )
        const result = search(store.session, event.properties.info.id, (s: any) => s.id)
        if (result.found) {
          setStore("session", produce((draft: any) => { draft.splice(result.index, 1) }))
        }
        break
      }

      case "session.updated": {
        diag(
          `session.updated id=${event.properties.info.id} title="${(event.properties.info.title ?? "").slice(0, 60)}" cost=${event.properties.info.cost ?? "?"} tokensInput=${event.properties.info.tokens?.input ?? "?"}`,
        )
        const result = search(store.session, event.properties.info.id, (s: any) => s.id)
        if (result.found) {
          // MERGE instead of replace: preserve higher cost/tokens from live state.
          // patch() reads stale DB state (cost: 0) before projector accumulates
          // subagent costs. The event carries stale zeros — we must not overwrite
          // correct live values with them.
          setStore("session", result.index, produce((draft: any) => {
            const incoming = event.properties.info
            Object.assign(draft, incoming)
            // Preserve higher cost/tokens — never regress
            if (incoming.cost != null && draft.cost != null && incoming.cost < draft.cost) {
              draft.cost = draft.cost
            }
            if (incoming.tokens?.input != null && draft.tokens?.input != null && incoming.tokens.input < draft.tokens.input) {
              draft.tokens = draft.tokens
            }
            if (incoming.tokens?.output != null && draft.tokens?.output != null && incoming.tokens.output < draft.tokens.output) {
              draft.tokens = draft.tokens
            }
          }))
          break
        }
        setStore("session", produce((draft: any) => { draft.splice(result.index, 0, event.properties.info) }))
        break
      }

      case "session.next.moved": {
        const result = search(store.session, event.properties.sessionID, (s: any) => s.id)
        if (!result.found) break
        diag(
          `STORE-WRITE session.next.moved sessionID=${event.properties.sessionID} dir=${event.properties.location.directory}`,
        )
        setStore("session", result.index, produce((session: any) => {
          session.directory = event.properties.location.directory
          session.path = event.properties.subdirectory
          session.workspaceID = event.properties.location.workspaceID
          session.time.updated = event.properties.timestamp
        }))
        break
      }

      case "session.status": {
        diag(`session.status sessionID=${event.properties.sessionID} type=${event.properties.status.type}`)
        setStore("session_status", event.properties.sessionID, event.properties.status)
        break
      }

      case "message.removed": {
        touchMessage(event.properties.sessionID, event.properties.messageID)
        touchDeletedMessage(event.properties.sessionID, event.properties.messageID)
        const messages = store.message[event.properties.sessionID]
        const beforeCount = messages?.length ?? 0
        const result = search(messages, event.properties.messageID, (m: any) => m.id)
        if (result.found) {
          diag(
            `message.removed sessionID=${event.properties.sessionID} messageID=${event.properties.messageID} beforeCount=${beforeCount}`,
          )
          setStore("message", event.properties.sessionID, produce((draft: any) => { draft.splice(result.index, 1) }))
        }
        break
      }

      case "message.updated": {
        touchMessage(event.properties.info.sessionID, event.properties.info.id)
        const messages = store.message[event.properties.info.sessionID]
        if (!messages) {
          diag(
            `STORE-WRITE message.updated.new sessionID=${event.properties.info.sessionID} messageID=${event.properties.info.id} role=${event.properties.info.role}`,
          )
          setStore("message", event.properties.info.sessionID, [event.properties.info])
          break
        }
        const result = search(messages, event.properties.info.id, (m: any) => m.id)
        if (result.found) {
          const msg = event.properties.info
          const cost = "cost" in msg ? (msg as AssistantMessage).cost : "?"
          const tokensIn = "tokens" in msg ? (msg as AssistantMessage).tokens?.input : "?"
          const tokensOut = "tokens" in msg ? (msg as AssistantMessage).tokens?.output : "?"
          diag(
            `STORE-WRITE message.updated.reconcile sessionID=${msg.sessionID} messageID=${msg.id} role=${msg.role} cost=${cost} tokens=${tokensIn}/${tokensOut}`,
          )
          setStore("message", event.properties.info.sessionID, result.index, reconcile(event.properties.info))
          break
        }
        diag(
          `STORE-WRITE message.updated.splice sessionID=${event.properties.info.sessionID} messageID=${event.properties.info.id} role=${event.properties.info.role} beforeCount=${messages.length}`,
        )
        setStore(
          "message",
          event.properties.info.sessionID,
          produce((draft: any) => { draft.splice(result.index, 0, event.properties.info) }),
        )
        const updated = store.message[event.properties.info.sessionID]
        if (updated && updated.length > 200) {
          const oldest = updated[0]
          diag(
            `message.updated 200-LIMIT-SHIFT sessionID=${event.properties.info.sessionID} messageID=${(oldest as any).id} incomingID=${event.properties.info.id} role=${event.properties.info.role} count=${updated.length}`,
          )
          const beforeShiftCount = updated.length
          batch(() => {
            setStore("message", event.properties.info.sessionID, produce((draft: any) => { draft.shift() }))
            diag(
              `STORE-WRITE message.updated.shift.part messageID=${(oldest as any).id} — deleted parts for shifted message`,
            )
            setStore("part", produce((draft: any) => { delete draft[(oldest as any).id] }))
          })
          const afterShift = store.message[event.properties.info.sessionID]
          if (afterShift) {
            diag(
              `message.updated 200-LIMIT-AFTER sessionID=${event.properties.info.sessionID} beforeLen=${beforeShiftCount} afterLen=${afterShift.length}`,
            )
          }
        }
        break
      }

      case "message.part.updated": {
        touchPart(event.properties.part.sessionID, event.properties.part.id)
        const parts = store.part[event.properties.part.messageID]
        if (!parts) {
          setStore("part", event.properties.part.messageID, [event.properties.part])
          break
        }
        const result = search(parts, event.properties.part.id, (p: any) => p.id)
        if (result.found) {
          setStore("part", event.properties.part.messageID, result.index, reconcile(event.properties.part))
          break
        }
        setStore("part", event.properties.part.messageID, produce((draft: any) => { draft.splice(result.index, 0, event.properties.part) }))
        break
      }

      case "message.part.delta": {
        let parts = store.part[event.properties.messageID]
        if (!parts) {
          const stub: Part = {
            id: event.properties.partID,
            messageID: event.properties.messageID,
            type: "text",
            sessionID: event.properties.sessionID,
            text: "",
          } as Part
          setStore("part", event.properties.messageID, [stub])
          parts = store.part[event.properties.messageID]
        }
        const result = search(parts, event.properties.partID, (p: any) => p.id)
        if (!result.found) {
          break
        }
        touchPart(event.properties.sessionID, event.properties.partID)
        setStore("part", event.properties.messageID, produce((draft: any) => {
          const part = draft[result.index]
          const field = event.properties.field
          const existing = part[field] ?? ""
          part[field] = existing + event.properties.delta
        }))
        break
      }

      case "message.part.removed": {
        touchPart(event.properties.sessionID, event.properties.partID)
        const parts = store.part[event.properties.messageID]
        const result = search(parts, event.properties.partID, (p: any) => p.id)
        if (result.found) {
          setStore("part", event.properties.messageID, produce((draft: any) => { draft.splice(result.index, 1) }))
        }
        break
      }

      case "lsp.updated": {
        const workspace = project.workspace.current()
        void sdk.client.lsp.status({ workspace }).then((x: any) => setStore("lsp", x.data ?? []))
        break
      }

      case "vcs.branch.updated": {
        if (workspace === project.workspace.current()) {
          setStore("vcs", { branch: event.properties.branch })
        }
        break
      }
    }
  })
}
