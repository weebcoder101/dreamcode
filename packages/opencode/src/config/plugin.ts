import { Glob } from "@opencode-ai/core/util/glob"
import { ConfigPluginV1 } from "@opencode-ai/core/v1/config/plugin"
import { pathToFileURL } from "url"
import { isPathPluginSpec, parsePluginSpecifier, resolvePathPluginTarget } from "@/plugin/shared"
import path from "path"

export type Scope = "global" | "local"

// Origin keeps the original config provenance attached to a spec.
// After multiple config files are merged, callers still need to know which file declared the plugin
// and whether it should behave like a global or project-local plugin.
export type Origin = {
  spec: ConfigPluginV1.Spec
  source: string
  scope: Scope
}

export async function load(dir: string) {
  const plugins: ConfigPluginV1.Spec[] = []
  const seen = new Set<string>()

  const addPlugins = async (pluginsDir: string) => {
    for (const item of await Glob.scan("*.{ts,js}", {
      cwd: pluginsDir,
      absolute: true,
      dot: true,
      symlink: true,
    }).catch(() => [])) {
      const fileUrl = pathToFileURL(item).href
      if (!seen.has(fileUrl)) {
        seen.add(fileUrl)
        plugins.push(fileUrl)
      }
    }
  }

  // 1. CWD plugins (local project: ./plugins/)
  await addPlugins(path.join(dir, "plugins")).catch(() => {})

  // 2. CWD .opencode plugins (local development: ./.opencode/plugins/)
  await addPlugins(path.join(dir, ".opencode", "plugins")).catch(() => {})

  // 3. Binary-bundled plugins dir (release artifact: dirname(process.execPath)/plugins/)
  await addPlugins(path.join(path.dirname(process.execPath), "plugins")).catch(() => {})

  // 4. XDG config plugins dir (~/.config/dreamcode/plugins/)
  const home = process.env.HOME || process.env.USERPROFILE || ""
  if (home) {
    await addPlugins(path.join(home, ".config", "dreamcode", "plugins")).catch(() => {})
    // 5. Legacy config dir (~/.dreamcode/plugins/) — backward compat for old installs
    await addPlugins(path.join(home, ".dreamcode", "plugins")).catch(() => {})
  }

  return plugins
}

export function pluginSpecifier(plugin: ConfigPluginV1.Spec): string {
  return Array.isArray(plugin) ? plugin[0] : plugin
}

export function pluginOptions(plugin: ConfigPluginV1.Spec): ConfigPluginV1.Options | undefined {
  return Array.isArray(plugin) ? plugin[1] : undefined
}

// Path-like specs are resolved relative to the config file that declared them so merges later on do not
// accidentally reinterpret `./plugin.ts` relative to some other directory.
export async function resolvePluginSpec(
  plugin: ConfigPluginV1.Spec,
  configFilepath: string,
): Promise<ConfigPluginV1.Spec> {
  const spec = pluginSpecifier(plugin)
  if (!isPathPluginSpec(spec)) return plugin

  const base = path.dirname(configFilepath)
  const file = (() => {
    if (spec.startsWith("file://")) return spec
    if (path.isAbsolute(spec) || /^[A-Za-z]:[\\/]/.test(spec)) return pathToFileURL(spec).href
    return pathToFileURL(path.resolve(base, spec)).href
  })()

  const resolved = await resolvePathPluginTarget(file).catch(() => file)

  if (Array.isArray(plugin)) return [resolved, plugin[1]]
  return resolved
}

// Dedupe on the load identity (package name for npm specs, exact file URL for local specs), but keep the
// full Origin so downstream code still knows which config file won and where follow-up writes should go.
export function deduplicatePluginOrigins(plugins: Origin[]): Origin[] {
  const seen = new Set<string>()
  const list: Origin[] = []

  for (const plugin of plugins.toReversed()) {
    const spec = pluginSpecifier(plugin.spec)
    const name = spec.startsWith("file://") ? spec : parsePluginSpecifier(spec).pkg
    if (seen.has(name)) continue
    seen.add(name)
    list.push(plugin)
  }

  return list.toReversed()
}

export * as ConfigPlugin from "./plugin"
