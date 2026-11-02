import { Command } from "effect/cli"
import { hhLoginCommand } from "./hh-login.ts"

export const hhCommand = Command.make("hh").pipe(
  Command.withSubcommands([hhLoginCommand]),
  Command.withDescription("hh.ru session commands")
)
