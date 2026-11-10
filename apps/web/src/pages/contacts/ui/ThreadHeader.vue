<script setup lang="ts">
import { computed, ref } from "vue"
import { useQuery } from "@pinia/colada"
import { ArrowLeft, ChevronDown, ExternalLink, MailOpen } from "@lucide/vue"
import type { ConversationSummary } from "@otbor/contract"
import { applicationApi, applicationKeys } from "@/entities/application"
import { markAvailable } from "@/entities/conversation"
import { EmployerName, confidencePercent, contactLinkText, personApi, personKeys } from "@/entities/person"
import { vacancyApi, vacancyKeys } from "@/entities/vacancy"
import {
  applicationPath,
  cn,
  contactHref,
  contactKindLabel,
  conversationChannelLabel,
  personPath,
  vacancyPath
} from "@/shared/lib"
import { Badge, Button, Skeleton, StatusBadge } from "@/shared/ui"
import { inboxHref, relativeTime, type InboxState } from "../model/inbox"
import ChannelIcon from "./ChannelIcon.vue"

const props = defineProps<{
  conversation: ConversationSummary
  state: InboxState
  accountName: string
  accountColor: string
}>()

const emit = defineEmits<{ markUnread: [] }>()

const personQuery = useQuery({
  key: () => personKeys.detail(props.conversation.personId ?? ""),
  query: () => personApi.get(props.conversation.personId ?? ""),
  enabled: () => props.conversation.personId !== null
})
const person = computed(() => personQuery.data.value)

const vacancyQuery = useQuery({
  key: () => vacancyKeys.detail(props.conversation.vacancyId ?? ""),
  query: () => vacancyApi.get(props.conversation.vacancyId ?? ""),
  enabled: () => props.conversation.vacancyId !== null
})
const vacancy = computed(() => vacancyQuery.data.value?.vacancy ?? null)

/** Отклик на вакансию диалога: для чата hh берём отклик того же аккаунта, иначе самый свежий. */
const applicationsQuery = useQuery({
  key: () => applicationKeys.vacancy(props.conversation.vacancyId ?? ""),
  query: () => applicationApi.list({ vacancyId: props.conversation.vacancyId ?? "", limit: 200 }),
  enabled: () => props.conversation.vacancyId !== null
})
const application = computed(() => {
  const list = applicationsQuery.data.value ?? []
  if (props.conversation.channel === "hh_chat") {
    const same = list.find((item) => item.hhAccountId === props.conversation.accountId)
    if (same !== undefined) return same
  }
  return list[0] ?? null
})

const title = computed(
  () => person.value?.displayName ?? props.conversation.personName ?? props.conversation.title ?? "Без названия"
)
const role = computed(() => person.value?.role ?? props.conversation.personRole)
const subject = computed(() =>
  props.conversation.title !== null && props.conversation.title !== title.value ? props.conversation.title : null
)

const otherThreads = computed(() =>
  (person.value?.conversations ?? []).filter((item) => item.id !== props.conversation.id)
)

const open = ref(false)
const backHref = computed(() => inboxHref({ ...props.state, conversation: null }))
const isHttp = (href: string | null): boolean => href !== null && /^https?:\/\//i.test(href)
</script>

