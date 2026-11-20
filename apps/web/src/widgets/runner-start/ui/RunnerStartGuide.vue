<script setup lang="ts">
import { CommandChip } from "@/shared/ui"

/**
 * Единственное место, где сказано, как запустить систему. Команды берутся из
 * оператора `otbor` (packages/cli): `otbor up` поднимает всё, `otbor runner run`
 * запускает только раннер. Страницы здоровья, очереди и генерации,
 * а также обзор показывают этот блок, а не свои тексты.
 */
withDefaults(
  defineProps<{
    /** Что именно не работает: драйвер, генерация или вся система. */
    target?: "browser" | "inference" | "stack"
  }>(),
  { target: "browser" }
)
</script>

<template>
  <div class="space-y-2 text-sm" data-testid="runner-start">
    <p class="font-medium">Как запустить</p>
    <ul class="space-y-2">
      <li class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <CommandChip command="otbor up" />
        <span class="text-muted-foreground">
          <template v-if="target === 'stack'">поднимает сервер, фоновый запуск, веб-интерфейс и исполнитель.</template>
          <template v-else>поднимает всё сразу, в том числе раннер, если он уже зарегистрирован.</template>
        </span>
      </li>
      <li v-if="target !== 'stack'" class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <CommandChip command="otbor runner run" />
        <span class="text-muted-foreground">
          запускает только раннер{{ target === "inference" ? ": он же выполняет генерацию" : " браузера" }}.
        </span>
      </li>
    </ul>
    <details v-if="target !== 'stack'" class="text-muted-foreground">
      <summary class="cursor-pointer select-none rounded text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        Раннер ещё не регистрировался
      </summary>
      <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <CommandChip command="otbor runner register --name <имя> --save" />
        <span>один раз на этом компьютере, дальше хватит команд выше.</span>
      </div>
    </details>
  </div>
</template>
