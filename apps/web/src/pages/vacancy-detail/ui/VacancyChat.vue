<script setup lang="ts">
import { computed, ref } from "vue"
import { useQuery } from "@pinia/colada"
import { useIntervalFn } from "@vueuse/core"
import { MessageSquare, RefreshCw } from "@lucide/vue"
import { conversationApi, conversationKeys } from "@/entities/conversation"
import { Button, Skeleton, useToast } from "@/shared/ui"
import { describeError, formatDate } from "@/shared/lib"
import type { VacancyPage } from "../model"

const props = defineProps<{ page: VacancyPage }>()

/** The chat of the response made with the resume chosen on this page. */
const key = () => ({
  vacancyId: props.page.id(),
  accountId: props.page.accountId.value,
  resumeId: props.page.resumeId.value
})

const query = useQuery({
  key: () => conversationKeys.vacancyChat(key().vacancyId, key().accountId, key().resumeId),
  query: () => conversationApi.vacancyChat(key()),
  enabled: () => props.page.accountId.value !== ""
})
const chat = computed(() => query.data.value ?? null)
const inFlight = computed(() => chat.value?.fetch === "pending" || chat.value?.fetch === "running")
// Poll only while a read is in flight, so the page does not hammer the API.
useIntervalFn(() => {
  if (inFlight.value) void query.refetch()
}, 2000)

const busy = ref(false)
const toast = useToast()
const refresh = async () => {
  if (busy.value || inFlight.value) return
  busy.value = true
  try {
    await conversationApi.vacancyChatRefresh(key())
    await query.refetch()
  } catch (error) {
    toast.error("Не удалось обновить чат", { description: describeError(error) })
  } finally {
    busy.value = false
  }
}

const messages = computed(() => chat.value?.detail?.messages ?? [])
const resumeTitle = computed(() => props.page.selectedResume.value?.title ?? null)
</script>

<template>
  <section class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="flex items-center gap-1.5 text-sm font-semibold">
        <MessageSquare class="size-4" />
        Переписка
        <span v-if="resumeTitle" class="font-normal text-muted-foreground">· {{ resumeTitle }}</span>
      </h2>
      <Button
        v-if="chat?.chatId"
        variant="outline"
        size="sm"
        :disabled="busy || inFlight"
        @click="refresh"
      >
        <RefreshCw class="size-4" :class="busy || inFlight ? 'animate-spin' : ''" />
        Обновить
      </Button>
    </div>

    <p v-if="chat?.fetch === 'failed' || chat?.fetch === 'needs_human'" class="text-xs text-destructive">
      {{ chat.message ?? "Не удалось прочитать чат" }}
    </p>

    <Skeleton v-if="query.isPending.value" class="h-24 w-full" />
    <p v-else-if="!chat?.chatId" class="text-sm text-muted-foreground">
      С этим резюме нет отклика с известным чатом. Если вы откликнулись вручную, синхронизируйте отклики.
    </p>
    <template v-else>
      <p v-if="messages.length === 0" class="text-sm text-muted-foreground">
        Сообщения ещё не загружены. Нажмите «Обновить».
      </p>
      <ol v-else class="space-y-2">
        <li
          v-for="message in messages"
          :key="message.id"
          class="flex"
          :class="message.direction === 'out' ? 'justify-end' : 'justify-start'"
        >
          <div
            v-if="message.kind === 'service'"
            class="w-full text-center text-xs text-muted-foreground"
          >
            {{ message.text ?? (message.direction === "out" ? "Вы откликнулись" : "Служебное сообщение") }}
            · {{ formatDate(message.sentAt) }}
          </div>
          <div
            v-else
            class="max-w-[85%] rounded-lg px-3 py-2 text-sm"
            :class="message.direction === 'out' ? 'bg-primary text-primary-foreground' : 'bg-muted'"
          >
            <p class="whitespace-pre-wrap break-words">{{ message.text }}</p>
            <p class="mt-1 text-xs opacity-70">{{ formatDate(message.sentAt) }}</p>
          </div>
        </li>
      </ol>
      <p v-if="chat.fetchedAt" class="text-xs text-muted-foreground">
        Обновлено {{ formatDate(chat.fetchedAt) }}
      </p>
    </template>
  </section>
</template>
