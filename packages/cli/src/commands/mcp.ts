import { runMcpServer } from "@otbor/mcp"
import { Command } from "effect/cli"

/**
 * stdout belongs to JSON-RPC while this runs; the server logs to stderr and
 * talks to the API over the same RPC group as every other command.
 */
export const mcpCommand = Command.make("mcp", {}, () => runMcpServer).pipe(
  Command.withDescription("Run the read-only MCP server on stdio (for Claude Code, OpenCode)")
)
