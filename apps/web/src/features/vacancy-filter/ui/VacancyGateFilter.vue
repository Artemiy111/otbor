<script setup lang="ts">
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ "update:modelValue": [value: string] }>()
</script>

<template>
  <div class="space-y-1.5">
    <Label for="vacancy-gate-filter" class="text-xs text-muted-foreground">Гейт</Label>
    <Select
      :model-value="props.modelValue"
      @update:model-value="(value) => emit('update:modelValue', String(value))"
    >
      <SelectTrigger id="vacancy-gate-filter" class="w-[190px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Все вердикты</SelectItem>
        <SelectItem value="match">Подходит (match)</SelectItem>
        <SelectItem value="unknown">Неясно (unknown)</SelectItem>
        <SelectItem value="reject">Отклонено (reject)</SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