<template>
  <header class="shrink-0 border-b border-border">
    <div class="flex items-start gap-2 p-3 sm:px-5 sm:py-4">
      <Button as-child variant="ghost" size="icon" class="-ml-1 shrink-0 lg:hidden">
        <a :href="backHref" aria-label="К списку диалогов"><ArrowLeft /></a>
      </Button>

      <div class="min-w-0 flex-1 space-y-1">
        <div class="flex min-w-0 items-center gap-2">
          <h2 class="min-w-0 truncate text-base font-semibold">{{ title }}</h2>
        </div>

        <p class="truncate text-sm text-muted-foreground">
          <template v-if="role">{{ role }}</template>
          <template v-if="role && person?.employerId"> · </template>
          <EmployerName v-if="person?.employerId" :id="person.employerId" />
          <template v-if="!role && !person?.employerId">{{ subject ?? "Роль и компания не указаны" }}</template>
        </p>

        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs text-muted-foreground">
          <Badge v-if="conversation.unreadCount > 0" variant="warning">
            Непрочитанных: {{ conversation.unreadCount }}
          </Badge>
          <span class="inline-flex items-center gap-1.5">
            <ChannelIcon :channel="conversation.channel" />
            {{ conversationChannelLabel(conversation.channel) }}
            <span class="size-2 rounded-full" :style="{ backgroundColor: accountColor }" />
            <span class="max-w-40 truncate">{{ accountName }}</span>
          </span>
          <a
            v-if="conversation.vacancyId"
            :href="vacancyPath(conversation.vacancyId)"
            class="max-w-64 truncate text-info underline-offset-4 hover:underline"
          >
            Вакансия<template v-if="vacancy">: {{ vacancy.title }}</template>
          </a>
          <a
            v-if="application"
            :href="applicationPath(application.id)"
            class="inline-flex items-center gap-1.5 text-info underline-offset-4 hover:underline"
          >
            Отклик <StatusBadge :value="application.state" />
          </a>
          <a
            v-if="conversation.url"
            :href="conversation.url"
            target="_blank"
            rel="noreferrer"
            class="inline-flex items-center gap-1 text-info underline-offset-4 hover:underline"
          >
            Открыть в источнике <ExternalLink class="size-3" />
          </a>
        </div>
      </div>

      <Button
        v-if="markAvailable && conversation.unreadCount === 0"
        variant="ghost"
        size="sm"
        class="shrink-0"
        aria-label="Отметить непрочитанным"
        @click="emit('markUnread')"
      >
        <MailOpen />
        <span class="hidden xl:inline">Отметить непрочитанным</span>
      </Button>

      <Button
        v-if="conversation.personId"
        variant="ghost"
        size="sm"
        class="shrink-0"
        :aria-expanded="open"
        aria-label="О собеседнике"
        @click="open = !open"
      >
        <span class="hidden xl:inline">О собеседнике</span>
        <ChevronDown :class="cn('transition-transform', open && 'rotate-180')" />
      </Button>
    </div>

    <div v-if="open && conversation.personId" class="max-h-[40dvh] space-y-4 overflow-y-auto border-t border-border bg-muted/30 p-3 text-sm sm:px-5">
      <div v-if="personQuery.isPending.value" class="space-y-2">
        <Skeleton class="h-4 w-1/2" />
        <Skeleton class="h-4 w-2/3" />
      </div>

      <template v-else-if="person">
        <section class="space-y-1.5">
          <h3 class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Как с ним связаться</h3>
          <p v-if="person.contacts.length === 0" class="text-muted-foreground">Контактов нет.</p>
          <ul v-else class="space-y-1.5">
            <li v-for="contact in person.contacts" :key="contact.id" class="flex flex-wrap items-baseline gap-x-2">
              <Badge variant="secondary">{{ contactKindLabel(contact.kind) }}</Badge>
              <a
                v-if="contactHref(contact)"
                :href="contactHref(contact) ?? undefined"
                :target="isHttp(contactHref(contact)) ? '_blank' : undefined"
                rel="noreferrer"
                class="break-all text-info underline-offset-4 hover:underline"
              >{{ contact.value }}</a>
              <span v-else class="break-all">{{ contact.value }}</span>
              <span
                class="text-xs"
                :class="contact.personLink === 'suggested' ? 'text-warning' : 'text-muted-foreground'"
                :title="confidencePercent(contact.confidence) === null ? undefined : 'Насколько мы уверены, что контакт принадлежит этому человеку'"
              >{{ contactLinkText(contact.personLink, contact.confidence) }}</span>
            </li>
          </ul>
        </section>

        <section v-if="otherThreads.length > 0" class="space-y-1.5">
          <h3 class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Другие диалоги с ним</h3>
          <ul class="space-y-1">
            <li v-for="thread in otherThreads" :key="thread.id">
              <a
                :href="inboxHref({ ...state, conversation: thread.id })"
                class="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent"
              >
                <ChannelIcon :channel="thread.channel" />
                <span class="min-w-0 flex-1 truncate">{{ thread.title ?? thread.lastMessage ?? thread.externalId }}</span>
                <span v-if="thread.unreadCount > 0" class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold tabular-nums text-primary-foreground">{{ thread.unreadCount }}</span>
                <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{{ relativeTime(thread.lastMessageAt) }}</span>
              </a>
            </li>
          </ul>
        </section>

        <p class="text-xs text-muted-foreground">
          <a :href="personPath(person.id)" class="text-info underline-offset-4 hover:underline">Открыть карточку человека</a>
          — там можно поправить имя, объединить дубликаты и проверить связи контактов.
        </p>
      </template>
    </div>
  </header>
</template>
