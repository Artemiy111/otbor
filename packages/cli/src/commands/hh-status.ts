import type { HhAccountRecord } from "@otbor/contract"
import { Console, Effect } from "effect"
import { Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { checkProfileSession, formatLastOk } from "../hh-session.ts"

const HEADER = ["name", "profile", "state", "last ok"] as const

export const hhStatusCommand = Command.make(
  "status",
  {
    account: Flag.String("account").pipe(
      Flag.withDescription("hh account id; all accounts when omitted"),
      Flag.withDefault("")
    )
  },
  Effect.fn(function*({ account }) {
    const api = yield* Api
    const all = yield* api.HhAccountsList()
    const targets: ReadonlyArray<HhAccountRecord> = account === "" ? all : all.filter((a) => a.id === account)
    if (targets.length === 0) {
      yield* Console.log(account === "" ? "Аккаунтов нет. Выполните: otbor hh login" : `Аккаунт не найден: ${account}`)
      return
    }
    const rows: Array<ReadonlyArray<string>> = []
    for (const acc of targets) {
      const profile = acc.sessionProfile
      if (profile === null) {
        rows.push([acc.label, "none", "no profile", "never"])
        continue
      }
      const stored = yield* api.HhAccountSessionStateGet({ id: acc.id })
      const check = yield* Effect.promise(() => checkProfileSession(stored.state))
      const saved = yield* api.HhAccountSessionSet({ id: acc.id, state: check.state, error: check.error })
      rows.push([acc.label, profile, check.state, formatLastOk(saved.session?.lastOkAt)])
    }
    const widths = HEADER.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)))
    const line = (cells: ReadonlyArray<string>) =>
      cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd()
    yield* Console.log(line(HEADER))
    for (const row of rows) yield* Console.log(line(row))
  })
).pipe(Command.withDescription("Check hh.ru sessions of all accounts (or one) and record the result"))
