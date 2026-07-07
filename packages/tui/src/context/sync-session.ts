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
      diag(`session.recover() sessionID=${sessionID} — forcing re-sync`)
      return this.sync(sessionID)
    },

    async sync(sessionID: string) {
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
              // Use Object.assign to merge server data in-place, preserving
              // fields that SSE events may have set (cost, tokens) which the
              // HTTP response might still have at stale zero values.
              // Direct assignment (draft.session[match.index] = session.data)
              // replaces the entire session object, clobbering SSE-populated
              // token/cost data — same root cause that was fixed in the
              // session.updated handler (sync-handlers.ts) where Object.assign
              // was replaced with reconcile. Inside produce, we use assign
              // with explicit restore rather than reconcile.
              const oldSession = draft.session[match.index]
              const oldCost = oldSession?.cost
              const oldTokens = oldSession?.tokens
              Object.assign(oldSession, session.data)
              // Restore cost if incoming has stale zeros
              if (oldCost != null && (session.data as any)?.cost != null && (session.data as any).cost < oldCost) {
                oldSession.cost = oldCost
              }
              // Restore tokens if incoming has stale zeros
              if (oldTokens && (session.data as any)?.tokens) {
                const needsRestore =
                  (oldTokens.input != null && (session.data as any).tokens.input != null && (session.data as any).tokens.input < oldTokens.input) ||
                  (oldTokens.output != null && (session.data as any).tokens.output != null && (session.data as any).tokens.output < oldTokens.output)
                if (needsRestore) {
                  oldSession.tokens = oldTokens
                }
              }
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
            const liveMessages = currentMessages

            const preSyncLen = preSyncMessages?.length ?? 0
            const currentLen = currentMessages.length
            if (preSyncLen > 0 && currentLen < 1) {
              diag(`DRAFT-STALE: sessionID=${sessionID} preSyncMessages=${preSyncLen} currentMessages=${currentLen}`)
            } else if (preSyncLen > 0 && currentLen !== preSyncLen) {
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
            // SYNC-WIPE DIAG: log whenever the HTTP response returns
            // significantly fewer messages than the pre-sync snapshot had
            // (drops by >50% or by >10 messages). This catches stale
            // projector data regardless of whether the guard below fires.
            // Now reports using both preSyncLen and currentLen — SSE events
            // may have populated the store between capture and produce.
            const maxLen = Math.max(preSyncLen, currentLen)
            if (maxLen > 0) {
              const dropPct = 1 - visible.length / maxLen
              const dropAbs = maxLen - visible.length
              if (dropAbs > 10 || dropPct > 0.5) {
                diag(
                  `SYNC-WIPE-DROP: sessionID=${sessionID} preSyncLen=${preSyncLen} currentLen=${currentLen} serverReturned=${serverMessages.length} visible=${visible.length} dropPct=${(dropPct * 100).toFixed(0)}% dropAbs=${dropAbs} trackerMessages=${tracker.messages.size} guardCandidate=${currentLen > 0}`,
                )
              }
            }

            // ── SYNC-WIPE GUARD v2 ──────────────────────────────────
            //
            // The original guard only compared visible.length against
            // preSyncLen (the length *before* setStore was called). But
            // preSyncMessages is captured *outside* the produce callback,
            // while currentMessages reflects the state *inside* the
            // produce callback — SSE events that arrived between capture
            // and execution are visible in currentMessages but NOT in
            // preSyncMessages. This created a window where SSE data
            // would be silently wiped.
            //
            // New approach:
            //   1. Compare visible.length against max(preSyncLen, currentLen)
            //      so any SSE data that arrived between capture and produce
            //      is also protected.
            //   2. When preSyncLen was 0 but the hydration tracker has
            //      recorded messages (from SSE), never replace with empty
            //      server data — preserve the live store.
            //   3. When currentMessages has messages but visible is empty,
            //      always preserve live data regardless of preSyncLen.

            // Use the larger of preSyncLen and currentLen for comparison
            const guardLen = Math.max(preSyncLen, currentLen)

            // Check if SSE has populated messages tracked by hydration tracker
            const hasTrackedMessages = tracker.messages.size > 0

            // Check if the store genuinely has messages (either before produce or inside it)
            const storeHasMessages = currentLen > 0 || preSyncLen > 0

            // Guard 1: Server returned fewer messages than store had
            if (visible.length < guardLen) {
              diag(
                `SYNC-WIPE-PREVENTED: sessionID=${sessionID} preSyncLen=${preSyncLen} currentLen=${currentLen} guardLen=${guardLen} serverReturned=${serverMessages.length} visible=${visible.length} trackerMessages=${tracker.messages.size} preserved=${currentLen}`,
              )
              draft.message[sessionID] = currentMessages.length > 0 ? currentMessages : preSyncMessages!
              draft.session_diff[sessionID] = diff.data ?? []
              return
            }

            // Guard 2: Server returned empty but watermark tracker shows activity —
            // SSE events populated messages but preSyncLen was 0 (missed window).
            // This prevents the FIRST sync call from wiping SSE data.
            if (hasTrackedMessages && visible.length === 0 && guardLen === 0) {
              diag(
                `SYNC-WIPE-TRACKER-GUARD: sessionID=${sessionID} preSyncLen=${preSyncLen} currentLen=${currentLen} serverReturned=${serverMessages.length} trackerMessages=${tracker.messages.size} — tracker shows messages, server returned empty, preserving live data`,
              )
              draft.message[sessionID] = currentMessages
              draft.session_diff[sessionID] = diff.data ?? []
              return
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
