<script setup lang="ts">
import { computed } from "vue"
import { RECON_SOURCES, stanceOf, type ReconRow } from "@/shared/lib"

const props = defineProps<{ row: ReconRow }>()

const dots = computed(() =>
  RECON_SOURCES.map((source) => {
    const stance = stanceOf(props.row, source.id)
    const cell = props.row.cells[source.id]
    return {
      id: source.id,
      short: source.short,
      stance,
      title: `${source.name}: ${stance === "silent" ? "не говорит" : (cell.text ?? cell.norm ?? "—")}`
    }
  })
)
const tone = (stance: string) =>
  stance === "yes"
    ? props.row.conflict
      ? "bg-amber-400 text-amber-950"
      : "bg-emerald-500 text-emerald-950"
    : stance === "other"
      ? "bg-red-400/80 text-red-950"
      : "bg-muted text-muted-foreground/50"
</script>

<template>
  <span class="inline-flex shrink-0 items-center gap-0.5 align-middle" aria-hidden="true">
    <span
      v-for="dot in dots"
      :key="dot.id"
      :title="dot.title"
      class="rounded px-1 text-[9px] font-semibold leading-[13px]"
      :class="tone(dot.stance)"
    >{{ dot.short === "текст" ? "т" : dot.short }}</span>
  </span>
</template>
