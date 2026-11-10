<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { useIntersectionObserver, useIntervalFn } from "@vueuse/core"
import { CircleAlert, Inbox, Mail, Search, Send } from "@lucide/vue"
import type { InboxConversation } from "@/entities/conversation"
import { cn } from "@/shared/lib"
import { Alert, AlertDescription, AlertTitle, Button, Input, Skeleton } from "@/shared/ui"
import { inboxHref, neighbourId, type InboxChannel, type InboxState } from "../model/inbox"
import type { Sources } from "../model/useSources"
import ConversationListItem from "./ConversationListItem.vue"

const props = defineProps<{
  /** Уже отфильтрованные и упорядоченные сервером строки загруженных страниц. */
  conversations: ReadonlyArray<InboxConversation>
  state: InboxState
  /** Сколько диалогов подходит под фильтры на сервере, а не сколько загружено. */
  total: number
  unreadTotal: number
  hasMore: boolean
  loadingMore: boolean
  loading: boolean
  errorText: string | null
  sources: Sources
}>()

const emit = defineEmits<{
  /** Выбрать диалог (стрелками); `null` - снять выбор. */
  select: [id: string | null]
  /** Сменить фильтр или канал, не трогая выбранный диалог. */
  filter: [patch: Partial<Pick<InboxState, "filter" | "channel">>]
  /** Подгрузить следующую страницу. */
  more: []
}>()

/** Текст поиска живёт у родителя: он уходит на сервер. */
const text = defineModel<string>("search", { default: "" })

/** «5 мин» в строках пересчитывается раз в минуту, а не при каждом рендере. */
const now = ref(new Date())
useIntervalFn(() => {
  if (!document.hidden) now.value = new Date()
}, 60_000)

const visible = computed(() => props.conversations)
const filtered = computed(() => props.state.filter !== "all" || props.state.channel !== "all" || text.value.trim() !== "")

const CHANNELS: ReadonlyArray<{ readonly id: InboxChannel; readonly label: string }> = [
  { id: "all", label: "Все каналы" },
  { id: "mail", label: "Почта" },
  { id: "telegram", label: "Telegram" },
  { id: "hh_chat", label: "Чат hh" }
]

const reset = () => {
  text.value = ""
  emit("filter", { filter: "all", channel: "all" })
}

/* ---- клавиатура: ↑ ↓ (и j / k) двигают выбор, Esc снимает его ----------------------- */

const listEl = ref<HTMLElement | null>(null)

/* Бесконечная прокрутка: когда метка под списком появляется в зоне видимости, просим следующую страницу. */
const sentinel = ref<HTMLElement | null>(null)
useIntersectionObserver(
  sentinel,
  ([entry]) => {
    if (entry?.isIntersecting && props.hasMore && !props.loadingMore) emit("more")
  },
  { root: () => listEl.value, rootMargin: "120px" }
)

const onKeydown = (event: KeyboardEvent) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target
  const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
  const down = event.key === "ArrowDown" || (!typing && event.key === "j")
  const up = event.key === "ArrowUp" || (!typing && event.key === "k")
  if (down || up) {
    event.preventDefault()
    const next = neighbourId(visible.value, props.state.conversation, down ? 1 : -1)
    if (next !== null) emit("select", next)
    if (typing) listEl.value?.focus()
    return
  }
  if (event.key === "Escape" && !typing && props.state.conversation !== null) emit("select", null)
}

/** Выбранная строка всегда в зоне видимости списка. */
watch(
  () => [props.state.conversation, visible.value.length] as const,
  async ([id]) => {
    if (id === null) return
    await nextTick()
    listEl.value?.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" })
  },
  { immediate: true, flush: "post" }
)

