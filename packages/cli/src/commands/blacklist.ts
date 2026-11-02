import type { BlacklistId, BlacklistScope, BlacklistTarget, HhAccountId } from "@otbor/contract"
import { blacklistScrapeCommand } from "./blacklist-scrape.ts"
import { Console, Effect, FileSystem, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { shortId, table } from "../format.ts"

const list = Command.make(
  "list",
  {
    scope: Flag.Literals("scope", ["app", "hh_account", "hh_native"]).pipe(Flag.optional),
    account: Flag.String("account").pipe(
      Flag.withDescription("hh account id (account and native layers)"),
      Flag.optional
    ),
    type: Flag.Literals("type", ["employer", "vacancy"]).pipe(Flag.optional),
    query: Flag.String("query").pipe(
      Flag.withDescription("Filter by name or external id"),
      Flag.optional
    ),
    limit: Flag.Int("limit").pipe(Flag.withDefault(100)),
    offset: Flag.Int("offset").pipe(Flag.withDefault(0)),
    json: Flag.Boolean("json").pipe(Flag.withDefault(false))
  },
  Effect.fn(function*({ scope, account, type, query, limit, offset, json }) {
    const api = yield* Api
    const result = yield* api.BlacklistList({
      scope: Option.getOrUndefined(scope) as BlacklistScope | undefined,
      hhAccountId: Option.getOrUndefined(account) as HhAccountId | undefined,
      targetType: Option.getOrUndefined(type) as BlacklistTarget | undefined,
      query: Option.getOrUndefined(query),
      limit,
      offset
    })

    if (json) {
      yield* Console.log(JSON.stringify(result, null, 2))
      return
    }
    if (result.items.length === 0) {
      yield* Console.log("Blacklist is empty.")
      return
    }

    yield* Console.log(
      table(
        ["id", "scope", "type", "external id", "name", "source", "account"],
        result.items.map((item) => [
          shortId(item.id),
          item.scope,
          item.targetType,
          item.externalId,
          item.name ?? "",
          item.source,
          item.hhAccountId === null || item.hhAccountId === undefined
            ? "-"
            : shortId(item.hhAccountId)
        ])
      )
    )
    yield* Console.log(`${result.total} record(s)`)
  })
).pipe(Command.withDescription("List blacklist layers (app, hh account, hh native)"))

const add = Command.make(
  "add",
  {
    scope: Flag.Literals("scope", ["app", "hh_account"]).pipe(
      Flag.withDescription("app applies to every account; hh_account only to one")
    ),
    type: Flag.Literals("type", ["employer", "vacancy"]).pipe(
      Flag.withDescription("Block a whole company or one vacancy")
    ),
    externalId: Flag.String("external-id").pipe(
      Flag.withDescription("hh employer or vacancy id")
    ),
    name: Flag.String("name").pipe(
      Flag.withDescription("Human-readable company or vacancy name"),
      Flag.optional
    ),
    reason: Flag.String("reason").pipe(Flag.optional),
    account: Flag.String("account").pipe(
      Flag.withDescription("Required for hh_account scope"),
      Flag.optional
    )
  },
  Effect.fn(function*({ scope, type, externalId, name, reason, account }) {
    const api = yield* Api
    const record = yield* api.BlacklistUpsert({
      scope: scope as BlacklistScope,
      hhAccountId: Option.getOrUndefined(account) as HhAccountId | undefined,
      targetType: type as BlacklistTarget,
      externalId,
      name: Option.getOrUndefined(name),
      reason: Option.getOrUndefined(reason)
    })
    yield* Console.log(
      `${record.id}  ${record.scope}  ${record.targetType}  ${record.externalId}`
    )
  })
).pipe(Command.withDescription("Add or update a blacklist record (a soft filter, not a ban)"))

const remove = Command.make(
  "remove",
  {
    id: Flag.String("id").pipe(Flag.withDescription("Blacklist record id"))
  },
  Effect.fn(function*({ id }) {
    const api = yield* Api
    const result = yield* api.BlacklistRemove({ id: id as BlacklistId })
    yield* Console.log(result.deleted ? `removed ${result.id}` : `not found ${result.id}`)
  })
).pipe(Command.withDescription("Remove one blacklist record"))

const importHh = Command.make(
  "import-hh",
  {
    account: Flag.String("account").pipe(
      Flag.withDescription("hh account whose hidden list is being imported")
    ),
    file: Flag.String("file").pipe(
      Flag.withDescription(
        "JSON file: an array or {entries:[{targetType,externalId,name?}]}"
      )
    )
  },
  Effect.fn(function*({ account, file }) {
    const fs = yield* FileSystem.FileSystem
    const api = yield* Api

    const parsed: unknown = JSON.parse(yield* fs.readFileString(file))
    const rawEntries = Array.isArray(parsed)
      ? parsed
      : (parsed as { entries?: unknown }).entries ?? []
    if (!Array.isArray(rawEntries)) {
      yield* Effect.fail(new Error("expected a JSON array or { entries: [...] }"))
      return
    }

    const entries: Array<{
      targetType: BlacklistTarget
      externalId: string
      name?: string
    }> = []
    for (const entry of rawEntries) {
      const item = entry as {
        targetType?: unknown
        externalId?: unknown
        name?: unknown
      }
      const targetType = String(item.targetType ?? "")
      if (targetType !== "employer" && targetType !== "vacancy") {
        yield* Effect.fail(new Error(`unknown targetType: ${targetType}`))
        return
      }
      entries.push({
        targetType: targetType as BlacklistTarget,
        externalId: String(item.externalId ?? ""),
        ...(typeof item.name === "string" ? { name: item.name } : {})
      })
    }

    const result = yield* api.BlacklistImportHh({
      hhAccountId: account as HhAccountId,
      entries
    })
    yield* Console.log(
      `imported ${result.imported}, updated ${result.updated}, skipped ${result.skipped}`
    )
  })
).pipe(Command.withDescription("Import hh's own hidden companies/vacancies (idempotent)"))

export const blacklistCommand = Command.make("blacklist").pipe(
  Command.withSubcommands([list, add, remove, importHh, blacklistScrapeCommand]),
  Command.withDescription("Blacklist layers: app, hh account and hh-native hiding")
)
