<script setup lang="ts">
import { computed } from "vue"
import type { FilterFailure } from "../lib"
import VacancyFilterCondition from "./VacancyFilterCondition.vue"

/**
 * Одно непрошедшее правило фильтра откликов человеческими словами. Группа «любое из»
 * с одним условием читается как обычное правило, с несколькими вариантами - списком.
 */
const props = defineProps<{ failure: FilterFailure }>()

const single = computed(() => props.failure.alternatives.length === 1 && props.failure.alternatives[0]?.length === 1)
const intro = computed(() =>
  props.failure.alternatives.length > 1 ? "Ни одно из условий не выполнено:" : "Не выполнено хотя бы одно из условий:"
)
</script>

<template>
  <div class="min-w-0">
    <VacancyFilterCondition v-if="single" :condition="failure.alternatives[0]![0]!" />
    <template v-else>
      <p>{{ intro }}</p>
      <ul class="mt-1.5 space-y-1.5 border-l border-border pl-3">
        <li v-for="(alternative, altIndex) in failure.alternatives" :key="altIndex" class="space-y-0.5">
          <VacancyFilterCondition v-for="(condition, index) in alternative" :key="index" :condition="condition" />
        </li>
        <li v-if="failure.more" class="text-muted-foreground">и другие условия группы</li>
      </ul>
    </template>
  </div>
</template>
