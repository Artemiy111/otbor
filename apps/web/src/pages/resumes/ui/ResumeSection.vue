<script setup lang="ts">
import { CircleAlert } from "@lucide/vue"
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui"

/**
 * Раздел страницы резюме. Если раздел можно править (`editable`), внизу одна
 * кнопка «Сохранить» именно для него, а в заголовке видно, есть ли правки.
 */
withDefaults(
  defineProps<{
    id: string
    title: string
    description?: string
    editable?: boolean
    dirty?: boolean
    saving?: boolean
    error?: string | null
  }>(),
  { description: undefined, editable: false, dirty: false, saving: false, error: null }
)
const emit = defineEmits<{ save: []; revert: [] }>()
</script>

<template>
  <Card :id="id" class="scroll-mt-20">
    <CardHeader>
      <div class="flex flex-wrap items-center gap-2">
        <CardTitle class="text-base">{{ title }}</CardTitle>
        <Badge v-if="editable && dirty" variant="warning">Не сохранено</Badge>
      </div>
      <CardDescription v-if="description">{{ description }}</CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <slot />
      <Alert v-if="error" variant="destructive">
        <CircleAlert />
        <AlertDescription>Не удалось сохранить: {{ error }}</AlertDescription>
      </Alert>
      <div v-if="editable" class="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
        <span class="mr-auto text-xs text-muted-foreground">
          {{ dirty ? "Есть правки, которые ещё не сохранены." : "Все правки сохранены." }}
        </span>
        <Button variant="ghost" size="sm" :disabled="!dirty || saving" @click="emit('revert')">Отменить правки</Button>
        <Button size="sm" :disabled="!dirty || saving" @click="emit('save')">
          {{ saving ? "Сохраняю…" : "Сохранить раздел" }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
