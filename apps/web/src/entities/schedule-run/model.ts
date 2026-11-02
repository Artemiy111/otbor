export const scheduleRunKeys = {
  all: ["schedule-runs"] as const,
  list: (scheduleId?: string, kind?: string) => ["schedule-runs", "list", scheduleId ?? "all", kind ?? "all"] as const
}
