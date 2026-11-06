import type { HhAccountId, NegotiationsSyncStatus } from "@otbor/contract"
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

const TERMINAL: ReadonlyArray<NegotiationsSyncStatus["status"]> = ["done", "failed", "needs_human"]

const printOutcome = (status: NegotiationsSyncStatus) =>
  Effect.gen(function*() {
    yield* Console.log(`status:   ${status.status}`)
    if (status.message) yield* Console.log(`message:  ${status.message}`)
    const counts = status.counts
    if (counts === null || counts === undefined) return
    yield* Console.log(`pages:    ${counts.pages}${counts.complete ? "" : " (list not read to the end)"}`)
    yield* Console.log(`topics:   ${counts.topics}`)
    yield* Console.log(`imported: ${counts.imported}`)
    yield* Console.log(`updated:  ${counts.updated}`)
    yield* Console.log(`unchanged: ${counts.unchanged}`)
    yield* Console.log(`unknown vacancy: ${counts.unknownVacancy}`)
    if (counts.unknownVacancyIds !== undefined && counts.unknownVacancyIds.length > 0) {
      yield* Console.log(
        `  not in the corpus yet (could not fetch them; run the sync again): ${counts.unknownVacancyIds.join(", ")}`
      )
    }
  })

export const hhSyncCommand = Command.make(
  "sync",
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

    const syncOnce = Effect.fn(function*() {
      const queued = yield* api.NegotiationsSyncRun({ hhAccountId })
      yield* Console.log(`negotiations sync queued for ${hhAccountId} (job ${queued.jobId ?? "?"})`)
      if (wait <= 0) return queued
      yield* Console.log("waiting for the harness (is `otbor harness` running?)...")
      const deadline = Date.now() + wait * 1_000
      let status = queued
      while (!TERMINAL.includes(status.status) && Date.now() < deadline) {
        yield* Effect.sleep("2 seconds")
        status = yield* api.NegotiationsSyncStatus({ hhAccountId })
      }
      return status
    })

    let status = yield* syncOnce()
    if (wait <= 0) return

    // Responses to vacancies that are not in the corpus yet cannot be imported.
    // Fetch those vacancy pages and read the list again, once.
    const unknown = status.status === "done" ? (status.counts?.unknownVacancyIds ?? []) : []
    if (unknown.length > 0) {
      yield* Console.log(`fetching ${unknown.length} vacancies that are not in the corpus yet...`)
      let fetched = 0
      for (const reference of unknown) {
        const result = yield* api.VacancyFetch({ reference }).pipe(Effect.result)
        if (result._tag === "Success") {
          fetched += 1
        } else {
          const reason = (result.failure as { message?: unknown }).message
          yield* Console.log(`  ${reference}: could not fetch${typeof reason === "string" ? ` (${reason.slice(0, 160)})` : ""}`)
        }
      }
      yield* Console.log(`fetched ${fetched} of ${unknown.length}; syncing again`)
      status = yield* syncOnce()
    }

    yield* printOutcome(status)
    if (!TERMINAL.includes(status.status)) {
      yield* Console.log("not finished yet; run `otbor hh sync` again to keep waiting on the same job")
    }
  })
).pipe(Command.withDescription("Import responses made by hand on hh.ru (reads /applicant/negotiations through the harness)"))
