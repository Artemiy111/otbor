<script setup lang="ts">
// PROTOTYPE (throwaway): floating variant switcher, syncs ?variant= and arrow keys.
import { onBeforeUnmount, onMounted } from "vue"
const props = defineProps<{ variants: ReadonlyArray<{ key: string; label: string }>; modelValue: string }>()
const emit = defineEmits<{ "update:modelValue": [string] }>()
const go = (d: number) => {
  const i = props.variants.findIndex((v) => v.key === props.modelValue)
  const next = props.variants[(i + d + props.variants.length) % props.variants.length]!
  emit("update:modelValue", next.key)
  const url = new URL(window.location.href)
  url.searchParams.set("variant", next.key)
  window.history.replaceState(null, "", url)
}
const onKey = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return
  if (e.key === "ArrowLeft") go(-1)
  if (e.key === "ArrowRight") go(1)
}
onMounted(() => window.addEventListener("keydown", onKey))
onBeforeUnmount(() => window.removeEventListener("keydown", onKey))
const label = () => props.variants.find((v) => v.key === props.modelValue)
</script>
<template>
  <div class="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-xl">
    <button class="px-1 text-lg" @click="go(-1)">←</button>
    <span class="min-w-56 text-center">{{ label()?.key }} · {{ label()?.label }}</span>
    <button class="px-1 text-lg" @click="go(1)">→</button>
  </div>
</template>
