/**
 * @opencode-ai/core/internal — Explicit internal API surface.
 *
 * These exports are used across the monorepo but are NOT part of the stable
 * public API. Breaking changes to these exports do not follow semver.
 *
 * Consumers SHOULD migrate to @opencode-ai/core/public wherever possible.
 * The ./[* ] wildcard export that allows arbitrary deep imports will be removed
 * in a future major version after all internal consumers have been migrated.
 */

// Re-export internal modules that are consumed across the monorepo
export * as EventV2 from "../event"
export * as ProviderV2 from "../provider"
export * as Location from "../location"
export * as Global from "../global"
export * as Schema from "../schema"
export * as Npm from "../npm"
export * as NpmConfig from "../npm-config"
export * as Credential from "../credential"
export * as Flag from "../flag/flag"
export * as LayerNode from "../effect/layer-node"
export * as ServiceUse from "../effect/service-use"
export * as FileSystem from "../filesystem/filesystem"
export * as FsUtil from "../fs-util"
export * as Database from "../database/database"
export * as SessionStore from "../session/store"
export * as SessionSchema from "../session/schema"
export * as SessionRunner from "../session/runner"
export * as SessionExecution from "../session/execution"
export * as SessionEvent from "../session/event"
export * as SessionInput from "../session/input"
export * as SessionHistory from "../session/history"
export * as SessionMessage from "../session/message"
export * as SessionMessageID from "../session/message-id"
export * as SessionRunCoordinator from "../session/run-coordinator"
export * as SessionCompaction from "../session/compaction"
export * as SessionContextEpoch from "../session/context-epoch"
export * as SessionProjector from "../session/projector"
export * as InstallationVersion from "../installation/version"
export * as SystemContext from "../system-context/index"
export * as SystemContextRegistry from "../system-context/registry"
export * as ToolOutputStore from "../tool-output-store"
export * as ToolRegistry from "../tool/registry"
export * as PermissionV2 from "../permission"
export * as AgentV2 from "../agent"
export * as ModelV2 from "../model"
export * as Reference from "../reference"
export * as Integration from "../integration"
export * as CommandV2 from "../command"
export * as Config from "../config"
export * as Policy from "../policy"
export * as PluginV2 from "../plugin"
export * as PluginBoot from "../plugin/boot"
export * as Catalog from "../catalog"
export * as QuestionV2 from "../question"
export * as SkillV2 from "../skill"
export * as LocationMutation from "../location-mutation"
export * as Watcher from "../watcher"
export * as Pty from "../pty"
export * as Tool from "../tool/tool"
