import { Command } from "effect/cli"
import { hhAccountCommand } from "./hh-account.ts"
import { hhImportCommand } from "./hh-import.ts"
import { hhLoginCommand } from "./hh-login.ts"
import { hhProfilesCommand } from "./hh-profiles.ts"
import { hhCaptchaCommand, hhResumeCommand } from "./hh-resume.ts"
import { hhResumesCommand } from "./hh-resumes.ts"
import { hhStatusCommand } from "./hh-status.ts"
import { hhSyncCommand } from "./hh-sync.ts"

export const hhCommand = Command.make("hh").pipe(
  Command.withSubcommands([hhAccountCommand, hhCaptchaCommand, hhImportCommand, hhLoginCommand, hhProfilesCommand, hhResumeCommand, hhResumesCommand, hhStatusCommand, hhSyncCommand]),
  Command.withDescription("hh.ru session and account commands")
)
