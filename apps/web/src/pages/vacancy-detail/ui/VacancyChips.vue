<script setup lang="ts">
import { computed } from "vue"
import type { VacancyDetail } from "@otbor/contract"
import { applicationRequestLabel, formatNumber } from "@/shared/lib"
import { Badge } from "@/shared/ui"

const props = defineProps<{ data: VacancyDetail }>()

type Chip = {
  key: string
  label: string
  variant: "warning" | "destructive" | "neutral" | "secondary" | "info"
  title?: string
}

const chips = computed<ReadonlyArray<Chip>>(() => {
  const facts = props.data.facts
  if (facts === undefined) return []
  const out: Array<Chip> = []
  const hh = facts.hh
  if (hh?.letterRequired === true) {
    out.push({ key: "letter", label: "hh требует письмо", variant: "warning" })
  }
  if (facts.text.coverLetter.requested) {
    out.push({
      key: "letter-text",
      label: "письмо в тексте",
      variant: "warning",
      title: facts.text.coverLetter.evidence ?? undefined
    })
  }
  if (hh?.test.hasTest) {
    out.push(
      hh.test.required === true
        ? { key: "test", label: "тест обязательный", variant: "warning" }
        : hh.test.required === false
          ? { key: "test", label: "тест необязательный", variant: "neutral" }
          : { key: "test", label: "есть тест", variant: "info" }
    )
  }
  for (const request of facts.text.applicationRequests) {
    out.push({
      key: `req-${request.code}`,
      label: applicationRequestLabel(request.code),
      variant: "secondary",
      title: request.evidence
    })
  }
  const flags = facts.text.redFlags.length
  if (flags > 0) {
    out.push({ key: "flags", label: `красных флагов: ${flags}`, variant: "destructive" })
  }
  return out
})

const responses = computed(() => props.data.responsesTotal ?? null)
</script>

<template>
  <div
    v-if="chips.length > 0 || responses !== null"
    class="mb-4 flex flex-wrap items-center gap-1.5"
  >
    <Badge v-for="chip in chips" :key="chip.key" :variant="chip.variant" :title="chip.title">
      {{ chip.label }}
    </Badge>
    <Badge v-if="responses !== null" variant="neutral">
      откликов: {{ formatNumber(responses) }}
    </Badge>
  </div>
</template>
