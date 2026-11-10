<script setup lang="ts">
/** Один шаг панели отклика: номер, название и (необязательно) пояснение справа. */
defineProps<{ n: number; title: string; id: string }>()
</script>

<template>
  <section :aria-labelledby="`${id}-title`" class="space-y-3">
    <div class="flex items-center gap-2">
      <span
        class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground"
        aria-hidden="true"
      >{{ n }}</span>
      <h3 :id="`${id}-title`" class="text-sm font-semibold">{{ title }}</h3>
      <div v-if="$slots.aside" class="ml-auto text-xs text-muted-foreground"><slot name="aside" /></div>
    </div>
    <slot />
  </section>
</template>
