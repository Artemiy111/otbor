<script setup lang="ts">
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ "update:modelValue": [value: string] }>()
</script>

<template>
  <div class="space-y-1.5">
    <Label for="application-state-filter" class="text-xs text-muted-foreground">Состояние</Label>
    <Select
      :model-value="props.modelValue"
      @update:model-value="(value) => emit('update:modelValue', String(value))"
    >
      <SelectTrigger id="application-state-filter" class="w-[220px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Все состояния</SelectItem>
        <SelectItem value="draft">Черновик (draft)</SelectItem>
        <SelectItem value="queued">В очереди (queued)</SelectItem>
        <SelectItem value="submitting">Отправляется (submitting)</SelectItem>
        <SelectItem value="submitted">Отправлен (submitted)</SelectItem>
        <SelectItem value="skipped">Пропущен (skipped)</SelectItem>
        <SelectItem value="needs_human">Нужен человек (needs_human)</SelectItem>
        <SelectItem value="failed">Ошибка (failed)</SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
