/**
 * Domain errors are tagged objects; some have a `message` getter and some only
 * carry their fields. Keep the formatting in one place so every page reports
 * the same shape.
 */
export const describeError = (error: unknown): string => {
  if (error instanceof Error && error.message !== "") return error.message
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>
    const parts = [record._tag, record.entity, record.id, record.operation, record.message]
      .filter((part): part is string => typeof part === "string" && part !== "")
    if (parts.length > 0) return parts.join(" · ")
  }
  return String(error)
}
