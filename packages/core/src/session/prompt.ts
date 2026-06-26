import * as Schema from "effect/Schema"

export class Source extends Schema.Class<Source>("Prompt.Source")({
  start: Schema.Finite,
  end: Schema.Finite,
  text: Schema.String,
}) {
  static toEncoded(input: Source): unknown {
    return { start: input.start, end: input.end, text: input.text }
  }
}

export class FileAttachment extends Schema.Class<FileAttachment>("Prompt.FileAttachment")({
  uri: Schema.String,
  mime: Schema.String,
  name: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
  source: Source.pipe(Schema.optional),
}) {
  static create(input: FileAttachment) {
    return new FileAttachment({
      uri: input.uri,
      mime: input.mime,
      name: input.name,
      description: input.description,
      source: input.source,
    })
  }

  static toEncoded(input: FileAttachment): unknown {
    return {
      uri: input.uri,
      mime: input.mime,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.source !== undefined ? { source: Source.toEncoded(input.source) } : {}),
    }
  }
}

export class AgentAttachment extends Schema.Class<AgentAttachment>("Prompt.AgentAttachment")({
  name: Schema.String,
  source: Source.pipe(Schema.optional),
}) {
  static toEncoded(input: AgentAttachment): unknown {
    return {
      name: input.name,
      ...(input.source !== undefined ? { source: Source.toEncoded(input.source) } : {}),
    }
  }
}

export class Prompt extends Schema.Class<Prompt>("Prompt")({
  text: Schema.String,
  files: Schema.Array(FileAttachment).pipe(Schema.optional),
  agents: Schema.Array(AgentAttachment).pipe(Schema.optional),
}) {
  static readonly equivalence = Schema.toEquivalence(Prompt)

  static fromUserMessage(input: Pick<Prompt, "text" | "files" | "agents">) {
    return new Prompt({
      text: input.text,
      ...(input.files === undefined ? {} : { files: input.files }),
      ...(input.agents === undefined ? {} : { agents: input.agents }),
    })
  }

  static toEncoded(input: Prompt): unknown {
    return {
      text: input.text,
      ...(input.files !== undefined ? { files: input.files.map(FileAttachment.toEncoded) } : {}),
      ...(input.agents !== undefined ? { agents: input.agents.map(AgentAttachment.toEncoded) } : {}),
    }
  }
}
