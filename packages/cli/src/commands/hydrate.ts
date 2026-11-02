import { proxyLabel } from "@otbor/crawler"
import { Console, Effect } from "effect"
import { Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { table } from "../format.ts"
import { asCrawlerError, fetchVacancyDraft, prepareProxy } from "../hh-fetch.ts"

interface HydrationResult {
  readonly externalId: string
  readonly title: string
  readonly status: "hydrated" | "failed"
}

/**
 * Fills in full vacancy pages for rows that only have a search-card stub.
 *
 * It never touches the search page: the vacancy ids already exist in the
 * corpus, so hydration is one request per vacancy through the configured
 * proxy. The corpus write still goes through `VacanciesUpsert`.
 */
const hydrate = Command.make(
  "hydrate",
  {
    limit: Flag.Int("limit").pipe(
      Flag.withDescription("How many stored vacancies to hydrate in this pass"),
      Flag.withDefault(50)
    ),
    delay: Flag.Int("delay").pipe(
      Flag.withDescription("Pause between vacancy requests, milliseconds"),
      Flag.withDefault(1000)
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print the pass as JSON"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function*({ limit, delay, json }) {
    const api = yield* Api
    const { config, proxy } = yield* prepareProxy

    const targets = yield* api.VacanciesHydrationTargets({ limit })
    const pause = Math.max(0, delay)

    let inserted = 0
    let updated = 0
    let skipped = 0
    let failed = 0
    const results: Array<HydrationResult> = []

    for (const [index, target] of targets.entries()) {
      const draft = yield* fetchVacancyDraft(target.externalId, proxy)

      if (draft === null) {
        failed += 1
        results.push({
          externalId: target.externalId,
          title: target.title,
          status: "failed"
        })
      } else {
        const saved = yield* api.VacanciesUpsert({ drafts: [draft] }).pipe(
          Effect.mapError((error) => asCrawlerError("network", error))
        )
        inserted += saved.inserted
        updated += saved.updated
        skipped += saved.skipped
        results.push({
          externalId: target.externalId,
          title: target.title,
          status: "hydrated"
        })
      }

      if (pause > 0 && index < targets.length - 1) {
        yield* Effect.sleep(`${pause} millis`)
      }
    }

    const hydrated = results.filter((result) => result.status === "hydrated").length
    const summary = {
      proxy: proxyLabel(config),
      candidates: targets.length,
      hydrated,
      failed,
      inserted,
      updated,
      skipped
    }

    if (json) {
      yield* Console.log(JSON.stringify({ ...summary, results }, null, 2))
    } else if (targets.length === 0) {
      yield* Console.log("No vacancies need hydration.")
    } else {
      if (config !== null) {
        yield* Console.log(`proxy:   ${proxyLabel(config)} (${config.source})`)
      }
      yield* Console.log(
        table(
          ["external id", "status", "title"],
          results.map((result) => [result.externalId, result.status, result.title])
        )
      )
      yield* Console.log(
        `\nhydrated ${hydrated} of ${targets.length}` +
          ` · inserted ${inserted} · updated ${updated} · unchanged ${skipped}` +
          (failed > 0 ? ` · failed ${failed}` : "")
      )
    }

    // A whole pass that produced nothing is an operator-visible failure, e.g.
    // the proxy is down or hh blocks every vacancy page.
    if (targets.length > 0 && hydrated === 0) process.exitCode = 3
  })
).pipe(Command.withDescription("Fetch full hh.ru pages for stored vacancies that only have a card stub"))

export const hydrateCommand = hydrate
