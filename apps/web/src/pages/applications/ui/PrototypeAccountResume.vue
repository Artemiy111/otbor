<script setup lang="ts">
// PROTOTYPE (throwaway): 4 ways to show account + resume + hh link in a table cell.
// Switch with ?variant=A|B|C|D or the floating bar / arrow keys.
import { computed } from "vue"
import type { HhAccountRecord, ResumeRecord } from "@otbor/contract"
import { hhAccountColorById, hhAccountInitials, hhAccountName } from "@/entities/hh-account"

const props = defineProps<{
  variant: string
  accountId: string
  resumeId?: string | null
  accounts: ReadonlyArray<HhAccountRecord>
  resumes: ReadonlyArray<ResumeRecord>
}>()

const account = computed(() => props.accounts.find((a) => a.id === props.accountId))
const name = computed(() => (account.value ? hhAccountName(account.value) : props.accountId.slice(0, 8)))
const color = computed(() => hhAccountColorById(props.accounts, props.accountId))
const initials = computed(() => hhAccountInitials(name.value))
const accountResumes = computed(() => props.resumes.filter((r) => r.hhAccountId === props.accountId))
// Prototype fallback: imported applications have no resumeId, so show the account's first resume.
// Every 5th-ish row (by id hash) is forced to "unknown" to show the empty state.
const forceUnknown = computed(() => (props.accountId.charCodeAt(0) + (props.resumeId?.length ?? 0)) % 7 === 0 && false)
const resume = computed(
  () => props.resumes.find((r) => r.id === props.resumeId) ?? (forceUnknown.value ? undefined : accountResumes.value[0])
)
const resumeTitle = computed(() => resume.value?.title ?? null)
const short = computed(() => {
  const t = resumeTitle.value
  return t === null ? null : t.length > 14 ? `${t.slice(0, 13)}…` : t
})
const resumeIdx = computed(() => {
  const i = accountResumes.value.findIndex((r) => r.id === resume.value?.id)
  return i < 0 ? null : i + 1
})
const sessionOk = computed(() => account.value?.session != null)
</script>

<template>
  <span class="group relative inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
    <!-- A: circle + resume badge -->
    <template v-if="variant === 'A'">
      <span class="inline-flex size-6 items-center justify-center rounded-full text-[10px] font-bold text-white" :style="{ backgroundColor: color }">{{ initials }}</span>
      <span v-if="short" class="rounded-md border px-1.5 py-0.5 text-xs" :style="{ borderColor: color, color }">{{ short }}</span>
      <span v-else class="rounded-md border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground">резюме ?</span>
    </template>

    <!-- B: circle with corner marker -->
    <template v-else-if="variant === 'B'">
      <span class="relative inline-flex size-6 items-center justify-center rounded-full text-[10px] font-bold text-white" :style="{ backgroundColor: color }" :title="`${name} · ${resumeTitle ?? 'резюме неизвестно'}`">
        {{ initials }}
        <span class="absolute -bottom-1 -right-1 inline-flex size-3.5 items-center justify-center rounded-full border-2 border-background bg-foreground text-[8px] font-bold text-background">{{ resumeIdx ?? "?" }}</span>
      </span>
    </template>

    <!-- C: circle only + hovercard -->
    <template v-else-if="variant === 'C'">
      <span class="inline-flex size-6 cursor-default items-center justify-center rounded-full text-[10px] font-bold text-white" :style="{ backgroundColor: color }">{{ initials }}</span>
      <span class="pointer-events-none absolute right-0 top-7 z-20 hidden w-64 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-lg group-hover:block">
        <span class="flex items-center gap-2">
          <span class="inline-flex size-8 items-center justify-center rounded-full text-xs font-bold text-white" :style="{ backgroundColor: color }">{{ initials }}</span>
          <span class="flex flex-col"><b class="text-sm">{{ name }}</b><span class="text-muted-foreground">{{ account?.areaName ?? "город не указан" }}</span></span>
        </span>
        <span class="mt-2 flex items-center gap-1.5"><span class="size-2 rounded-full" :class="sessionOk ? 'bg-green-500' : 'bg-red-500'" />сессия hh.ru {{ sessionOk ? "активна" : "не активна" }}</span>
        <span class="mt-2 block border-t pt-2"><span class="text-muted-foreground">Резюме:</span> <b>{{ resumeTitle ?? "неизвестно" }}</b></span>
        <span v-if="accountResumes.length > 1" class="mt-1 block text-muted-foreground">ещё {{ accountResumes.length - 1 }} в аккаунте</span>
        <span class="mt-2 block text-primary">открыть на hh.ru ↗</span>
      </span>
    </template>

    <!-- D: composite pill -->
    <template v-else>
      <span class="inline-flex items-stretch overflow-hidden rounded-md border text-xs">
        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 font-semibold text-white" :style="{ backgroundColor: color }">{{ initials }}<span class="font-normal opacity-90">{{ name.split(" ")[0] }}</span></span>
        <span class="inline-flex items-center px-1.5">{{ resumeTitle ?? "резюме ?" }}</span>
        <span class="inline-flex items-center gap-1 border-l bg-muted px-1.5 text-muted-foreground"><span class="size-1.5 rounded-full" :class="sessionOk ? 'bg-green-500' : 'bg-red-500'" />hh ↗</span>
      </span>
    </template>
  </span>
</template>
