<script setup lang="ts">
import { computed } from "vue"
import type { ApplicationRecord, ContactRecord, DecisionRecord, VacancyDetail } from "@otbor/contract"
import { AccountChip } from "@/entities/hh-account"
import type { HhAccountRecord } from "@otbor/contract"
import {
  applicationPath,
  applicationRequestLabel,
  conditionFacts,
  contactHref,
  contactKindLabel,
  decisionsPath,
  formatDate,
  formatPriority,
  redFlagLabel,
  scheduleCodeLabel,
  statusLabel
} from "@/shared/lib"
import { Button, StatusBadge } from "@/shared/ui"

const props = defineProps<{
  data: VacancyDetail
  decisions: ReadonlyArray<DecisionRecord>
  applications: ReadonlyArray<ApplicationRecord>
  contacts: ReadonlyArray<ContactRecord>
  accounts: ReadonlyArray<HhAccountRecord>
  defaultAccountId: string | undefined
  hydrating: boolean
}>()

defineEmits<{ hydrate: [] }>()

const facts = computed(() => props.data.facts)
const hh = computed(() => facts.value?.hh ?? null)
const text = computed(() => facts.value?.text)
const conditions = computed(() =>
  text.value?.conditions ? conditionFacts(text.value.conditions) : []
)
const decision = computed(
  () =>
    props.decisions.find((item) => item.hhAccountId === props.defaultAccountId) ??
    props.decisions[0]
)
const isHttp = (href: string | null) => /^https?:/i.test(href ?? "")

const sectionTitle = "mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
const section = "border-t border-border pt-3 first:border-t-0 first:pt-0"
</script>

<template>
  <aside class="space-y-3 text-sm">
    <section v-if="facts" :class="section">
      <h2 :class="sectionTitle">Отклик</h2>
      <div v-if="hh === null" class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        Данные отклика с hh не загружены
        <Button size="sm" variant="outline" :disabled="hydrating" @click="$emit('hydrate')">
          Загрузить
        </Button>
      </div>
      <ul class="space-y-1">
        <li v-if="hh?.letterRequired === true">
          Письмо: <b>hh требует приложить</b>
        </li>
        <li v-if="text?.coverLetter.requested">
          Письмо: <b>упомянуто в тексте</b>
          <p v-if="text.coverLetter.evidence" class="text-xs text-muted-foreground">
            «{{ text.coverLetter.evidence }}»
          </p>
        </li>
        <li v-if="hh?.test.hasTest">
          Тест:
          <b>{{ hh.test.required === null ? "есть" : hh.test.required ? "обязательный" : "необязательный" }}</b>
        </li>
        <li v-for="request in text?.applicationRequests ?? []" :key="request.code">
          Просят: <b>{{ applicationRequestLabel(request.code) }}</b>
          <p class="text-xs text-muted-foreground">«{{ request.evidence }}»</p>
        </li>
        <li v-if="hh && hh.workScheduleDays.length + hh.workingHours.length > 0" class="text-xs text-muted-foreground">
          График: {{ [...hh.workScheduleDays, ...hh.workingHours].map(scheduleCodeLabel).join(", ") }}
        </li>
      </ul>
    </section>

    <section v-if="facts" :class="section">
      <h2 :class="sectionTitle">Красные флаги</h2>
      <ul v-if="(text?.redFlags.length ?? 0) > 0" class="space-y-1.5">
        <li v-for="flag in text?.redFlags" :key="flag.code">
          <span class="font-medium text-red-300">{{ redFlagLabel(flag.code) }}</span>
          <p class="text-xs text-muted-foreground">«{{ flag.evidence }}»</p>
        </li>
      </ul>
      <p v-else class="text-xs text-muted-foreground">не найдено</p>
    </section>

    <section v-if="conditions.length > 0" :class="section">
      <h2 :class="sectionTitle">Условия</h2>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <template v-for="fact in conditions" :key="fact.key">
          <dt class="text-muted-foreground" :title="fact.evidence">{{ fact.label }}</dt>
          <dd class="text-right" :title="fact.evidence">{{ fact.value }}</dd>
        </template>
      </dl>
    </section>

    <section :class="section">
      <h2 :class="sectionTitle">Решение</h2>
      <div v-if="decision" class="flex flex-wrap items-center gap-2">
        <StatusBadge :value="decision.verdict" />
        <span class="text-xs text-muted-foreground">
          соответствие {{ decision.fit }} · приоритет {{ formatPriority(decision.priority) }}
        </span>
      </div>
      <p v-else class="text-xs text-muted-foreground">Вакансия ещё не оценивалась.</p>
      <a :href="decisionsPath()" class="text-xs text-muted-foreground hover:text-primary">
        Все решения
      </a>
    </section>

    <section :class="section">
      <h2 :class="sectionTitle">Отклики аккаунтов</h2>
      <ul v-if="applications.length > 0" class="space-y-1">
        <li v-for="application in applications" :key="application.id" class="flex items-center gap-2">
          <AccountChip :account-id="application.hhAccountId" :accounts="accounts" />
          <a :href="applicationPath(application.id)" class="hover:text-primary">
            {{ statusLabel(application.state) }}
          </a>
          <span class="text-xs text-muted-foreground">{{ formatDate(application.updatedAt) }}</span>
        </li>
      </ul>
      <p v-else class="text-xs text-muted-foreground">Откликов нет.</p>
    </section>

    <section :class="section">
      <h2 :class="sectionTitle">Контакты</h2>
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
    </section>
  </aside>
</template>
