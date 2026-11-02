<script setup lang="ts">
import { computed } from "vue"
import { Badge, type BadgeVariants } from "@/shared/ui/badge"
import { statusLabel, statusTone } from "@/shared/lib"

const props = withDefaults(
  defineProps<{
    value: string
    label?: string
  }>(),
  { label: undefined }
)

const variant = computed<BadgeVariants["variant"]>(() => {
  const tone = statusTone(props.value)
  return tone === "danger" ? "destructive" : tone
})

const text = computed(() => props.label ?? statusLabel(props.value))
</script>

<template>
  <Badge :variant="variant">{{ text }}</Badge>
</template>
