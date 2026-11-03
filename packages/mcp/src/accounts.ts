import type { HhAccountRecord } from "@otbor/contract"
import { Effect } from "effect"
import { ToolFailure } from "./errors.ts"
import { accountDirectory, accountName } from "./shapes.ts"

const failure = (message: string) => Effect.fail(new ToolFailure({ message }))

const describeAccounts = (accounts: ReadonlyArray<HhAccountRecord>) =>
  accounts.map((account) => `${account.id} (${accountName(account)}${account.isDefault ? ", default" : ""})`).join(", ")

/**
 * Finds one account by a reference: the exact id, then a name or label
 * (case-insensitive, the hh display name or the operator's label), then an id
 * prefix of at least four characters. Ambiguity is an error, never a guess.
 */
export const findAccount = (
  accounts: ReadonlyArray<HhAccountRecord>,
  reference: string
): Effect.Effect<HhAccountRecord, ToolFailure> => {
  const ref = reference.trim().toLowerCase()
  const tiers: ReadonlyArray<(account: HhAccountRecord) => boolean> = [
    (account) => account.id.toLowerCase() === ref,
    (account) => accountName(account).toLowerCase() === ref || account.label.trim().toLowerCase() === ref,
    (account) => ref.length >= 4 && account.id.toLowerCase().startsWith(ref)
  ]
  for (const tier of tiers) {
    const matches = accounts.filter(tier)
    if (matches.length === 1) return Effect.succeed(matches[0]!)
    if (matches.length > 1) {
      return failure(`"${reference}" matches several hh accounts; use the id: ${describeAccounts(matches)}`)
    }
  }
  return failure(
    accounts.length === 0
      ? "no hh account is configured; add one in otbor first"
      : `no hh account matches "${reference}"; known accounts: ${describeAccounts(accounts)}`
  )
}

/**
 * The single account resolver: the explicit reference, else the default
 * account, else the only account, else an error listing them. Write tools use
 * it directly.
 */
export const pickAccount = (
  accounts: ReadonlyArray<HhAccountRecord>,
  reference: string | undefined
): Effect.Effect<HhAccountRecord, ToolFailure> => {
  if (reference !== undefined && reference.trim() !== "") return findAccount(accounts, reference)
  const chosen = accounts.find((account) => account.isDefault) ?? (accounts.length === 1 ? accounts[0] : undefined)
  if (chosen !== undefined) return Effect.succeed(chosen)
  if (accounts.length === 0) return failure("no hh account is configured; add one in otbor first")
  return failure(`several hh accounts and none is default; pass account: ${describeAccounts(accounts)}`)
}

/**
 * For read tools: an explicit `account` narrows the result to that account
 * (same matching as `pickAccount`); without it nothing is filtered, so a quiet
 * default never hides data. Returns undefined for "all accounts".
 */
export const readAccountFilter = (
  accounts: ReadonlyArray<HhAccountRecord>,
  reference: string | undefined
): Effect.Effect<HhAccountRecord | undefined, ToolFailure> =>
  reference === undefined || reference.trim() === "" ? Effect.succeed(undefined) : findAccount(accounts, reference)

/**
 * Loads the accounts (via the given, already guarded effect) and applies the
 * optional read filter. `directory` maps ids to `{id, name}` for output shapes.
 */
export const accountsFor = <E, R>(
  load: Effect.Effect<ReadonlyArray<HhAccountRecord>, E, R>,
  reference: string | undefined
) =>
  Effect.gen(function*() {
    const accounts = yield* load
    const filter = yield* readAccountFilter(accounts, reference)
    return { accounts, filter, directory: accountDirectory(accounts) }
  })
