<script setup lang="ts">
import { computed } from "vue"
import { RECON_SOURCES, stanceOf, type ReconRow } from "@/shared/lib"
import { Hint } from "@/shared/ui"

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
      ? "bg-warning text-warning-foreground"
      : "bg-success text-success-foreground"
    : stance === "other"
      ? "bg-danger text-danger-foreground"
      : "bg-muted text-muted-foreground/50"
</script>

<template>
  <span class="inline-flex shrink-0 items-center gap-0.5 align-middle" aria-hidden="true">
    <Hint v-for="dot in dots" :key="dot.id" :text="dot.title">
      <span
        class="rounded px-1 text-xs font-semibold leading-none"
        :class="tone(dot.stance)"
      >{{ dot.short === "текст" ? "т" : dot.short }}</span>
    </Hint>
  </span>
</template>
