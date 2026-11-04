<script setup lang="ts">
import { computed } from "vue"
import type { ApplicationRecord, HhAccountRecord, ResumeRecord } from "@otbor/contract"
import { AccountChip } from "@/entities/hh-account"
import { applicationPath, applicationStatus, formatDate } from "@/shared/lib"
import { Badge } from "@/shared/ui"

const props = defineProps<{
  applications: ReadonlyArray<ApplicationRecord>
  accounts: ReadonlyArray<HhAccountRecord>
  resumes: ReadonlyArray<ResumeRecord>
  accountId: string
  resumeId: string
}>()

const isSelected = (application: ApplicationRecord) =>
  application.hhAccountId === props.accountId && (application.resumeId ?? "") === props.resumeId

const newest = (list: ReadonlyArray<ApplicationRecord>) =>
  [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null

const selected = computed(() => newest(props.applications.filter(isSelected)))
const others = computed(() =>
  [...props.applications.filter((application) => !isSelected(application))].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  )
)
const selectedResume = computed(() => props.resumes.find((resume) => resume.id === props.resumeId))

const view = (application: ApplicationRecord) => {
  const status = applicationStatus(application)
  return {
    ...status,
    variant: status.tone === "danger" ? ("destructive" as const) : status.tone,
    when: formatDate(application.hhRespondedAt ?? application.updatedAt)
  }
}
const resumeTitle = (application: ApplicationRecord) =>
  props.resumes.find((resume) => resume.id === application.resumeId)?.title ?? "резюме не определено"
</script>

<template>
  <div class="flex flex-wrap items-stretch gap-2 text-sm">
    <!-- the resume being worked with -->
    <div
      class="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-1.5"
      :class="
        selected === null
          ? 'border-dashed border-border'
          : view(selected).tone === 'danger'
            ? 'border-red-500/50 bg-red-500/10'
            : view(selected).tone === 'success'
              ? 'border-emerald-500/50 bg-emerald-500/10'
              : 'border-sky-500/40 bg-sky-500/5'
      "
    >
      <span class="text-xs text-muted-foreground">Это резюме{{ selectedResume ? ` «${selectedResume.title}»` : "" }}:</span>
      <template v-if="selected">
        <a :href="applicationPath(selected.id)" class="font-semibold hover:underline">{{ view(selected).label }}</a>
        <span class="text-xs text-muted-foreground">{{ view(selected).when }}</span>
        <Badge v-if="view(selected).fromHh" variant="neutral" class="text-[10px]">статус hh</Badge>
      </template>
      <span v-else class="font-medium text-muted-foreground">не откликались</span>
    </div>

    <!-- every other resume that already responded -->
    <div v-if="others.length > 0" class="flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-border px-3 py-1.5">
      <span class="text-xs text-muted-foreground">Другие резюме:</span>
      <a
        v-for="application in others"
        :key="application.id"
        :href="applicationPath(application.id)"
        class="inline-flex items-center gap-1.5 rounded-md bg-muted/40 py-0.5 pl-1 pr-1.5 text-xs transition-colors hover:bg-muted"
        :title="`${resumeTitle(application)} · ${view(application).when}`"
      >
        <AccountChip
          :account-id="application.hhAccountId"
          :accounts="accounts"
          :resume-ids="[application.resumeId]"
          :resumes="resumes"
        />
        <Badge :variant="view(application).variant" class="px-1.5 py-0 text-[11px]">{{ view(application).label }}</Badge>
      </a>
    </div>
    <div v-else class="flex items-center rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground">
      Другие резюме: откликов нет
    </div>
  </div>
</template>
