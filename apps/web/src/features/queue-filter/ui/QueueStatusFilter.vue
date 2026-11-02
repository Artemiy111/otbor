<script setup lang="ts">
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ "update:modelValue": [value: string] }>()
</script>

<template>
  <div class="space-y-1.5">
    <Label for="queue-status-filter" class="text-xs text-muted-foreground">Статус</Label>
    <Select
      :model-value="props.modelValue"
      @update:model-value="(value) => emit('update:modelValue', String(value))"
    >
      <SelectTrigger id="queue-status-filter" class="w-[230px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Все статусы</SelectItem>
        <SelectItem value="pending">Ожидает (pending)</SelectItem>
        <SelectItem value="leased">Взят в работу (leased)</SelectItem>
        <SelectItem value="running">Выполняется (running)</SelectItem>
        <SelectItem value="done">Готово (done)</SelectItem>
        <SelectItem value="failed">Ошибка (failed)</SelectItem>
        <SelectItem value="dead">Исчерпан (dead)</SelectItem>
        <SelectItem value="needs_human">Нужен человек (needs_human)</SelectItem>
        <SelectItem value="needs_reconcile">Нужна сверка (needs_reconcile)</SelectItem>
        <SelectItem value="cancelled">Отменён (cancelled)</SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
