import * as fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import type { Database } from "../storage/storage"
import { eq } from "drizzle-orm"
import { Log } from "../util"
import { MemoryFtsTable } from "./fts.sql"
import { parsePath, parseCcPath, parseCcFrontmatterType, type MemoryLocator } from "./paths"

const log = Log.create({ service: "memory.reconcile" })

export async function walkMemoryDir(root: string): Promise<string[]> {
  const out: string[] = []
  async function recurse(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return [] as import("fs").Dirent[]
      throw e
    })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await recurse(full)
      else if (entry.isFile() && full.endsWith(".md")) out.push(full)
    }
  }
  await recurse(root)
  return out
}

// Walk <base>/<slug>/memory/**/*.md across every slug under <base>.
// ENOENT on <base> returns []; missing memory subdirs are silently skipped.
export async function walkCcRoot(base: string): Promise<string[]> {
  const slugs = await fs.readdir(base, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return [] as import("fs").Dirent[]
    throw e
  })
  const out: string[] = []
  for (const entry of slugs) {
    if (!entry.isDirectory()) continue
    const memoryDir = path.join(base, entry.name, "memory")
    const exists = await fs.stat(memoryDir).then(() => true).catch(() => false)
    if (!exists) continue
    const files = await walkMemoryDir(memoryDir)
    for (const f of files) out.push(f)
  }
  return out
}

export function indexFromDisk(
  db: Database.Interface["db"],
  absPath: string,
  loc: MemoryLocator,
  bodyType: "mimo" | "cc",
  oldFingerprint?: string,
): Effect.Effect<"hit" | "updated" | "skipped"> {
  return Effect.gen(function* () {
    const stat = yield* Effect.promise(() => fs.stat(absPath).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return null
      throw e
    }))
    if (!stat) return "skipped" as const
    const fingerprint = `${stat.size}-${stat.mtimeMs}`
    if (oldFingerprint === fingerprint) return "hit" as const

    const body = yield* Effect.promise(() => Bun.file(absPath).text())

    // For CC files, derive type from frontmatter; mimo files keep loc.type from path.
    const finalType =
      bodyType === "cc" ? (parseCcFrontmatterType(body) ?? "free") : loc.type

    yield* db
      .insert(MemoryFtsTable)
      .values({
        path: absPath,
        scope: loc.scope,
        scope_id: loc.scope_id,
        type: finalType,
        body,
        fingerprint,
        last_indexed_at: Date.now(),
      })
      .onConflictDoUpdate({
        target: MemoryFtsTable.path,
        set: {
          scope: loc.scope,
          scope_id: loc.scope_id,
          type: finalType,
          body,
          fingerprint,
          last_indexed_at: Date.now(),
        },
      })
      .run()
    return "updated" as const
  })
}

export function reconcileMemory(
  db: Database.Interface["db"],
  roots: { mimo: string; cc?: string },
): Effect.Effect<{ indexed: number; pruned: number }> {
  return Effect.gen(function* () {
    // Collect disk paths from BOTH roots before pruning. If we pruned per-root,
    // enabling CC indexing on a fresh run would prune all mimo rows (and vice
    // versa) because each walk's set is missing the other root's paths.
    const [mimoArr, ccArr] = yield* Effect.all([
      Effect.promise(() => walkMemoryDir(roots.mimo)),
      Effect.promise(() => roots.cc ? walkCcRoot(roots.cc) : Promise.resolve([] as string[])),
    ])
    const mimoFiles = new Set(mimoArr)
    const ccFiles = new Set(ccArr)
    const diskPaths = new Set<string>([...mimoFiles, ...ccFiles])

    const rows = yield* db
      .select({ path: MemoryFtsTable.path, fingerprint: MemoryFtsTable.fingerprint })
      .from(MemoryFtsTable)
      .all()
    const indexed = new Map<string, string>(
      rows.map((r: { path: string; fingerprint: string }) => [r.path, r.fingerprint]),
    )

    // Direction B: prune dead FTS rows (any path not in either walk).
    let pruned = 0
    for (const p of indexed.keys()) {
      if (!diskPaths.has(p)) {
        yield* Effect.orDie(db.delete(MemoryFtsTable).where(eq(MemoryFtsTable.path, p)).run())
        pruned++
      }
    }

    // Direction A: index disk files. Pick parser by which walk produced the path.
    let indexedCount = 0
    for (const p of mimoFiles) {
      const loc = parsePath(p)
      if (!loc) {
        log.warn("path outside memory layout, skipping", { path: p })
        continue
      }
      const result = yield* indexFromDisk(db, p, loc, "mimo", indexed.get(p))
      if (result === "updated") indexedCount++
    }
    for (const p of ccFiles) {
      const loc = parseCcPath(p)
      if (!loc) {
        log.warn("CC path failed to parse, skipping", { path: p })
        continue
      }
      const result = yield* indexFromDisk(db, p, loc, "cc", indexed.get(p))
      if (result === "updated") indexedCount++
    }

    return { indexed: indexedCount, pruned }
  })
}
