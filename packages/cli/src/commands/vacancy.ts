import { extractVacancy } from "@otbor/hh"
import type { VacancyId } from "@otbor/contract"
import { Console, Effect, FileSystem, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { formatVacancy, salary, table } from "../format.ts"
import { resolveVacancyId } from "../resolve.ts"

const list = Command.make(
  "list",
  {
    limit: Flag.Int("limit").pipe(Flag.withDefault(20)),
    gate: Flag.String("gate").pipe(
      Flag.withDescription("Filter by the stored title verdict (match, unknown, reject)"),
      Flag.optional
    ),
    archived: Flag.Boolean("archived").pipe(
      Flag.withDescription("Include archived vacancies"),
      Flag.withDefault(false)
    ),
    json: Flag.Boolean("json").pipe(Flag.withDefault(false))
  },
  Effect.fn(function*({ limit, gate, archived, json }) {
    const api = yield* Api
    const { items, total } = yield* api.VacanciesList({
      limit,
      gate: Option.getOrUndefined(gate),
      includeArchived: archived
    })

    if (json) {
      yield* Console.log(JSON.stringify({ items, total }, null, 2))
      return
    }
    if (items.length === 0) {
      yield* Console.log("No vacancies.")
      return
    }

    yield* Console.log(table(["id", "title", "employer", "area", "salary", "flag"], items.map(formatVacancy)))
    yield* Console.log(`\n${items.length} of ${total}`)
  })
).pipe(Command.withDescription("List stored vacancies"))

const get = Command.make(
  "get",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Vacancy id or prefix"))
  },
  Effect.fn(function*({ id }) {
    const api = yield* Api
    const vacancyId = yield* resolveVacancyId(api, id)
    const detail = yield* api.VacanciesGet({ id: vacancyId as VacancyId })
    const { vacancy } = detail

    yield* Console.log(`${vacancy.title}`)
    yield* Console.log(`id:       ${vacancy.id}`)
    yield* Console.log(`employer: ${vacancy.employerName ?? "-"}`)
    yield* Console.log(`area:     ${vacancy.areaName ?? "-"}`)
    yield* Console.log(`salary:   ${salary(vacancy)}`)
    yield* Console.log(`seniority: ${vacancy.seniority}`)
    yield* Console.log(`published: ${vacancy.publishedAt ?? "-"}`)
    yield* Console.log(`url:      ${vacancy.canonicalUrl}`)
    if (detail.titleVerdict !== null && detail.titleVerdict !== undefined) {
      yield* Console.log(`gate:     ${detail.titleVerdict}`)
    }
    if (detail.skills.length > 0) {
      yield* Console.log(`skills:   ${detail.skills.join(", ")}`)
    }
    if (detail.keywords.length > 0) {
      yield* Console.log(
        `keywords: ${detail.keywords
          .map((match) => `${match.term}(${match.titleCount + match.bodyCount})`)
          .join(", ")}`
      )
    }
    if (detail.descriptionText.length > 0) {
      yield* Console.log(`\n${detail.descriptionText.slice(0, 2000)}`)
    }
  })
).pipe(Command.withDescription("Show one vacancy with its stored verdict and keywords"))

const ingest = Command.make(
  "ingest",
  {
    files: Argument.String("file").pipe(
      Argument.withDescription("Saved hh.ru vacancy pages (HTML)"),
      Argument.variadic({ min: 1 })
    ),
    url: Flag.String("url").pipe(
      Flag.withDescription("Source URL recorded for a single file"),
      Flag.optional
    )
  },
  Effect.fn(function*({ files, url }) {
    const fs = yield* FileSystem.FileSystem
    const api = yield* Api
    const sourceUrl = Option.getOrElse(url, () => "")

    const drafts = yield* Effect.forEach(
      files,
      (file) =>
        Effect.gen(function*() {
          const html = yield* fs.readFileString(file)
          return yield* extractVacancy(html, { url: sourceUrl })
        }),
      { concurrency: 1 }
    )

    const result = yield* api.VacanciesUpsert({ drafts })
    yield* Console.log(
      `inserted=${result.inserted} updated=${result.updated} skipped=${result.skipped}`
    )
    if (result.items.length > 0) {
      yield* Console.log(table(["id", "title", "employer", "area", "salary", "flag"], result.items.map(formatVacancy)))
    }
  })
).pipe(Command.withDescription("Parse saved hh.ru vacancy pages and store them"))

const fetchOne = Command.make(
  "fetch",
  {
    reference: Argument.String("vacancy").pipe(
      Argument.withDescription("hh.ru vacancy URL or external id")
    )
  },
  Effect.fn(function*({ reference }) {
    const api = yield* Api
    const result = yield* api.VacancyFetch({ reference })
    yield* Console.log(
      `${result.alreadyKnown ? "already in the corpus" : "fetched and stored"}: ${result.title}\n` +
        `id:       ${result.vacancyId}\nexternal: ${result.externalId}`
    )
  })
).pipe(
  Command.withDescription(
    "Fetch ONE hh.ru vacancy page (through the cloud and its proxy) into the corpus; used by the manual apply mode"
  )
)

export const vacancyCommand = Command.make("vacancy").pipe(
  Command.withSubcommands([list, get, ingest, fetchOne]),
  Command.withDescription("The vacancy corpus")
)
