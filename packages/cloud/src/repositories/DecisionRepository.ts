import type { DecisionReason, DecisionRecord, GateVerdict, TitleVerdictRecord } from "@otbor/contract"
import type { RoleGateOutput } from "@otbor/domain"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { decision, titleVerdict } from "../db/tables.ts"

/* -------------------------------------------------------------------------- */
/* Title verdicts                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Rules only write a verdict if no user verdict exists and the stored rules are
 * older. A user's "this is garbage" outranks every future policy version; only
 * another explicit user verdict replaces it.
 */
export const cacheRulesVerdict = (tx: Executor, gate: RoleGateOutput): RepoEffect<void> =>
  Effect.gen(function*() {
    yield* tx
      .insert(titleVerdict)
      .values({
        normalizedTitle: gate.titleNormalized,
        roleFamily: gate.role,
        verdict: gate.verdict,
        source: "rules",
        matched: gate.matched,
        rejectedBy: gate.rejectedBy,
        rulesVersion: gate.rulesVersion
      })
      .onConflictDoUpdate({
        target: titleVerdict.normalizedTitle,
        set: {
          roleFamily: sql`excluded.role_family`,
          verdict: sql`excluded.verdict`,
          source: sql`excluded.source`,
          matched: sql`excluded.matched`,
          rejectedBy: sql`excluded.rejected_by`,
          rulesVersion: sql`excluded.rules_version`,
          updatedAt: sql`now()`
        },
        where: sql`${titleVerdict.source} <> 'user' and ${titleVerdict.rulesVersion} < excluded.rules_version`
      })
  })

export const findVerdict = (
  tx: Executor,
  normalizedTitle: string
): RepoEffect<TitleVerdictRecord | null> =>
  Effect.gen(function*() {
    const [row] = yield* tx
      .select()
      .from(titleVerdict)
      .where(sql`${titleVerdict.normalizedTitle} = ${normalizedTitle}`)
      .limit(1)

    if (row === undefined) return null
    return {
      normalizedTitle: row.normalizedTitle,
      roleFamily: row.roleFamily,
      verdict: row.verdict as GateVerdict,
      source: row.source as TitleVerdictRecord["source"],
      matched: row.matched,
      rejectedBy: row.rejectedBy,
      rulesVersion: row.rulesVersion,
      createdAt: row.createdAt.toISOString()
    }
  })

export const setUserVerdict = (
  tx: Executor,
  input: { readonly normalizedTitle: string; readonly verdict: GateVerdict; readonly roleFamily: string | null; readonly matched: ReadonlyArray<string> }
): RepoEffect<TitleVerdictRecord> =>
  Effect.gen(function*() {
    const [row] = yield* tx
      .insert(titleVerdict)
      .values({
        normalizedTitle: input.normalizedTitle,
        roleFamily: input.roleFamily,
        verdict: input.verdict,
        source: "user",
        matched: input.matched,
        rejectedBy: null,
        rulesVersion: 0
      })
      .onConflictDoUpdate({
        target: titleVerdict.normalizedTitle,
        set: {
          roleFamily: sql`excluded.role_family`,
          verdict: sql`excluded.verdict`,
          source: sql`'user'`,
          matched: sql`excluded.matched`,
          rejectedBy: sql`null`,
          updatedAt: sql`now()`
        }
      })
      .returning()

    return {
      normalizedTitle: row!.normalizedTitle,
      roleFamily: row!.roleFamily,
      verdict: row!.verdict as GateVerdict,
      source: "user",
      matched: row!.matched,
      rejectedBy: row!.rejectedBy,
      rulesVersion: row!.rulesVersion,
      createdAt: row!.createdAt.toISOString()
    }
  })

/* -------------------------------------------------------------------------- */
/* Decisions                                                                  */
/* -------------------------------------------------------------------------- */

