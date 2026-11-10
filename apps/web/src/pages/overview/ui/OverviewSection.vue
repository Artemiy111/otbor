<script setup lang="ts">
import { useId } from "vue"
import { cn } from "@/shared/lib"

/** Карточка-раздел: заголовок h2, необязательная подпись и «хвост» справа. */
const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    class?: string
    bodyClass?: string
  }>(),
  { description: undefined, class: undefined, bodyClass: undefined }
)

const headingId = useId()
</script>

<template>
  <section :aria-labelledby="headingId" :class="cn('flex min-w-0 flex-col rounded-xl border bg-card text-card-foreground shadow-sm', props.class)">
    <header class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5">
      <div class="min-w-0">
        <h2 :id="headingId" class="text-base font-semibold leading-6">{{ props.title }}</h2>
        <p v-if="props.description" class="mt-0.5 text-xs text-muted-foreground">{{ props.description }}</p>
      </div>
      <div v-if="$slots.aside" class="flex shrink-0 items-center gap-2">
        <slot name="aside" />
      </div>
    </header>
    <div :class="cn('min-w-0 flex-1 p-5 pt-4', props.bodyClass)">
      <slot />
    </div>
  </section>
</template>
