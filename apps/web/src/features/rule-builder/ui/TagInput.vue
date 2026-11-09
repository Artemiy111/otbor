<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { X } from "@lucide/vue"

/**
 * Список подстрок чипами: Enter или запятая добавляют значение, вставка списка
 * режется по запятым и переводам строк, Backspace в пустом поле снимает последний
 * чип, потеря фокуса не теряет набранное. Правило хранит значения одной строкой
 * через запятую, поэтому на границе компонента строка режется и склеивается.
 */
const props = withDefaults(defineProps<{ text: string; placeholder?: string; disabled?: boolean }>(), {
  placeholder: "Введите и нажмите Enter",
  disabled: false
})
const emit = defineEmits<{ "update:text": [value: string] }>()

const draft = ref("")
const input = ref<HTMLInputElement | null>(null)

const split = (value: string): Array<string> =>
  value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => item !== "")

const tags = computed(() => split(props.text))

const write = (values: ReadonlyArray<string>) => emit("update:text", [...new Set(values)].join(", "))

const commit = () => {
  const added = split(draft.value)
  draft.value = ""
  if (added.length > 0) write([...tags.value, ...added])
}

/** Запятая или перевод строки, попавшие в поле любым путём (ввод, IME, автозамена), закрывают чип. */
watch(draft, (value) => {
  if (/[,\n]/.test(value)) commit()
})

const remove = (tag: string) => write(tags.value.filter((item) => item !== tag))

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault()
    commit()
  } else if (event.key === "Backspace" && draft.value === "" && tags.value.length > 0) {
    write(tags.value.slice(0, -1))
  }
}

const onPaste = (event: ClipboardEvent) => {
  const pasted = event.clipboardData?.getData("text") ?? ""
  if (!/[,\n]/.test(pasted)) return
  event.preventDefault()
  write([...tags.value, ...split(draft.value + pasted)])
  draft.value = ""
}
</script>

<template>
  <div
    class="flex min-h-7 min-w-[160px] flex-1 cursor-text flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs focus-within:ring-1 focus-within:ring-ring"
    :class="props.disabled ? 'pointer-events-none opacity-50' : ''"
    @click="input?.focus()"
  >
    <span
      v-for="tag in tags"
      :key="tag"
      class="inline-flex h-5 items-center gap-0.5 rounded bg-primary/15 pl-1.5 pr-0.5"
    >
      <span class="max-w-[220px] truncate">{{ tag }}</span>
      <button
        type="button"
        class="inline-flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
        tabindex="-1"
        @click.stop="remove(tag)"
      >
        <X class="h-3 w-3" />
      </button>
    </span>
    <input
      ref="input"
      v-model="draft"
      type="text"
      :disabled="props.disabled"
      :placeholder="tags.length === 0 ? props.placeholder : 'ещё…'"
      class="h-5 min-w-[70px] flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground"
      @keydown="onKeydown"
      @paste="onPaste"
      @blur="commit"
    />
  </div>
</template>
