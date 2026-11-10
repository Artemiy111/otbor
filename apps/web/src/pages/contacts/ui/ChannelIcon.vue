<script setup lang="ts">
import { computed } from "vue"
import { Mail, MessageSquareText, Send } from "@lucide/vue"
import type { ConversationChannel } from "@otbor/contract"
import { conversationChannelLabel } from "@/shared/lib"

const props = defineProps<{ channel: ConversationChannel }>()

const icon = computed(() =>
  props.channel === "mail" ? Mail : props.channel === "telegram" ? Send : MessageSquareText
)
const label = computed(() => conversationChannelLabel(props.channel))
</script>

<template>
  <component :is="icon" class="size-3.5 shrink-0" :aria-label="label" role="img">
    <title>{{ label }}</title>
  </component>
</template>
