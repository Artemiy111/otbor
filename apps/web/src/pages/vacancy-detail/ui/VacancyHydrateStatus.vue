<script setup lang="ts">
import { LoaderCircle } from "@lucide/vue"
import { Button } from "@/shared/ui"
import type { VacancyPage } from "../model"

/** Тихая строка о догрузке полного описания: идёт, не удалась (с повтором) либо ничего. */
defineProps<{ page: VacancyPage }>()
</script>

<template>
  <p
    v-if="page.hydrating.value"
    class="flex items-center gap-1.5 text-xs text-muted-foreground"
    role="status"
  >
    <LoaderCircle class="size-3.5 animate-spin" />
    Догружаем полное описание…
  </p>
  <p v-else-if="page.hydrateFailed.value" class="flex flex-wrap items-center gap-x-2 text-xs text-warning" role="status">
    Не удалось догрузить описание.
    <Button variant="link" size="sm" class="h-auto p-0 text-xs" @click="page.hydrate">Повторить</Button>
  </p>
</template>
