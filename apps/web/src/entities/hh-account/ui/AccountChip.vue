<script setup lang="ts">
import { computed } from "vue"
import type { HhAccountRecord, ResumeRecord } from "@otbor/contract"
import { resumeCode } from "@/entities/resume"
import { hhAccountColorById } from "../colors"
import { hhAccountInitials, hhAccountName } from "../model"

const props = withDefaults(
  defineProps<{
    accountId: string | null | undefined
    accounts: ReadonlyArray<HhAccountRecord>
    /** Also print the name next to the circle (settings); tables show only the circle. */
    showName?: boolean
    /** Resumes this row was sent with (one account may use several per vacancy). */
    resumeIds?: ReadonlyArray<string | null | undefined>
    /** All known resumes; needed to resolve `resumeIds` into codes and titles. */
    resumes?: ReadonlyArray<ResumeRecord>
  }>(),
  { showName: false, resumeIds: () => [], resumes: () => [] }
)

const account = computed(() => props.accounts.find((item) => item.id === props.accountId))
const name = computed(() =>
  account.value ? hhAccountName(account.value) : (props.accountId ?? "").slice(0, 8)
)
const color = computed(() => hhAccountColorById(props.accounts, props.accountId ?? ""))
const sessionOk = computed(() => account.value?.session != null)

const accountResumes = computed(() => props.resumes.filter((r) => r.hhAccountId === props.accountId))
const titles = computed(() => accountResumes.value.map((r) => r.title))
const items = computed(() =>
  props.resumeIds
    .map((id) => props.resumes.find((r) => r.id === id))
    .filter((r): r is ResumeRecord => r !== undefined)
    .map((r) => ({
      id: r.id,
      code: resumeCode(r.title, titles.value),
      title: r.title,
      active: r.isActive,
      href: `https://hh.ru/resume/${r.externalId}`
    }))
)
const unknownResume = computed(() => props.resumeIds.length > 0 && items.value.length === 0)
const card = computed(() => !props.showName)
</script>

<template>
  <span v-if="props.accountId" class="group relative inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
    <!-- The circle continues into a capsule holding the resume code(s). -->
    <span
      class="inline-flex h-7 items-center rounded-full"
      :class="{ 'pr-1': items.length > 0 || unknownResume }"
      :style="{ backgroundColor: items.length > 0 || unknownResume ? color + '33' : undefined }"
    >
      <span
        class="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
        :style="{ backgroundColor: color }"
        :aria-label="name"
        >{{ hhAccountInitials(name) }}</span
      >
      <span
        v-for="item in items"
        :key="item.id"
        class="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-background px-1 text-xs font-bold"
        :style="{ color }"
        >{{ item.code }}</span
      >
      <span v-if="unknownResume" class="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-dashed bg-background px-1 text-xs text-muted-foreground">?</span>
    </span>
    <span v-if="props.showName">{{ name }}</span>

    <!-- Hovercard. pt-2 is an invisible bridge so the pointer can move into it. -->
    <span v-if="card" class="absolute right-0 top-full z-20 hidden pt-2 group-hover:block">
      <span class="block w-72 whitespace-normal rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-lg">
        <span class="flex items-center gap-2">
          <span class="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" :style="{ backgroundColor: color }">{{ hhAccountInitials(name) }}</span>
          <span class="flex flex-col"><b class="text-sm">{{ name }}</b><span class="text-muted-foreground">{{ account?.areaName ?? "город не указан" }}</span></span>
        </span>
        <span class="mt-2 flex items-center gap-1.5">
          <span class="size-2 rounded-full" :class="sessionOk ? 'bg-green-500' : 'bg-red-500'" />сессия hh.ru {{ sessionOk ? "активна" : "не активна" }}
        </span>
        <template v-if="items.length > 0">
          <span class="mt-2 block border-t pt-2 text-muted-foreground">{{ items.length > 1 ? "Откликнулись резюме:" : "Резюме:" }}</span>
          <a v-for="item in items" :key="item.id" :href="item.href" target="_blank" rel="noopener" class="mt-1 flex items-center gap-2 rounded-md p-1 hover:bg-muted">
            <span class="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-bold text-white" :style="{ backgroundColor: color }">{{ item.code }}</span>
            <b class="flex-1 truncate">{{ item.title }}</b>
            <span class="text-muted-foreground">{{ item.active ? "активно" : "скрыто" }} ↗</span>
          </a>
        </template>
        <span v-else-if="unknownResume" class="mt-2 block border-t pt-2 text-muted-foreground">резюме неизвестно</span>
      </span>
    </span>
  </span>
  <span v-else class="text-muted-foreground">—</span>
</template>
