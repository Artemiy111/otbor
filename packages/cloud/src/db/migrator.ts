import { Effect } from "effect"
import { fromRecord, type Loader } from "effect/sql/Migrator"
import { SqlClient } from "effect/sql/SqlClient"

/**
 * Splits a hand-written SQL file into single statements.
 *
 * Effect SQL speaks the extended protocol, which runs exactly one statement per
 * message, so a migration file cannot be sent as one blob. The splitter is
 * deliberately small but aware of the three places a semicolon can appear
 * inside a statement: dollar-quoted bodies, string literals and quoted
 * identifiers.
 */
export const splitStatements = (source: string): ReadonlyArray<string> => {
  const statements: Array<string> = []
  let current = ""
  let index = 0
  let dollarTag: string | null = null

  while (index < source.length) {
    const char = source[index]!

    if (dollarTag !== null) {
      if (source.startsWith(dollarTag, index)) {
        current += dollarTag
        index += dollarTag.length
        dollarTag = null
        continue
      }
      current += char
      index += 1
      continue
    }

    if (char === "-" && source[index + 1] === "-") {
      const end = source.indexOf("\n", index)
      const stop = end === -1 ? source.length : end
      current += source.slice(index, stop)
      index = stop
      continue
    }

    if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2)
      const stop = end === -1 ? source.length : end + 2
      current += source.slice(index, stop)
      index = stop
      continue
    }

    if (char === "'" || char === '"') {
      const quote = char
      current += char
      index += 1
      while (index < source.length) {
        const inner = source[index]!
        current += inner
        index += 1
        if (inner === quote) {
          if (source[index] === quote) {
            current += quote
            index += 1
            continue
          }
          break
        }
      }
      continue
    }

    if (char === "$") {
      const match = /^\$[A-Za-z_]*\$/.exec(source.slice(index))
      if (match !== null) {
        dollarTag = match[0]
        current += dollarTag
        index += dollarTag.length
        continue
      }
    }

    if (char === ";") {
      const statement = current.trim()
      if (statement.length > 0) statements.push(statement)
      current = ""
      index += 1
      continue
    }

    current += char
    index += 1
  }

  const tail = current.trim()
  if (tail.length > 0) statements.push(tail)
  return statements
}

export interface MigrationFile {
  readonly id: number
  readonly name: string
  readonly path: string
}

/**
 * Hands `effect/sql/Migrator` the files in `migrations/`, sorted by numeric
 * prefix. Reading a file and applying every statement happen inside the
 * migrator's transaction, so a broken file leaves no half-applied schema.
 */
export const loader = (files: ReadonlyArray<MigrationFile>): Loader =>
  Effect.succeed(
    files
      .slice()
      .sort((left, right) => left.id - right.id)
      .map(
        (file) =>
          [
            file.id,
            file.name,
            Effect.succeed(
              Effect.gen(function*() {
                const sql = yield* SqlClient
                const text = yield* Effect.promise(() => Bun.file(file.path).text())
                for (const statement of splitStatements(text)) {
                  yield* sql.unsafe(statement)
                }
              })
            )
          ] as const
      )
  )
