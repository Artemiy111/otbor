<script setup lang="ts">
import { computed, ref } from "vue"
import type { KeywordId, LexiconKeyword } from "@otbor/contract"
import { Input, Label, Skeleton } from "@/shared/ui"

const props = withDefaults(
  defineProps<{
    modelValue: ReadonlyArray<KeywordId>
    keywords: ReadonlyArray<LexiconKeyword>
    loading?: boolean
    disabled?: boolean
  }>(),
  { loading: false, disabled: false }
)

const emit = defineEmits<{ "update:modelValue": [value: KeywordId[]] }>()

const search = ref("")

const selected = computed(() => new Set<string>(props.modelValue))

const visible = computed(() => {
  const needle = search.value.trim().toLowerCase()
  if (needle === "") return props.keywords
  return props.keywords.filter(
    (keyword) =>
      keyword.term.toLowerCase().includes(needle) ||
      keyword.normalizedTerm.includes(needle) ||
      keyword.aliases.some((alias) => alias.alias.toLowerCase().includes(needle))
  )
})

const toggle = (id: KeywordId) => {
  const next = new Set<string>(props.modelValue)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  emit("update:modelValue", [...next] as KeywordId[])
}

const clear = () => {
  emit("update:modelValue", [])
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap items-end justify-between gap-2">
      <Label for="preset-keyword-search" class="text-xs text-muted-foreground">
        Ключевые слова
        <span class="font-normal">· выбрано {{ props.modelValue.length }}</span>
      </Label>
      <button
        v-if="props.modelValue.length > 0"
        type="button"
        class="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
        :disabled="props.disabled"
        @click="clear"
      >
        Очистить
      </button>
    </div>

    <Input
      id="preset-keyword-search"
      v-model="search"
      type="text"
      placeholder="Найти термин или алиас"
      :disabled="props.disabled"
    />

    <div class="max-h-64 overflow-auto rounded-md border border-border bg-muted/20 p-2">
      <div v-if="props.loading" class="space-y-2 p-1">
        <Skeleton v-for="index in 5" :key="index" class="h-5 w-full" />
      </div>

      <p v-else-if="props.keywords.length === 0" class="p-2 text-xs text-muted-foreground">
        Словарь пуст. Добавьте термины на странице «Ключевые слова».
      </p>

      <p v-else-if="visible.length === 0" class="p-2 text-xs text-muted-foreground">
        Ничего не найдено.
      </p>

      <div v-else class="grid gap-0.5 sm:grid-cols-2">
        <label
          v-for="keyword in visible"
          :key="keyword.id"
          class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-accent"
        >
          <input
            type="checkbox"
            class="size-4 shrink-0 rounded border-input accent-primary"
            :checked="selected.has(keyword.id)"
            :disabled="props.disabled"
            @change="toggle(keyword.id)"
          />
          <span class="min-w-0 truncate">{{ keyword.term }}</span>
          <span
            v-if="!keyword.enabled"
            class="shrink-0 text-[10px] text-muted-foreground"
          >
            выключено
          </span>
        </label>
      </div>
    </div>

    <p class="text-xs text-muted-foreground">
      Пустой список не ограничивает пресет по ключевым словам.
    </p>
  </div>
</template>
