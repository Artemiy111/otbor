import { sql } from "drizzle-orm"
import type { Executor, RepoEffect } from "../db/Database.ts"
import { Effect } from "effect"

export interface StoredLogo {
  readonly contentType: string
  readonly bytes: Uint8Array
  readonly sourceUrl: string
  readonly fetchedAt: Date
}

export interface LogoLookup {
  /** Адрес логотипа в `employer.logo_url`; null, если логотипа у компании нет. */
  readonly logoUrl: string | null
  /** Сохранённая копия, если она есть и скачана именно с текущего адреса. */
  readonly stored: StoredLogo | null
}

interface LookupRow {
  readonly logo_url: string | null
  readonly source_url: string | null
  readonly content_type: string | null
  readonly bytes_b64: string | null
  readonly fetched_at: string | Date | null
}

/**
 * Байты ходят через base64 (`encode`/`decode`), чтобы не зависеть от того, как
 * драйвер отдаёт bytea: логотипы маленькие, лишние 33% не ощутимы.
 * Null, когда компании с таким id нет.
 */
export const lookup = (tx: Executor, employerId: string): RepoEffect<LogoLookup | null> =>
  tx
    .execute(sql`
      select e.logo_url, l.source_url, l.content_type, l.fetched_at,
             encode(l.bytes, 'base64') as bytes_b64
      from employer e
      left join employer_logo l on l.employer_id = e.id
      where e.id = ${employerId}
    `)
    .pipe(
      Effect.map((result) => {
        const row = result.rows[0] as unknown as LookupRow | undefined
        if (row === undefined) return null
        const fresh =
          row.bytes_b64 !== null &&
          row.content_type !== null &&
          row.source_url !== null &&
          row.source_url === row.logo_url
        return {
          logoUrl: row.logo_url,
          stored: fresh
            ? {
                contentType: row.content_type!,
                bytes: Buffer.from(row.bytes_b64!.replace(/\s/g, ""), "base64"),
                sourceUrl: row.source_url!,
                fetchedAt: new Date(row.fetched_at!)
              }
            : null
        }
      })
    )

export interface SaveLogo {
  readonly sourceUrl: string
  readonly contentType: string
  readonly bytes: Uint8Array
  readonly originalBytes: number
  readonly width: number | null
  readonly height: number | null
}

export const save = (tx: Executor, employerId: string, logo: SaveLogo): RepoEffect<void> =>
  tx
    .execute(sql`
      insert into employer_logo (
        employer_id, source_url, content_type, bytes, byte_size,
        original_byte_size, width, height, fetched_at
      ) values (
        ${employerId}, ${logo.sourceUrl}, ${logo.contentType},
        decode(${Buffer.from(logo.bytes).toString("base64")}, 'base64'),
        ${logo.bytes.byteLength}, ${logo.originalBytes}, ${logo.width}, ${logo.height}, now()
      )
      on conflict (employer_id) do update set
        source_url = excluded.source_url,
        content_type = excluded.content_type,
        bytes = excluded.bytes,
        byte_size = excluded.byte_size,
        original_byte_size = excluded.original_byte_size,
        width = excluded.width,
        height = excluded.height,
        fetched_at = now()
    `)
    .pipe(Effect.asVoid)
