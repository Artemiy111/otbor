<script lang="ts">
export interface HeaderFilterOption {
  readonly value: string
  readonly label: string
  /** Account colour (CSS colour); renders a dot before the label. */
  readonly color?: string
}
</script>

<script setup lang="ts">
import Select from "../select/Select.vue"
import SelectContent from "../select/SelectContent.vue"
import SelectItem from "../select/SelectItem.vue"
import SelectTrigger from "../select/SelectTrigger.vue"
import SelectValue from "../select/SelectValue.vue"

const props = defineProps<{
  modelValue: string
  options: ReadonlyArray<HeaderFilterOption>
}>()
const emit = defineEmits<{ "update:modelValue": [value: string] }>()
</script>

<template>
  <Select
    :model-value="props.modelValue"
    @update:model-value="(value) => emit('update:modelValue', String(value))"
  >
    <SelectTrigger class="h-7 w-full min-w-[130px] gap-1 px-2 text-xs font-normal normal-case">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="option in props.options" :key="option.value" :value="option.value">
        <span class="inline-flex items-center gap-2">
          <span
            v-if="option.color !== undefined"
            class="size-2.5 shrink-0 rounded-full"
            :style="{ backgroundColor: option.color }"
          />
          {{ option.label }}
        </span>
      </SelectItem>
    </SelectContent>
  </Select>
</template>
