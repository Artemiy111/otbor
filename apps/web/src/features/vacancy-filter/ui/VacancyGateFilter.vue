<script setup lang="ts">
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ "update:modelValue": [value: string] }>()
</script>

<template>
  <div class="flex items-center gap-2">
    <Label for="vacancy-gate-filter" class="text-muted-foreground">Gate</Label>
    <Select
      :model-value="props.modelValue"
      @update:model-value="(value) => emit('update:modelValue', String(value))"
    >
      <SelectTrigger id="vacancy-gate-filter" class="w-[150px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All gates</SelectItem>
        <SelectItem value="match">match</SelectItem>
        <SelectItem value="unknown">unknown</SelectItem>
        <SelectItem value="reject">reject</SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
