import { Effect, Layer, Context } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"

async function main() {
  const mod = await import("./src/server/routes/instance/httpapi/server.ts")
  
  // Replicate createRoutes() BUT without uiRoute
  // This is a minimal reproduction
  const { 
    rootApiRoutes, eventApiRoutes, ptyConnectApiRoutes, 
    instanceRoutes, serverRoutes, docRoute,
    errorLayer, compressionLayer, corsVaryFix, securityHeaders,
    fenceLayer, cors, Database, Account, Agent, Auth,
    BackgroundJob, Command, Config, Format, LSP, LLM,
    Installation, MCP, ModelsDev, Permission, Plugin,
    Project, ProjectV2, ProjectCopy, MoveSession,
    ProviderAuth, Provider, PtyTicket, Question,
    RuntimeFlags, Session, SessionCompaction, ContextCompressor,
    SensorGate, SessionPrompt, SessionRevert, SessionShare,
    SessionRunState, SessionStatus, SessionSummary, ShareNext,
    Snapshot, EventV2Bridge, EventV2, Skill, Todo, ToolRegistry,
    Vcs, Workspace, Worktree, FSUtil, FetchHttpClient,
    HttpServer: HttpServerSvcs, CorsConfig, InstanceLayer,
    Ripgrep, Observability
  } = await import("./src/server/routes/instance/httpapi/server.ts")
  
  // Build routes WITHOUT uiRoute
  const routes = Layer.mergeAll(
    rootApiRoutes,
    eventApiRoutes,
    ptyConnectApiRoutes,
    instanceRoutes,
    serverRoutes,
    docRoute,
    // uiRoute intentionally omitted
  ).pipe(
    Layer.provide([
      errorLayer,
      compressionLayer,
      corsVaryFix,
      securityHeaders,
      fenceLayer.pipe(Layer.provide(Database.defaultLayer)),
      cors(undefined),
      Database.defaultLayer,
      Account.defaultLayer,
      Agent.defaultLayer,
      Auth.defaultLayer,
      BackgroundJob.defaultLayer,
      Command.defaultLayer,
      Config.defaultLayer,
      Format.defaultLayer,
      LSP.defaultLayer,
      LLM.defaultLayer,
      Installation.defaultLayer,
      MCP.defaultLayer,
      ModelsDev.defaultLayer,
      Permission.defaultLayer,
      Plugin.defaultLayer,
      Project.defaultLayer,
      ProjectV2.defaultLayer,
      ProjectCopy.defaultLayer,
      MoveSession.defaultLayer,
      ProviderAuth.defaultLayer,
      Provider.defaultLayer,
      PtyTicket.defaultLayer,
      Question.defaultLayer,
      RuntimeFlags.defaultLayer,
      Session.defaultLayer,
      SessionCompaction.defaultLayer,
      ContextCompressor.defaultLayer,
      SensorGate.defaultLayer,
      SessionPrompt.defaultLayer,
      SessionRevert.defaultLayer,
      SessionShare.defaultLayer,
      SessionRunState.defaultLayer,
      SessionStatus.defaultLayer,
      SessionSummary.defaultLayer,
      ShareNext.defaultLayer,
      Snapshot.defaultLayer,
      EventV2Bridge.defaultLayer,
      EventV2.defaultLayer,
      Skill.defaultLayer,
      Todo.defaultLayer,
      ToolRegistry.defaultLayer,
      Vcs.defaultLayer,
      Workspace.defaultLayer,
      Worktree.appLayer,
      FSUtil.defaultLayer,
      FetchHttpClient.layer,
      HttpServerSvcs.layerServices,
    ]),
    Layer.provide(Layer.succeed(CorsConfig)(undefined)),
    Layer.provideMerge(Ripgrep.defaultLayer),
    Layer.provide(InstanceLayer.layer),
    Layer.provideMerge(Observability.layer),
  )
  
  const wh = HttpRouter.toWebHandler(routes, {
    disableLogger: true,
    memoMap: Layer.makeMemoMapUnsafe(),
  })
  
  const ctx = Context.makeUnsafe<unknown>(new Map())
  
  const r1 = await wh.handler(new Request("http://localhost/doc"), ctx)
  console.log("GET /doc (no UI):", r1.status, (await r1.text()).slice(0, 100))
}

main().catch((e: any) => console.error("FATAL:", e?.message ?? String(e)))
