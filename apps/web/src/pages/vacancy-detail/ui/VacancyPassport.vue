<script setup lang="ts">
import { computed } from "vue"
import type { ContactRecord, VacancyDetail } from "@otbor/contract"
import {
  conditionFacts,
  contactHref,
  contactKindLabel,
  formatDate,
  formatNumber,
  RECON_GROUPS,
  RECON_SOURCES,
  type ReconGroup,
  type ReconRow
} from "@/shared/lib"
import { Button } from "@/shared/ui"
import type { VacancyPage } from "../model"
import ReconDots from "./ReconDots.vue"

const props = defineProps<{ page: VacancyPage; data: VacancyDetail; contacts: ReadonlyArray<ContactRecord> }>()

const rows = computed(() => props.page.recon.value)
// The profile lives in the header chips; this block is about the response and the risks.
const order: ReadonlyArray<ReconGroup> = ["apply", "risk", "perk"]
const groups = computed(() =>
  order
    .map((group) => ({ group, title: RECON_GROUPS[group], rows: rows.value.filter((row) => row.group === group) }))
    .filter((entry) => entry.rows.length > 0)
)
const all = computed(() => rows.value.filter((row) => row.group !== "profile"))
const conflicts = computed(() => all.value.filter((row) => row.conflict))
const agreed = computed(() => all.value.filter((row) => !row.conflict && row.answered > 1))
const single = computed(() => all.value.filter((row) => !row.conflict && row.answered === 1))

const isValueRow = (row: ReconRow) =>
  row.group === "profile" && Object.values(row.cells).some((cell) => cell.norm !== null && cell.norm !== "да")

const distinctTexts = (row: ReconRow): ReadonlyArray<{ text: string; sources: string }> => {
  const byNorm = new Map<string, { text: string; sources: Array<string> }>()
  for (const source of RECON_SOURCES) {
    const cell = row.cells[source.id]
    if (cell.norm === null || cell.norm === "нет") continue
    const entry = byNorm.get(cell.norm) ?? { text: cell.text ?? cell.norm, sources: [] }
    entry.sources.push(source.short)
    byNorm.set(cell.norm, entry)
  }
  return [...byNorm.values()].map((entry) => ({ text: entry.text, sources: entry.sources.join("+") }))
}

const chipLabel = (row: ReconRow): string => {
  if (isValueRow(row)) {
    const texts = distinctTexts(row)
    return `${row.label}: ${texts.map((item) => item.text).join(" ≠ ")}`
  }
  const lead = Object.values(row.cells).find((cell) => cell.norm === "да" && cell.text !== null)
  return lead?.text && lead.text !== "упомянуто" && lead.text !== "в тексте" && lead.text !== "просят"
    ? `${row.label} · ${lead.text}`
    : row.label
}

const tip = (row: ReconRow): string =>
  [
    ...RECON_SOURCES.map((source) => {
      const cell = row.cells[source.id]
      return `${source.name}: ${cell.norm === null && cell.text === null ? "—" : (cell.text ?? cell.norm)}`
    }),
    row.evidence ? `«${row.evidence}»` : null
  ]
    .filter(Boolean)
    .join("\n")

const chipClass = (row: ReconRow): string => {
  if (row.conflict) return "border-amber-500/60 bg-amber-500/10 text-amber-100"
  if (row.group === "risk") return "border-red-500/40 bg-red-500/10 text-red-200"
  if (row.group === "perk") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
  if (row.group === "apply" && Object.values(row.cells).some((c) => c.text === "обязательно")) {
    return "border-amber-500/40 bg-amber-500/5 text-amber-200"
  }
  return "border-border bg-card"
}

const wanted = new Set(["probation", "interviewStages", "vacation", "sickLeave"])
const numbers = computed(() =>
  (props.data.facts?.text.conditions ? conditionFacts(props.data.facts.text.conditions) : [])
    .filter((fact) => wanted.has(fact.key))
    .filter((fact) => !["нет", "не оплачивается"].includes(fact.value))
)
const hh = computed(() => props.data.facts?.hh ?? null)
const isHttp = (href: string | null) => /^https?:/i.test(href ?? "")
const cap = "text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
</script>

<template>
  <section class="space-y-2 text-sm">
    <!-- how many sources agree -->
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span class="inline-flex items-center gap-1">
        <ReconDots :row="{ key: 'legend', group: 'profile', label: '', cells: { hh: { norm: 'x', text: null }, text: { norm: 'x', text: null }, ai: { norm: 'x', text: null } }, conflict: false, answered: 3, summary: '' }" />
        hh · текст · ИИ
      </span>
      <span v-if="all.length > 0">
        совпало <b class="text-emerald-300">{{ agreed.length }}</b>
        <template v-if="conflicts.length > 0">, расходятся <b class="text-amber-300">{{ conflicts.length }}</b></template>
        <template v-if="single.length > 0">, один источник {{ single.length }}</template>
      </span>
      <span v-if="!page.analysis.value && !page.analysisPending.value" class="text-amber-300">модель вакансию не разбирала</span>
    </div>

    <p v-if="all.length === 0" class="text-xs text-muted-foreground">Особых требований к отклику, рисков и плюсов не найдено.</p>

    <!-- chips with a source mark per parameter -->
    <div v-else class="space-y-1.5">
      <div v-for="entry in groups" :key="entry.group" class="flex flex-wrap items-center gap-1.5">
        <span :class="cap" class="w-full sm:w-auto sm:min-w-[5.5rem]">{{ entry.title }}</span>
        <span
          v-for="row in entry.rows"
          :key="row.key"
          :title="tip(row)"
          class="inline-flex items-center gap-1.5 rounded-md border py-0.5 pl-2 pr-1 text-xs"
          :class="chipClass(row)"
        >
          {{ chipLabel(row) }}
          <ReconDots :row="row" />
        </span>
      </div>
    </div>

    <!-- numbers, responses, contacts -->
    <div
      v-if="numbers.length > 0 || data.responsesTotal != null || contacts.length > 0"
      class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
    >
      <span v-for="fact in numbers" :key="fact.key" :title="fact.evidence">
        <span class="text-muted-foreground">{{ fact.label }}:</span> <b>{{ fact.value }}</b>
      </span>
      <span v-if="data.responsesTotal != null">
        <span class="text-muted-foreground">откликов:</span> <b>{{ formatNumber(data.responsesTotal) }}</b>
      </span>
      <span v-for="contact in contacts" :key="contact.id" class="min-w-0">
        <span class="text-muted-foreground">{{ contactKindLabel(contact.kind) }}:</span>
        <a
          v-if="contactHref(contact)"
          :href="contactHref(contact) ?? undefined"
          :target="isHttp(contactHref(contact)) ? '_blank' : undefined"
          rel="noreferrer"
          class="break-all text-sky-300 underline-offset-4 hover:underline"
          :title="contact.evidence ?? undefined"
        >{{ contact.value }}</a>
        <span v-else class="break-all">{{ contact.value }}</span>
      </span>
    </div>

    <p class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
      <template v-if="page.analysis.value">разбор: {{ page.analysis.value.model }}, {{ formatDate(page.analysis.value.updatedAt) }}</template>
      <template v-if="hh === null">
        · данные отклика с hh не загружены
        <Button size="sm" variant="outline" class="h-6 px-2 text-xs" :disabled="page.hydrating.value" @click="page.hydrate">Загрузить</Button>
      </template>
    </p>
  </section>
</template>
