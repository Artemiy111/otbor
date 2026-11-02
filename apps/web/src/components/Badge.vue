<script setup lang="ts">
defineProps<{
  value: string
  label?: string
}>()
</script>

<template>
  <span class="badge" :class="`badge-${value}`">{{ label ?? value }}</span>
</template>
