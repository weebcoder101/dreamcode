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
import { createStore } from "solid-js/store"
import type { SetStoreFunction } from "solid-js/store"
import fs from "node:fs"

const DIAG_LOG = "/tmp/dreamcode-diag.log"

export function diag(msg: string) {
  try {
    fs.appendFileSync(DIAG_LOG, `[${Date.now()}] ${msg}\n`)
  } catch {}
}

export function search<T>(items: T[], target: string, key: (item: T) => string) {
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

export const emptyConsoleState: ConsoleState = {
  consoleManagedProviders: [],
  switchableOrgCount: 0,
}

export interface SyncStore {
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
}

export type SyncSetStore = SetStoreFunction<SyncStore>

export function createSyncStore() {
  const [store, setStore] = createStore<SyncStore>({
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

  return { store, setStore }
}

// ─── Hydration tracker ───────────────────────────────────────────

export interface HydrationTracker {
  messages: Set<string>
  parts: Set<string>
  deletedMessages: Set<string>
}

export function createHydrationTracker(): {
  fullSyncedSessions: Set<string>
  syncingSessions: Map<string, Promise<void>>
  hydratingSessions: Map<string, HydrationTracker>
  touchMessage: (sessionID: string, messageID: string) => void
  touchPart: (sessionID: string, partID: string) => void
  touchDeletedMessage: (sessionID: string, messageID: string) => void
} {
  const fullSyncedSessions = new Set<string>()
  const syncingSessions = new Map<string, Promise<void>>()
  const hydratingSessions = new Map<string, HydrationTracker>()

  const touchMessage = (sessionID: string, messageID: string) => {
    hydratingSessions.get(sessionID)?.messages.add(messageID)
  }
  const touchPart = (sessionID: string, partID: string) => {
    hydratingSessions.get(sessionID)?.parts.add(partID)
  }
  const touchDeletedMessage = (sessionID: string, messageID: string) => {
    hydratingSessions.get(sessionID)?.deletedMessages.add(messageID)
  }

  return { fullSyncedSessions, syncingSessions, hydratingSessions, touchMessage, touchPart, touchDeletedMessage }
}
