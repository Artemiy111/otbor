<script setup lang="ts">
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ "update:modelValue": [value: string] }>()
</script>

<template>
  <div class="flex items-center gap-2">
    <Label for="application-state-filter" class="text-muted-foreground">State</Label>
    <Select
      :model-value="props.modelValue"
      @update:model-value="(value) => emit('update:modelValue', String(value))"
    >
      <SelectTrigger id="application-state-filter" class="w-[160px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All states</SelectItem>
        <SelectItem value="draft">draft</SelectItem>
        <SelectItem value="queued">queued</SelectItem>
        <SelectItem value="submitting">submitting</SelectItem>
        <SelectItem value="submitted">submitted</SelectItem>
        <SelectItem value="skipped">skipped</SelectItem>
        <SelectItem value="needs_human">needs_human</SelectItem>
        <SelectItem value="failed">failed</SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
