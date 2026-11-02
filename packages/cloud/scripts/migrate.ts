import { NodeRuntime } from "@effect/platform-node"
import { migrateProgram } from "../src/db/migrate.ts"

NodeRuntime.runMain(migrateProgram({ reset: true }))
