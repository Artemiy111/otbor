<script setup lang="ts">
import { computed, ref } from "vue"
import { useIntersectionObserver } from "@vueuse/core"
import { useQuery } from "@pinia/colada"
import type { ConversationSummary } from "@otbor/contract"
import { vacancyApi, vacancyKeys } from "@/entities/vacancy"
import { cn, conversationChannelLabel } from "@/shared/lib"
import { inboxHref, relativeTime, type InboxState } from "../model/inbox"
import ChannelIcon from "./ChannelIcon.vue"

const props = defineProps<{
  conversation: ConversationSummary
  state: InboxState
  selected: boolean
  accountName: string
  accountColor: string
  /** Минутная отметка: список сам пересчитывает «5 мин» раз в минуту. */
  now: Date
}>()

/** Название вакансии подгружается, только когда строка попала в видимую часть списка. */
const root = ref<HTMLElement | null>(null)
const seen = ref(false)
useIntersectionObserver(root, ([entry]) => {
  if (entry?.isIntersecting) seen.value = true
})
const vacancyQuery = useQuery({
  key: () => vacancyKeys.detail(props.conversation.vacancyId ?? ""),
  query: () => vacancyApi.get(props.conversation.vacancyId ?? ""),
  enabled: () => seen.value && props.conversation.vacancyId !== null
})
const vacancyTitle = computed(() => vacancyQuery.data.value?.vacancy.title ?? null)

const unread = computed(() => props.conversation.unreadCount > 0)
const name = computed(
  () => props.conversation.personName ?? props.conversation.title ?? "Без названия"
)
/** Вторая строка: вакансия, а если её нет или она ещё грузится - тема диалога. */
const context = computed(() => {
  if (props.conversation.vacancyId !== null && vacancyTitle.value !== null) return vacancyTitle.value
  if (props.conversation.title !== null && props.conversation.title !== name.value) return props.conversation.title
  return props.conversation.personRole
})
const href = computed(() => inboxHref({ ...props.state, conversation: props.conversation.id }))
const snippet = computed(() => {
  // Письма hh приходят с разметкой: «[https://…png]» вместо картинок и
  // «[текст](ссылка)» вместо ссылок. В превью оставляем только слова.
  const text =
    props.conversation.lastMessage
      ?.replace(/\[https?:\/\/[^\]\s]*\]/g, " ")
      .replace(/\[([^\]]*)\]\(https?:\/\/[^)\s]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/\s+/g, " ")
      .trim() ?? ""
  return text === "" ? "Нет текста" : text
})
</script>

<template>
  <a
    :id="`conversation-${conversation.id}`"
    ref="root"
    :href="href"
    role="option"
    tabindex="-1"
    :aria-selected="selected"
    :data-id="conversation.id"
    :class="
      cn(
        'relative block border-b border-border px-3 py-2.5 outline-none transition-colors',
        'hover:bg-accent/60 focus-visible:bg-accent',
        selected && 'bg-accent before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary'
      )
    "
  >
    <div class="flex items-baseline justify-between gap-2">
      <span class="min-w-0 truncate text-sm" :class="unread ? 'font-semibold' : 'font-medium'">{{ name }}</span>
      <time
        class="shrink-0 text-xs tabular-nums"
        :class="unread ? 'font-medium text-foreground' : 'text-muted-foreground'"
        :datetime="conversation.lastMessageAt ?? undefined"
      >{{ relativeTime(conversation.lastMessageAt, now) }}</time>
    </div>

    <div class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <ChannelIcon :channel="conversation.channel" />
      <span
        class="size-2 shrink-0 rounded-full"
        :style="{ backgroundColor: accountColor }"
        :title="accountName"
        role="img"
        :aria-label="`Аккаунт: ${accountName}`"
      />
      <span class="truncate">{{ context ?? conversationChannelLabel(conversation.channel) }}</span>
    </div>

    <div class="mt-0.5 flex items-center justify-between gap-2">
      <p class="min-w-0 truncate text-sm" :class="unread ? 'text-foreground' : 'text-muted-foreground'">
        {{ snippet }}
      </p>
      <span
        v-if="unread"
        class="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold tabular-nums text-primary-foreground"
        :aria-label="`Непрочитанных: ${conversation.unreadCount}`"
      >{{ conversation.unreadCount }}</span>
    </div>
  </a>
</template>
