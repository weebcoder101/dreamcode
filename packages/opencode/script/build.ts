#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")

import { Script } from "@opencode-ai/script"
import pkg from "../package.json"

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")
const sourcemapsFlag = process.argv.includes("--sourcemaps")
const plugin = createSolidTransformPlugin()

// Patch effect dist files for bun 1.3.x runtime compatibility:
// 1. bun --compile corrupts module-level TextEncoder via @__PURE__ tree-shaking
// 2. bun 1.3.x mis-compiles rest parameters, breaking Schema.Union(a, b) -> Union(a, options=b),
//    Schema.check(...checks) -> check(checks), Schema.Literals(literals), Schema.Tuple(elements), etc.
const effectPlugin: Bun.Plugin = {
  name: "effect-bun-patches",
  setup(build) {
    build.onLoad({ filter: /\/effect\/dist\//, namespace: "file" }, async (args) => {
      let source = await Bun.file(args.path).text()
      source = source.replace(/\/\*[#@]\s*__PURE__\s*\*\//g, "")
      source = source.replace(/\bencoder\.(encode|encodeInto)\(/g, "new TextEncoder().$1(")
      source = source.replace(/^const encoder = new TextEncoder\(\);?\s*$/gm, "")
      source = source.replace(/^const encoder = new TextEncoder\(\);?\n?/gm, "")

      source = source.replace(
        /export function Union\(members,\s*options\)\s*\{(\s*)return makeUnion\(AST\.union\(members,\s*options\?\.mode\s*\?\?\s*"anyOf",\s*undefined\),\s*members\);\s*\}/s,
        "export function Union(members, options) {\n" +
        "  if (!Array.isArray(members)) {\n" +
        "    var _uargs = Array.prototype.slice.call(arguments);\n" +
        "    members = _uargs;\n" +
        "    options = typeof _uargs[_uargs.length - 1] === 'object' && !Array.isArray(_uargs[_uargs.length - 1]) && _uargs.length > 1 ? _uargs.pop() : undefined;\n" +
        "  }\n" +
        "  return makeUnion(AST.union(members, (options && options.mode) || 'anyOf', undefined), members);\n" +
        "}"
      )

      source = source.replace(
        /export function check\(\.\.\.checks\)\s*\{(\s*)return self => self\.check\(\.\.\.checks\);\s*\}/s,
        "export function check() {\n" +
        "  var checks = Array.prototype.slice.call(arguments);\n" +
        "  return self => self.check.apply(self, checks);\n" +
        "}"
      )

      source = source.replace(
        /export function Literals\(literals\)\s*\{/,
        "export function Literals() { var literals = arguments.length === 1 && Array.isArray(arguments[0]) ? arguments[0] : Array.prototype.slice.call(arguments);",
      )

      source = source.replace(
        /export function Tuple\(elements\)\s*\{(\s*)return makeTuple\(AST\.tuple\(elements\), elements\);\s*\}/s,
        "export function Tuple() {\n" +
        "  var elements = arguments.length === 1 && Array.isArray(arguments[0]) ? arguments[0] : Array.prototype.slice.call(arguments);\n" +
        "  return makeTuple(AST.tuple(elements), elements);\n" +
        "}"
      )

      // 7. Fix memoize in Function.js — WeakMap crashes on undefined keys.
      if (args.path.includes("Function.js")) {
        source = source.replace(
          /export function memoize\(f\)\s*\{(\s*)const cache = new WeakMap\(\);\s*return a\s*=>\s*\{/s,
          "export function memoize(f) {\n" +
          "  const cache = new WeakMap();\n" +
          "  return a => {\n" +
          "    if (a == null) return f(a);",
        )
      }

      // 8. Guard toType et al against undefined, filter undefined from AST arrays,
      //    and guard SchemaParser.makeEffect / recurDefaults against null AST.
      if (args.path.includes("SchemaAST.js")) {
        source = source.replace(/=\s*memoize\(\(?\s*\w+\s*\)?\s*=>\s*\{/g,
          " = memoize((ast) => { if (ast == null) return ast;",
        )
        source = source.replace(
          /(export function union\(members, mode, checks\)\s*\{)/,
          "$1 if (Array.isArray(members)) members = members.filter(function(m) { return m != null; }); else return;",
        )
        source = source.replace(
          /(export function tuple\(elements, checks\s*=\s*undefined\)\s*\{)/,
          "$1 if (Array.isArray(elements)) elements = elements.filter(function(e) { return e != null; }); else return;",
        )
        source = source.replace(
          /(export function struct\(fields, checks, annotations\)\s*\{)/,
          "$1 if (fields && typeof fields === 'object') { var _keys = Object.keys(fields); for (var _i = 0; _i < _keys.length; _i++) { if (fields[_keys[_i]] == null) delete fields[_keys[_i]]; } }",
        )
      }
      if (args.path.includes("SchemaParser.js")) {
        source = source.replace(
          /const recurDefaults = memoize\(ast\s*=>\s*\{/,
          "const recurDefaults = memoize(ast => { if (ast == null) return ast;",
        )
        source = source.replace(
          /export function makeEffect\(schema\)\s*\{(\s*)const ast = recurDefaults\(AST\.toType\(schema\.ast\)\);/s,
          "export function makeEffect(schema) {\n" +
          "  if (schema == null || schema.ast == null) return;\n" +
          "  const ast = recurDefaults(AST.toType(schema.ast));",
        )
      }

      return { contents: source, loader: "js" }
    })
  },
}
const skipEmbedWebUi = process.argv.includes("--skip-embed-web-ui")

const createEmbeddedWebUIBundle = async () => {
  console.log(`Building Web UI to embed in the binary`)
  const appDir = path.join(import.meta.dirname, "../../app")
  const dist = path.join(appDir, "dist")
  await $`OPENCODE_CHANNEL=${Script.channel} bun run --cwd ${appDir} build`
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist })))
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !file.endsWith(".map"))
    .sort()
  const imports = files.map((file, i) => {
    const spec = path.relative(dir, path.join(dist, file)).replaceAll("\\", "/")
    return `import file_${i} from ${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)} with { type: "file" };`
  })
  const entries = files.map((file, i) => `  ${JSON.stringify(file)}: file_${i},`)
  return [
    `// Import all files as file_$i with type: "file"`,
    ...imports,
    `// Export with original mappings`,
    `export default {`,
    ...entries,
    `}`,
  ].join("\n")
}

const embeddedFileMap = skipEmbedWebUi ? null : await createEmbeddedWebUIBundle()

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "x64", avx2: false },
  { os: "linux", arch: "arm64", abi: "musl" },
  { os: "linux", arch: "x64", abi: "musl" },
  { os: "linux", arch: "x64", abi: "musl", avx2: false },
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "darwin", arch: "x64", avx2: false },
  { os: "win32", arch: "arm64" },
  { os: "win32", arch: "x64" },
  { os: "win32", arch: "x64", avx2: false },
]

const targets = singleFlag
  ? allTargets.filter((item) => {
      if (item.os !== process.platform || item.arch !== process.arch) return false
      if (item.avx2 === false) return baselineFlag
      if (item.abi !== undefined) return false
      return true
    })
  : allTargets

await $`rm -rf dist`

const binaries: Record<string, string> = {}
if (!skipInstall) {
  await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
  await $`bun install --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
  await $`bun install --os="*" --cpu="*" @ff-labs/fff-bun@${pkg.dependencies["@ff-labs/fff-bun"]}`
}
for (const item of targets) {
  const name = [
    pkg.name,
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
  console.log(`building ${name}`)
  await $`mkdir -p dist/${name}/bin`

  const localPath = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
  const rootPath = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js")
  const parserWorker = fs.realpathSync(fs.existsSync(localPath) ? localPath : rootPath)
  const workerPath = "./src/cli/tui/worker.ts"

  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
  const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

  // Build the server as a plain JS bundle (not compiled) so effect's Schema
  // system works — bun's --compile step corrupts Schema AST traversal.
  const serverOutDir = path.resolve(dir, `dist/${name}/bin`)
  await Bun.build({
    conditions: ["bun", "node"],
    tsconfig: "./tsconfig.json",
    plugins: [plugin, effectPlugin],
    external: ["node-gyp"],
    format: "esm",
    target: "bun",
    minify: false,
    sourcemap: "none",
    splitting: false,
    outdir: serverOutDir,
    naming: "opencode-server.js",
    entrypoints: ["./src/index.ts"],
    define: {
      FFF_LIBC: JSON.stringify(item.abi === "musl" ? "musl" : "gnu"),
      OPENCODE_VERSION: `'${Script.version}'`,
      OPENCODE_MODELS_DEV: generated.modelsData,
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
      OPENCODE_WORKER_PATH: workerPath,
      OPENCODE_CHANNEL: `'${Script.channel}'`,
      OPENCODE_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
    },
  })
  console.log(`Server bundle: ${path.join(serverOutDir, "opencode-server.js")}`)

  await Bun.build({
    conditions: ["bun", "node"],
    tsconfig: "./tsconfig.json",
    plugins: [plugin, effectPlugin],
    external: ["node-gyp"],
    format: "esm",
    minify: true,
    sourcemap: sourcemapsFlag ? "linked" : "none",
    splitting: true,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: name.replace(pkg.name, "bun") as any,
      outfile: `dist/${name}/bin/opencode`,
      execArgv: [`--user-agent=opencode/${Script.version}`, "--use-system-ca", "--"],
      windows: {},
    },
    files: embeddedFileMap ? { "opencode-web-ui.gen.ts": embeddedFileMap } : {},
    entrypoints: ["./src/index.ts", parserWorker, workerPath, ...(embeddedFileMap ? ["opencode-web-ui.gen.ts"] : [])],
    define: {
      FFF_LIBC: JSON.stringify(item.abi === "musl" ? "musl" : "gnu"),
      OPENCODE_VERSION: `'${Script.version}'`,
      OPENCODE_MODELS_DEV: generated.modelsData,
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
      OPENCODE_WORKER_PATH: workerPath,
      OPENCODE_CHANNEL: `'${Script.channel}'`,
      OPENCODE_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
      ...(item.os === "linux" ? { "process.env.OPENTUI_LIBC": JSON.stringify(item.abi ?? "glibc") } : {}),
    },
  })

  if (item.os === process.platform && item.arch === process.arch && !item.abi) {
    const binaryPath = `dist/${name}/bin/opencode`
    console.log(`Running smoke test: ${binaryPath} --version`)
    try {
      const versionOutput = await $`${binaryPath} --version`.text()
      console.log(`Smoke test passed: ${versionOutput.trim()}`)
    } catch (e) {
      console.error(`Smoke test failed for ${name}:`, e)
      process.exit(1)
    }
  }

  await $`rm -rf ./dist/${name}/bin/tui`
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        preferUnplugged: true,
        os: [item.os],
        cpu: [item.arch],
        ...(item.abi ? { libc: [item.abi] } : {}),
      },
      null,
      2,
    ),
  )
  binaries[name] = Script.version
}

if (Script.release) {
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      await $`tar -czf ../../${key}.tar.gz *`.cwd(`dist/${key}/bin`)
    } else {
      await $`zip -r ../../${key}.zip *`.cwd(`dist/${key}/bin`)
    }
  }
  await $`gh release upload v${Script.version} ./dist/*.zip ./dist/*.tar.gz --clobber --repo ${process.env.GH_REPO}`
}

export { binaries }
