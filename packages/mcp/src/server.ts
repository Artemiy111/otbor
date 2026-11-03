import { Layer, Logger } from "effect"
import { McpProtocol, McpServer } from "effect/ai"
import { ApiLayer } from "./api.ts"
import { OtborReadHandlers } from "./handlers.ts"
import { OtborReadToolkit, SERVER_INSTRUCTIONS } from "./tools.ts"

export const MCP_SERVER_NAME = "otbor"
export const MCP_SERVER_VERSION = "0.1.0"

/**
 * Everything the server registers. Read-only today. To add write tools, build
 * another toolkit + handlers layer and merge it here; the transport below does
 * not change.
 */
export const OtborToolkitRegistration = McpServer.toolkit(OtborReadToolkit).pipe(
  Layer.provide(OtborReadHandlers)
)

/**
 * MCP over stdio. Requires `Stdio` (provided by `NodeServices.layer`). The API
 * client is built here from `OTBOR_API_URL`, so the host app does not need to
 * provide one. Building the client never connects, so a down API only fails
 * individual tool calls.
 */
export const McpStdio = McpServer.layerStdio({
  name: MCP_SERVER_NAME,
  version: MCP_SERVER_VERSION,
  instructions: SERVER_INSTRUCTIONS,
  protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26, McpProtocol.v2024_11_05],
  registrations: OtborToolkitRegistration
}).pipe(Layer.provide(ApiLayer))

/** stdout carries JSON-RPC only: every log line goes to stderr. */
export const StderrLogging = Layer.succeed(Logger.LogToStderr, true)

/** A runnable server layer: `Layer.launch(McpServerLive)` or provide it to a CLI command. */
export const McpServerLive = McpStdio.pipe(Layer.provide(StderrLogging))
