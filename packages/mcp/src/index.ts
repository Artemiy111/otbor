import { Layer } from "effect"
import { McpServerLive } from "./server.ts"

export { Api, ApiLayer, apiLayerFor, DEFAULT_API_URL } from "./api.ts"
export { ToolFailure, unreachableMessage } from "./errors.ts"
export { OtborReadHandlers } from "./handlers.ts"
export {
  McpServerLive,
  McpStdio,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  OtborReadRegistration,
  OtborToolkitRegistration,
  OtborWriteRegistration,
  ReadOnlyConfig,
  registrationFor,
  StderrLogging
} from "./server.ts"
export { OtborReadToolkit, SERVER_INSTRUCTIONS, serverInstructions } from "./tools.ts"
export { OtborWriteHandlers } from "./write-handlers.ts"
export { OtborWriteToolkit } from "./write-tools.ts"

/**
 * Runs the MCP server on stdio until the client disconnects. Requires only
 * `Stdio` (use `NodeServices.layer`). Mount as `otbor mcp`:
 * `Command.make("mcp", {}, () => runMcpServer)`.
 */
export const runMcpServer = Layer.launch(McpServerLive)
