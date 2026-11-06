<script setup lang="ts">
import { computed } from "vue"

/** Plain text with the given terms marked wherever they stand as whole words. */
const props = defineProps<{ text: string; terms: ReadonlyArray<string> }>()

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const pattern = computed(() => {
  const terms = [...new Set(props.terms.map((t) => t.trim()).filter((t) => t.length > 1))]
    .sort((a, b) => b.length - a.length)
    .map(escape)
  // Letters and digits bound a word; this keeps "C++", ".NET" and Cyrillic terms working.
  return terms.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.join("|")})(?![\\p{L}\\p{N}])`, "giu") : null
})

const parts = computed(() => {
  const re = pattern.value
  if (!re) return [{ text: props.text, hit: false }]
  const out: Array<{ text: string; hit: boolean }> = []
  let last = 0
  for (const match of props.text.matchAll(re)) {
    const at = match.index ?? 0
    if (at > last) out.push({ text: props.text.slice(last, at), hit: false })
    out.push({ text: match[0], hit: true })
    last = at + match[0].length
  }
  if (last < props.text.length) out.push({ text: props.text.slice(last), hit: false })
  return out
})
</script>

<template>
  <template v-for="(part, i) in parts" :key="i">
    <mark v-if="part.hit" class="rounded-sm bg-primary/15 px-0.5 font-medium text-foreground">{{ part.text }}</mark>
    <template v-else>{{ part.text }}</template>
  </template>
</template>
