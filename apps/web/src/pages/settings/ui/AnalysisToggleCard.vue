<script setup lang="ts">
import { computed } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { SettingsView, UserSettings } from "@otbor/contract"
import { settingsApi, settingsKeys } from "@/entities/settings"
import { describeError } from "@/shared/lib"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, useToast } from "@/shared/ui"

/**
 * Выключатель анализа вакансий моделью SystemOne. Лежит в настройках пользователя
 * и действует сразу: диспетчер читает его перед каждым проходом расписания `analysis`.
 */
const queryCache = useQueryCache()
const query = useQuery({ key: () => settingsKeys.get(), query: () => settingsApi.get() })
const view = computed(() => query.data.value)
const toast = useToast()

const mutation = useMutation<SettingsView, UserSettings>({
  mutation: (input) => settingsApi.update(input)
})

const toggle = async (event: Event) => {
  const current = view.value
  if (current === undefined) return
  const enabled = (event.target as HTMLInputElement).checked
  try {
    await mutation.mutateAsync({ ...current.settings, analysisEnabled: enabled })
    toast.success(enabled ? "Анализ включён" : "Анализ выключен")
  } catch (cause) {
    toast.error("Не удалось сохранить", { description: describeError(cause) })
  } finally {
    await queryCache.invalidateQueries({ key: settingsKeys.all })
  }
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Анализ вакансий</CardTitle>
      <CardDescription>
        Когда выключен, расписания <code>analysis</code> завершаются сразу, не обращаясь к модели SystemOne.
        Уже готовые результаты остаются; ручной запуск <code>otbor analysis run</code> работает.
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-2">
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          :checked="view?.settings.analysisEnabled ?? true"
          :disabled="!view || mutation.isLoading.value"
          @change="toggle"
        />
        Анализировать вакансии по расписанию
      </label>
    </CardContent>
  </Card>
</template>
