import { config } from "dotenv"
import { resolve } from "node:path"

// Load the monorepo root `.env` regardless of the package working directory.
config({ path: resolve(import.meta.dirname, "../../../.env"), quiet: true })
