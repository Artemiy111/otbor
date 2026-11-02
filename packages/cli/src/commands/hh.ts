import { Command } from "effect/cli"
import { hhLoginCommand } from "./hh-login.ts"
import { hhProfilesCommand } from "./hh-profiles.ts"
import { hhStatusCommand } from "./hh-status.ts"

export const hhCommand = Command.make("hh").pipe(
  Command.withSubcommands([hhLoginCommand, hhProfilesCommand, hhStatusCommand]),
  Command.withDescription("hh.ru session commands")
)
