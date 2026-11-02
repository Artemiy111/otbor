import { Command } from "effect/cli"
import { hhAccountCommand } from "./hh-account.ts"
import { hhLoginCommand } from "./hh-login.ts"
import { hhProfilesCommand } from "./hh-profiles.ts"
import { hhStatusCommand } from "./hh-status.ts"

export const hhCommand = Command.make("hh").pipe(
  Command.withSubcommands([hhAccountCommand, hhLoginCommand, hhProfilesCommand, hhStatusCommand]),
  Command.withDescription("hh.ru session and account commands")
)
