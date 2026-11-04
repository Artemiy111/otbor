<script setup lang="ts">
import { computed } from "vue"
import type { ContactRecord, VacancyDetail } from "@otbor/contract"
import {
  applicationRequestLabel,
  conditionFacts,
  contactHref,
  contactKindLabel,
  formatNumber,
  redFlagLabel,
  scheduleCodeLabel
} from "@/shared/lib"
import { Badge, Button } from "@/shared/ui"

const props = defineProps<{
  data: VacancyDetail
  contacts: ReadonlyArray<ContactRecord>
  hydrating: boolean
}>()
defineEmits<{ hydrate: [] }>()

const facts = computed(() => props.data.facts)
const hh = computed(() => facts.value?.hh ?? null)
const text = computed(() => facts.value?.text)
const conditions = computed(() =>
  text.value?.conditions ? conditionFacts(text.value.conditions) : []
)
const schedule = computed(() =>
  hh.value ? [...hh.value.workScheduleDays, ...hh.value.workingHours].map(scheduleCodeLabel) : []
)
const requests = computed(() => text.value?.applicationRequests ?? [])
const redFlags = computed(() => text.value?.redFlags ?? [])
const isHttp = (href: string | null) => /^https?:/i.test(href ?? "")
const heading = "mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
</script>

<template>
  <div class="space-y-4 text-sm">
    <div
      v-if="hh === null"
      class="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground"
    >
      Данные отклика с hh не загружены
      <Button size="sm" variant="outline" :disabled="hydrating" @click="$emit('hydrate')">
        Загрузить
      </Button>
    </div>

    <div v-if="redFlags.length > 0">
      <h3 :class="heading">Красные флаги</h3>
      <ul class="space-y-1.5">
        <li v-for="flag in redFlags" :key="flag.code">
          <Badge variant="destructive">{{ redFlagLabel(flag.code) }}</Badge>
          <span class="ml-1.5 text-xs text-muted-foreground">«{{ flag.evidence }}»</span>
        </li>
      </ul>
    </div>

    <div v-if="hh || requests.length > 0 || text?.coverLetter.requested || schedule.length > 0 || data.responsesTotal != null">
      <h3 :class="heading">Про отклик и график</h3>
      <ul class="space-y-1">
        <li v-if="hh?.letterRequired === true">Письмо: <b>hh требует приложить</b></li>
        <li v-if="text?.coverLetter.requested">
          Письмо: <b>упомянуто в тексте</b>
          <span v-if="text.coverLetter.evidence" class="ml-1 text-xs text-muted-foreground">
            «{{ text.coverLetter.evidence }}»
          </span>
        </li>
        <li v-if="hh?.test.hasTest">
          Тест:
          <b>{{ hh.test.required === null ? "есть" : hh.test.required ? "обязательный" : "необязательный" }}</b>
        </li>
        <li v-for="request in requests" :key="request.code">
          Просят приложить: <b>{{ applicationRequestLabel(request.code) }}</b>
          <span class="ml-1 text-xs text-muted-foreground">«{{ request.evidence }}»</span>
        </li>
        <li v-if="schedule.length > 0">График: <b>{{ schedule.join(", ") }}</b></li>
        <li v-if="data.responsesTotal != null">
          Откликов на вакансию: <b>{{ formatNumber(data.responsesTotal) }}</b>
        </li>
      </ul>
    </div>

    <div v-if="conditions.length > 0">
      <h3 :class="heading">Условия из текста</h3>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <template v-for="fact in conditions" :key="fact.key">
          <dt class="text-muted-foreground" :title="fact.evidence">{{ fact.label }}</dt>
          <dd class="text-right" :title="fact.evidence">{{ fact.value }}</dd>
        </template>
      </dl>
    </div>

    <div>
      <h3 :class="heading">Контакты</h3>
      <ul v-if="contacts.length > 0" class="space-y-1">
        <li v-for="contact in contacts" :key="contact.id" class="min-w-0">
          <a
            v-if="contactHref(contact)"
            :href="contactHref(contact) ?? undefined"
            :target="isHttp(contactHref(contact)) ? '_blank' : undefined"
            :rel="isHttp(contactHref(contact)) ? 'noreferrer' : undefined"
            class="break-all text-sky-300 underline-offset-4 hover:underline"
            :title="contact.evidence ?? undefined"
          >
            {{ contact.value }}
          </a>
          <span v-else class="break-all" :title="contact.evidence ?? undefined">{{ contact.value }}</span>
          <span class="text-xs text-muted-foreground">
            · {{ contactKindLabel(contact.kind) }}<template v-if="contact.personName"> · {{ contact.personName }}</template>
          </span>
        </li>
      </ul>
      <p v-else class="text-xs text-muted-foreground">В тексте вакансии контактов нет.</p>
    </div>
  </div>
</template>
