<script setup lang="ts">
import ToastItem from "./ToastItem.vue"
import { toastItems } from "./state"
</script>

<template>
  <!-- Телефон: сверху, чтобы не закрывать нижние панели действий; от sm: справа внизу. -->
  <section
    aria-label="Уведомления"
    class="pointer-events-none fixed inset-x-3 top-16 z-[60] sm:inset-x-auto sm:top-auto sm:right-4 sm:bottom-4 sm:w-96"
  >
    <TransitionGroup
      tag="ol"
      class="flex flex-col gap-2"
      enter-active-class="motion-safe:transition motion-safe:duration-200"
      enter-from-class="opacity-0 motion-safe:translate-y-2"
      leave-active-class="motion-safe:transition motion-safe:duration-150"
      leave-to-class="opacity-0"
    >
      <ToastItem v-for="toast in toastItems" :key="toast.id" :toast="toast" />
    </TransitionGroup>
  </section>
</template>
