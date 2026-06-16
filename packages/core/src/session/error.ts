import { Schema } from "effect"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"

export class MessageDecodeError extends Schema.TaggedErrorClass<MessageDecodeError>()("Session.MessageDecodeError", {
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
}) {}

export class ContextSnapshotDecodeError extends Schema.TaggedErrorClass<ContextSnapshotDecodeError>()(
  "Session.ContextSnapshotDecodeError",
  {
    sessionID: SessionSchema.ID,
    details: Schema.String,
  },
) {
  override get message() {
    return `Failed to decode context snapshot for session ${this.sessionID}: ${this.details}`
  }
}

export class SessionNotFoundError extends Schema.TaggedErrorClass<SessionNotFoundError>()(
  "Session.SessionNotFoundError",
  { sessionID: SessionSchema.ID },
) {
  override get message() {
    return `Session not found: ${this.sessionID}`
  }
}

export class PublishValidationError extends Schema.TaggedErrorClass<PublishValidationError>()(
  "Session.PublishValidationError",
  { message: Schema.String },
) {}
