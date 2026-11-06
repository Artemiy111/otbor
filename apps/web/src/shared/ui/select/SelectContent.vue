<script setup lang="ts">
import { computed, type HTMLAttributes } from "vue"
import {
  SelectContent,
  SelectPortal,
  SelectViewport,
  useForwardProps,
  type SelectContentProps
} from "reka-ui"
import { cn } from "@/shared/lib"

const props = defineProps<SelectContentProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = computed(() => {
  const { class: _class, ...delegated } = props
  return delegated
})
const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <SelectPortal>
    <SelectContent
      v-bind="forwardedProps"
      :class="
        cn(
          'relative z-50 max-h-72 min-w-[6rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md',
          props.class
        )
      "
    >
      <SelectViewport class="p-1">
        <slot />
      </SelectViewport>
    </SelectContent>
  </SelectPortal>
</template>
