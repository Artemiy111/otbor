<script setup lang="ts">
import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import type { ConversationSummary } from "@otbor/contract"
import { conversationApi, conversationKeys } from "@/entities/conversation"
import { Badge } from "@/shared/ui"
import { conversationChannelLabel, formatDate, personPath } from "@/shared/lib"
import type { VacancyPage } from "../model"

const props = defineProps<{ page: VacancyPage }>()

// У списка диалогов нет фильтра по вакансии, поэтому берём общий кэш и отбираем на клиенте.
const query = useQuery({
  key: () => conversationKeys.list("all", ""),
  query: () => conversationApi.list({ limit: 200 })
})

const conversations = computed<ReadonlyArray<ConversationSummary>>(() =>
  (query.data.value ?? []).filter((item) => item.vacancyId === props.page.id())
)

interface Row {
  readonly personId: string | null
  readonly label: string
  readonly conversations: ReadonlyArray<ConversationSummary>
}

/** Люди вакансии: из диалогов и из контактов, найденных в самом тексте вакансии. */
const rows = computed<ReadonlyArray<Row>>(() => {
  const byPerson = new Map<string, { label: string; items: ConversationSummary[] }>()
  const loose: ConversationSummary[] = []
  for (const conversation of conversations.value) {
    if (conversation.personId === null) {
      loose.push(conversation)
      continue
    }
    const entry = byPerson.get(conversation.personId) ?? {
      label: conversation.personName ?? "Без имени",
      items: []
    }
    entry.items.push(conversation)
    byPerson.set(conversation.personId, entry)
  }
  for (const contact of props.page.contacts.value) {
    if (contact.personId !== null && !byPerson.has(contact.personId)) {
      byPerson.set(contact.personId, { label: contact.personName ?? "Без имени", items: [] })
    }
  }
  const people: Row[] = [...byPerson.entries()].map(([personId, entry]) => ({
    personId,
    label: entry.label,
    conversations: entry.items
  }))
  return loose.length === 0
    ? people
    : [...people, { personId: null, label: "Без человека", conversations: loose }]
})
</script>

<template>
  <div v-if="rows.length > 0">
    <ul class="space-y-3">
      <li v-for="row in rows" :key="row.personId ?? 'loose'" class="text-sm">
        <a
          v-if="row.personId"
          :href="personPath(row.personId)"
          class="font-medium text-info underline-offset-4 hover:underline"
        >{{ row.label }}</a>
        <span v-else class="font-medium text-muted-foreground">{{ row.label }}</span>
        <ul class="mt-1 space-y-0.5">
          <li
            v-for="conversation in row.conversations"
            :key="conversation.id"
          >
            <a
              :href="`/contacts?c=${encodeURIComponent(conversation.id)}`"
              class="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-1 py-0.5 text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              title="Открыть диалог во входящих"
            >
              <Badge variant="secondary">{{ conversationChannelLabel(conversation.channel) }}</Badge>
              <span class="min-w-0 flex-1 truncate">{{ conversation.lastMessage ?? conversation.title ?? "—" }}</span>
              <span class="tabular-nums">{{ formatDate(conversation.lastMessageAt) }}</span>
            </a>
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>
