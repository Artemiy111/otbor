<script setup lang="ts">
import { computed, nextTick, ref } from "vue"
import { onClickOutside } from "@vueuse/core"
import { Check, ChevronDown, ChevronRight } from "@lucide/vue"
import type { HhAccountRecord, ResumeRecord } from "@otbor/contract"
import { AccountChip, hhAccountName } from "@/entities/hh-account"

const props = defineProps<{
  accounts: ReadonlyArray<HhAccountRecord>
  resumes: ReadonlyArray<ResumeRecord>
  /** Resume ids already responded with, per account, to mark them in the list. */
  sent?: ReadonlyArray<{ accountId: string; resumeId: string | null }>
  disabled?: boolean
}>()
const accountId = defineModel<string>("accountId", { required: true })
const resumeId = defineModel<string>("resumeId", { required: true })

const open = ref(false)
const hovered = ref<string>("")
const root = ref<HTMLElement | null>(null)
onClickOutside(root, () => (open.value = false))

const resumesOf = (id: string) => props.resumes.filter((resume) => resume.hhAccountId === id)
const current = computed(() => props.resumes.find((resume) => resume.id === resumeId.value) ?? null)
const currentAccount = computed(() => props.accounts.find((account) => account.id === accountId.value))
const wasSent = (account: string, resume: string) =>
  props.sent?.some((item) => item.accountId === account && item.resumeId === resume) ?? false

const toggle = async () => {
  if (props.disabled) return
  open.value = !open.value
  hovered.value = accountId.value
  await nextTick()
}
const pick = (account: string, resume: string) => {
  accountId.value = account
  resumeId.value = resume
  open.value = false
}
/** A click on the account itself picks its first active resume: one click fewer when the choice is obvious. */
const pickAccount = (account: string) => {
  const list = resumesOf(account)
  const resume = list.find((item) => item.isActive) ?? list[0]
  if (resume) pick(account, resume.id)
}
</script>

<template>
  <div ref="root" class="relative" @keydown.esc="open = false">
    <button
      type="button"
      class="flex w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-left text-sm shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      :disabled="disabled"
      :aria-expanded="open"
      @click="toggle"
    >
      <AccountChip
        v-if="accountId"
        :account-id="accountId"
        :accounts="accounts"
        :resume-ids="current ? [current.id] : []"
        :resumes="resumes"
      />
      <span class="min-w-0 flex-1 truncate">
        <span class="font-medium">{{ currentAccount ? hhAccountName(currentAccount) : "Выберите аккаунт" }}</span>
        <span v-if="current" class="text-muted-foreground"> · {{ current.title }}</span>
        <span v-else-if="currentAccount" class="text-muted-foreground"> · резюме нет</span>
      </span>
      <ChevronDown class="size-4 shrink-0 text-muted-foreground transition-transform" :class="open ? 'rotate-180' : ''" />
    </button>

    <div
      v-if="open"
      class="absolute inset-x-0 top-full z-30 mt-1 flex overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl"
    >
      <ul class="w-1/2 shrink-0 border-r border-border p-1" role="menu" aria-label="Аккаунты hh">
        <li v-for="account in accounts" :key="account.id" role="none">
          <button
            type="button"
            role="menuitem"
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors"
            :class="hovered === account.id ? 'bg-muted' : 'hover:bg-muted/60'"
            @mouseenter="hovered = account.id"
            @focus="hovered = account.id"
            @click="pickAccount(account.id)"
          >
            <AccountChip :account-id="account.id" :accounts="accounts" />
            <span class="min-w-0 flex-1 truncate">{{ hhAccountName(account) }}</span>
            <ChevronRight class="size-4 text-muted-foreground" />
          </button>
        </li>
      </ul>
      <ul class="min-h-24 flex-1 p-1" role="menu" aria-label="Резюме">
        <li v-if="resumesOf(hovered).length === 0" class="px-2 py-3 text-xs text-muted-foreground">
          У этого аккаунта нет загруженных резюме.
        </li>
        <li v-for="resume in resumesOf(hovered)" :key="resume.id" role="none">
          <button
            type="button"
            role="menuitem"
            class="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
            @click="pick(hovered, resume.id)"
          >
            <Check
              class="mt-0.5 size-4 shrink-0"
              :class="resume.id === resumeId && hovered === accountId ? 'text-primary' : 'text-transparent'"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate" :class="resume.isActive ? '' : 'text-muted-foreground'">{{ resume.title }}</span>
              <span v-if="!resume.isActive || wasSent(hovered, resume.id)" class="text-xs text-muted-foreground">
                <template v-if="wasSent(hovered, resume.id)">уже откликались</template>
                <template v-if="!resume.isActive && wasSent(hovered, resume.id)"> · </template>
                <template v-if="!resume.isActive">неактивно</template>
              </span>
            </span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
