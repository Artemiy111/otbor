<script setup lang="ts">
import { Label } from "../label"
import HelpHint from "./HelpHint.vue"

/** A form label with an optional "?" hint right after it. */
defineProps<{ hint?: string }>()
</script>

<template>
  <div class="flex items-center gap-1">
    <Label class="text-xs"><slot /></Label>
    <HelpHint v-if="hint" :text="hint" />
  </div>
</template>
