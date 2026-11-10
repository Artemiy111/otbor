<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue"
import { Check, Copy } from "@lucide/vue"

/** Команда терминала одной плашкой с кнопкой «Скопировать». */
const props = defineProps<{ command: string }>()

const id = `cmd-${Math.random().toString(36).slice(2, 9)}`
const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

const copy = async () => {
  try {
    await navigator.clipboard.writeText(props.command)
  } catch {
    // Без доступа к буферу выделяем текст: пользователь скопирует сам.
    const range = document.createRange()
    const node = document.getElementById(id)
    if (node !== null) {
      range.selectNodeContents(node)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
    return
  }
  copied.value = true
  if (timer !== undefined) clearTimeout(timer)
  timer = setTimeout(() => (copied.value = false), 1800)
}
onBeforeUnmount(() => {
  if (timer !== undefined) clearTimeout(timer)
})
</script>

<template>
  <span class="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/40 py-0.5 pr-0.5 pl-2.5">
    <code :id="id" class="min-w-0 truncate font-mono text-xs">{{ command }}</code>
    <button
      type="button"
      class="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      :aria-label="copied ? 'Скопировано' : `Скопировать команду ${command}`"
      @click="copy"
    >
      <Check v-if="copied" class="size-3.5 text-success" />
      <Copy v-else class="size-3.5" />
    </button>
    <span class="sr-only" role="status">{{ copied ? "Команда скопирована" : "" }}</span>
  </span>
</template>
