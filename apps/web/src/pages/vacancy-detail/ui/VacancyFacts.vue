<script setup lang="ts">
import { computed, ref } from "vue"
import { ChevronRight } from "@lucide/vue"
import type { ContactRecord, VacancyDetail } from "@otbor/contract"
import {
  cn,
  conditionFacts,
  contactHref,
  contactKindLabel,
  formatDate,
  formatNumber,
  RECON_GROUPS,
  toneClasses,
  type ReconGroup
} from "@/shared/lib"
import { Button } from "@/shared/ui"
import { reconWording } from "../lib"
import type { VacancyPage } from "../model"

/**
 * «Факты и источники»: что о вакансии говорят поля hh, разбор текста и модель,
 * и где они расходятся. Свёрнут: нужен, когда хочется проверить сомнительный пункт.
 */
const props = defineProps<{ page: VacancyPage; data: VacancyDetail; contacts: ReadonlyArray<ContactRecord> }>()
const open = ref(false)

const order: ReadonlyArray<ReconGroup> = ["profile", "apply", "risk", "perk"]
const wording = computed(() => props.page.recon.value.map((row) => ({ row, words: reconWording(row) })))
const groups = computed(() =>
  order
    .flatMap((group) => {
      const rows = wording.value.filter((item) => item.row.group === group)
      return rows.length === 0 ? [] : [{ group, title: RECON_GROUPS[group], rows }]
    })
)
const conflicts = computed(() => wording.value.filter((item) => item.words.verdict === "conflict").length)
const agreed = computed(() => wording.value.filter((item) => item.words.verdict === "agree").length)

const wanted = new Set(["probation", "interviewStages", "vacation", "sickLeave"])
const numbers = computed(() =>
  (props.data.facts?.text.conditions ? conditionFacts(props.data.facts.text.conditions) : [])
    .filter((fact) => wanted.has(fact.key))
    .filter((fact) => !["нет", "не оплачивается"].includes(fact.value))
)
const hh = computed(() => props.data.facts?.hh ?? null)
const isHttp = (href: string | null) => /^https?:/i.test(href ?? "")
const analysis = computed(() => props.page.analysis.value)
</script>

<template>
  <section class="rounded-lg border border-border bg-card" aria-labelledby="facts-title">
    <h2 id="facts-title" class="text-base font-semibold">
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-lg px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-expanded="open"
        aria-controls="facts-body"
        @click="open = !open"
      >
        <ChevronRight class="size-4 shrink-0 text-muted-foreground transition-transform" :class="open ? 'rotate-90' : ''" />
        Факты и источники
        <span class="ml-auto text-sm font-normal tabular-nums text-muted-foreground">
          <template v-if="wording.length > 0">
            совпало {{ agreed }}<template v-if="conflicts > 0">, расходятся <span :class="toneClasses('warning').text">{{ conflicts }}</span></template>
          </template>
          <template v-else>нет данных</template>
        </span>
      </button>
    </h2>

    <div v-show="open" id="facts-body" class="space-y-4 border-t border-border px-4 py-4 text-sm">
      <p class="text-muted-foreground">
        Три источника описывают одну вакансию: поля hh, разбор текста и модель. Здесь видно, где они сходятся.
      </p>

      <div v-for="entry in groups" :key="entry.group" class="space-y-1">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{{ entry.title }}</h3>
        <table class="w-full text-left">
          <caption class="sr-only">{{ entry.title }}</caption>
          <tbody class="divide-y divide-border">
            <tr v-for="item in entry.rows" :key="item.row.key" class="align-top">
              <th scope="row" class="w-1/4 min-w-24 py-1.5 pr-3 font-medium">{{ item.words.label }}</th>
              <td class="py-1.5 pr-3 text-muted-foreground">{{ item.words.sources }}</td>
              <td
                class="w-28 py-1.5 text-right text-xs"
                :class="cn(item.words.verdict === 'conflict' ? toneClasses('warning').text : item.words.verdict === 'agree' ? toneClasses('success').text : 'text-muted-foreground')"
              >
                {{ item.words.note }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="numbers.length > 0 || data.responsesTotal != null || contacts.length > 0" class="flex flex-wrap gap-x-4 gap-y-1">
        <span v-for="fact in numbers" :key="fact.key" :title="fact.evidence ? `«${fact.evidence}»` : undefined">
          <span class="text-muted-foreground">{{ fact.label }}:</span> <b class="font-medium">{{ fact.value }}</b>
        </span>
        <span v-if="data.responsesTotal != null" class="tabular-nums">
          <span class="text-muted-foreground">откликов на hh:</span> <b class="font-medium">{{ formatNumber(data.responsesTotal) }}</b>
        </span>
        <span v-for="contact in contacts" :key="contact.id" class="min-w-0">
          <span class="text-muted-foreground">{{ contactKindLabel(contact.kind) }}:</span>
          <a
            v-if="contactHref(contact)"
            :href="contactHref(contact) ?? undefined"
            :target="isHttp(contactHref(contact)) ? '_blank' : undefined"
            rel="noreferrer"
            class="break-all text-info underline-offset-4 hover:underline"
          >{{ contact.value }}</a>
          <span v-else class="break-all">{{ contact.value }}</span>
        </span>
      </div>

      <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <template v-if="analysis">Разбор модели: {{ analysis.model }}, {{ formatDate(analysis.updatedAt) }}.</template>
        <template v-else-if="!page.analysisPending.value">Модель эту вакансию не разбирала.</template>
        <template v-if="hh === null">
          Данные отклика с hh не загружены.
          <Button size="sm" variant="outline" :disabled="page.hydrating.value" @click="page.hydrate">Загрузить</Button>
        </template>
      </p>
    </div>
  </section>
</template>
