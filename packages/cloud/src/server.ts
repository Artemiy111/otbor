import { OtborRpcs, RPC_PATH } from "@otbor/contract"
import { NodeHttpServer, NodeRuntime, NodeServices } from "@effect/platform-node"
import { Config, Effect, FileSystem, Layer, Logger } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { createServer } from "node:http"
import { join, resolve } from "node:path"
import "./env.ts"
import { Database } from "./db/Database.ts"
import { EmployerLogoRoute } from "./http/employerLogoRoute.ts"
import { OtborHandlers, OtborServices } from "./rpc/handlers.ts"
import { ensureBootstrapUser, ensureSystemPresets } from "./services/bootstrap.ts"
import { CurrentUser } from "./services/CurrentUser.ts"

const RpcRoute = RpcServer.layerHttp({
  group: OtborRpcs,
  path: RPC_PATH,
  protocol: "http"
}).pipe(
  Layer.provide(OtborHandlers),
  Layer.provide(RpcSerialization.layerNdjson),
  // Общий HTTP-лог бесполезен для RPC: метод логируется в handlers.ts
  Layer.provide(HttpRouter.disableLogger)
)

const HealthRoute = Layer.effectDiscard(
  Effect.gen(function*() {
    const router = yield* HttpRouter.HttpRouter
    yield* router.add(
      "GET",
      "/health",
      Effect.succeed(HttpServerResponse.text(JSON.stringify({ status: "ok" })))
    )
  })
)

/**
 * One build graph: the handlers, the queue worker and the bootstrap step share
 * the same pool and the same `CurrentUser`. Providing `Runtime` twice would
 * open two pools, so it sits at the very top.
 */
const AppLayer = Layer.mergeAll(
  RpcRoute,
  HealthRoute,
  EmployerLogoRoute,
  Layer.effectDiscard(ensureBootstrapUser),
  Layer.effectDiscard(ensureSystemPresets)
)

const Runtime = Layer.mergeAll(Database.layer, CurrentUser.layer)

const ServerLayer = HttpRouter.serve(AppLayer).pipe(
  Layer.provide(OtborServices),
  Layer.provide(Runtime),
  Layer.provide(
    NodeHttpServer.layerConfig(createServer, {
      port: Config.Port("PORT").pipe(Config.withDefault(3001)),
      host: Config.String("HOST").pipe(Config.withDefault("127.0.0.1"))
    })
  )
)

/**
 * Terminal logs keep their pretty format; the same entries are appended as
 * JSON lines to `logs/app-YYYY-MM-DD.log`.
 */
const logDir = process.env.LOG_DIR ?? resolve(import.meta.dirname, "../../../logs")
const logDay = new Date().toISOString().slice(0, 10)
const logFile = join(logDir, `app-${logDay}.log`)

const fileLogger = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(logDir, { recursive: true })
  return yield* Logger.toFile(Logger.formatJson, logFile, { flag: "a" })
})

const LoggerLayer = Logger.layer([Logger.consolePretty(), fileLogger]).pipe(
  Layer.provide(NodeServices.layer)
)

Layer.launch(ServerLayer).pipe(Effect.provide(LoggerLayer), NodeRuntime.runMain)
