import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement — allow both 1.2.x and 1.3.x
const expectedBunVersionRange = `>=1.2.0 <2.0.0`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  OPENCODE_CHANNEL: process.env["OPENCODE_CHANNEL"],
  OPENCODE_BUMP: process.env["OPENCODE_BUMP"],
  OPENCODE_VERSION: process.env["OPENCODE_VERSION"],
  OPENCODE_RELEASE: process.env["OPENCODE_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.OPENCODE_CHANNEL) return env.OPENCODE_CHANNEL
  if (env.OPENCODE_BUMP) return "latest"
  if (env.OPENCODE_VERSION && !env.OPENCODE_VERSION.startsWith("0.0.0-")) return "latest"
  const branch = await $`git branch --show-current`.text().then((x) => x.trim())
  // SECURITY: detached HEAD produces a literal "HEAD" branch string.
  // Refuse to compute a release in that case. See wave5-retry F-MISC-03.
  if (branch === "HEAD") {
    throw new Error(
      "Detached HEAD detected. Set OPENCODE_CHANNEL explicitly or check out a real branch before running the release script.",
    )
  }
  return branch
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.OPENCODE_VERSION) return env.OPENCODE_VERSION
  // Read from packages/opencode/package.json — the single source of truth
  const opencodePkgPath = path.resolve(import.meta.dir, "../../../packages/opencode/package.json")
  const pkgVersion = await Bun.file(opencodePkgPath).json().then((p: any) => p.version).catch(() => null)
  if (pkgVersion) {
    if (IS_PREVIEW) {
      console.warn(`[Script] No OPENCODE_VERSION env set — using version ${pkgVersion} from package.json`)
    }
    return pkgVersion
  }
  if (IS_PREVIEW) {
    console.warn(`[Script] No OPENCODE_VERSION env set and CHANNEL="${CHANNEL}" — using fallback 1.1.0. Install via dreamcode/install.sh to get the correct version.`)
    return `1.1.0`
  }
  // SECURITY: 5s timeout, identifying User-Agent, pinned channel.
  // The full fix (registry SHA-256 verification, channel-pinned
  // endpoint) is tracked in the audit. See wave5-retry F-MISC-02.
  const version = await fetch("https://registry.npmjs.org/opencode-ai/latest", {
    signal: AbortSignal.timeout(5_000),
    headers: { "User-Agent": "opencode-release-script/1.0" },
  })
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: any) => data.version)
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.OPENCODE_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

const bot = ["actions-user", "opencode", "opencode-agent[bot]"]
const teamPath = path.resolve(import.meta.dir, "../../../.github/TEAM_MEMBERS")
const team = [
  ...(await Bun.file(teamPath)
    .text()
    .then((x) => x.split(/\r?\n/).map((x) => x.trim()))
    .then((x) => x.filter((x) => x && !x.startsWith("#")))),
  ...bot,
]

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.OPENCODE_RELEASE
  },
  get team() {
    return team
  },
}
// SECURITY: only emit the Script summary in debug mode. The full fix
// (drop the log entirely; the export is what matters) is tracked in
// the audit. See wave5-retry F-MISC-04.
if (process.env.SCRIPT_DEBUG) {
  console.log(`opencode script`, JSON.stringify(Script, null, 2))
}
