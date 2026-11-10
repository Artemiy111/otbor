<script setup lang="ts">
import { computed } from "vue"
import { useIntervalFn } from "@vueuse/core"
import { useQueryCache } from "@pinia/colada"
import { conversationKeys, useConversations } from "@/entities/conversation"
import { cn, locationSearch } from "@/shared/lib"
import { countUnread, parseContactsView } from "../model/inbox"
import ContactsPanel from "./ContactsPanel.vue"
import InboxView from "./InboxView.vue"

/**
 * Одна область «Переписка»: диалоги, люди и сырые контакты. Вкладка «Люди»
 * приходит слотом (её страницы живут в `pages/people`), поэтому `/people` и
 * `/people/:id` остаются прежними адресами, а подсвечивается «Переписка».
 */
const props = withDefaults(defineProps<{ area?: "inbox" | "people" }>(), { area: "inbox" })

const view = computed(() => parseContactsView(locationSearch.value))
const tab = computed<"inbox" | "people" | "contacts">(() =>
  props.area === "people" ? "people" : view.value === "contacts" ? "contacts" : "inbox"
)

const conversations = useConversations()
const unread = computed(() => countUnread(conversations.data.value ?? []))

const TABS = [
  { id: "inbox", label: "Диалоги", href: "/contacts" },
  { id: "people", label: "Люди", href: "/people" },
  { id: "contacts", label: "Контакты", href: "/contacts?view=contacts" }
] as const

/* Один интервал на всю область: диалоги и открытый диалог обновляются, пока вкладка видна. */
const REFRESH_MS = 20_000
const queryCache = useQueryCache()
const refresh = () => {
  if (document.hidden) return
  void queryCache.invalidateQueries({ key: conversationKeys.all })
}
useIntervalFn(refresh, REFRESH_MS)
</script>

<template>
  <!-- Ящик занимает экран целиком, панели прокручиваются сами; остальные вкладки текут как обычные страницы. -->
  <section :class="cn('flex flex-col', tab === 'inbox' && 'h-[calc(100dvh-6.5rem)] min-h-96 lg:h-[calc(100dvh-8rem)]')">
    <div class="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <h1 class="text-2xl font-semibold tracking-tight">Переписка</h1>
      <nav class="inline-flex h-9 w-fit items-center rounded-lg bg-muted p-[3px] text-sm font-medium" aria-label="Разделы переписки">
        <a
          v-for="item in TABS"
          :key="item.id"
          :href="item.href"
          :aria-current="tab === item.id ? 'page' : undefined"
          :class="
            cn(
              'inline-flex h-[calc(100%-1px)] items-center gap-1.5 rounded-md px-3 transition-colors',
              tab === item.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )
          "
        >
          {{ item.label }}
          <span
            v-if="item.id === 'inbox' && unread > 0"
            class="rounded-full bg-primary px-1.5 text-xs tabular-nums text-primary-foreground"
            :aria-label="`Непрочитанных диалогов: ${unread}`"
          >{{ unread }}</span>
        </a>
      </nav>
    </div>

    <InboxView v-if="tab === 'inbox'" />
    <ContactsPanel v-else-if="tab === 'contacts'" />
    <slot v-else />
  </section>
</template>
