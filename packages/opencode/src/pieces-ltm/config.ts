import { Context } from "effect"

export class PiecesLTMConfig extends Context.Service<
  PiecesLTMConfig,
  {
    readonly mcpURL: string
    readonly defaultTimeout: number
    readonly healthCheckEnabled: boolean
  }
>()("@dreamcode/PiecesLTM/Config") {
  static readonly default = PiecesLTMConfig.of({
    mcpURL:
      process.env["PIECES_MCP_URL"] ??
      "http://localhost:39302/model_context_protocol/2024-11-05",
    defaultTimeout: 30_000,
    healthCheckEnabled: true,
  })
}
