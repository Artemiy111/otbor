<script setup lang="ts">
import { LoaderCircle } from "@lucide/vue"
import { Alert, AlertDescription, AlertTitle, Button } from "@/shared/ui"

/** Отклик готовит раннер автооткликов: форму трогать нельзя, но его можно пропустить. */
defineProps<{ busy: boolean }>()
const emit = defineEmits<{ skip: [] }>()
</script>

<template>
  <Alert>
    <LoaderCircle class="animate-spin" />
    <AlertTitle>Автоотклик готовится</AlertTitle>
    <AlertDescription class="space-y-2">
      <p>
        Программа сама читает анкету, пишет письмо и отправляет отклик. Пока она работает, поля закрыты, чтобы не
        мешать ей.
      </p>
      <p>Если не хотите, чтобы этот отклик ушёл автоматически, пропустите его: черновик вы сможете составить сами.</p>
      <Button variant="outline" size="sm" :disabled="busy" @click="emit('skip')">Пропустить автоотклик</Button>
    </AlertDescription>
  </Alert>
</template>
