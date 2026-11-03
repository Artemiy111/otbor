import { Command } from "effect/cli"
import { hhAccountCommand } from "./hh-account.ts"
import { hhLoginCommand } from "./hh-login.ts"
import { hhProfilesCommand } from "./hh-profiles.ts"
import { hhStatusCommand } from "./hh-status.ts"
import { hhSyncCommand } from "./hh-sync.ts"

export const hhCommand = Command.make("hh").pipe(
  Command.withSubcommands([hhAccountCommand, hhLoginCommand, hhProfilesCommand, hhStatusCommand, hhSyncCommand]),
  Command.withDescription("hh.ru session and account commands")
)
