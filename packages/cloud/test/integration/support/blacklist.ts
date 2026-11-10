import type { BlacklistScope, BlacklistTarget } from "@otbor/contract"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { hiddenTarget } from "../../../src/db/tables.ts"
import { BlacklistService } from "../../../src/services/BlacklistService.ts"
import { runAs, runAsFailure } from "./layers.ts"
import { ownerTx } from "./seeds.ts"

export const blacklistList = (
  userId: string,
  filter: {
    readonly scope?: BlacklistScope
    readonly hhAccountId?: string
    readonly targetType?: BlacklistTarget
    readonly query?: string
    readonly limit?: number
    readonly offset?: number
  } = {}
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const blacklist = yield* BlacklistService
      return yield* blacklist.list(filter)
    })
  )

export const blacklistUpsert = (
  userId: string,
  input: {
    readonly id?: string
    readonly scope: BlacklistScope
    readonly hhAccountId?: string
    readonly targetType: BlacklistTarget
    readonly externalId: string
    readonly name?: string
    readonly reason?: string
  }
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const blacklist = yield* BlacklistService
      return yield* blacklist.upsert(input)
    })
  )

export const blacklistUpsertFailure = (
  userId: string,
  input: {
    readonly scope: BlacklistScope
    readonly hhAccountId?: string
    readonly targetType: BlacklistTarget
    readonly externalId: string
  }
) =>
  runAsFailure(
    userId,
    Effect.gen(function*() {
      const blacklist = yield* BlacklistService
      return yield* blacklist.upsert(input)
    })
  )

export const blacklistRemove = (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const blacklist = yield* BlacklistService
      return yield* blacklist.remove(id)
    })
  )

export const blacklistImportHh = (
  userId: string,
  input: {
    readonly hhAccountId: string
    readonly entries: ReadonlyArray<{
      readonly targetType: BlacklistTarget
      readonly externalId: string
      readonly name?: string
    }>
  }
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const blacklist = yield* BlacklistService
      return yield* blacklist.importHh(input)
    })
  )

export const hiddenTargetRowsFor = async (userId: string) =>
  runAs(
    "owner",
    ownerTx((tx) =>
      tx.select().from(hiddenTarget).where(eq(hiddenTarget.userId, userId))
    )
  )

export const rejectVacancy = (
  userId: string,
  input: {
    readonly vacancyId: string
    readonly scope: "app" | "hh_account" | "resume"
    readonly hhAccountId?: string
    readonly resumeId?: string
    readonly reason?: string
  }
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const blacklist = yield* BlacklistService
      return yield* blacklist.rejectVacancy(input)
    })
  )

export const unrejectVacancy = (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const blacklist = yield* BlacklistService
      return yield* blacklist.unrejectVacancy(id)
    })
  )
