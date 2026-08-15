import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { parseWithGrammar, grammarForFile } from "./grammar"
import { assertExternalDirectoryEffect } from "./external-directory"
import * as Bom from "@/util/bom"

const operations = ["renameSymbol", "replaceNode", "deleteBlock"] as const

export const Parameters = Schema.Struct({
  operation: Schema.Literals(operations).annotate({
    description:
      "renameSymbol: rename every occurrence of a symbol in the file (identifier nodes only, indentation-safe). replaceNode: replace the exact byte range of a node found at a line (structural, indentation-proof). deleteBlock: delete the node spanning a line (function body, if-block, class, etc.)",
  }),
  filePath: Schema.String.annotate({ description: "The absolute or relative path to the file" }),
  oldName: Schema.optional(Schema.String).annotate({ description: "Symbol name to rename (renameSymbol)" }),
  newName: Schema.optional(Schema.String).annotate({
    description: "New symbol name (renameSymbol) or replacement text (replaceNode)",
  }),
  line: Schema.optional(Schema.Int).annotate({
    description: "1-based line to locate the node for replaceNode / deleteBlock",
  }),
})

const identifierKinds = new Set([
  "identifier",
  "type_identifier",
  "property_identifier",
  "field_identifier",
  "shorthand_property_identifier",
  "shorthand_property_identifier_pattern",
])

// tree-sitter-typescript issue #306: nested multiline JSX elements capture
// leading whitespace in the node range. Trim leading trivia when the node is
// inside JSX so byte-range edits don't inject stray newlines.
function trimNodeRange(node: any, source: string) {
  let start = node.startIndex
  let end = node.endIndex
  if (isTsxStart(node)) {
    while (start < end && /\s/.test(source[start])) start++
  }
  return { start, end }
}

function isTsxStart(node: any) {
  let cur = node
  while (cur) {
    if (cur.type === "jsx_element" || cur.type === "jsx_self_closing_element" || cur.type === "jsx_fragment") {
      return true
    }
    cur = cur.parent
  }
  return false
}

