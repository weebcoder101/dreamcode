import { reconcile } from "solid-js/store"
import { batch } from "solid-js"
import type { SyncStore, SyncSetStore } from "./sync-store"
import { diag, search, emptyConsoleState } from "./sync-store"

export interface BootstrapDeps {
  store: SyncStore
  setStore: SyncSetStore
  project: ReturnType<typeof import("./project").useProject>
  sdk: ReturnType<typeof import("./sdk").useSDK>
  args: ReturnType<typeof import("./args").useArgs>
  exit: ReturnType<typeof import("./exit").useExit>
  listSessions: () => Promise<import("@opencode-ai/sdk/v2").Session[]>
}

export function createBootstrap(deps: BootstrapDeps) {
  const { store, setStore, project, sdk, args, exit, listSessions } = deps

  async function bootstrap(input: { fatal?: boolean } = {}) {
    diag(
      `bootstrap() STARTING — store.sessions=${store.session.length} store.message.keys=${Object.keys(store.message).length}`,
    )
    const fatal = input.fatal ?? true
    const workspace = project.workspace.current()
    const projectPromise = project.sync()
    const sessionListPromise = projectPromise.then(() => listSessions())

    // blocking - include session.list when continuing a session
    const providersPromise = sdk.client.config.providers({ workspace }, { throwOnError: true })
    const providerListPromise = sdk.client.provider.list({ workspace }, { throwOnError: true })
    const consoleStatePromise = sdk.client.experimental.console
      .get({ workspace }, { throwOnError: true })
      .then((x: any) => x.data)
      .catch(() => emptyConsoleState)
    const agentsPromise = sdk.client.app.agents({ workspace }, { throwOnError: true })
    const configPromise = sdk.client.config.get({ workspace }, { throwOnError: true })
    await Promise.all([
      providersPromise,
      providerListPromise,
      agentsPromise,
      configPromise,
      projectPromise,
      ...(args.continue ? [sessionListPromise] : []),
    ])
      .then(async () => {
        const providersResponse = providersPromise.then((x: any) => x.data!)
        const providerListResponse = providerListPromise.then((x: any) => x.data!)
        const consoleStateResponse = consoleStatePromise
        const agentsResponse = agentsPromise.then((x: any) => x.data ?? [])
        const configResponse = configPromise.then((x: any) => x.data!)
        const sessionListResponse = args.continue ? sessionListPromise : undefined

        return Promise.all([
          providersResponse,
          providerListResponse,
          consoleStateResponse,
          agentsResponse,
          configResponse,
          ...(sessionListResponse ? [sessionListResponse] : []),
        ]).then((responses) => {
          const providers = responses[0]
          const providerList = responses[1]
          const consoleState = responses[2]
          const agents = responses[3]
          const config = responses[4]
          const sessions = responses[5]

          batch(() => {
            setStore("provider", reconcile(providers.providers))
            setStore("provider_default", reconcile(providers.default))
            setStore("provider_next", reconcile(providerList))
            setStore("console_state", reconcile(consoleState))
            setStore("agent", reconcile(agents))
            setStore("config", reconcile(config))
            if (sessions !== undefined) {
              // Preserve sessions that have local messages to prevent
              // wiping out active sessions during instance disposal.
              const sessionsWithLocalMessages = new Set(
                Object.keys(store.message).filter((k) => (store.message[k]?.length ?? 0) > 0),
              )
              if (sessionsWithLocalMessages.size > 0) {
                const serverIds = new Set(sessions.map((s: any) => s.id))
                const preservedLocal = store.session.filter(
                  (s: any) => sessionsWithLocalMessages.has(s.id) && !serverIds.has(s.id),
                )
                // For sessions that exist on BOTH server and locally,
                // merge them — preserve higher cost/tokens from local state.
                const merged = sessions.map((serverSession: any) => {
                  const local = store.session.find((s: any) => s.id === serverSession.id)
                  if (!local) return serverSession
                  // Preserve higher cost/tokens from local (live SSE data)
                  // Server may have stale cost: 0 if projector hasn't caught up
                  return {
                    ...serverSession,
                    cost: Math.max(serverSession.cost ?? 0, local.cost ?? 0),
                    tokens: {
                      input: Math.max(serverSession.tokens?.input ?? 0, local.tokens?.input ?? 0),
                      output: Math.max(serverSession.tokens?.output ?? 0, local.tokens?.output ?? 0),
                      reasoning: Math.max(serverSession.tokens?.reasoning ?? 0, local.tokens?.reasoning ?? 0),
                    },
                  }
                })
                diag(
                  `STORE-WRITE bootstrap.blocking.session sessionID=${Array.from(serverIds).slice(0, 3).join(",")} serverCount=${sessions.length} localWithMsgs=${sessionsWithLocalMessages.size} preservedLocal=${preservedLocal.length}`,
                )
                setStore("session", reconcile([...merged, ...preservedLocal]))
              } else {
                diag(
                  `STORE-WRITE bootstrap.blocking.session sessions=${sessions.length} prevSessions=${store.session.length}`,
                )
                setStore("session", reconcile(sessions))
              }
            }
          })
        })
      })
      .then(() => {
        if (store.status !== "complete") setStore("status", "partial")
        diag(
          `bootstrap() COMPLETE — store.sessions=${store.session.length} store.message.keys=${Object.keys(store.message).length} status=${store.status}`,
        )
        // non-blocking
        void Promise.all([
          ...(args.continue
            ? []
            : [
                sessionListPromise.then((sessions: any) => {
                  const sessionsWithLocalMessages = new Set(
                    Object.keys(store.message).filter((k) => (store.message[k]?.length ?? 0) > 0),
                  )
                  if (sessionsWithLocalMessages.size > 0) {
                    const serverIds = new Set(sessions.map((s: any) => s.id))
                    const preservedLocal = store.session.filter(
                      (s: any) => sessionsWithLocalMessages.has(s.id) && !serverIds.has(s.id),
                    )
                    diag(
                      `STORE-WRITE bootstrap.nonblocking.session serverCount=${sessions.length} localWithMsgs=${sessionsWithLocalMessages.size} preservedLocal=${preservedLocal.length}`,
                    )
                    setStore("session", reconcile([...sessions, ...preservedLocal]))
                  } else {
                    diag(
                      `STORE-WRITE bootstrap.nonblocking.session sessions=${sessions.length} prevSessions=${store.session.length}`,
                    )
                    setStore("session", reconcile(sessions))
                  }
                }),
              ]),
          consoleStatePromise.then((consoleState: any) => setStore("console_state", reconcile(consoleState))),
          sdk.client.command.list({ workspace }).then((x: any) => setStore("command", reconcile(x.data ?? []))),
          sdk.client.lsp.status({ workspace }).then((x: any) => setStore("lsp", reconcile(x.data ?? []))),
          sdk.client.mcp.status({ workspace }).then((x: any) => setStore("mcp", reconcile(x.data ?? {}))),
          sdk.client.experimental.resource
            .list({ workspace })
            .then((x: any) => setStore("mcp_resource", reconcile(x.data ?? {}))),
          sdk.client.formatter.status({ workspace }).then((x: any) => setStore("formatter", reconcile(x.data ?? []))),
          sdk.client.session.status({ workspace }).then((x: any) => {
            setStore("session_status", reconcile(x.data ?? {}))
          }),
          sdk.client.provider.auth({ workspace }).then((x: any) => setStore("provider_auth", reconcile(x.data ?? {}))),
          sdk.client.vcs.get({ workspace }).then((x: any) => setStore("vcs", reconcile(x.data))),
          project.workspace.sync(),
        ]).then(() => {
          setStore("status", "complete")
        })
      })
      .catch(async (e: any) => {
        diag(`bootstrap() FAILED — error=${e instanceof Error ? e.message : String(e)}`)
        console.error("tui bootstrap failed", {
          error: e instanceof Error ? e.message : String(e),
          name: e instanceof Error ? e.name : undefined,
          stack: e instanceof Error ? e.stack : undefined,
        })
        if (fatal) {
          exit(e)
        } else {
          throw e
        }
      })
  }

  return bootstrap
}
