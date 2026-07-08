import { createSimpleContext } from "./helper"
import { useTuiStartup } from "./runtime"
import { useKV } from "./kv"
import { useProject } from "./project"
import { useEvent } from "./event"
import { useSDK } from "./sdk"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { onCleanup, onMount } from "solid-js"
import path from "path"
import { createSyncStore, createHydrationTracker, diag } from "./sync-store"
import { createBootstrap } from "./sync-bootstrap"
import { createSessionSync } from "./sync-session"
import { registerEventHandlers } from "./sync-handlers"

export const {
  context: SyncContext,
  use: useSync,
  provider: SyncProvider,
} = createSimpleContext({
  name: "Sync",
  init: () => {
    const startup = useTuiStartup()
    const kv = useKV()
    const { store, setStore } = createSyncStore()
    const {
      fullSyncedSessions,
      syncingSessions,
      hydratingSessions,
      touchMessage,
      touchPart,
      touchDeletedMessage,
    } = createHydrationTracker()

    const event = useEvent()
    const project = useProject()
    const sdk = useSDK()
    const exit = useExit()
    const args = useArgs()

    function sessionListQuery(): { scope?: "project"; path?: string } {
      if (!kv.get("session_directory_filter_enabled", true)) return { scope: "project" }
      if (!project.data.instance.path.worktree || !project.data.instance.path.directory) return { scope: "project" }
      return {
        path: path
          .relative(path.resolve(project.data.instance.path.worktree), project.data.instance.path.directory)
          .replaceAll("\\", "/"),
      }
    }

    function listSessions() {
      return sdk.client.session
        .list({ start: Date.now() - 30 * 24 * 60 * 60 * 1000, ...sessionListQuery() })
        .then((x: any) => (x.data ?? []).toSorted((a: any, b: any) => a.id.localeCompare(b.id)))
    }

    const bootstrap = createBootstrap({ store, setStore, project, sdk, args, exit, listSessions })

    registerEventHandlers(event, {
      store,
      setStore,
      project,
      sdk,
      touchMessage,
      touchPart,
      touchDeletedMessage,
      bootstrap,
    })

    onMount(() => {
      void bootstrap()

      // Periodic snapshot: every 30s, log message counts for ALL sessions
      const snapshotInterval = setInterval(() => {
        try {
          const sessionIDs = Object.keys(store.message)
          const counts = sessionIDs
            .map((id) => `${id.slice(0, 20)}:${store.message[id]?.length ?? 0}`)
            .join(" ")
          const partKeys = Object.keys(store.part)
          const totalParts = partKeys.reduce((sum, id) => sum + (store.part[id]?.length ?? 0), 0)
          diag(
            `SNAPSHOT sessions=${store.session.length} msgKeys=${sessionIDs.length} counts=[${counts}] partKeys=${partKeys.length} totalParts=${totalParts}`,
          )
        } catch {}
      }, 30_000)
      onCleanup(() => clearInterval(snapshotInterval))
    })

    const sessionSync = createSessionSync({
      store,
      setStore,
      sdk,
      fullSyncedSessions,
      syncingSessions,
      hydratingSessions,
      sessionListQuery,
      listSessions,
    })

    return {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        if (startup.skipInitialLoading) return true
        return store.status !== "loading"
      },
      get path() {
        return project.instance.path()
      },
      session: sessionSync,
      bootstrap,
    }
  },
})
