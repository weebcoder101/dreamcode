import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
  SnapshotFileDiff,
  ConsoleState,
} from "@opencode-ai/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useProject } from "./project"
import { useEvent } from "./event"
import { useSDK } from "./sdk"
import { useTuiStartup } from "./runtime"
import { createSimpleContext } from "./helper"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, onCleanup, onMount } from "solid-js"
import path from "path"
import { useKV } from "./kv"
import fs from "node:fs"

const DIAG_LOG = "/tmp/dreamcode-diag.log"
function diag(msg: string) {
  try { fs.appendFileSync(DIAG_LOG, `[${Date.now()}] ${msg}\n`) } catch {}
}

const emptyConsoleState: ConsoleState = {
  consoleManagedProviders: [],
  switchableOrgCount: 0,
}

function search<T>(items: T[], target: string, key: (item: T) => string) {
  let left = 0
  let right = items.length - 1
  while (left <= right) {
    const middle = Math.floor((left + right) / 2)
    const value = key(items[middle])
    if (value === target) return { found: true, index: middle }
    if (value < target) left = middle + 1
    else right = middle - 1
  }
  return { found: false, index: left }
}

export const {
  context: SyncContext,
  use: useSync,
  provider: SyncProvider,
} = createSimpleContext({
  name: "Sync",
  init: () => {
    const startup = useTuiStartup()
    const kv = useKV()
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      console_state: ConsoleState
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      config: Config
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: SnapshotFileDiff[]
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      message: {
        [sessionID: string]: Message[]
      }
      part: {
        [messageID: string]: Part[]
      }
      lsp: LspStatus[]
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      console_state: emptyConsoleState,
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
    })

    const event = useEvent()
    const project = useProject()
    const sdk = useSDK()

    const fullSyncedSessions = new Set<string>()
    const syncingSessions = new Map<string, Promise<void>>()
    const hydratingSessions = new Map<string, { messages: Set<string>; parts: Set<string>; deletedMessages: Set<string> }>()
    const touchMessage = (sessionID: string, messageID: string) => {
      hydratingSessions.get(sessionID)?.messages.add(messageID)
    }
    const touchPart = (sessionID: string, partID: string) => {
      hydratingSessions.get(sessionID)?.parts.add(partID)
    }
    const touchDeletedMessage = (sessionID: string, messageID: string) => {
      hydratingSessions.get(sessionID)?.deletedMessages.add(messageID)
    }

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
        .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))
    }

    event.subscribe((event, { workspace }) => {
      switch (event.type) {
        case "server.instance.disposed": {
          // Don't re-bootstrap if any session is actively generating,
          // has content, or if we have any sessions at all.
          // server.instance.disposed fires when the server recycles an
          // instance (config reload, cache expiry, etc.) during normal
          // operation. Running bootstrap() replaces the entire session
          // list via reconcile(), which can remove the active session if
          // it hasn't been persisted yet — causing session() to return
          // undefined and the entire UI to disappear (black screen).
          //
          // Three-layer guard:
          // 1. hasActiveGeneration: any session is busy/retry
          // 2. hasSessionMessages: any session has loaded messages
          // 3. hasAnySessions: the session list itself has entries
          //    (prevents wipe when sync hasn't loaded messages yet)
          const hasActiveGeneration = Object.values(store.session_status)
            .some((s) => s.type === "busy" || s.type === "retry")
          const hasSessionMessages = Object.keys(store.message).length > 0
          const hasAnySessions = store.session.length > 0
          if (hasActiveGeneration || hasSessionMessages || hasAnySessions) {
            diag(`server.instance.disposed SUPPRESSED — activeGen=${hasActiveGeneration} sessionMsgs=${hasSessionMessages} anySessions=${hasAnySessions} sessions=${store.session.length} msgKeys=${Object.keys(store.message).length}`)
            break
          }
          diag(`server.instance.disposed FIRING bootstrap — activeGen=${hasActiveGeneration} sessionMsgs=${hasSessionMessages} anySessions=${hasAnySessions}`)
          void bootstrap()
          break
        }
        case "permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.asked": {
          const request = event.properties
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked": {
          const request = event.properties
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.deleted": {
          diag(`session.deleted id=${event.properties.info.id} title="${event.properties.info.title?.slice(0, 60) ?? ""}"`)
          const result = search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "session.updated": {
          diag(`session.updated id=${event.properties.info.id} title="${event.properties.info.title?.slice(0, 60) ?? ""}" cost=${event.properties.info.cost ?? "?"} tokensInput=${event.properties.info.tokens?.input ?? "?"}`)
          const result = search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore("session", result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        }

        case "session.next.moved": {
          const result = search(store.session, event.properties.sessionID, (s) => s.id)
          if (!result.found) break
          setStore(
            "session",
            result.index,
            produce((session) => {
              session.directory = event.properties.location.directory
              session.path = event.properties.subdirectory
              session.workspaceID = event.properties.location.workspaceID
              session.time.updated = event.properties.timestamp
            }),
          )
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
          const result = search(messages, event.properties.messageID, (m) => m.id)
          if (result.found) {
            diag(`message.removed sessionID=${event.properties.sessionID} messageID=${event.properties.messageID} beforeCount=${beforeCount}`)
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "message.updated": {
          touchMessage(event.properties.info.sessionID, event.properties.info.id)
          const messages = store.message[event.properties.info.sessionID]
          if (!messages) {
            diag(`message.updated NEW sessionID=${event.properties.info.sessionID} messageID=${event.properties.info.id} role=${event.properties.info.role}`)
            setStore("message", event.properties.info.sessionID, [event.properties.info])
            break
          }
          const result = search(messages, event.properties.info.id, (m) => m.id)
          if (result.found) {
            setStore("message", event.properties.info.sessionID, result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "message",
            event.properties.info.sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          const updated = store.message[event.properties.info.sessionID]
          if (updated.length > 100) {
            const oldest = updated[0]
            diag(`message.updated 100-LIMIT-SHIFT sessionID=${event.properties.info.sessionID} messageID=${oldest.id} incomingID=${event.properties.info.id} role=${event.properties.info.role} count=${updated.length}`)
            const beforeShiftCount = updated.length
            batch(() => {
              setStore(
                "message",
                event.properties.info.sessionID,
                produce((draft) => {
                  draft.shift()
                }),
              )
              setStore(
                "part",
                produce((draft) => {
                  delete draft[oldest.id]
                }),
              )
            })
            // Log the AFTER state to confirm shift worked correctly
            const afterShift = store.message[event.properties.info.sessionID]
            if (afterShift) {
              diag(`message.updated 100-LIMIT-AFTER sessionID=${event.properties.info.sessionID} beforeLen=${beforeShiftCount} afterLen=${afterShift.length}`)
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
          const result = search(parts, event.properties.part.id, (p) => p.id)
          if (result.found) {
            setStore("part", event.properties.part.messageID, result.index, reconcile(event.properties.part))
            break
          }
          setStore(
            "part",
            event.properties.part.messageID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.part)
            }),
          )
          break
        }

        case "message.part.delta": {
          let parts = store.part[event.properties.messageID]
          if (!parts) {
            // Delta arrived before part.updated — create a stub part so the
            // delta text isn't permanently lost. A subsequent part.updated
            // will reconcile over this stub via reconcile() in the
            // message.part.updated handler below.
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
          const result = search(parts, event.properties.partID, (p) => p.id)
          if (!result.found) {
            // Race: part still not in store even after creating stub.
            // This can happen if store mutation is still propagating.
            // The delta is lost in this edge case but the server fetch
            // in session.sync() will recover the final text.
            break
          }
          touchPart(event.properties.sessionID, event.properties.partID)
          setStore(
            "part",
            event.properties.messageID,
            produce((draft) => {
              const part = draft[result.index]
              const field = event.properties.field as keyof typeof part
              const existing = part[field] as string | undefined
              ;(part[field] as string) = (existing ?? "") + event.properties.delta
            }),
          )
          break
        }

        case "message.part.removed": {
          touchPart(event.properties.sessionID, event.properties.partID)
          const parts = store.part[event.properties.messageID]
          const result = search(parts, event.properties.partID, (p) => p.id)
          if (result.found) {
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }

        case "lsp.updated": {
          const workspace = project.workspace.current()
          void sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", x.data ?? []))
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

    const exit = useExit()
    const args = useArgs()

    async function bootstrap(input: { fatal?: boolean } = {}) {
      diag(`bootstrap() STARTING — store.sessions=${store.session.length} store.message.keys=${Object.keys(store.message).length}`)
      const fatal = input.fatal ?? true
      const workspace = project.workspace.current()
      const projectPromise = project.sync()
      const sessionListPromise = projectPromise.then(() => listSessions())

      // blocking - include session.list when continuing a session
      const providersPromise = sdk.client.config.providers({ workspace }, { throwOnError: true })
      const providerListPromise = sdk.client.provider.list({ workspace }, { throwOnError: true })
      const consoleStatePromise = sdk.client.experimental.console
        .get({ workspace }, { throwOnError: true })
        .then((x) => x.data)
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
          const providersResponse = providersPromise.then((x) => x.data!)
          const providerListResponse = providerListPromise.then((x) => x.data!)
          const consoleStateResponse = consoleStatePromise
          const agentsResponse = agentsPromise.then((x) => x.data ?? [])
          const configResponse = configPromise.then((x) => x.data!)
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
                // The server response may not include a session that was
                // just created or hasn't been persisted yet.
                const sessionsWithLocalMessages = new Set(
                  Object.keys(store.message).filter(
                    (k) => (store.message[k]?.length ?? 0) > 0,
                  ),
                )
                if (sessionsWithLocalMessages.size > 0) {
                  const serverIds = new Set(sessions.map((s: any) => s.id))
                  const preservedLocal = store.session.filter(
                    (s) =>
                      sessionsWithLocalMessages.has(s.id) &&
                      !serverIds.has(s.id),
                  )
                  setStore(
                    "session",
                    reconcile([...sessions, ...preservedLocal]),
                  )
                } else {
                  setStore("session", reconcile(sessions))
                }
              }
            })
          })
        })
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          diag(`bootstrap() COMPLETE — store.sessions=${store.session.length} store.message.keys=${Object.keys(store.message).length} status=${store.status}`)
          // non-blocking
          void Promise.all([
            ...(args.continue
              ? []
              : [
                  sessionListPromise.then((sessions) => {
                    // Same preservation logic as the blocking phase:
                    // don't wipe sessions that have local messages.
                    const sessionsWithLocalMessages = new Set(
                      Object.keys(store.message).filter(
                        (k) => (store.message[k]?.length ?? 0) > 0,
                      ),
                    )
                    if (sessionsWithLocalMessages.size > 0) {
                      const serverIds = new Set(
                        sessions.map((s: any) => s.id),
                      )
                      const preservedLocal = store.session.filter(
                        (s) =>
                          sessionsWithLocalMessages.has(s.id) &&
                          !serverIds.has(s.id),
                      )
                      setStore(
                        "session",
                        reconcile([...sessions, ...preservedLocal]),
                      )
                    } else {
                      setStore("session", reconcile(sessions))
                    }
                  }),
                ]),
            consoleStatePromise.then((consoleState) => setStore("console_state", reconcile(consoleState))),
            sdk.client.command.list({ workspace }).then((x) => setStore("command", reconcile(x.data ?? []))),
            sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", reconcile(x.data ?? []))),
            sdk.client.mcp.status({ workspace }).then((x) => setStore("mcp", reconcile(x.data ?? {}))),
            sdk.client.experimental.resource
              .list({ workspace })
              .then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            sdk.client.formatter.status({ workspace }).then((x) => setStore("formatter", reconcile(x.data ?? []))),
            sdk.client.session.status({ workspace }).then((x) => {
              setStore("session_status", reconcile(x.data ?? {}))
            }),
            sdk.client.provider.auth({ workspace }).then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.vcs.get({ workspace }).then((x) => setStore("vcs", reconcile(x.data))),
            project.workspace.sync(),
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
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

    onMount(() => {
      void bootstrap()

      // Periodic snapshot: every 30s, log message counts for ALL sessions
      // so we can detect when data disappears mid-stream.
      const snapshotInterval = setInterval(() => {
        try {
          const sessionIDs = Object.keys(store.message)
          const counts = sessionIDs
            .map((id) => `${id.slice(0, 20)}:${store.message[id]?.length ?? 0}`)
            .join(" ")
          diag(`SNAPSHOT sessions=${store.session.length} msgKeys=${sessionIDs.length} counts=[${counts}]`)
        } catch {}
      }, 30_000)
      onCleanup(() => clearInterval(snapshotInterval))
    })

    const result = {
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
      session: {
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
          setStore("session", reconcile(list))
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
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
            // Capture snapshot BEFORE produce to have a stable reference for
            // the defensive wipe guard. The SolidJS draft proxy may return a
            // stale/empty reference after rapid 100-limit shifts, causing
            // currentMessages inside produce to be [] and silently wiping
            // all messages. This snapshot is the LIVE store reference.
            const preSyncMessages = store.message[sessionID]
            setStore(
              produce((draft) => {
                const match = search(draft.session, sessionID, (s) => s.id)
                if (match.found) draft.session[match.index] = session.data!
                if (!match.found) draft.session.splice(match.index, 0, session.data!)
                draft.todo[sessionID] = todo.data ?? []
                const currentMessages = draft.message[sessionID] ?? []
                // DIAG: detect SolidJS draft proxy returning stale/empty reference.
                // If the live store (preSyncMessages) has data but the draft proxy
                // (currentMessages) shows fewer or zero, the draft proxy is stale.
                // This helps pinpoint the root cause of the "all data gone" bug.
                const preSyncLen = preSyncMessages?.length ?? 0
                const currentLen = currentMessages.length
                if (preSyncLen >= 2 && currentLen < 2) {
                  diag(`DRAFT-STALE: sessionID=${sessionID} preSyncMessages=${preSyncLen} currentMessages=${currentLen}`)
                } else if (preSyncLen >= 2 && currentLen !== preSyncLen) {
                  diag(`DRAFT-MISMATCH: sessionID=${sessionID} preSyncMessages=${preSyncLen} currentMessages=${currentLen} diff=${currentLen - preSyncLen}`)
                }
                const infos = (messages.data ?? []).flatMap((message) => {
                  if (!tracker.messages.has(message.info.id)) return [message.info]
                  const current = currentMessages.find((item) => item.id === message.info.id)
                  return current ? [current] : []
                })
                // Preserve ALL current messages not already in the server response.
                // The tracker-only guard (messages touched by events DURING sync)
                // misses messages that arrived via SSE BEFORE sync started but
                // haven't been persisted to DB yet. Without this, the HTTP response
                // can be stale — returning fewer messages than what SSE delivered —
                // and the missing messages get silently dropped. This is the root
                // cause of the "everything goes blank" / "tokens become zero" bug.
                //
                // Exclude messages that were explicitly removed during sync
                // (revert/undo/compaction). The message.removed handler adds them
                // to tracker.deletedMessages as defense-in-depth — the handler also
                // removes them from the store synchronously (so they're typically
                // already gone from currentMessages), but if a race causes them
                // to still be present, this guard prevents re-preservation.
                infos.push(
                  ...currentMessages.filter(
                    (message) =>
                      !infos.some((item) => item.id === message.id) &&
                      !tracker.deletedMessages.has(message.id),
                  ),
                )
                const removed = infos.slice(0, -100)
                const visible = infos.slice(-100)
                // DIAG + DEFENSIVE GUARD: detect when sync would wipe messages.
                // If currentMessages had >= 2 but visible has < 2, the SolidJS
                // draft proxy likely returned a stale reference (after rapid
                // 100-limit shifts replacing the array). Preserve the pre-sync
                // snapshot instead of wiping everything to blank.
                if ((preSyncMessages?.length ?? 0) >= 2 && visible.length < 2) {
                  diag(`SYNC-WIPE-PREVENTED: sessionID=${sessionID} preserved=${preSyncMessages!.length} currentMessages=${currentMessages.length} serverReturned=${(messages.data ?? []).length} visible=${visible.length} trackerMessages=${tracker.messages.size}`)
                  draft.message[sessionID] = preSyncMessages!
                  draft.session_diff[sessionID] = diff.data ?? []
                  return
                }
                // DIAG-only: log when the condition was met but the guard
                // snapshot was empty (in case the snapshot itself was empty).
                if (currentMessages.length >= 2 && visible.length < 2) {
                  diag(`SYNC-WIPE: sessionID=${sessionID} currentMessages=${currentMessages.length} serverReturned=${(messages.data ?? []).length} visible=${visible.length} trackerMessages=${tracker.messages.size} deletedMessages=${tracker.deletedMessages.size} preSyncMessages=${preSyncMessages?.length ?? 0}`)
                }
                const visibleIDs = new Set(visible.map((message) => message.id))
                for (const message of messages.data ?? []) {
                  if (!visibleIDs.has(message.info.id)) {
                    delete draft.part[message.info.id]
                    continue
                  }
                  const currentParts = draft.part[message.info.id] ?? []
                  const parts = message.parts.flatMap((part) => {
                    const current = currentParts.find((item) => item.id === part.id)
                    if (tracker.parts.has(part.id)) {
                      // Part was touched by a delta/update event during sync.
                      // If we have a current version, prefer it (more up-to-date).
                      // If we DON'T have a current version (part.delta arrived
                      // before part.updated, race in the delta handler), use
                      // the server version instead of dropping the part.
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
                      (part) => tracker.parts.has(part.id) && !parts.some((item) => item.id === part.id),
                    ),
                  )
                  draft.part[message.info.id] = parts
                }
                for (const message of removed) delete draft.part[message.id]
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
      },
      bootstrap,
    }
    return result
  },
})
