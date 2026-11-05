import { useColorMode } from "@vueuse/core"

/**
 * The operator's theme choice: `light`, `dark`, or `auto` (follow the system).
 * Persisted in the browser. `useColorMode` puts `light` or `dark` on <html>
 * (the Tailwind `dark` variant keys off the `dark` class) and tracks the
 * system preference while the choice is `auto`.
 */
export type ThemeChoice = "light" | "dark" | "auto"

export const themeChoice = useColorMode({
  storageKey: "otbor.theme",
  initialValue: "auto",
  emitAuto: true,
  attribute: "class"
})
