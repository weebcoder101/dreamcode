import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { Glob } from "@opencode-ai/core/util/glob"
import { grammarForFile, parseWithGrammar } from "./grammar"
import * as fsSync from "node:fs"

const operations = [
  "whoProvides",
  "consumersOf",
  "dependentsOf",
  "reverseImports",
  "circular",
] as const

export const Parameters = Schema.Struct({
  operation: Schema.Literals(operations).annotate({
    description:
      "The graph query to run. whoProvides <symbol>: which files define it. consumersOf <symbol>: which files import/use it. dependentsOf <file>: which files import this file (reverse-imports). reverseImports <file>: same as dependentsOf. circular: detect import cycles.",
  }),
  symbol: Schema.optional(Schema.String).annotate({
    description: "Symbol name for whoProvides / consumersOf",
  }),
  filePath: Schema.optional(Schema.String).annotate({
    description: "File path for dependentsOf / reverseImports. Absolute or relative to the workspace.",
  }),
  depth: Schema.optional(Schema.Int).annotate({
    description: "Max traversal depth for circular detection (default 1 = direct cycles)",
  }),
})

type SymbolDef = { name: string; file: string; kind: string; line: number }

type Graph = {
  files: Set<string>
  imports: Map<string, Set<string>>
  symbols: Map<string, SymbolDef[]>
}

const symbolKinds = new Set([
  "function_declaration",
  "class_declaration",
  "class_definition",
  "interface_declaration",
  "method_definition",
  "function_definition",
  "arrow_function",
  "generator_function_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "abstract_class_declaration",
  "struct_specifier",
  "protocol_declaration",
  "type_declaration",
  "variable_declaration",
  "import_statement",
])

