<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import type { HhAccountRecord, ResumeRecord } from "@otbor/contract"
import { hhAccountApi, hhAccountKeys, hhAccountName } from "@/entities/hh-account"
import { resumeApi, resumeKeys } from "@/entities/resume"
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import AutoApplyPreviewTab from "./AutoApplyPreviewTab.vue"
import AutoApplyProgressTab from "./AutoApplyProgressTab.vue"

/** Select values cannot be empty: this stands for "every resume of the account". */
const ACCOUNT_DEFAULT = "__account__"

const initial = new URLSearchParams(window.location.search)

const accountsQuery = useQuery({ key: () => hhAccountKeys.list(), query: () => hhAccountApi.list() })
const accounts = computed<ReadonlyArray<HhAccountRecord>>(() => accountsQuery.data.value ?? [])
const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })
const allResumes = computed<ReadonlyArray<ResumeRecord>>(() => resumesQuery.data.value ?? [])

const accountId = ref<string>(initial.get("account") ?? "")
const resumeSelection = ref<string>(initial.get("resume") ?? ACCOUNT_DEFAULT)
const tab = ref<string>(initial.get("tab") === "progress" ? "progress" : "preview")

watch(
  accounts,
  (list) => {
    if (accountId.value === "" || !list.some((account) => account.id === accountId.value)) {
      const pick = list.find((account) => account.isDefault) ?? list[0]
      if (pick !== undefined) accountId.value = pick.id
    }
  },
  { immediate: true }
)

const accountResumes = computed(() => allResumes.value.filter((resume) => resume.hhAccountId === accountId.value))

watch(accountId, () => {
  if (
    resumeSelection.value !== ACCOUNT_DEFAULT &&
    !accountResumes.value.some((resume) => resume.id === resumeSelection.value)
  ) {
    resumeSelection.value = ACCOUNT_DEFAULT
  }
})

const resumeId = computed<string | null>(() =>
  resumeSelection.value === ACCOUNT_DEFAULT ? null : resumeSelection.value
)
</script>

<template>
  <section>
    <PageHeader
      title="Автоотклики"
      description="Что возьмёт следующий запуск автоотклика и как идут уже созданные отклики."
    />

    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div class="space-y-1">
        <Label class="text-xs">Аккаунт hh</Label>
        <Select v-model="accountId">
          <SelectTrigger class="h-8 w-[220px] text-sm"><SelectValue placeholder="Аккаунт" /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="account in accounts" :key="account.id" :value="account.id">
              {{ hhAccountName(account) }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="space-y-1">
        <Label class="text-xs">Резюме</Label>
        <Select v-model="resumeSelection">
          <SelectTrigger class="h-8 w-[280px] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem :value="ACCOUNT_DEFAULT">Все резюме аккаунта</SelectItem>
            <SelectItem v-for="resume in accountResumes" :key="resume.id" :value="resume.id">
              {{ resume.title }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <Tabs v-model="tab" class="gap-4">
      <TabsList>
        <TabsTrigger value="preview">Что возьмёт следующий запуск</TabsTrigger>
        <TabsTrigger value="progress">Ход</TabsTrigger>
      </TabsList>

      <TabsContent value="preview">
        <AutoApplyPreviewTab :account-id="accountId" :resume-id="resumeId" />
      </TabsContent>
      <TabsContent value="progress">
        <AutoApplyProgressTab :account-id="accountId" :visible="tab === 'progress'" />
      </TabsContent>
    </Tabs>
  </section>
</template>
