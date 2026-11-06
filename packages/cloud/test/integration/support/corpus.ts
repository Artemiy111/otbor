import type { VacancyDraft } from "@otbor/contract"
import { Effect } from "effect"
import { Database } from "../../../src/db/Database.ts"
import * as PresetRepository from "../../../src/repositories/PresetRepository.ts"
import { CorpusService } from "../../../src/services/CorpusService.ts"
import { DecisionService } from "../../../src/services/DecisionService.ts"
import { runAs } from "./layers.ts"

export const corpusList = (
  userId: string,
  filter: {
    readonly includeBlacklisted?: boolean
    readonly hhAccountId?: string
    readonly includeArchived?: boolean
    readonly limit?: number
  } = {}
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const corpus = yield* CorpusService
      return yield* corpus.list(filter)
    })
  )

export const employersList = (
  userId: string,
  filter: {
    readonly includeBlacklisted?: boolean
    readonly hhAccountId?: string
    readonly query?: string
    readonly limit?: number
  } = {}
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const corpus = yield* CorpusService
      return yield* corpus.employers(filter)
    })
  )

export const evaluateVacancy = (
  userId: string,
  input: {
    readonly vacancyId: string
    readonly includeBlacklisted?: boolean
    readonly hhAccountId?: string
    readonly resumeId?: string
    readonly fit?: number
  }
) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const decisions = yield* DecisionService
      return yield* decisions.evaluate(input)
    })
  )

export const findPreset = async (userId: string, id: string) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const database = yield* Database
      return yield* database
        .asUser(userId, (tx) => PresetRepository.findById(tx, id, userId))
    })
  )

export const corpusIngest = (userId: string, drafts: ReadonlyArray<VacancyDraft>) =>
  runAs(
    userId,
    Effect.gen(function*() {
      const corpus = yield* CorpusService
      return yield* corpus.ingest(drafts)
    })
  )
