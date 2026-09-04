export type FileSelection = {
  startLine: number
  startChar: number
  endLine: number
  endChar: number
}

export type SelectedLineRange = {
  start: number
  end: number
}

export function selectionFromLines(selection?: SelectedLineRange): FileSelection | undefined {
  if (!selection) return undefined
  return {
    startLine: selection.start,
    startChar: 0,
    endLine: selection.end,
    endChar: 0,
  }
}

const defaultPool = [
  "src/session/timeline.tsx",
  "src/session/composer.tsx",
  "src/components/prompt-input.tsx",
  "src/components/session-todo-dock.tsx",
  "README.md",
]

/**
 * Build a `useFile` mock. Pass a custom `pool` to exercise empty, single,
 * large, or permission-denied states that the default 5-path pool cannot.
 * See wave5-retry F-SB-03.
 */
export function createFileMock(pool: string[] = defaultPool) {
  return {
    tab(path: string) {
      return `file:${path}`
    },
    pathFromTab(tab: string) {
      if (!tab.startsWith("file:")) return ""
      return tab.slice(5)
    },
    load: async () => undefined,
    async searchFilesAndDirectories(query: string) {
      const text = query.trim().toLowerCase()
      if (!text) return pool
      return pool.filter((path) => path.toLowerCase().includes(text))
    },
  }
}

export function useFile() {
  return createFileMock()
}
