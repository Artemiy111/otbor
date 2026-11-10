<script setup lang="ts">
import { computed } from "vue"
import { MessagesSquare } from "@lucide/vue"
import { useConversations } from "@/entities/conversation"
import { cn, describeError, locationSearch, replaceSearch } from "@/shared/lib"
import { countUnread, inboxSearch, parseInboxState, type InboxState } from "../model/inbox"
import { useSources } from "../model/useSources"
import ConversationList from "./ConversationList.vue"
import ThreadPane from "./ThreadPane.vue"

/* Состояние ящика живёт в адресе и следует за ним, пока страница открыта. */
const state = computed<InboxState>(() => parseInboxState(locationSearch.value))
const setState = (patch: Partial<InboxState>) => replaceSearch(inboxSearch({ ...state.value, ...patch }))

const query = useConversations()
const conversations = computed(() => query.data.value ?? [])
const errorText = computed(() => (query.error.value === null ? null : describeError(query.error.value)))
const unread = computed(() => countUnread(conversations.value))
const sources = useSources()
</script>

<template>
  <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-card lg:grid-cols-[minmax(17rem,20rem)_minmax(0,1fr)] xl:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]">
    <!-- До 1024px показывается либо список, либо диалог; шире - обе панели. -->
    <aside :class="cn('min-h-0 min-w-0 border-border lg:flex lg:border-r', state.conversation === null ? 'flex flex-col' : 'hidden')">
      <ConversationList
        class="w-full"
        :conversations="conversations"
        :state="state"
        :loading="query.isPending.value"
        :error-text="errorText"
        :sources="sources"
        @select="setState({ conversation: $event })"
        @filter="setState($event)"
      />
    </aside>

    <section :class="cn('min-h-0 min-w-0 lg:flex lg:flex-col', state.conversation === null ? 'hidden' : 'flex flex-col')">
      <ThreadPane v-if="state.conversation !== null" :key="state.conversation" :id="state.conversation" :state="state" :sources="sources" />

      <div v-else class="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <MessagesSquare class="size-8 text-muted-foreground/60" />
        <p class="text-sm font-medium">
          {{ unread > 0 ? `Непрочитанных диалогов: ${unread}` : "Новых сообщений нет" }}
        </p>
        <p class="max-w-sm text-sm text-muted-foreground">
          Выберите диалог слева. Стрелки вверх и вниз переключают диалоги, Esc закрывает открытый.
        </p>
      </div>
    </section>
  </div>
</template>
