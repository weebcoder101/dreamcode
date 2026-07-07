import { produce, reconcile } from "solid-js/store"
import type { SyncStore, SyncSetStore, HydrationTracker } from "./sync-store"
import { diag, search } from "./sync-store"

export interface SessionSyncDeps {
  store: SyncStore
  setStore: SyncSetStore
  sdk: ReturnType<typeof import("./sdk").useSDK>
  fullSyncedSessions: Set<string>
  syncingSessions: Map<string, Promise<void>>
  hydratingSessions: Map<string, HydrationTracker>
  sessionListQuery: () => { scope?: "project"; path?: string }
  listSessions: () => Promise<import("@opencode-ai/sdk/v2").Session[]>
}

export function createSessionSync(deps: SessionSyncDeps) {
  const { store, setStore, sdk, fullSyncedSessions, syncingSessions, hydratingSessions, sessionListQuery, listSessions } =
    deps

  return {
    get(sessionID: string) {
      const match = search(store.session, sessionID, (s) => s.id)
      if (match.found) return store.session[match.index]
      return undefined
    },

    query() {
      return sessionListQuery()
    },

    async refresh() {
      const list = await listSessions()
      diag(`STORE-WRITE session.refresh sessions=${list.length} prevSessions=${store.session.length}`)
      setStore("session", reconcile(list))
    },

    status(sessionID: string): string {
      const session = this.get(sessionID)
      if (!session) return "idle"
      if (session.time.compacting) return "compacting"
      const messages = store.message[sessionID] ?? []
      const last = messages.at(-1)
      if (!last) return "idle"
      if (last.role === "user") return "working"
      return last.time.completed ? "idle" : "working"
    },

    async recover(sessionID: string) {
      fullSyncedSessions.delete(sessionID)
      diag(`session.recover() sessionID=${sessionID} — forcing re-sync`)
      return this.sync(sessionID)
    },

    async sync(sessionID: string) {
      if (fullSyncedSessions.has(sessionID)) {
        diag(`session.sync() SKIPPED — fullSyncedSessions has sessionID=${sessionID}`)
        return
      }
      const syncing = syncingSessions.get(sessionID)
      if (syncing) return syncing
      diag(`session.sync() starting sessionID=${sessionID}`)
      const tracker = { messages: new Set<string>(), parts: new Set<string>(), deletedMessages: new Set<string>() }
      hydratingSessions.set(sessionID, tracker)
      const task = (async () => {
        const [session, messages, todo, diff] = await Promise.all([
          sdk.client.session.get({ sessionID }, { throwOnError: true }),
          sdk.client.session.messages({ sessionID, limit: 100 }),
          sdk.client.session.todo({ sessionID }),
          sdk.client.session.diff({ sessionID }),
        ])
        const preSyncMessages = store.message[sessionID]
        setStore(
          produce((draft: any) => {
            const match = search(draft.session, sessionID, (s: any) => s.id)
            if (match.found) {
              draft.session[match.index] = session.data
              diag(
                `STORE-WRITE session.sync.session.session UPDATE sessionID=${sessionID} prevTitle=${(store.session[match.index] as any)?.title?.slice(0, 30) ?? ""} newTitle=${(session.data as any)?.title?.slice(0, 30) ?? ""}`,
              )
            }
            if (!match.found) {
              draft.session.splice(match.index, 0, session.data)
              diag(
                `STORE-WRITE session.sync.session.session NEW sessionID=${sessionID} title=${(session.data as any)?.title?.slice(0, 30) ?? ""}`,
              )
            }
            draft.todo[sessionID] = todo.data ?? []
            const currentMessages = draft.message[sessionID] ?? []
            const liveMessages = preSyncMessages ?? []

            const preSyncLen = preSyncMessages?.length ?? 0
            const currentLen = currentMessages.length
            if (preSyncLen >= 2 && currentLen < 2) {
              diag(`DRAFT-STALE: sessionID=${sessionID} preSyncMessages=${preSyncLen} currentMessages=${currentLen}`)
            } else if (preSyncLen >= 2 && currentLen !== preSyncLen) {
              diag(
                `DRAFT-MISMATCH: sessionID=${sessionID} preSyncMessages=${preSyncLen} currentMessages=${currentLen} diff=${currentLen - preSyncLen}`,
              )
            }

            const serverMessages = (messages.data ?? []) as any[]
            const infos = serverMessages.flatMap((message: any) => {
              if (!tracker.messages.has(message.info.id)) return [message.info]
              const current = liveMessages.find((item: any) => item.id === message.info.id)
              return current ? [current] : []
            })
            infos.push(
              ...liveMessages.filter(
                (message: any) =>
                  !infos.some((item: any) => item.id === message.id) &&
                  !tracker.deletedMessages.has(message.id),
              ),
            )
            const removed = infos.slice(0, -100)
            const visible = infos.slice(-100)

            for (let i = 0; i < visible.length; i++) {
              const msg = visible[i]
              const storeMsg = liveMessages.find((m: any) => m.id === msg.id)
              if (storeMsg) {
                visible[i] = storeMsg
              }
            }

            // SYNC-WIPE DIAG: log whenever the HTTP response returns
            // significantly fewer messages than the pre-sync snapshot had
            // (drops by >50% or by >10 messages). This catches stale
            // projector data regardless of whether the guard below fires.
            if (preSyncLen >= 2) {
              const dropPct = 1 - visible.length / preSyncLen
              const dropAbs = preSyncLen - visible.length
              if (dropAbs > 10 || dropPct > 0.5) {
                diag(
                  `SYNC-WIPE-DROP: sessionID=${sessionID} preSyncLen=${preSyncLen} serverReturned=${serverMessages.length} visible=${visible.length} dropPct=${(dropPct * 100).toFixed(0)}% dropAbs=${dropAbs} guardTriggered=${visible.length < 2 || visible.length < preSyncLen * 0.5}`,
                )
              }
            }

            // SYNC-WIPE GUARD: if the server returned fewer messages than the
            // pre-sync snapshot had, preserve the live data instead of replacing.
            // This handles the case where the server projector hasn't caught up
            // (async lag) and returns stale/partial data that would wipe messages.
            // ANY reduction in message count is suspicious — the live store has
            // more recent data from SSE events than the HTTP fetch can provide.
            if (preSyncLen >= 2 && visible.length < preSyncLen) {
              diag(
                `SYNC-WIPE-PREVENTED: sessionID=${sessionID} preSyncLen=${preSyncLen} serverReturned=${serverMessages.length} visible=${visible.length} preserved=${preSyncLen}`,
              )
              draft.message[sessionID] = preSyncMessages!
              draft.session_diff[sessionID] = diff.data ?? []
              return
            }
            if (currentMessages.length >= 2 && visible.length < 2) {
              diag(
                `SYNC-WIPE: sessionID=${sessionID} currentMessages=${currentMessages.length} serverReturned=${serverMessages.length} visible=${visible.length} trackerMessages=${tracker.messages.size} deletedMessages=${tracker.deletedMessages.size} preSyncMessages=${preSyncMessages?.length ?? 0}`,
              )
            }

            const visibleIDs = new Set(visible.map((message: any) => message.id))
            for (const message of serverMessages) {
              if (!visibleIDs.has(message.info.id)) {
                delete draft.part[message.info.id]
                continue
              }
              const currentParts = draft.part[message.info.id] ?? []
              const parts = message.parts.flatMap((part: any) => {
                const current = currentParts.find((item: any) => item.id === part.id)
                if (tracker.parts.has(part.id)) {
                  return current ? [current] : [part]
                }
                if (
                  current &&
                  (part.type === "text" || part.type === "reasoning") &&
                  (current.type === "text" || current.type === "reasoning") &&
                  part.text.length === 0 &&
                  current.text.length > 0
                ) {
                  return [current]
                }
                return [part]
              })
              parts.push(
                ...currentParts.filter(
                  (part: any) => tracker.parts.has(part.id) && !parts.some((item: any) => item.id === part.id),
                ),
              )
              draft.part[message.info.id] = parts
            }
            for (const message of removed) delete draft.part[message.id]
            diag(
              `STORE-WRITE session.sync.message sessionID=${sessionID} visible=${visible.length} serverReturned=${serverMessages.length} preSyncMessages=${preSyncMessages?.length ?? 0} trackerMessages=${tracker.messages.size} removed=${removed.length}`,
            )
            draft.message[sessionID] = visible
            draft.session_diff[sessionID] = diff.data ?? []
          }),
        )
        fullSyncedSessions.add(sessionID)
        diag(`session.sync() COMPLETE sessionID=${sessionID} messagesInStore=${store.message[sessionID]?.length ?? 0}`)
      })().finally(() => {
        syncingSessions.delete(sessionID)
        hydratingSessions.delete(sessionID)
      })
      syncingSessions.set(sessionID, task)
      return task
    },
  }
}
