import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { runMcpServer } from "./index.ts"

runMcpServer.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
