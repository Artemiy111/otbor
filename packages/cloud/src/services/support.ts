import { StorageError } from "@otbor/contract"

/** One place where a driver failure becomes a typed, user-visible error. */
export const toStorageError =
  (operation: string) =>
  (cause: unknown): StorageError =>
    new StorageError({
      operation,
      message: cause instanceof Error ? cause.message : String(cause),
      cause: cause instanceof Error ? cause : undefined
    })

export const sha256 = (input: string): string =>
  new Bun.CryptoHasher("sha256").update(input).digest("hex")

/** Stable JSON: object keys sorted, so a hash depends on values not order. */
export const stableHash = (value: unknown): string => sha256(stableStringify(value))

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`
}
