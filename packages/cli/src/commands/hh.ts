import { Command } from "effect/cli"
import { hhLoginCommand } from "./hh-login.ts"
import { hhStatusCommand } from "./hh-status.ts"

export const hhCommand = Command.make("hh").pipe(
  Command.withSubcommands([hhLoginCommand, hhStatusCommand]),
  Command.withDescription("hh.ru session commands")
)
