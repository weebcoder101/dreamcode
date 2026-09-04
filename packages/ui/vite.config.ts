import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"
import { iconsSpritesheet } from "vite-plugin-icons-spritesheet"
import fs from "fs"
import path from "path"

const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/
const MAX_SVG_BYTES = 256 * 1024
const ALLOWED_MODELS_URL = new Set([
  "https://models.dev",
  "https://models.zanity.net",
])

function safeProviderName(name: unknown): string | null {
  if (typeof name !== "string") return null
  if (!SAFE_NAME.test(name)) return null
  return name
}

function safeSvg(body: string): string | null {
  if (body.length > MAX_SVG_BYTES) return null
  if (/<(script|foreignObject|iframe|object|embed|use|a|image)\b/i.test(body)) return null
  if (/\bon\w+\s*=/i.test(body)) return null
  if (/javascript:/i.test(body)) return null
  return body
}

async function fetchProviderIcons() {
  const url = process.env.OPENCODE_MODELS_URL || "https://models.dev"
  if (!ALLOWED_MODELS_URL.has(url)) {
    console.error(`[provider-icons] refusing fetch from non-allowlisted URL: ${url}`)
    return
  }
  let json: unknown
  try {
    const res = await fetch(`${url}/api.json`)
    if (!res.ok) return
    json = await res.json()
  } catch (err) {
    console.error("[provider-icons] failed to fetch /api.json:", err)
    return
  }
  if (!json || typeof json !== "object") return
  const providers = Object.keys(json as Record<string, unknown>)
  const dir = path.resolve("./src/assets/icons/provider")
  fs.mkdirSync(dir, { recursive: true })
  await Promise.allSettled(
    providers.map(async (raw) => {
      const name = safeProviderName(raw)
      if (!name) {
        console.warn(`[provider-icons] skipping unsafe provider name: ${raw}`)
        return
      }
      try {
        const res = await fetch(`${url}/logos/${name}.svg`)
        if (!res.ok) return
        const body = await res.text()
        const safe = safeSvg(body)
        if (!safe) {
          console.warn(`[provider-icons] rejecting unsafe SVG for: ${name}`)
          return
        }
        fs.writeFileSync(path.join(dir, `${name}.svg`), safe)
      } catch (err) {
        console.warn(`[provider-icons] failed to fetch icon for ${name}:`, err)
      }
    }),
  )
}

export default defineConfig({
  plugins: [
    solidPlugin(),
    providerIconsPlugin(),
    iconsSpritesheet([
      {
        withTypes: true,
        inputDir: "src/assets/icons/file-types",
        outputDir: "src/components/file-icons",
        formatter: "prettier",
      },
      {
        withTypes: true,
        inputDir: "src/assets/icons/provider",
        outputDir: "src/components/provider-icons",
        formatter: "prettier",
        iconNameTransformer: (iconName) => iconName,
      },
    ]),
  ],
  server: { port: 3001 },
  build: {
    target: "esnext",
  },
  worker: {
    format: "es",
  },
})

function providerIconsPlugin() {
  return {
    name: "provider-icons-plugin",
    configureServer() {
      void fetchProviderIcons()
    },
    buildStart() {
      void fetchProviderIcons()
    },
  }
}
