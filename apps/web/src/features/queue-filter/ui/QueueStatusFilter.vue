<script setup lang="ts">
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ "update:modelValue": [value: string] }>()
</script>

<template>
  <div class="flex items-center gap-2">
    <Label for="queue-status-filter" class="text-muted-foreground">Status</Label>
    <Select
      :model-value="props.modelValue"
      @update:model-value="(value) => emit('update:modelValue', String(value))"
    >
      <SelectTrigger id="queue-status-filter" class="w-[170px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All statuses</SelectItem>
        <SelectItem value="pending">pending</SelectItem>
        <SelectItem value="leased">leased</SelectItem>
        <SelectItem value="running">running</SelectItem>
        <SelectItem value="done">done</SelectItem>
        <SelectItem value="failed">failed</SelectItem>
        <SelectItem value="dead">dead</SelectItem>
        <SelectItem value="needs_human">needs_human</SelectItem>
        <SelectItem value="needs_reconcile">needs_reconcile</SelectItem>
        <SelectItem value="cancelled">cancelled</SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
