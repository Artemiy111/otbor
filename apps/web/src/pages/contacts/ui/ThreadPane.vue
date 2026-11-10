<script setup lang="ts">
import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import { ArrowLeft, CircleAlert } from "@lucide/vue"
import { conversationApi, conversationKeys } from "@/entities/conversation"
import { describeError } from "@/shared/lib"
import { Alert, AlertDescription, AlertTitle, Button, Skeleton } from "@/shared/ui"
import { inboxHref, type InboxState } from "../model/inbox"
import type { Sources } from "../model/useSources"
import ThreadHeader from "./ThreadHeader.vue"
import ThreadMessages from "./ThreadMessages.vue"

const props = defineProps<{ id: string; state: InboxState; sources: Sources }>()

const query = useQuery({
  key: () => conversationKeys.detail(props.id),
  query: () => conversationApi.get(props.id)
})

const detail = computed(() => query.data.value)
const conversation = computed(() => detail.value?.conversation ?? null)
const errorText = computed(() => (query.error.value === null ? null : describeError(query.error.value)))
const peerName = computed(
  () => conversation.value?.personName ?? conversation.value?.title ?? "Собеседник"
)
const backHref = computed(() => inboxHref({ ...props.state, conversation: null }))
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Скелет повторяет заголовок и чередующиеся пузыри переписки. -->
    <div v-if="query.isPending.value" class="flex min-h-0 flex-1 flex-col" aria-hidden="true">
      <div class="space-y-2 border-b border-border p-4">
        <Skeleton class="h-5 w-1/3" />
        <Skeleton class="h-4 w-1/2" />
        <Skeleton class="h-3 w-2/3" />
      </div>
      <div class="flex-1 space-y-4 p-5">
        <Skeleton class="h-16 w-3/5 rounded-2xl" />
        <Skeleton class="ml-auto h-12 w-1/2 rounded-2xl" />
        <Skeleton class="h-20 w-2/3 rounded-2xl" />
        <Skeleton class="ml-auto h-10 w-2/5 rounded-2xl" />
      </div>
    </div>

    <div v-else-if="errorText" class="space-y-3 p-4">
      <Button as-child variant="ghost" size="sm" class="lg:hidden">
        <a :href="backHref"><ArrowLeft />К списку</a>
      </Button>
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>Не удалось загрузить диалог</AlertTitle>
        <AlertDescription>{{ errorText }}</AlertDescription>
      </Alert>
    </div>

    <template v-else-if="conversation && detail">
      <ThreadHeader
        :conversation="conversation"
        :state="state"
        :account-name="sources.accountName(conversation)"
        :account-color="sources.accountColor(conversation.accountId)"
      />
      <ThreadMessages :conversation-id="conversation.id" :messages="detail.messages" :peer-name="peerName" />
      <footer class="border-t border-border px-3 py-2 text-xs text-muted-foreground sm:px-5">
        Отправка сообщений из интерфейса пока недоступна: отвечайте в почте, Telegram или на hh.ru.
      </footer>
    </template>
  </div>
</template>
