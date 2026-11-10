<script setup lang="ts">
import { computed, type Component } from "vue"
import type { ScheduleKind } from "@otbor/contract"
import {
  ArrowUpFromLine,
  Building2,
  CalendarClock,
  DatabaseZap,
  FileText,
  Gauge,
  Mail,
  MessagesSquare,
  ScanSearch,
  Search,
  Send,
  Sparkles,
  Zap
} from "@lucide/vue"

const props = defineProps<{ kind: ScheduleKind }>()

const ICONS: Record<ScheduleKind, Component> = {
  search: Search,
  source: Search,
  apply: Zap,
  evaluate: Sparkles,
  fit: Gauge,
  vacancy_hydration: DatabaseZap,
  employer_hydration: Building2,
  analysis: ScanSearch,
  resume_sync: FileText,
  resume_bump: ArrowUpFromLine,
  hh_chat_sync: MessagesSquare,
  mail_sync: Mail,
  telegram_sync: Send
}

const icon = computed(() => ICONS[props.kind] ?? CalendarClock)
</script>

<template>
  <span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground" aria-hidden="true">
    <component :is="icon" class="size-4" />
  </span>
</template>
