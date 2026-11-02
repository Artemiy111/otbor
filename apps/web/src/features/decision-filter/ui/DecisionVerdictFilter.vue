<script setup lang="ts">
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ "update:modelValue": [value: string] }>()
</script>

<template>
  <div class="space-y-1.5">
    <Label for="decision-verdict-filter" class="text-xs text-muted-foreground">Вердикт</Label>
    <Select
      :model-value="props.modelValue"
      @update:model-value="(value) => emit('update:modelValue', String(value))"
    >
      <SelectTrigger id="decision-verdict-filter" class="w-[210px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Все вердикты</SelectItem>
        <SelectItem value="apply">Откликаться (apply)</SelectItem>
        <SelectItem value="draft">Черновик (draft)</SelectItem>
        <SelectItem value="skip">Пропуск (skip)</SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
