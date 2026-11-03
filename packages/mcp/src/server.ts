import { Config, Effect, Layer, Logger } from "effect"
import { McpProtocol, McpServer } from "effect/ai"
import { ApiLayer } from "./api.ts"
import { OtborReadHandlers } from "./handlers.ts"
import { OtborReadToolkit, serverInstructions } from "./tools.ts"
import { OtborWriteHandlers } from "./write-handlers.ts"
import { OtborWriteToolkit } from "./write-tools.ts"

export const MCP_SERVER_NAME = "otbor"
export const MCP_SERVER_VERSION = "0.2.0"

/** The read toolkit alone: what `OTBOR_MCP_READONLY=1` registers. */
export const OtborReadRegistration = McpServer.toolkit(OtborReadToolkit).pipe(
  Layer.provide(OtborReadHandlers)
)

/** The write toolkit alone. Sending is gated twice: `confirm: true` here, the daily limit in the cloud. */
export const OtborWriteRegistration = McpServer.toolkit(OtborWriteToolkit).pipe(
  Layer.provide(OtborWriteHandlers)
)

/** Everything the server registers by default: read + write. */
export const OtborToolkitRegistration = Layer.merge(OtborReadRegistration, OtborWriteRegistration)

/** Read-only or full, as chosen by the operator. */
export const registrationFor = (readOnly: boolean) =>
  readOnly ? OtborReadRegistration : OtborToolkitRegistration

/** `OTBOR_MCP_READONLY=1` (or true/yes/on) registers only the read tools. */
export const ReadOnlyConfig = Config.Boolean("OTBOR_MCP_READONLY").pipe(Config.withDefault(false))

/**
 * MCP over stdio. Requires `Stdio` (provided by `NodeServices.layer`). The API
 * client is built here from `OTBOR_API_URL`, so the host app does not need to
 * provide one. Building the client never connects, so a down API only fails
 * individual tool calls.
 */
export const McpStdio = Layer.unwrap(
  Effect.map(ReadOnlyConfig, (readOnly) =>
    McpServer.layerStdio({
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
      instructions: serverInstructions(readOnly),
      protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26, McpProtocol.v2024_11_05],
      registrations: registrationFor(readOnly)
    }))
).pipe(Layer.provide(ApiLayer))

/** stdout carries JSON-RPC only: every log line goes to stderr. */
export const StderrLogging = Layer.succeed(Logger.LogToStderr, true)

/** A runnable server layer: `Layer.launch(McpServerLive)` or provide it to a CLI command. */
export const McpServerLive = McpStdio.pipe(Layer.provide(StderrLogging))
