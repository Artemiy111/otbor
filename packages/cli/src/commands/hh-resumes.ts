import type { HhAccountId, ResumeSyncStatus } from "@otbor/contract"
import { Console, Effect, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { Api } from "../client.ts"

const accountFlag = Flag.String("account").pipe(
  Flag.withDescription("hh account id (defaults to OTBOR_HH_ACCOUNT_ID, or the only account)"),
  Flag.optional
)

const waitFlag = Flag.Int("wait").pipe(
  Flag.withDescription("Seconds to wait for the harness to finish; 0 only queues the sync"),
  Flag.withDefault(180)
)

const TERMINAL: ReadonlyArray<ResumeSyncStatus["status"]> = ["done", "failed", "needs_human"]

const printOutcome = (status: ResumeSyncStatus) =>
  Effect.gen(function*() {
    yield* Console.log(`status:   ${status.status}`)
    if (status.message) yield* Console.log(`message:  ${status.message}`)
    const counts = status.counts
    if (counts === null || counts === undefined) return
    yield* Console.log(`found:    ${counts.found}`)
    yield* Console.log(`imported: ${counts.imported}`)
    yield* Console.log(`updated:  ${counts.updated}`)
    yield* Console.log(`unchanged: ${counts.unchanged}`)
    yield* Console.log(`unreadable: ${counts.unreadable}`)
    yield* Console.log(`deactivated: ${counts.deactivated}`)
  })

export const hhResumesCommand = Command.make(
  "resumes",
  { account: accountFlag, wait: waitFlag },
  Effect.fn(function*({ account, wait }) {
    const api = yield* Api
    const fromFlag = Option.getOrElse(account, () => process.env.OTBOR_HH_ACCOUNT_ID ?? "")
    let hhAccountId = fromFlag as HhAccountId
    if (fromFlag === "") {
      const accounts = yield* api.HhAccountsList()
      if (accounts.length !== 1) {
        return yield* Effect.fail(
          new Error("Pass --account or set OTBOR_HH_ACCOUNT_ID (more than one hh account exists)")
        )
      }
      hhAccountId = accounts[0]!.id
    }

    const queued = yield* api.ResumeSyncRun({ hhAccountId })
    yield* Console.log(`resume sync queued for ${hhAccountId} (job ${queued.jobId ?? "?"})`)
    if (wait <= 0) return

    yield* Console.log("waiting for the harness (is `otbor harness` running?)...")
    const deadline = Date.now() + wait * 1_000
    let status = queued
    while (!TERMINAL.includes(status.status) && Date.now() < deadline) {
      yield* Effect.sleep("2 seconds")
      status = yield* api.ResumeSyncStatus({ hhAccountId })
    }
    yield* printOutcome(status)
    if (!TERMINAL.includes(status.status)) {
      yield* Console.log("not finished yet; run `otbor hh resumes` again to keep waiting on the same job")
    }
  })
).pipe(Command.withDescription("Load the account's resumes from hh.ru (reads the profile and resume pages through the harness)"))
