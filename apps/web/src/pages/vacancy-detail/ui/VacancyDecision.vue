<script setup lang="ts">
import { computed } from "vue"
import type { ApplicationRecord, DecisionRecord, HhAccountRecord, ResumeRecord } from "@otbor/contract"
import { AccountChip } from "@/entities/hh-account"
import { applicationPath, decisionsPath, formatDate, formatPriority, statusLabel } from "@/shared/lib"
import { StatusBadge } from "@/shared/ui"

const props = defineProps<{
  decisions: ReadonlyArray<DecisionRecord>
  applications: ReadonlyArray<ApplicationRecord>
  accounts: ReadonlyArray<HhAccountRecord>
  resumes: ReadonlyArray<ResumeRecord>
  defaultAccountId: string | undefined
}>()

const decision = computed(
  () =>
    props.decisions.find((item) => item.hhAccountId === props.defaultAccountId) ??
    props.decisions[0]
)
const heading = "mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
</script>

<template>
  <div class="space-y-4 text-sm">
    <div>
      <h3 :class="heading">Решение otbor</h3>
      <div v-if="decision" class="flex flex-wrap items-center gap-2">
        <StatusBadge :value="decision.verdict" />
        <span class="text-xs text-muted-foreground">
          соответствие {{ decision.fit }} · приоритет {{ formatPriority(decision.priority) }}
        </span>
      </div>
      <p v-else class="text-xs text-muted-foreground">Вакансия ещё не оценивалась.</p>
      <a :href="decisionsPath()" class="text-xs text-muted-foreground hover:text-primary">Все решения</a>
    </div>
    <div>
      <h3 :class="heading">Уже откликались</h3>
      <ul v-if="applications.length > 0" class="space-y-1">
        <li v-for="application in applications" :key="application.id" class="flex items-center gap-2">
          <AccountChip
            :account-id="application.hhAccountId"
            :accounts="accounts"
            :resume-ids="[application.resumeId]"
            :resumes="resumes"
          />
          <a :href="applicationPath(application.id)" class="hover:text-primary">
            {{ statusLabel(application.state) }}
          </a>
          <span class="text-xs text-muted-foreground">{{ formatDate(application.updatedAt) }}</span>
        </li>
      </ul>
      <p v-else class="text-xs text-muted-foreground">Откликов нет.</p>
    </div>
  </div>
</template>
