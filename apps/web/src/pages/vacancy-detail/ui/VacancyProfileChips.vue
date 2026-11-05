<script setup lang="ts">
import { computed } from "vue"
import type { VacancyDetail } from "@otbor/contract"
import { employmentFormLabel, formatSalary, RECON_SOURCES, type ReconRow } from "@/shared/lib"
import { Hint } from "@/shared/ui"
import ReconDots from "./ReconDots.vue"

const props = defineProps<{ data: VacancyDetail; recon: ReadonlyArray<ReconRow> }>()

const salary = computed(() => {
  const v = props.data.vacancy
  const text = formatSalary(v.salaryFrom, v.salaryTo, v.salaryCurrency)
  return text === "—" ? null : text
})

/** Same value from several sources reads once; a disagreement reads "A ≠ B". */
const valueText = (row: ReconRow): { text: string; note: string | null } => {
  const byNorm = new Map<string, string>()
  for (const source of RECON_SOURCES) {
    const cell = row.cells[source.id]
    if (cell.norm !== null && cell.norm !== "нет" && !byNorm.has(cell.norm)) byNorm.set(cell.norm, cell.text ?? cell.norm)
  }
  const texts = [...byNorm.values()]
  if (row.conflict) return { text: texts.join(" ≠ "), note: null }
  // Sources agree but word it differently (hh: "гибрид, удалённо", model: "удалённо"): keep both.
  const wordings = [
    ...new Set(
      RECON_SOURCES.map((s) => row.cells[s.id])
        .filter((cell) => cell.norm !== null)
        .map((cell) => cell.text)
        .filter((t): t is string => t !== null && t !== texts[0])
    )
  ]
  return { text: texts[0] === undefined || texts[0] === "да" ? row.label : texts[0], note: wordings.length > 0 ? `по тексту: ${wordings.join(", ")}` : null }
}

const PROFILE_LABEL: Record<string, string> = {
  experience: "опыт",
  employment: "оформление",
  role: "роль"
}
const order = ["role", "level", "experience", "format", "employment", "company", "location", "manages", "solo", "internship"]

const chips = computed(() =>
  props.recon
    .filter((row) => row.group === "profile")
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
    .map((row) => {
      const { text, note } = valueText(row)
      const prefix = PROFILE_LABEL[row.key]
      return { row, text: prefix ? `${prefix} ${text}` : text, note }
    })
)
const hhEmployment = computed(() => employmentFormLabel(props.data.vacancy.employmentForm))

const tip = (row: ReconRow, note: string | null) =>
  [
    ...RECON_SOURCES.map((s) => {
      const cell = row.cells[s.id]
      return `${s.name}: ${cell.norm === null && cell.text === null ? "—" : (cell.text ?? cell.norm)}`
    }),
    note
  ]
    .filter(Boolean)
    .join("\n")
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5 text-sm">
    <span
      v-if="salary"
      class="rounded-md bg-primary px-2.5 py-1 text-sm font-semibold text-primary-foreground"
    >{{ salary }}</span>
    <span v-if="hhEmployment" class="rounded-md border border-border bg-card px-2 py-1 text-xs">{{ hhEmployment }}</span>
    <Hint v-for="chip in chips" :key="chip.row.key" :text="tip(chip.row, chip.note)">
      <span
        class="inline-flex items-center gap-1.5 rounded-md border py-1 pl-2 pr-1.5 text-xs"
        :class="chip.row.conflict ? 'border-amber-500/60 bg-amber-500/10 text-amber-900 dark:text-amber-100' : 'border-border bg-card'"
      >
        {{ chip.text }}
        <span v-if="chip.note" class="text-muted-foreground">({{ chip.note }})</span>
        <ReconDots :row="chip.row" />
      </span>
    </Hint>
  </div>
</template>
