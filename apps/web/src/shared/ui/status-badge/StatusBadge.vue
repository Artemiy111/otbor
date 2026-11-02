<script setup lang="ts">
import { computed } from "vue"
import { Badge, type BadgeVariants } from "@/shared/ui/badge"
import { statusLabel, statusTone } from "@/shared/lib"

const props = withDefaults(
  defineProps<{
    value: string
    label?: string
    /** Show the raw contract token next to the Russian label. */
    raw?: boolean
    variant?: BadgeVariants["variant"]
  }>(),
  { label: undefined, raw: false, variant: undefined }
)

const variant = computed<BadgeVariants["variant"]>(() => {
  if (props.variant !== undefined) return props.variant
  const tone = statusTone(props.value)
  return tone === "danger" ? "destructive" : tone
})

const text = computed(() => props.label ?? statusLabel(props.value))
</script>

<template>
  <Badge :variant="variant" :title="props.value" :data-status="props.value">
    {{ text }}<span v-if="props.raw" class="ml-1 font-mono text-[10px] font-normal opacity-60">{{ props.value }}</span>
  </Badge>
</template>
