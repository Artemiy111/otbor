export const inferenceKeys = {
  all: ["inference"] as const,
  job: (id: string) => ["inference", "job", id] as const
}
