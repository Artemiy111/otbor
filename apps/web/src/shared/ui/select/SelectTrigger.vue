<script setup lang="ts">
import { computed, type HTMLAttributes } from "vue"
import {
  SelectTrigger,
  useForwardProps,
  type SelectTriggerProps
} from "reka-ui"
import { ChevronDown } from "lucide-vue-next"
import { cn } from "@/shared/lib"

const props = defineProps<SelectTriggerProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = computed(() => {
  const { class: _class, ...delegated } = props
  return delegated
})
const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <SelectTrigger
    v-bind="forwardedProps"
    :class="
      cn(
        'flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1',
        props.class
      )
    "
  >
    <slot />
    <ChevronDown class="h-4 w-4 shrink-0 opacity-50" />
  </SelectTrigger>
</template>
