<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { Paperclip } from "@lucide/vue"
import type { ConversationMessageRecord } from "@otbor/contract"
import { cn } from "@/shared/lib"
import { formatClock, groupMessagesByDay, linkify } from "../model/inbox"

const props = defineProps<{
  conversationId: string
  messages: ReadonlyArray<ConversationMessageRecord>
  /** Как подписывать собеседника у входящих. */
  peerName: string
}>()

const days = computed(() => groupMessagesByDay(props.messages))

/* Поток прокручивается вниз при открытии диалога и при новых сообщениях, если читатель и так внизу. */
const scroller = ref<HTMLElement | null>(null)
let stickToBottom = true
const onScroll = () => {
  const el = scroller.value
  if (el !== null) stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
}
const toBottom = async () => {
  await nextTick()
  const el = scroller.value
  if (el !== null) el.scrollTop = el.scrollHeight
}
watch(
  () => props.conversationId,
  () => {
    stickToBottom = true
    void toBottom()
  },
  { immediate: true }
)
watch(
  () => props.messages.length,
  () => {
    if (stickToBottom) void toBottom()
  },
  { flush: "post" }
)

const bodyText = (message: ConversationMessageRecord): string => {
  const text = message.text?.trim() ?? ""
  if (text !== "") return text
  return message.kind === "media" ? "Вложение без подписи" : "Сообщение без текста"
}
</script>

<template>
  <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5" @scroll.passive="onScroll">
    <div v-if="days.length === 0" class="flex h-full flex-col items-center justify-center gap-1 text-center">
      <p class="text-sm font-medium">Сообщений нет</p>
      <p class="max-w-xs text-sm text-muted-foreground">Переписка сохранена без текста или ещё не синхронизирована.</p>
    </div>

    <section v-for="day in days" :key="day.key" class="mb-4 space-y-2 last:mb-0">
      <h3 class="sticky top-0 z-10 flex justify-center py-1">
        <span class="rounded-full bg-muted px-3 py-0.5 text-xs font-medium text-muted-foreground">{{ day.label }}</span>
      </h3>

      <template v-for="message in day.messages" :key="message.id">
        <p v-if="message.kind === 'service'" class="text-center text-xs italic text-muted-foreground">
          {{ bodyText(message) }}
        </p>

        <div v-else class="flex" :class="message.direction === 'out' ? 'justify-end' : 'justify-start'">
          <div
            :class="
              cn(
                'max-w-[88%] rounded-2xl px-3 py-2 text-sm sm:max-w-[75%]',
                message.direction === 'out'
                  ? 'rounded-br-sm bg-primary text-primary-foreground'
                  : 'rounded-bl-sm bg-muted text-foreground'
              )
            "
          >
            <!-- Отправитель известен у писем (from); у Telegram и чата hh берём собеседника диалога. -->
            <p class="mb-0.5 text-xs font-medium opacity-80" :title="message.senderAddress ?? undefined">
              {{ message.direction === "out" ? "Вы" : (message.senderName ?? message.senderAddress ?? peerName) }}
            </p>
            <p v-if="message.kind === 'media'" class="mb-1 flex items-center gap-1 text-xs opacity-80">
              <Paperclip class="size-3.5" />Вложение
            </p>
            <p class="whitespace-pre-wrap break-words">
              <template v-for="(part, index) in linkify(bodyText(message))" :key="index">
                <a
                  v-if="part.kind === 'link'"
                  :href="part.href"
                  target="_blank"
                  rel="noreferrer noopener"
                  class="underline underline-offset-2 hover:opacity-80"
                >{{ part.value }}</a>
                <template v-else>{{ part.value }}</template>
              </template>
            </p>
            <p class="mt-1 text-right text-xs tabular-nums opacity-70">
              {{ formatClock(message.sentAt) }}<template v-if="message.direction === 'out' && message.readAt === null"> · не прочитано</template>
            </p>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>