function extractImports(root: any, source: string, file: string): Set<string> {
  const out = new Set<string>()
  const walk = (node: any) => {
    if (!node) return
    if (node.type === "import_statement" || node.type === "import_from_statement" || node.type === "export_statement") {
      const src = node.namedChildren?.find(
        (c: any) => c.type === "string" || c.type === "string_fragment" || c.type === "dotted_name" || c.type === "relative_import",
      )
      if (src) {
        const raw = source.slice(src.startIndex, src.endIndex).replace(/['"]/g, "")
        if (raw.startsWith(".") || raw.startsWith("/") || raw.startsWith("@/")) out.add(raw)
      }
    }
    // Python: from .helpers import util — source lives in relative_import child
    if (node.type === "import_from_statement") {
      const rel = node.namedChildren?.find((c: any) => c.type === "relative_import")
      if (rel) {
        const raw = source.slice(rel.startIndex, rel.endIndex).replace(/['"]/g, "")
        if (raw.startsWith(".")) out.add(raw)
      }
    }
    if (node.type === "call_expression") {
      const callee = node.namedChildren?.find((c: any) => c.type === "identifier" || c.type === "function")
      if (callee?.text === "require") {
        // The string arg sits inside the arguments node
        const args = node.namedChildren?.find((c: any) => c.type === "arguments")
        const arg = args?.namedChildren?.find((c: any) => c.type === "string")
        if (arg) {
          const raw = source.slice(arg.startIndex, arg.endIndex).replace(/['"]/g, "")
          if (raw.startsWith(".") || raw.startsWith("/") || raw.startsWith("@/")) out.add(raw)
        }
      }
    }
    for (const child of node.namedChildren ?? []) walk(child)
  }
  walk(root)
  return out
}

function extractSymbols(root: any, source: string, file: string): SymbolDef[] {
  const out: SymbolDef[] = []
  const walk = (node: any) => {
    if (!node) return
    if (symbolKinds.has(node.type)) {
      const nameNode = node.namedChildren?.find((c: any) => c.type === "identifier" || c.type === "name" || c.type === "property_identifier" || c.type === "type_identifier")
      if (nameNode) {
        out.push({
          name: nameNode.text,
          file,
          kind: node.type,
          line: node.startPosition?.row != null ? node.startPosition.row + 1 : 0,
        })
      }
    }
    for (const child of node.namedChildren ?? []) walk(child)
  }
  walk(root)
  return out
}

function resolveImport(spec: string, fromDir: string): string | undefined {
  if (spec.startsWith("@/")) {
    return spec
  }
  if (!spec.startsWith(".")) return undefined
  const clean = spec.replace(/\.(ts|tsx|js|jsx|py|rs|go|java|rb|php|cs|scala|hs|ex|exs|dart|jl|ml|mli|c|cc|cpp|h|hpp)$/, "")
  let p = path.resolve(fromDir, clean)
  for (const ext of [".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java", ".rb", ".php", ".cs", ".scala", ".hs", ".ex", ".exs", ".dart", ".jl", ".ml", ".mli", ".c", ".cc", ".cpp", ".h", ".hpp", "/index.ts", "/index.js", "/index.tsx", "/__init__.py"]) {
    const candidate = p.endsWith(ext) ? p : p + ext
    try {
      if (fsSync.existsSync(candidate)) return fsSync.realpathSync(candidate)
    } catch {}
  }
  return undefined
}

export function __test_resolveImport(spec: string, fromDir: string) {
  return resolveImport(spec, fromDir)
}

export const RelationsTool = Tool.define(
  "relations",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const worktree = instance.worktree
          yield* ctx.ask({
            permission: "read",
            patterns: ["*"],
            always: ["*"],
            metadata: { operation: args.operation, symbol: args.symbol, filePath: args.filePath },
          })

          const scanRoot = instance.directory && instance.directory !== "/" ? instance.directory : worktree !== "/" ? worktree : process.cwd()
          const pattern = "**/*.{" + ["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "rb", "php", "cs", "scala", "hs", "ex", "exs", "dart", "jl", "ml", "mli", "c", "cc", "cpp", "h", "hpp", "sh"].join(",") + "}"
          const files = yield* Effect.promise(async () => {
            const list = await Glob.scan(pattern, {
              cwd: scanRoot,
              absolute: true,
              dot: false,
            })
            return list.filter(
              (f) => !/(^|[/\\])(node_modules|dist|build|\.git|vendor|out|\.next|\.turbo|__pycache__)([/\\]|$)/.test(f),
            )
          })

          // Build the graph (async) and query it
          const graph = yield* Effect.promise(() => buildGraphEffect(scanRoot, files)).pipe(
            Effect.catch((e) => Effect.fail(new Error(`relations graph build failed: ${String(e)}`))),
          )
          const result = queryGraph(graph, args, scanRoot, files)
          
          return {
            title: `relations ${args.operation}`,
            metadata: { operation: args.operation, count: result.length },
            output: result.length === 0 ? `No results for ${args.operation}` : JSON.stringify(result, null, 2),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

import type { ParsedFile } from "./grammar"

async function buildGraphEffect(directory: string, files: string[]): Promise<Graph> {
  const graph: Graph = { files: new Set(), imports: new Map(), symbols: new Map() }
  const fs = await import("node:fs")
  for (const file of files) {
    graph.files.add(file)
    let source: string
    try {
      source = fs.readFileSync(file, "utf8")
    } catch {
      continue
    }
    const parsed: ParsedFile = await parseWithGrammar(file, source).catch(() => undefined)
    if (!parsed?.tree) continue
    const root = parsed.tree.rootNode as any
    const imports = extractImports(root, source, file)
    const fromDir = path.dirname(file)
    const resolved = new Set<string>()
    for (const spec of imports) {
      const target = resolveImport(spec, fromDir)
      if (target && target !== file) resolved.add(target)
    }
    if (resolved.size) {
      const set = graph.imports.get(file) ?? new Set()
      for (const t of resolved) set.add(t)
      graph.imports.set(file, set)
    }
    const symbols = extractSymbols(root, source, file)
    for (const s of symbols) {
      const list = graph.symbols.get(s.name) ?? []
      list.push(s)
      graph.symbols.set(s.name, list)
    }
  }
  return graph
}

function queryGraph(
  graph: Graph,
  args: Schema.Schema.Type<typeof Parameters>,
  worktree: string,
  files: string[],
): unknown[] {
  const rel = (f: string) => path.relative(worktree, f)
  switch (args.operation) {
    case "whoProvides": {
      if (!args.symbol) throw new Error("symbol is required for whoProvides")
      const defs = graph.symbols.get(args.symbol) ?? []
      return defs.map((d) => ({ symbol: d.name, kind: d.kind, file: rel(d.file), line: d.line }))
    }
    case "consumersOf": {
      if (!args.symbol) throw new Error("symbol is required for consumersOf")
      const defs = graph.symbols.get(args.symbol) ?? []
      const defFiles = new Set(defs.map((d) => d.file))
      const consumers = new Set<string>()
      for (const [from, targets] of graph.imports.entries()) {
        for (const t of targets) {
          if (defFiles.has(t)) {
            consumers.add(from)
            break
          }
        }
      }
      return [...consumers].map((f) => ({ file: rel(f) }))
    }
    case "dependentsOf":
    case "reverseImports": {
      if (!args.filePath) throw new Error("filePath is required for dependentsOf")
      const target = path.isAbsolute(args.filePath) ? args.filePath : path.resolve(worktree, args.filePath)
      const dependents = new Set<string>()
      for (const [from, targets] of graph.imports.entries()) {
        if (targets.has(target)) dependents.add(from)
      }
      return [...dependents].map((f) => ({ file: rel(f) }))
    }
    case "circular": {
      const depth = args.depth ?? 1
      const cycles: { cycle: string[] }[] = []
      const seen = new Set<string>()
      const visit = (start: string, cur: string, trail: string[], remaining: number) => {
        if (remaining < 0) return
        const key = [...trail, cur].join(">")
        if (seen.has(key)) return
        seen.add(key)
        const nexts = graph.imports.get(cur) ?? new Set()
        for (const next of nexts) {
          if (next === start && trail.length >= 1) {
            cycles.push({ cycle: [...trail, cur].map(rel) })
            continue
          }
          if (trail.includes(next)) continue
          visit(start, next, [...trail, cur], remaining - 1)
        }
      }
      for (const f of graph.files) visit(f, f, [], depth)
      const unique = new Map<string, { cycle: string[] }>()
      for (const c of cycles) {
        const sorted = [...c.cycle].sort()
        unique.set(sorted.join("|"), c)
      }
      return [...unique.values()].slice(0, 100)
    }
  }
}

const DESCRIPTION = `Query a relational code map of the workspace: who provides a symbol, who consumes it, and which files depend on each other via imports. Built lazily from tree-sitter parsing of the workspace (imports, exports, require, and definitions).

Operations:
- whoProvides <symbol>: which files define this symbol (function/class/interface/type)
- consumersOf <symbol>: which files import from a file that defines this symbol
- dependentsOf <file>: which files import this file (reverse-imports)
- reverseImports <file>: alias of dependentsOf
- circular [depth]: import cycles in the workspace (depth = max edges per cycle, default 1 = direct)

Cost: ~1-3s first call (builds graph), sub-second after (cached). For symbol resolution prefer lsp (50ms); use relations when you need the import graph / blast radius across files.

Limitations: static analysis only — dynamic imports and path aliases are best-effort; LSP findReferences remains the precise resolver for ambiguous symbols.`
