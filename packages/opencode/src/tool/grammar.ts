import { Language } from "web-tree-sitter"
import { lazy } from "@/util/lazy"
import { fileURLToPath } from "url"

export type Grammar = {
  id: string
  extensions: string[]
  load: () => Promise<Language>
}

const core = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  let treePath: string
  try {
    const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
      with: { type: "wasm" },
    })
    treePath = resolveWasm(treeWasm)
  } catch (e) {
    throw new Error(`tree-sitter WASM bootstrap failed — cannot resolve tree-sitter.wasm: ${e instanceof Error ? e.message : e}`)
  }
  try {
    await Parser.init({
      locateFile() {
        return treePath
      },
    })
  } catch (e) {
    throw new Error(`tree-sitter Parser.init() failed at ${treePath}: ${e instanceof Error ? e.message : e}`)
  }
  return Parser
})

function resolveWasm(asset: string) {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

/**
 * Load a tree-sitter WASM grammar with informative error messages.
 * Catches both import failures (WASM not found in bundle) and Language.load
 * failures (WASM present but corrupt or incompatible).
 */
async function loadGrammarWasm(specifier: string, grammarId: string): Promise<Language> {
  await core() // ensure tree-sitter runtime is initialized
  let wasmPath: string
  try {
    const { default: wasm } = await import(specifier as string, { with: { type: "wasm" } })
    wasmPath = resolveWasm(wasm)
  } catch (e) {
    throw new Error(
      `tree-sitter WASM import failed for ${grammarId}: ` +
      `cannot resolve "${specifier}" — ${e instanceof Error ? e.message : e}. ` +
      `The grammar WASM may not be installed. Run: bun add ${specifier.split("/").slice(0, 2).join("/")}`
    )
  }
  try {
    return await Language.load(wasmPath)
  } catch (e) {
    throw new Error(
      `tree-sitter Language.load() failed for ${grammarId} at ${wasmPath}: ` +
      `${e instanceof Error ? e.message : e}. The WASM file may be corrupt or incompatible.`
    )
  }
}

const typescriptWasm = lazy(() => loadGrammarWasm("tree-sitter-typescript/tree-sitter-typescript.wasm", "typescript"))
const tsxWasm = lazy(() => loadGrammarWasm("tree-sitter-typescript/tree-sitter-tsx.wasm", "tsx"))
const javascriptWasm = lazy(() => loadGrammarWasm("tree-sitter-javascript/tree-sitter-javascript.wasm", "javascript"))
const pythonWasm = lazy(() => loadGrammarWasm("tree-sitter-python/tree-sitter-python.wasm", "python"))
const javaWasm = lazy(() => loadGrammarWasm("tree-sitter-java/tree-sitter-java.wasm", "java"))
const goWasm = lazy(() => loadGrammarWasm("tree-sitter-go/tree-sitter-go.wasm", "go"))
const rustWasm = lazy(() => loadGrammarWasm("tree-sitter-rust/tree-sitter-rust.wasm", "rust"))
const cWasm = lazy(() => loadGrammarWasm("tree-sitter-c/tree-sitter-c.wasm", "c"))
const cppWasm = lazy(() => loadGrammarWasm("tree-sitter-cpp/tree-sitter-cpp.wasm", "cpp"))
const c_sharpWasm = lazy(() => loadGrammarWasm("tree-sitter-c-sharp/tree-sitter-c_sharp.wasm", "c_sharp"))
const phpWasm = lazy(() => loadGrammarWasm("tree-sitter-php/tree-sitter-php.wasm", "php"))
const rubyWasm = lazy(() => loadGrammarWasm("tree-sitter-ruby/tree-sitter-ruby.wasm", "ruby"))
const scalaWasm = lazy(() => loadGrammarWasm("tree-sitter-scala/tree-sitter-scala.wasm", "scala"))
const haskellWasm = lazy(() => loadGrammarWasm("tree-sitter-haskell/tree-sitter-haskell.wasm", "haskell"))
const elixirWasm = lazy(() => loadGrammarWasm("tree-sitter-elixir/tree-sitter-elixir.wasm", "elixir"))

const dartWasm = lazy(() => loadGrammarWasm("tree-sitter-dart/tree-sitter-dart.wasm", "dart"))
const juliaWasm = lazy(() => loadGrammarWasm("tree-sitter-julia/tree-sitter-julia.wasm", "julia"))
const ocamlWasm = lazy(() => loadGrammarWasm("tree-sitter-ocaml/tree-sitter-ocaml.wasm", "ocaml"))
const jsonWasm = lazy(() => loadGrammarWasm("tree-sitter-json/tree-sitter-json.wasm", "json"))
const htmlWasm = lazy(() => loadGrammarWasm("tree-sitter-html/tree-sitter-html.wasm", "html"))
const cssWasm = lazy(() => loadGrammarWasm("tree-sitter-css/tree-sitter-css.wasm", "css"))
const svelteWasm = lazy(() => loadGrammarWasm("tree-sitter-svelte/tree-sitter-svelte.wasm", "svelte"))
const bashWasm = lazy(() => loadGrammarWasm("tree-sitter-bash/tree-sitter-bash.wasm", "bash"))
const powershellWasm = lazy(() => loadGrammarWasm("tree-sitter-powershell/tree-sitter-powershell.wasm", "powershell"))

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
  let lang: Language
  try {
    lang = await g.load()
  } catch (e) {
    throw new Error(
      `Failed to load tree-sitter grammar "${g.id}" for ${filePath}: ${e instanceof Error ? e.message : e}. ` +
      `Falling back to text-based edit is recommended for this file.`
    )
  }
  const parser = new Parser()
  parser.setLanguage(lang)
  const tree = parser.parse(source)
  return { grammar: g, tree, parser }
}

export type ParsedFile = Awaited<ReturnType<typeof parseWithGrammar>>
