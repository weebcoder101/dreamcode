// ─── Embedding-Based Historical Retrieval (§3.6) ────────────────────────
// Cross-session memory WITHOUT an embedding API: past compaction summaries
// and key decisions are indexed to disk with token statistics, and retrieved
// with a BM25-style lexical scorer (idf-weighted term overlap). This gives
// most of the retrieval value of embeddings (relevant historical context
// injected into the dynamic system tail) with zero external dependencies.
//
// Research: Mnemoverse 2026 — KV-cache-aware memory retrieval; Zylos 2026 —
// long-session context strategies. Lexical retrieval is a deliberate
// trade-off: deterministic, offline, and free — embeddings can be layered
// on later by swapping the scorer.
//
// KV-cache discipline: retrieved context is injected into the SYSTEM TAIL
// (after taste/knowledge), so any change only re-bills the small tail, never
// the ~250k-token cached prefix. Retrieval runs once per user message
// (step === 1), keeping the block stable within a turn.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { Global } from "@opencode-ai/core/global"

const INDEX_DIR = join(Global.Path.data, "memory-index")
const INDEX_FILE = join(INDEX_DIR, "index.json")

export interface MemoryEntry {
  id: string
  /** Session this entry came from. */
  sessionID: string
  /** ISO timestamp of indexing. */
  ts: number
  /** Short title/session label. */
  title: string
  /** The summary / key decisions text. */
  text: string
}

interface IndexFile {
  entries: MemoryEntry[]
}

/** Max entries kept on disk (FIFO eviction). */
const MAX_ENTRIES = 200
/** Max chars stored per entry. */
const MAX_ENTRY_CHARS = 2000

function ensureDir(dir: string) {
  try { mkdirSync(dir, { recursive: true }) } catch {}
}

function loadIndex(): IndexFile {
  if (!existsSync(INDEX_FILE)) return { entries: [] }
  try {
    const parsed = JSON.parse(readFileSync(INDEX_FILE, "utf-8")) as unknown
    if (typeof parsed !== "object" || parsed === null) return { entries: [] }
    const raw = (parsed as { entries?: unknown }).entries
    if (!Array.isArray(raw)) return { entries: [] }
    const entries: MemoryEntry[] = []
    for (const e of raw) {
      if (typeof e !== "object" || e === null) continue
      const r = e as Record<string, unknown>
      if (typeof r.id !== "string" || typeof r.sessionID !== "string" || typeof r.text !== "string") continue
      entries.push({
        id: r.id.slice(0, 200),
        sessionID: r.sessionID.slice(0, 200),
        ts: typeof r.ts === "number" && Number.isFinite(r.ts) ? r.ts : 0,
        title: typeof r.title === "string" ? r.title.slice(0, 120) : "",
        text: r.text.slice(0, MAX_ENTRY_CHARS),
      })
    }
    return { entries }
  } catch {
    return { entries: [] }
  }
}

function saveIndex(index: IndexFile) {
  try {
    ensureDir(INDEX_DIR)
    writeFileSync(INDEX_FILE, JSON.stringify(index), { mode: 0o600 })
  } catch {
    // Best-effort — memory indexing must never break the loop.
  }
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []).filter(
    // Stopwords — cheap and language-agnostic enough for lexical retrieval
    (t) =>
      ![
        "the", "and", "for", "with", "that", "this", "from", "have", "will", "was", "were",
        "are", "you", "your", "our", "their", "them", "they", "just", "not", "but", "its",
        "into", "then", "than", "can", "could", "would", "should", "what", "when", "where",
        "which", "who", "whom", "there", "here", "about", "after", "before", "been", "being",
        "does", "doing", "done", "each", "other", "some", "such", "only", "own", "same",
      ].includes(t),
  )
}

/** BM25-lite scorer over the in-memory entry list. */
function scoreEntries(entries: MemoryEntry[], queryTokens: string[]): Array<{ entry: MemoryEntry; score: number }> {
  if (queryTokens.length === 0) return []
  const N = Math.max(1, entries.length)
  // Document frequency per term
  const df = new Map<string, number>()
  const tokenSets = entries.map((e) => {
    const set = new Set(tokenize(e.text))
    for (const t of set) df.set(t, (df.get(t) ?? 0) + 1)
    return set
  })
  const scored: Array<{ entry: MemoryEntry; score: number }> = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    const set = tokenSets[i]!
    let score = 0
    for (const t of queryTokens) {
      if (!set.has(t)) continue
      const idf = Math.log((N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5) + 1)
      score += idf
    }
    // Recency boost: entries within the last 24h get +0.5, within 7d +0.25
    const age = Date.now() - entry.ts
    if (age < 24 * 3600_000) score += 0.5
    else if (age < 7 * 24 * 3600_000) score += 0.25
    if (score > 0) scored.push({ entry, score })
  }
  return scored.sort((a, b) => b.score - a.score)
}

/**
 * Index a compaction summary / decision block for future retrieval.
 * Idempotent per (sessionID, text-hash): re-indexing the same summary
 * (e.g. re-run compaction) updates the timestamp instead of duplicating.
 */
export function indexSummary(input: { sessionID: string; title: string; text: string }): void {
  const text = input.text.slice(0, MAX_ENTRY_CHARS)
  if (!text.trim()) return
  const index = loadIndex()
  const id = `${input.sessionID}:${hash(text)}`
  const existing = index.entries.find((e) => e.id === id)
  if (existing) {
    existing.ts = Date.now()
    existing.title = input.title
  } else {
    index.entries.push({
      id,
      sessionID: input.sessionID,
      ts: Date.now(),
      title: input.title.slice(0, 120),
      text,
    })
  }
  // FIFO eviction by age (newest last)
  index.entries.sort((a, b) => a.ts - b.ts)
  while (index.entries.length > MAX_ENTRIES) index.entries.shift()
  saveIndex(index)
}

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

/**
 * Retrieve the top-k historical entries relevant to the query.
 * Returns [] when nothing scores above the relevance floor.
 */
export function retrieveHistorical(query: string, k = 2): Array<{ text: string; title: string; score: number }> {
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return []
  const index = loadIndex()
  if (index.entries.length === 0) return []
  return scoreEntries(index.entries, queryTokens)
    .slice(0, k)
    .map(({ entry, score }) => ({ text: entry.text, title: entry.title, score }))
}

/**
 * Build a `<historical-context>` system block for the given user query.
 * Empty string when nothing relevant is found. Must be injected in the
 * DYNAMIC TAIL of the system prompt (after taste/knowledge).
 */
export function historicalContextBlock(query: string, k = 2): string {
  if (!query || query.trim().length < 40) return ""
  const hits = retrieveHistorical(query, k)
  if (hits.length === 0) return ""
  const lines = [
    "<historical-context>",
    "Relevant context from previous sessions (use it; do not re-derive):",
  ]
  for (const hit of hits) {
    const snippet = hit.text.slice(0, 300)
    lines.push(`- [${hit.title}] ${snippet}${hit.text.length > 300 ? "…" : ""}`)
  }
  lines.push("</historical-context>")
  return lines.join("\n")
}

export * as MemoryIndex from "./memory-index"
