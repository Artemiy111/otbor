<script setup lang="ts">
import { computed, ref } from "vue"
import { listPreview, type FilterCondition } from "../lib"

/** Одно условие фильтра: фраза и список значений, который можно развернуть, если он не оборван сервером. */
const props = defineProps<{ condition: FilterCondition }>()

const open = ref(false)
const preview = computed(() => listPreview(props.condition.items, props.condition.cut, open.value))
const linkClass =
  "ml-1 rounded-sm text-info underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
</script>

<template>
  <p class="break-words">
    {{ condition.text }}<template v-if="condition.items.length > 0">:
      <span class="text-muted-foreground">{{ preview.shown.join(", ") }}</span>
      <span v-if="preview.other" class="text-muted-foreground"> и другие</span>
      <button v-else-if="preview.canExpand" type="button" :class="linkClass" @click="open = true">
        и ещё {{ preview.hidden }}
      </button>
      <button v-else-if="open" type="button" :class="linkClass" @click="open = false">свернуть</button>
    </template>
  </p>
</template>