export interface DecisionRow {
  readonly id: string
  readonly user_id: string
  readonly hh_account_id: string | null
  readonly resume_id: string | null
  readonly vacancy_id: string
  readonly vacancy_title: string | null
  readonly verdict: string
  readonly gate: string
  readonly role_family: string | null
  readonly fit: number
  readonly priority: number
  readonly reasons: ReadonlyArray<DecisionReason>
  readonly policy_version: number
  readonly rules_version: number
  readonly created_at: Date
}

export const toRecord = (row: DecisionRow): DecisionRecord => ({
  id: row.id as DecisionRecord["id"],
  userId: row.user_id as DecisionRecord["userId"],
  hhAccountId: row.hh_account_id as DecisionRecord["hhAccountId"],
  resumeId: row.resume_id as DecisionRecord["resumeId"],
  vacancyId: row.vacancy_id as DecisionRecord["vacancyId"],
  vacancyTitle: row.vacancy_title ?? undefined,
  roleFamily: row.role_family,
  verdict: row.verdict as DecisionRecord["verdict"],
  gate: row.gate as DecisionRecord["gate"],
  fit: row.fit,
  priority: row.priority,
  reasons: row.reasons,
  policyVersion: row.policy_version,
  createdAt: row.created_at.toISOString()
})

export interface PersistDecisionInput {
  readonly userId: string
  readonly hhAccountId: string | null
  readonly resumeId: string | null
  readonly vacancyId: string
  readonly verdict: "apply" | "draft" | "skip"
  readonly gate: GateVerdict
  readonly roleFamily: string | null
  readonly fit: number
  readonly priority: number
  readonly reasons: ReadonlyArray<DecisionReason>
  readonly policyVersion: number
  readonly rulesVersion: number
  readonly inputHash: string
}

const selectDecision = sql`
  select d.*, v.title as vacancy_title
  from decision d
  join vacancy v on v.id = d.vacancy_id
`

export const persist = (
  tx: Executor,
  input: PersistDecisionInput
): RepoEffect<DecisionRecord> =>
  Effect.gen(function*() {
    yield* tx
      .insert(decision)
      .values({
        userId: input.userId,
        hhAccountId: input.hhAccountId,
        resumeId: input.resumeId,
        vacancyId: input.vacancyId,
        verdict: input.verdict,
        gate: input.gate,
        roleFamily: input.roleFamily,
        fit: input.fit,
        priority: input.priority,
        reasons: input.reasons,
        policyVersion: input.policyVersion,
        rulesVersion: input.rulesVersion,
        inputHash: input.inputHash
      })
      .onConflictDoNothing()

    const [row] = (
      yield* tx.execute(sql`
        ${selectDecision}
        where d.user_id = ${input.userId}
          and d.vacancy_id = ${input.vacancyId}
          and d.policy_version = ${input.policyVersion}
          and d.input_hash = ${input.inputHash}
        limit 1
      `)
    ).rows

    return toRecord(row as unknown as DecisionRow)
  })

export const findById = (tx: Executor, id: string): RepoEffect<DecisionRecord | null> =>
  tx
    .execute(sql`${selectDecision} where d.id = ${id} limit 1`)
    .pipe(Effect.map((result) => {
      const row = result.rows[0] as unknown as DecisionRow | undefined
      return row === undefined ? null : toRecord(row)
    }))

export const list = (
  tx: Executor,
  userId: string,
  options: { readonly verdict?: string; readonly limit?: number; readonly offset?: number } = {}
): RepoEffect<ReadonlyArray<DecisionRecord>> =>
  tx
    .execute(sql`
      ${selectDecision}
      where d.user_id = ${userId}
        ${options.verdict === undefined || options.verdict === ""
          ? sql``
          : sql`and d.verdict = ${options.verdict}`}
      order by d.created_at desc
      limit ${Math.min(Math.max(options.limit ?? 50, 1), 200)}
      offset ${Math.max(options.offset ?? 0, 0)}
    `)
    .pipe(
      Effect.map((result) =>
        (result.rows as unknown as ReadonlyArray<DecisionRow>).map(toRecord)
      )
    )
