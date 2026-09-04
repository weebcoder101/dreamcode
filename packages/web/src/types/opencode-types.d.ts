
// Global declarations to silence third-party module errors
declare global {
  var toolbeamDocsThemeConfig: any
}

// Stub types for the dreamcode (formerly opencode) session exports used by web.
declare module "dreamcode/session/message-v2" {
  export type Part = any
  export type Info = any
  export type User = any
  export type Assistant = any
  export type ToolPart = any
  export type ToolState = any
  export type ToolStatePending = any
  export type ToolStateRunning = any
  export type ToolStateCompleted = any
  export type ToolStateError = any
  export type TextPart = any
  export type FilePart = any
  export type StepStartPart = any
  export type StepFinishPart = any
  export type SubtaskPart = any
  export type CompactionPart = any
  export type SnapshotPart = any
  export type PatchPart = any
  export type RetryPart = any
  export type AgentPart = any
  export type ReasoningPart = any
  export type WithParts = any
  export type OutputFormat = any
  // Namespace for legacy `MessageV2.X` access patterns
  export const MessageV2: {
    Part: any
    Info: any
    User: any
    Assistant: any
    ToolPart: any
    ToolState: any
    ToolStatePending: any
    ToolStateRunning: any
    ToolStateCompleted: any
    ToolStateError: any
    TextPart: any
    FilePart: any
    StepStartPart: any
    StepFinishPart: any
    SubtaskPart: any
    CompactionPart: any
    SnapshotPart: any
    PatchPart: any
    RetryPart: any
    AgentPart: any
    ReasoningPart: any
    WithParts: any
  }
}
declare module "dreamcode/session/session" {
  export type Info = any
  export class Service {}
  export const Session: {
    Info: any
    Service: any
  }
}
declare module "dreamcode/session/message" {
  const _any: any
  export = _any
  export const Info: any
}
