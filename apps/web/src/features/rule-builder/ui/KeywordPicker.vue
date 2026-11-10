<script setup lang="ts">
import { computed, ref } from "vue"
import type { LexiconKeyword } from "@otbor/contract"
import { X } from "@lucide/vue"
import { Input, Label, Skeleton } from "@/shared/ui"

/**
 * Multi-select over the lexicon. The preset stores the terms themselves, not
 * keyword ids: a rule must survive a keyword being renamed or removed.
 */
const props = withDefaults(
  defineProps<{
    modelValue: ReadonlyArray<string>
    keywords: ReadonlyArray<LexiconKeyword>
    loading?: boolean
    disabled?: boolean
  }>(),
  { loading: false, disabled: false }
)

const emit = defineEmits<{ "update:modelValue": [value: string[]] }>()

const search = ref("")

const selected = computed(
  () => new Set(props.modelValue.map((term) => term.toLocaleLowerCase("ru-RU")))
)

const visible = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase("ru-RU")
  if (needle === "") return props.keywords
  return props.keywords.filter(
    (keyword) =>
      keyword.term.toLocaleLowerCase("ru-RU").includes(needle) ||
      keyword.normalizedTerm.includes(needle) ||
      keyword.aliases.some((alias) =>
        alias.alias.toLocaleLowerCase("ru-RU").includes(needle)
      )
  )
})

const isSelected = (term: string): boolean =>
  selected.value.has(term.toLocaleLowerCase("ru-RU"))

const toggle = (term: string) => {
  const next = props.modelValue.filter(
    (item) => item.toLocaleLowerCase("ru-RU") !== term.toLocaleLowerCase("ru-RU")
  )
  emit("update:modelValue", isSelected(term) ? next : [...next, term])
}

const remove = (term: string) => {
  emit(
    "update:modelValue",
    props.modelValue.filter(
      (item) => item.toLocaleLowerCase("ru-RU") !== term.toLocaleLowerCase("ru-RU")
    )
  )
}

const clear = () => {
  emit("update:modelValue", [])
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap items-end justify-between gap-2">
      <Label class="text-xs text-muted-foreground">
        Термины словаря
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

    <div v-if="props.modelValue.length > 0" class="flex flex-wrap gap-1">
      <button
        v-for="term in props.modelValue"
        :key="term"
        type="button"
        class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
        :disabled="props.disabled"
        @click="remove(term)"
      >
        {{ term }}
        <X class="h-3 w-3 text-muted-foreground" />
      </button>
    </div>

    <Input
      v-model="search"
      type="text"
      placeholder="Найти термин или алиас"
      class="h-8 text-xs"
      :disabled="props.disabled"
    />

    <div class="max-h-48 overflow-auto rounded-md border border-border bg-muted/20 p-1.5">
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
          class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-xs hover:bg-accent"
        >
          <input
            type="checkbox"
            class="size-3.5 shrink-0 rounded border-input accent-primary"
            :checked="isSelected(keyword.term)"
            :disabled="props.disabled"
            @change="toggle(keyword.term)"
          />
          <span class="min-w-0 truncate">{{ keyword.term }}</span>
        </label>
      </div>
    </div>

    <p class="text-xs text-muted-foreground">
      Сохраняются термины, а не id: правило переживёт переименование в словаре.
    </p>
  </div>
</template>
