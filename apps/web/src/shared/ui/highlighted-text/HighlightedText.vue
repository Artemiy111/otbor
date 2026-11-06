<script setup lang="ts">
import { computed } from "vue"

export interface HighlightTerm {
  readonly text: string
  /** `skill` is a keyword hh vacancies list as a skill; `keyword` is any other lexicon keyword. */
  readonly kind: "keyword" | "skill"
}

/** Plain text with the given terms marked wherever they stand as whole words. */
const props = defineProps<{ text: string; terms: ReadonlyArray<HighlightTerm> }>()

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const index = computed(() => {
  const kinds = new Map<string, HighlightTerm["kind"]>()
  for (const term of props.terms) {
    const key = term.text.trim().toLowerCase()
    if (key.length < 2) continue
    // A skill wins over a plain keyword when the same word is both.
    if (kinds.get(key) !== "skill") kinds.set(key, term.kind)
  }
  const alternation = [...kinds.keys()].sort((a, b) => b.length - a.length).map(escape)
  // Letters and digits bound a word; this keeps "C++", ".NET" and Cyrillic terms working.
  const re = alternation.length
    ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation.join("|")})(?![\\p{L}\\p{N}])`, "giu")
    : null
  return { kinds, re }
})

const parts = computed(() => {
  const { kinds, re } = index.value
  if (!re) return [{ text: props.text, kind: null as HighlightTerm["kind"] | null }]
  const out: Array<{ text: string; kind: HighlightTerm["kind"] | null }> = []
  let last = 0
  for (const match of props.text.matchAll(re)) {
    const at = match.index ?? 0
    if (at > last) out.push({ text: props.text.slice(last, at), kind: null })
    out.push({ text: match[0], kind: kinds.get(match[0].toLowerCase()) ?? "keyword" })
    last = at + match[0].length
  }
  if (last < props.text.length) out.push({ text: props.text.slice(last), kind: null })
  return out
})
</script>

<template>
  <template v-for="(part, i) in parts" :key="i">
    <mark
      v-if="part.kind"
      class="rounded-sm px-0.5 text-foreground"
      :class="part.kind === 'skill' ? 'bg-red-200/70 dark:bg-red-500/30' : 'bg-yellow-200/80 dark:bg-yellow-400/25'"
    >{{ part.text }}</mark>
    <template v-else>{{ part.text }}</template>
  </template>
</template>
