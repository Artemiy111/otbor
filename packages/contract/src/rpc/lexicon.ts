import { Schema } from "effect"
import { Rpc } from "effect/rpc"
import { KeywordMatchLocation } from "../enums.ts"
import { ApiError } from "../errors.ts"
import { KeywordAliasId, KeywordId, PresetId } from "../ids.ts"
import { LexiconKeyword } from "../models/index.ts"

export const LexiconList = Rpc.make("LexiconList", {
  payload: Schema.Struct({
    query: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int),
    /** Apply this preset's filter to the keyword set and counts. */
    presetId: Schema.optional(PresetId),
    /** Narrow keyword matches to a place: title, body, HH skills, text+skills. */
    location: Schema.optional(KeywordMatchLocation)
  }),
  success: Schema.Array(LexiconKeyword),
  error: ApiError
})

export const LexiconUpsert = Rpc.make("LexiconUpsert", {
  payload: Schema.Struct({
    /** Edit this keyword (and rename it) instead of matching by term. */
    id: Schema.optional(KeywordId),
    term: Schema.String,
    aliases: Schema.optional(Schema.Array(Schema.String))
  }),
  success: LexiconKeyword,
  error: ApiError
})

/** Progress of the background re-match of every vacancy against the lexicon. */
export const LexiconRematchProgress = Schema.Struct({
  running: Schema.Boolean,
  processed: Schema.Int,
  total: Schema.Int
})

/**
 * Matches are derived data stored at ingest, so a dictionary edit does not
 * touch old vacancies. This starts a detached batch re-match and returns at
 * once; `started` is false when one is already running.
 */
export const LexiconRematch = Rpc.make("LexiconRematch", {
  success: Schema.Struct({ started: Schema.Boolean, progress: LexiconRematchProgress }),
  error: ApiError
})

export const LexiconRematchStatus = Rpc.make("LexiconRematchStatus", {
  success: LexiconRematchProgress,
  error: ApiError
})

export const LexiconAliasAdd = Rpc.make("LexiconAliasAdd", {
  payload: Schema.Struct({
    keywordId: KeywordId,
    alias: Schema.String,
    typo: Schema.optional(Schema.Boolean)
  }),
  success: LexiconKeyword,
  error: ApiError
})

export const LexiconAliasSetTypo = Rpc.make("LexiconAliasSetTypo", {
  payload: Schema.Struct({ id: KeywordAliasId, typo: Schema.Boolean }),
  success: LexiconKeyword,
  error: ApiError
})

export const LexiconAliasRemove = Rpc.make("LexiconAliasRemove", {
  payload: Schema.Struct({ id: KeywordAliasId }),
  success: Schema.Struct({ id: KeywordAliasId, deleted: Schema.Boolean }),
  error: ApiError
})

export const LexiconRemove = Rpc.make("LexiconRemove", {
  payload: Schema.Struct({ id: KeywordId }),
  success: Schema.Struct({ id: KeywordId, deleted: Schema.Boolean }),
  error: ApiError
})
