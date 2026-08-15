import { Language } from "web-tree-sitter"
import { lazy } from "@/util/lazy"

export type Grammar = {
  id: string
  extensions: string[]
  load: () => Promise<Language>
}

const core = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  return Parser
})

function resolveWasm(asset: string) {
  if (asset.startsWith("file://")) return asset
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return url.href
}

const typescriptWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-typescript/tree-sitter-typescript.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const tsxWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-typescript/tree-sitter-tsx.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const javascriptWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-javascript/tree-sitter-javascript.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const pythonWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-python/tree-sitter-python.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const javaWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-java/tree-sitter-java.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const goWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-go/tree-sitter-go.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const rustWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-rust/tree-sitter-rust.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const cWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-c/tree-sitter-c.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const cppWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-cpp/tree-sitter-cpp.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const c_sharpWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-c-sharp/tree-sitter-c_sharp.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const phpWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-php/tree-sitter-php.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const rubyWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-ruby/tree-sitter-ruby.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const scalaWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-scala/tree-sitter-scala.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const haskellWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-haskell/tree-sitter-haskell.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const elixirWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-elixir/tree-sitter-elixir.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const dartWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-dart/tree-sitter-dart.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const juliaWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-julia/tree-sitter-julia.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const ocamlWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-ocaml/tree-sitter-ocaml.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const jsonWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-json/tree-sitter-json.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const htmlWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-html/tree-sitter-html.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const cssWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-css/tree-sitter-css.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const svelteWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-svelte/tree-sitter-svelte.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const bashWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

const powershellWasm = lazy(async () => {
  const Parser = await core()
  const { default: wasm } = await import("tree-sitter-powershell/tree-sitter-powershell.wasm" as string, { with: { type: "wasm" } })
  return Language.load(resolveWasm(wasm))
})

function grammar(id: string, extensions: string[], load: () => Promise<Language>): Grammar {
  return {
    id,
    extensions,
    load,
  }
}

export const GRAMMARS: Grammar[] = [
  grammar("typescript", [".ts", ".mts", ".cts"], typescriptWasm),
  grammar("tsx", [".tsx"], tsxWasm),
  grammar("javascript", [".js", ".mjs", ".cjs", ".jsx"], javascriptWasm),
  grammar("python", [".py", ".pyw"], pythonWasm),
  grammar("java", [".java"], javaWasm),
  grammar("go", [".go"], goWasm),
  grammar("rust", [".rs"], rustWasm),
  grammar("c", [".c", ".h"], cWasm),
  grammar("cpp", [".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx"], cppWasm),
  grammar("c_sharp", [".cs"], c_sharpWasm),
  grammar("php", [".php"], phpWasm),
  grammar("ruby", [".rb"], rubyWasm),
  grammar("scala", [".scala"], scalaWasm),
  grammar("haskell", [".hs"], haskellWasm),
  grammar("elixir", [".ex", ".exs"], elixirWasm),
  grammar("dart", [".dart"], dartWasm),
  grammar("julia", [".jl"], juliaWasm),
  grammar("ocaml", [".ml", ".mli"], ocamlWasm),
  grammar("json", [".json", ".jsonc"], jsonWasm),
  grammar("html", [".html", ".htm"], htmlWasm),
  grammar("css", [".css", ".scss", ".less"], cssWasm),
  grammar("svelte", [".svelte"], svelteWasm),
  grammar("bash", [".sh", ".bash"], bashWasm),
  grammar("powershell", [".ps1", ".psm1"], powershellWasm),
]

const byExtension = new Map<string, Grammar>()
for (const g of GRAMMARS) {
  for (const ext of g.extensions) byExtension.set(ext, g)
}

export function grammarForFile(filePath: string): Grammar | undefined {
  const base = filePath.split(/[\\/]/).pop() ?? ""
  const dot = base.lastIndexOf(".")
  if (dot <= 0) return undefined
  return byExtension.get(base.slice(dot).toLowerCase())
}

export function supportedExtensions(): string[] {
  return [...byExtension.keys()]
}

export async function parseWithGrammar(filePath: string, source: string) {
  const g = grammarForFile(filePath)
  if (!g) return undefined
  const Parser = await core()
  const lang = await g.load()
  const parser = new Parser()
  parser.setLanguage(lang)
  const tree = parser.parse(source)
  return { grammar: g, tree, parser }
}

export type ParsedFile = Awaited<ReturnType<typeof parseWithGrammar>>
