export const presetKeys = {
  all: ["presets"] as const,
  list: (kind: string) => ["presets", "list", kind] as const
}
