import type { HeaderFilterOption } from "@/shared/ui"

/** Blacklist visibility: hidden rows stay in the corpus, the toggle only changes the view. */
export const blacklistVisibilityOptions: ReadonlyArray<HeaderFilterOption> = [
  { value: "hide", label: "Скрыть заблокированные" },
  { value: "show", label: "Показать заблокированные" }
]
