import { config } from "dotenv"
import { resolve } from "node:path"

// Same root `.env` as the server and the migrator, regardless of cwd.
config({ path: resolve(import.meta.dirname, "../../../.env"), quiet: true })
