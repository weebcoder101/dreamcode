import * as fs from "fs"
import * as path from "path"

interface MemoryIndex { indexed_at: string; files: MemoryEntry[]; total_tokens: number }
interface MemoryEntry { path: string; type: string; size: number; tokens: number; top_tokens: [string, number][] }

function walkMemoryDir(root: string): string[] {
  const files: string[] = []
  if (!fs.existsSync(root)) return files
  function recurse(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) recurse(full)
      else if (entry.isFile() && full.endsWith(".md")) files.push(full)
    }
  }
  recurse(root)
  return files
}

function extractTokens(text: string): Map<string, number> {
  const words = text.toLowerCase().match(/\b\w+\b/g) || []
  const freq = new Map<string, number>()
  for (const w of words) if (w.length > 2) freq.set(w, (freq.get(w) || 0) + 1)
  return freq
}

export function reconcileMemory(memoryDir: string, indexPath: string): MemoryIndex {
  const files = walkMemoryDir(memoryDir)
  const index: MemoryIndex = { indexed_at: new Date().toISOString(), files: [], total_tokens: 0 }
  for (const f of files) {
    try {
      const content = fs.readFileSync(f, "utf8")
      const tokens = extractTokens(content)
      index.files.push({ path: f, type: "memory", size: content.length, tokens: tokens.size, top_tokens: [...tokens.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20) })
      index.total_tokens += tokens.size
    } catch {}
  }
  fs.mkdirSync(path.dirname(indexPath), { recursive: true })
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2))
  return index
}