export const AstEditTool = Tool.define(
  "ast-edit",
  Effect.gen(function* () {
    const afs = yield* FSUtil.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!args.filePath) throw new Error("filePath is required")
          const instance = yield* InstanceState.context
          const filePath = path.isAbsolute(args.filePath)
            ? args.filePath
            : path.join(instance.directory, args.filePath)
          yield* assertExternalDirectoryEffect(ctx, filePath)

          const grammar = grammarForFile(filePath)
          if (!grammar) {
            throw new Error(
              `No tree-sitter grammar for ${filePath}. Supported: ${["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "rb", "php", "cs", "scala", "hs", "ex", "exs", "dart", "jl", "ml", "mli", "c", "cc", "cpp", "h", "hpp", "sh"].join(", ")}. Use edit for other files.`,
            )
          }

          const existed = yield* afs.existsSafe(filePath)
          if (!existed) throw new Error(`File ${filePath} not found`)
          const read = yield* Bom.readFile(afs, filePath)
          const source = read.text

          const parsed = yield* Effect.promise(() =>
            parseWithGrammar(filePath, source).then((p) => {
              if (!p) throw new Error(`Failed to parse ${filePath}`)
              return p
            }),
          ).pipe(Effect.mapError(() => new Error(`Failed to parse ${filePath}`)))
          if (!parsed.tree) throw new Error(`Failed to parse ${filePath}`)
          const root = parsed.tree.rootNode as any

          const edits: { start: number; end: number; text: string }[] = []

          if (args.operation === "renameSymbol") {
            if (!args.oldName || !args.newName) throw new Error("oldName and newName are required for renameSymbol")
            if (args.oldName === args.newName) throw new Error("oldName and newName are identical")
            const oldName: string = args.oldName
            const newName: string = args.newName
            const walk = (node: any) => {
              if (!node) return
              if (identifierKinds.has(node.type) && node.text === oldName) {
                const { start, end } = trimNodeRange(node, source)
                edits.push({ start, end, text: newName })
              }
              for (const child of node.namedChildren ?? []) walk(child)
            }
            walk(root)
            if (edits.length === 0) throw new Error(`Symbol "${oldName}" not found in ${filePath}`)
          } else if (args.operation === "replaceNode" || args.operation === "deleteBlock") {
            if (!args.line) throw new Error("line is required for replaceNode / deleteBlock")
            const lineIndex = args.line - 1
            let target: any = undefined
            const walk = (node: any) => {
              if (target) return
              if (!node) return
              if (node.startPosition?.row === lineIndex) {
                target = node
                return
              }
              for (const child of node.namedChildren ?? []) walk(child)
            }
            walk(root)
            if (!target) {
              throw new Error(`No parse node starts at line ${args.line} in ${filePath}. Use edit for literal text changes.`)
            }
            const { start, end } = trimNodeRange(target, source)
            if (args.operation === "deleteBlock") {
              edits.push({ start, end, text: "" })
            } else {
              if (!args.newName) throw new Error("newName (replacement text) is required for replaceNode")
              edits.push({ start, end, text: args.newName })
            }
          }

          // Apply edits from the END of the file backwards so earlier offsets stay valid
          edits.sort((a, b) => b.start - a.start)
          let next = source
          for (const edit of edits) {
            next = next.slice(0, edit.start) + edit.text + next.slice(edit.end)
          }

          // Re-parse and assert syntactic validity before writing
          const revalidated = yield* Effect.promise(() =>
            parseWithGrammar(filePath, next).then((p) => {
              if (!p) throw new Error(`Edit produced unparseable output — rejecting write`)
              return p
            }),
          ).pipe(Effect.mapError(() => new Error(`Edit produced unparseable output — rejecting write`)))
          const hasError = (node: any): boolean => {
            if (node.type === "ERROR" || node.isError) return true
            for (const child of node.namedChildren ?? []) {
              if (hasError(child)) return true
            }
            return false
          }
          if (!revalidated.tree || hasError(revalidated.tree.rootNode as any)) {
            throw new Error(`Edit produced syntax errors — rejecting write to ${filePath}`)
          }

          yield* ctx.ask({
            permission: "edit",
            patterns: [path.relative(instance.worktree, filePath)],
            always: ["*"],
            metadata: {
              filepath: filePath,
              operation: args.operation,
              editCount: edits.length,
              diff: createDiff(source, next),
            },
          })

          yield* afs.writeWithDirs(filePath, next)
          return {
            title: `ast-edit ${args.operation} ${path.relative(instance.worktree, filePath)}`,
            metadata: { operation: args.operation, editCount: edits.length },
            output: `Applied ${edits.length} structural edit(s) to ${filePath} (validated by re-parse).\n${createDiff(source, next)}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function createDiff(oldText: string, newText: string) {
  const oldLines = oldText.split("\n")
  const newLines = newText.split("\n")
  const out: string[] = []
  const max = Math.max(oldLines.length, newLines.length)
  for (let i = 0; i < max; i++) {
    const a = oldLines[i]
    const b = newLines[i]
    if (a !== b) {
      if (a !== undefined) out.push(`- ${a}`)
      if (b !== undefined) out.push(`+ ${b}`)
    }
  }
  return out.join("\n").slice(0, 8000)
}

const DESCRIPTION = `Structural, indentation-proof code edits driven by tree-sitter AST parsing. Unlike the fuzzy edit tool (string matching), ast-edit operates on exact byte ranges of parsed nodes, so whitespace/indentation can never break the edit. Edits are validated by re-parsing the result — unparseable output is rejected before writing.

Operations:
- renameSymbol: rename every identifier occurrence of oldName to newName in the file. Safe renames of functions, variables, types, properties. For cross-file renames use the lsp rename operation instead.
- replaceNode <line> <newName>: replace the exact parse node starting at line with newName. E.g. replace a function body, an argument, a JSX element.
- deleteBlock <line>: delete the node starting at line (function declaration, if-block, class, etc.).

Cost: ~100-500ms per call (grammar lazy-loads on first use per language).

Works with: TypeScript, TSX, JavaScript, Python, Rust, Go, Java, C, C++, C#, PHP, Ruby, Scala, Haskell, Elixir, Dart, Julia, OCaml, JSON, HTML, CSS, Svelte, Bash, PowerShell. Other languages fall back to edit/apply_patch.`
