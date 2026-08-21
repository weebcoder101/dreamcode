import { describe, expect, test } from "bun:test"
import { grammarForFile, parseWithGrammar } from "../../src/tool/grammar"

async function extractImports(filePath: string, source: string) {
  const parsed = await parseWithGrammar(filePath, source)
  expect(parsed).toBeDefined()
  const out = new Set<string>()
  const walk = (node: any) => {
    if (!node) return
    if (node.type === "import_statement" || node.type === "import_from_statement" || node.type === "export_statement") {
      const src = node.namedChildren?.find(
        (c: any) => c.type === "string" || c.type === "string_fragment" || c.type === "dotted_name" || c.type === "relative_import",
      )
      if (src) out.add(source.slice(src.startIndex, src.endIndex).replace(/['"]/g, ""))
    }
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
        const args = node.namedChildren?.find((c: any) => c.type === "arguments")
        const arg = args?.namedChildren?.find((c: any) => c.type === "string")
        if (arg) out.add(source.slice(arg.startIndex, arg.endIndex).replace(/['"]/g, ""))
      }
    }
    for (const child of node.namedChildren ?? []) walk(child)
  }
  walk(parsed!.tree!.rootNode as any)
  return out
}

async function extractSymbols(filePath: string, source: string) {
  const parsed = await parseWithGrammar(filePath, source)
  expect(parsed).toBeDefined()
  const out: string[] = []
  const kinds = new Set(["function_declaration", "class_declaration", "class_definition", "interface_declaration", "method_definition", "function_definition", "type_alias_declaration"])
  const walk = (node: any) => {
    if (!node) return
    if (kinds.has(node.type)) {
      const name = node.namedChildren?.find((c: any) => c.type === "identifier" || c.type === "name" || c.type === "property_identifier" || c.type === "type_identifier")
      if (name) out.push(name.text)
    }
    for (const child of node.namedChildren ?? []) walk(child)
  }
  walk(parsed!.tree!.rootNode as any)
  return out
}

describe("relations graph extraction", () => {
  test("extracts TS imports (import, export-from, require)", async () => {
    const src = `import { A } from "./a"
export { B } from "./b"
const c = require("./c")`
    const imports = await extractImports("main.ts", src)
    expect(imports.has("./a")).toBe(true)
    expect(imports.has("./b")).toBe(true)
    expect(imports.has("./c")).toBe(true)
  })

  test("extracts Python imports", async () => {
    const src = `import os
from .helpers import util
import src.config as cfg`
    const imports = await extractImports("main.py", src)
    expect(imports.has(".helpers")).toBe(true)
    expect(imports.has("src.config")).toBe(false) // absolute imports need module resolution (LSP domain)
  })

  test("extracts symbols from TS and Python", async () => {
    const tsSymbols = await extractSymbols("a.ts", "export function add(a: number): number { return a }\ninterface Foo { x: number }\nclass Bar { method() {} }")
    expect(tsSymbols).toContain("add")
    expect(tsSymbols).toContain("Foo")
    expect(tsSymbols).toContain("Bar")
    expect(tsSymbols).toContain("method")

    const pySymbols = await extractSymbols("a.py", "def helper():\n    pass\nclass Widget:\n    def render(self):\n        pass\n")
    expect(pySymbols).toContain("helper")
    expect(pySymbols).toContain("Widget")
    expect(pySymbols).toContain("render")
  })

  test("grammarForFile resolves the graph languages", () => {
    expect(grammarForFile("x/src/main.ts")?.id).toBe("typescript")
    expect(grammarForFile("x/src/main.py")?.id).toBe("python")
    expect(grammarForFile("x/main.rs")?.id).toBe("rust")
    expect(grammarForFile("x/main.go")?.id).toBe("go")
    expect(grammarForFile("x/main.java")?.id).toBe("java")
    expect(grammarForFile("x/app.tsx")?.id).toBe("tsx")
    expect(grammarForFile("x/Makefile")?.id).toBeUndefined()
  })
})
