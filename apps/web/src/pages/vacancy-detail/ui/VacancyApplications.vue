<script setup lang="ts">
import { computed } from "vue"
import type { ApplicationRecord, HhAccountRecord, ResumeRecord } from "@otbor/contract"
import { HumanStatusBadge, employerResponse, humanStatus } from "@/entities/auto-apply"
import { AccountChip } from "@/entities/hh-account"
import { SentLetterButton } from "@/features/vacancy-apply"
import { applicationPath, formatDate } from "@/shared/lib"
import { Badge } from "@/shared/ui"
import { latestApplications } from "../lib"

/** Ваши отклики на эту вакансию: по строке на каждую пару «аккаунт + резюме». */
const props = defineProps<{
  vacancyId: string
  applications: ReadonlyArray<ApplicationRecord>
  accounts: ReadonlyArray<HhAccountRecord>
  resumes: ReadonlyArray<ResumeRecord>
  accountId: string
  resumeId: string
}>()

const rows = computed(() =>
  latestApplications(props.applications).map((application) => ({
    application,
    resumeTitle: props.resumes.find((resume) => resume.id === application.resumeId)?.title ?? "резюме не определено",
    status: humanStatus(application),
    response: employerResponse(application),
    when: formatDate(application.hhRespondedAt ?? application.updatedAt),
    selected: application.hhAccountId === props.accountId && (application.resumeId ?? "") === props.resumeId
  }))
)
</script>

<template>
  <section v-if="rows.length > 0" aria-labelledby="applications-title" class="rounded-lg border border-border bg-card">
    <h2 id="applications-title" class="px-4 pt-3 text-sm font-semibold text-muted-foreground">Ваши отклики на эту вакансию</h2>
    <ul class="divide-y divide-border">
      <li
        v-for="row in rows"
        :key="row.application.id"
        class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-sm"
      >
        <AccountChip
          :account-id="row.application.hhAccountId"
          :accounts="accounts"
          :resume-ids="[row.application.resumeId ?? null]"
          :resumes="resumes"
        />
        <span class="min-w-0 flex-1 basis-40 truncate" :class="row.selected ? 'font-medium' : 'text-muted-foreground'">
          {{ row.resumeTitle }}
        </span>
        <HumanStatusBadge :status="row.status" :show-detail="false" />
        <Badge v-if="row.response" :variant="row.response.tone" title="Ответ работодателя на hh">
          {{ row.response.label }}
        </Badge>
        <span class="text-xs tabular-nums text-muted-foreground">{{ row.when }}</span>
        <SentLetterButton
          v-if="row.selected"
          :vacancy-id="vacancyId"
          :account-id="row.application.hhAccountId"
          :resume-id="row.application.resumeId ?? null"
        />
        <a
          :href="applicationPath(row.application.id)"
          class="rounded-sm text-xs text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >Открыть отклик</a>
        <p v-if="row.status.detail" class="basis-full text-xs text-muted-foreground">{{ row.status.detail }}</p>
      </li>
    </ul>
  </section>
</template>
