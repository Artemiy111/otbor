<script setup lang="ts">
import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import { CircleAlert } from "@lucide/vue"
import { conversationApi, conversationKeys } from "@/entities/conversation"
import {
  conversationChannelLabel,
  describeError,
  formatDate,
  vacancyPath
} from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Skeleton
} from "@/shared/ui"

const props = defineProps<{ id: string }>()

const query = useQuery({
  key: () => conversationKeys.detail(props.id),
  query: () => conversationApi.get(props.id)
})

const detail = computed(() => query.data.value)
const conversation = computed(() => detail.value?.conversation)
const messages = computed(() =>
  [...(detail.value?.messages ?? [])].sort(
    (left, right) => new Date(left.sentAt).getTime() - new Date(right.sentAt).getTime()
  )
)
const errorText = computed(() =>
  query.error.value === null ? null : describeError(query.error.value)
)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div v-if="query.isPending.value" class="space-y-3 p-4">
      <Skeleton class="h-6 w-2/3" />
      <Skeleton class="h-4 w-1/2" />
      <Skeleton class="h-24 w-full" />
      <Skeleton class="h-24 w-4/5" />
    </div>

    <Alert v-else-if="errorText" variant="destructive" class="m-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить диалог</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>

    <template v-else-if="conversation">
      <header class="space-y-2 border-b border-border p-4 pr-12">
        <div class="flex flex-wrap items-center gap-2">
          <Badge variant="info">{{ conversationChannelLabel(conversation.channel) }}</Badge>
          <Badge v-if="conversation.unreadCount > 0" variant="warning">
            непрочитанных: {{ conversation.unreadCount }}
          </Badge>
          <Badge v-if="conversation.archived" variant="neutral">архив</Badge>
        </div>
        <h2 class="text-lg font-semibold">
          {{ conversation.title ?? conversation.personName ?? "Без названия" }}
        </h2>
        <p v-if="conversation.personName || conversation.personRole" class="text-sm text-muted-foreground">
          {{ conversation.personName ?? "Без имени" }}
          <span v-if="conversation.personRole"> · {{ conversation.personRole }}</span>
        </p>
        <div class="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>Последнее сообщение: {{ formatDate(conversation.lastMessageAt) }}</span>
          <a
            v-if="conversation.vacancyId"
            :href="vacancyPath(conversation.vacancyId)"
            class="text-sky-300 underline-offset-4 hover:underline"
          >
            Вакансия
          </a>
          <a
            v-if="conversation.url"
            :href="conversation.url"
            target="_blank"
            rel="noreferrer"
            class="text-sky-300 underline-offset-4 hover:underline"
          >
            Открыть в источнике
          </a>
        </div>
      </header>

      <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <template v-if="messages.length > 0">
          <div
            v-for="message in messages"
            :key="message.id"
            class="flex"
            :class="message.direction === 'out' ? 'justify-end' : 'justify-start'"
          >
            <div
              class="max-w-[85%] rounded-lg px-3 py-2 text-sm"
              :class="
                message.direction === 'out'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              "
            >
              <p class="whitespace-pre-wrap break-words">
                {{ message.text === null || message.text === "" ? "(без текста)" : message.text }}
              </p>
              <div
                class="mt-1 text-[10px] opacity-70"
                :class="message.direction === 'out' ? 'text-right' : 'text-left'"
              >
                {{ message.direction === "out" ? "Исходящее" : "Входящее" }} ·
                {{ formatDate(message.sentAt) }}
                <span v-if="message.readAt === null && message.direction === 'out'"> · не прочитано</span>
              </div>
            </div>
          </div>
        </template>

        <Card v-else>
          <CardContent class="p-0">
            <EmptyState
              title="Сообщений нет"
              description="Переписка сохранена без текста или ещё не синхронизирована."
            />
          </CardContent>
        </Card>
      </div>

      <footer class="border-t border-border p-3">
        <Button as-child variant="outline" size="sm">
          <a href="/contacts">Все контакты</a>
        </Button>
        <span class="ml-2 text-xs text-muted-foreground">
          Отправка сообщений из интерфейса недоступна.
        </span>
      </footer>
    </template>
  </div>
</template>
