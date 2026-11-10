<script setup lang="ts">
import { computed } from "vue"
import { Hint } from "@/shared/ui/tooltip"

export interface HighlightTerm {
  readonly text: string
  /** `skill` is a keyword hh vacancies list as a skill; `keyword` is any other lexicon keyword. */
  readonly kind: "keyword" | "skill"
  /** Vacancies of the selection whose text mentions the term. */
  readonly vacancies: number
  /** Vacancies of the selection that list the term among their hh skills. */
  readonly skillVacancies: number
}

/** Plain text with the given terms marked wherever they stand as whole words. */
const props = defineProps<{ text: string; terms: ReadonlyArray<HighlightTerm> }>()

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const index = computed(() => {
  const found = new Map<string, HighlightTerm>()
  for (const term of props.terms) {
    const key = term.text.trim().toLowerCase()
    if (key.length < 2) continue
    // A skill wins over a plain keyword when the same word is both.
    if (found.get(key)?.kind !== "skill") found.set(key, term)
  }
  const alternation = [...found.keys()].sort((a, b) => b.length - a.length).map(escape)
  // Letters and digits bound a word; this keeps "C++", ".NET" and Cyrillic terms working.
  const re = alternation.length
    ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation.join("|")})(?![\\p{L}\\p{N}])`, "giu")
    : null
  return { found, re }
})

const parts = computed(() => {
  const { found, re } = index.value
  if (!re) return [{ text: props.text, term: null as HighlightTerm | null }]
  const out: Array<{ text: string; term: HighlightTerm | null }> = []
  let last = 0
  for (const match of props.text.matchAll(re)) {
    const at = match.index ?? 0
    if (at > last) out.push({ text: props.text.slice(last, at), term: null })
    out.push({ text: match[0], term: found.get(match[0].toLowerCase()) ?? null })
    last = at + match[0].length
  }
  if (last < props.text.length) out.push({ text: props.text.slice(last), term: null })
  return out
})

const tip = (term: HighlightTerm): string =>
  `в текстах вакансий: ${term.vacancies}\nв навыках hh: ${term.skillVacancies}`
</script>

<template>
  <template v-for="(part, i) in parts" :key="i">
    <Hint v-if="part.term" :text="tip(part.term)">
      <mark
        class="rounded-sm px-0.5 text-foreground"
        :class="part.term.kind === 'skill' ? 'bg-danger/25' : 'bg-warning/25'"
      >{{ part.text }}</mark>
    </Hint>
    <template v-else>{{ part.text }}</template>
  </template>
</template>