const filterHref = (patch: Partial<InboxState>) => inboxHref({ ...props.state, ...patch })
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="space-y-2 border-b border-border p-3">
      <div class="relative">
        <Search class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          v-model="text"
          type="search"
          class="pl-8"
          placeholder="Имя, тема или текст сообщения"
          aria-label="Поиск по диалогам"
          @keydown="onKeydown"
        />
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <div class="inline-flex h-8 shrink-0 rounded-lg bg-muted p-0.5 text-xs font-medium" role="group" aria-label="Фильтр диалогов">
          <button
            type="button"
            :class="
              cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 transition-colors',
                state.filter === 'unread' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )
            "
            :aria-pressed="state.filter === 'unread'"
            @click="emit('filter', { filter: 'unread' })"
          >
            Непрочитанные
            <span v-if="unreadTotal > 0" class="rounded-full bg-primary px-1.5 text-xs tabular-nums text-primary-foreground">{{ unreadTotal }}</span>
          </button>
          <button
            type="button"
            :class="
              cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 transition-colors',
                state.filter === 'all' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )
            "
            :aria-pressed="state.filter === 'all'"
            @click="emit('filter', { filter: 'all' })"
          >
            Все
            <span v-if="state.filter === 'all'" class="tabular-nums text-muted-foreground">{{ total }}</span>
          </button>
        </div>

        <select
          class="h-8 min-w-32 flex-1 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Канал"
          :value="state.channel"
          @change="emit('filter', { channel: ($event.target as HTMLSelectElement).value as InboxChannel })"
        >
          <option v-for="channel in CHANNELS" :key="channel.id" :value="channel.id">{{ channel.label }}</option>
        </select>
      </div>
    </div>

    <div
      ref="listEl"
      role="listbox"
      tabindex="0"
      aria-label="Диалоги"
      :aria-activedescendant="state.conversation === null ? undefined : `conversation-${state.conversation}`"
      class="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      @keydown="onKeydown"
    >
      <Alert v-if="errorText" variant="destructive" class="m-3 w-auto">
        <CircleAlert />
        <AlertTitle>Не удалось загрузить диалоги</AlertTitle>
        <AlertDescription>{{ errorText }}</AlertDescription>
      </Alert>

      <!-- Скелет повторяет строку списка: имя и время, вторая строка, фрагмент. -->
      <div v-else-if="loading" class="divide-y divide-border" aria-hidden="true">
        <div v-for="index in 8" :key="index" class="space-y-2 px-3 py-3">
          <div class="flex items-center justify-between gap-6">
            <Skeleton class="h-4 w-1/2" />
            <Skeleton class="h-3 w-8" />
          </div>
          <Skeleton class="h-3 w-2/3" />
          <Skeleton class="h-4 w-full" />
        </div>
      </div>

      <div v-else-if="visible.length === 0" class="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <template v-if="!filtered">
          <Inbox class="size-7 text-muted-foreground/60" />
          <p class="text-sm font-medium">
            {{ sources.loaded.value && !sources.hasMail.value && !sources.hasTelegram.value ? "Почта и Telegram не подключены" : "Диалогов пока нет" }}
          </p>
          <p class="max-w-xs text-sm text-muted-foreground">
            Переписка с рекрутерами появляется здесь после синхронизации почты или Telegram,
            а также из чатов hh по вашим откликам.
          </p>
          <div class="mt-1 flex flex-wrap items-center justify-center gap-2">
            <Button as-child variant="outline" size="sm">
              <a href="/mail"><Mail />Подключить почту</a>
            </Button>
            <Button as-child variant="outline" size="sm">
              <a href="/telegram"><Send />Подключить Telegram</a>
            </Button>
          </div>
        </template>
        <template v-else-if="state.filter === 'unread' && text.trim() === ''">
          <Inbox class="size-7 text-muted-foreground/60" />
          <p class="text-sm font-medium">Новых сообщений нет</p>
          <p class="max-w-xs text-sm text-muted-foreground">Все диалоги прочитаны. Старую переписку можно открыть во вкладке «Все».</p>
          <Button variant="outline" size="sm" as-child>
            <a :href="filterHref({ filter: 'all' })">Показать все диалоги</a>
          </Button>
        </template>
        <template v-else>
          <Search class="size-7 text-muted-foreground/60" />
          <p class="text-sm font-medium">Ничего не найдено</p>
          <p class="max-w-xs text-sm text-muted-foreground">Попробуйте другой запрос или сбросьте фильтры.</p>
          <Button variant="outline" size="sm" @click="reset">Сбросить фильтры</Button>
        </template>
      </div>

      <template v-else>
        <ConversationListItem
          v-for="conversation in visible"
          :key="conversation.id"
          :conversation="conversation"
          :state="state"
          :selected="conversation.id === state.conversation"
          :account-name="sources.accountName(conversation)"
          :account-color="sources.accountColor(conversation.accountId)"
          :now="now"
        />
        <div ref="sentinel" class="flex justify-center px-3 py-3">
          <Button v-if="hasMore" variant="ghost" size="sm" :disabled="loadingMore" @click="emit('more')">
            {{ loadingMore ? "Загружаем…" : `Показать ещё (${total - conversations.length})` }}
          </Button>
          <p v-else-if="total > 0" class="text-xs text-muted-foreground">Показаны все диалоги: {{ total }}</p>
        </div>
      </template>
    </div>
  </div>
</template>
