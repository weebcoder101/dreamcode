import { ScopedKey, type ServerScope } from "@/utils/server-scope"

const normalize = (directory: string) => directory.replace(/[\\/]+$/, "")
const key = (scope: ServerScope, directory: string) => ScopedKey.from(scope, normalize(directory))

type State =
  | {
      status: "pending"
    }
  | {
      status: "ready"
    }
  | {
      status: "failed"
      message: string
    }

// LRU cap on the state and waiters maps. Beyond this we drop the oldest
// entry on insert. This is a safety net for long sessions; the primary
// cleanup path is `dispose()` called from the SDK when a session ends.
const MAX_ENTRIES = 256

type Waiter = {
  promise: Promise<State>
  resolve: (state: State) => void
}

const state = new Map<string, State>()
const waiters = new Map<string, Waiter>()

function trimLRU<K, V>(map: Map<K, V>) {
  if (map.size <= MAX_ENTRIES) return
  // Map iteration order is insertion order; delete the oldest 10% so we
  // do not thrash on every insert.
  const drop = Math.max(1, Math.floor(MAX_ENTRIES * 0.1))
  for (let i = 0; i < drop; i += 1) {
    const first = map.keys().next().value
    if (first === undefined) break
    map.delete(first)
  }
}

function deferred() {
  const box = { resolve: (_: State) => {} }
  const promise = new Promise<State>((resolve) => {
    box.resolve = resolve
  })
  return { promise, resolve: box.resolve }
}

export const Worktree = {
  get(scope: ServerScope, directory: string) {
    return state.get(key(scope, directory))
  },
  pending(scope: ServerScope, directory: string) {
    const id = key(scope, directory)
    const current = state.get(id)
    if (current && current.status !== "pending") return
    state.set(id, { status: "pending" })
    trimLRU(state)
  },
  ready(scope: ServerScope, directory: string) {
    const id = key(scope, directory)
    const next = { status: "ready" } as const
    state.set(id, next)
    trimLRU(state)
    const waiter = waiters.get(id)
    if (!waiter) return
    waiters.delete(id)
    waiter.resolve(next)
  },
  failed(scope: ServerScope, directory: string, message: string) {
    const id = key(scope, directory)
    const next = { status: "failed", message } as const
    state.set(id, next)
    trimLRU(state)
    const waiter = waiters.get(id)
    if (!waiter) return
    waiters.delete(id)
    waiter.resolve(next)
  },
  wait(scope: ServerScope, directory: string) {
    const id = key(scope, directory)
    const current = state.get(id)
    if (current && current.status !== "pending") return Promise.resolve(current)

    const existing = waiters.get(id)
    if (existing) return existing.promise

    const waiter = deferred()
    waiters.set(id, waiter)
    trimLRU(waiters)
    return waiter.promise
  },
  // Explicit cleanup hook — call when a session is destroyed so the
  // worktree state is released even if LRU has not evicted it.
  dispose(scope: ServerScope, directory: string) {
    const id = key(scope, directory)
    state.delete(id)
    const waiter = waiters.get(id)
    if (waiter) {
      waiters.delete(id)
      waiter.resolve({ status: "failed", message: "Worktree disposed" })
    }
  },
}
