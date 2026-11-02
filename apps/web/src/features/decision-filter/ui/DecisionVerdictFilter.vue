<script setup lang="ts">
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ "update:modelValue": [value: string] }>()
</script>

<template>
  <div class="flex items-center gap-2">
    <Label for="decision-verdict-filter" class="text-muted-foreground">Verdict</Label>
    <Select
      :model-value="props.modelValue"
      @update:model-value="(value) => emit('update:modelValue', String(value))"
    >
      <SelectTrigger id="decision-verdict-filter" class="w-[150px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All verdicts</SelectItem>
        <SelectItem value="apply">apply</SelectItem>
        <SelectItem value="draft">draft</SelectItem>
        <SelectItem value="skip">skip</SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
