<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "@lucide/vue"
import { cn, toneClasses } from "@/shared/lib"
import Button from "../button/Button.vue"
import { defaultDuration, useToast, type ToastMessage } from "./state"

const props = defineProps<{ toast: ToastMessage }>()

const { dismiss } = useToast()

const tone = computed(() => toneClasses(props.toast.tone))
const icon = computed(
  () => ({ success: CircleCheck, info: Info, warning: TriangleAlert, danger: CircleAlert })[props.toast.tone]
)
const total = computed(() =>
  props.toast.duration === undefined ? defaultDuration(props.toast.tone) : props.toast.duration
)

/* Таймер ставится на паузу под курсором и при фокусе внутри: читать не мешаем. */
let remaining = 0
let startedAt = 0
let timer: ReturnType<typeof setTimeout> | undefined
const hovered = ref(false)
const focused = ref(false)

const stop = () => {
  if (timer === undefined) return
  clearTimeout(timer)
  timer = undefined
  remaining -= Date.now() - startedAt
}
const start = () => {
  if (total.value === null || timer !== undefined) return
  startedAt = Date.now()
  timer = setTimeout(() => dismiss(props.toast.id), Math.max(remaining, 800))
}
const sync = () => (hovered.value || focused.value ? stop() : start())
const setHover = (value: boolean) => {
  hovered.value = value
  sync()
}
const setFocus = (value: boolean) => {
  focused.value = value
  sync()
}

onMounted(() => {
  remaining = total.value ?? 0
  start()
})
onBeforeUnmount(() => {
  if (timer !== undefined) clearTimeout(timer)
})

const act = () => {
  props.toast.action?.onClick?.()
  dismiss(props.toast.id)
}
</script>

<template>
  <li
    :role="toast.tone === 'danger' ? 'alert' : 'status'"
    :aria-live="toast.tone === 'danger' ? 'assertive' : 'polite'"
    aria-atomic="true"
    :class="
      cn(
        'pointer-events-auto flex items-start gap-3 rounded-lg border bg-card p-3 text-sm text-card-foreground shadow-lg',
        tone.border
      )
    "
    @mouseenter="setHover(true)"
    @mouseleave="setHover(false)"
    @focusin="setFocus(true)"
    @focusout="setFocus(false)"
    @keydown.esc="dismiss(toast.id)"
  >
    <component :is="icon" :class="cn('mt-0.5 size-4 shrink-0', tone.text)" aria-hidden="true" />
    <div class="min-w-0 flex-1">
      <p class="font-medium leading-snug">{{ toast.title }}</p>
      <p v-if="toast.description" class="mt-0.5 break-words text-muted-foreground">{{ toast.description }}</p>
      <div v-if="toast.action" class="mt-2">
        <Button v-if="toast.action.href" as-child size="sm" variant="outline" @click="dismiss(toast.id)">
          <a :href="toast.action.href">{{ toast.action.label }}</a>
        </Button>
        <Button v-else size="sm" variant="outline" @click="act">{{ toast.action.label }}</Button>
      </div>
    </div>
    <Button
      variant="ghost"
      size="icon"
      class="-mr-1 -mt-1 size-7 shrink-0 text-muted-foreground"
      aria-label="Закрыть уведомление"
      @click="dismiss(toast.id)"
    >
      <X />
    </Button>
  </li>
</template>
