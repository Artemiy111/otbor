<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { CaptchaSolverSettings, CaptchaSolverTestResult } from "@otbor/contract"
import { localModelApi, localModelKeys } from "@/entities/local-model"
import { useHarnessCatalog } from "@/features/harness-catalog"
import { describeError } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/shared/ui"

const queryCache = useQueryCache()
const settingsQuery = useQuery({
  key: () => localModelKeys.captcha(),
  query: () => localModelApi.captchaGet()
})
const { harnesses, models } = useHarnessCatalog()

const enabled = ref(false)
const harnessId = ref("")
const model = ref("")
const maxAttempts = ref(5)
const timeoutSeconds = ref(60)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const testResult = ref<CaptchaSolverTestResult | null>(null)

// Форма заполняется сохранёнными настройками, как только они пришли.
watch(
  () => settingsQuery.data.value,
  (saved) => {
    if (saved === undefined || saved === null) return
    enabled.value = saved.enabled
    harnessId.value = saved.harnessId
    model.value = saved.model
    maxAttempts.value = saved.maxAttempts
    timeoutSeconds.value = saved.timeoutSeconds
  },
  { immediate: true }
)

const modelsOfHarness = computed(() => models.value.filter((item) => item.harness === harnessId.value))
const pickHarness = (value: unknown) => {
  harnessId.value = String(value)
  model.value = ""
}

const saveMutation = useMutation<CaptchaSolverSettings, CaptchaSolverSettings>({
  mutation: (input) => localModelApi.captchaSet(input)
})
const testMutation = useMutation<CaptchaSolverTestResult, void>({
  mutation: () => localModelApi.captchaTest()
})
const busy = computed(() => saveMutation.isLoading.value || testMutation.isLoading.value)

const save = async () => {
  error.value = null
  notice.value = null
  try {
    await saveMutation.mutateAsync({
      enabled: enabled.value,
      harnessId: harnessId.value,
      model: model.value,
      maxAttempts: Number(maxAttempts.value),
      timeoutSeconds: Number(timeoutSeconds.value)
    })
    notice.value = "Сохранено в ~/.otbor/captcha.json. Харнес читает настройки при каждой капче, перезапуск не нужен."
    await queryCache.invalidateQueries({ key: localModelKeys.captcha() })
  } catch (cause) {
    error.value = describeError(cause)
  }
}

const test = async () => {
  error.value = null
  testResult.value = null
  try {
    testResult.value = await testMutation.mutateAsync()
  } catch (cause) {
    error.value = describeError(cause)
  }
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Распознавание капчи</CardTitle>
      <CardDescription>
        Когда hh показывает капчу, браузер харнеса снимает картинку и отдаёт её выбранной модели, затем
        вводит ответ и жмёт «Отправить». Подойдёт любой харнес каталога с поддержкой изображений: локальный
        сервер (oMLX, LM Studio), <code>opencode</code>, <code>claude</code>. Если ответ не принят за
        указанное число попыток, аккаунт останавливается, как и без распознавания. Картинка уходит только
        выбранному харнесу. Настройка хранится локально в <code>~/.otbor/captcha.json</code>.
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <label class="flex items-center gap-2 text-sm">
        <input v-model="enabled" type="checkbox" /> Распознавать капчу автоматически
      </label>

      <div class="grid gap-4 md:grid-cols-2">
        <div class="space-y-1.5">
          <Label for="captcha-harness" class="text-xs text-muted-foreground">Харнес</Label>
          <Select :model-value="harnessId" @update:model-value="pickHarness">
            <SelectTrigger id="captcha-harness"><SelectValue placeholder="Выберите харнес" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="item in harnesses" :key="item.id" :value="item.id">
                {{ item.name }}{{ item.error ? " (недоступен)" : "" }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="space-y-1.5">
          <Label for="captcha-model" class="text-xs text-muted-foreground">Модель (с поддержкой изображений)</Label>
          <Select :model-value="model" :disabled="harnessId === ''" @update:model-value="(value) => (model = String(value))">
            <SelectTrigger id="captcha-model"><SelectValue placeholder="Выберите модель" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="item in modelsOfHarness" :key="item.id" :value="item.id">
                {{ item.label || item.id }}
              </SelectItem>
            </SelectContent>
          </Select>
          <Input v-model="model" class="mt-1.5" placeholder="или впишите имя модели, например gemma-4-E4B-it-oQ4e-mtp" autocomplete="off" />
        </div>
        <div class="space-y-1.5">
          <Label for="captcha-attempts" class="text-xs text-muted-foreground">Попыток ввода (1–10)</Label>
          <Input id="captcha-attempts" v-model="maxAttempts" type="number" min="1" max="10" />
        </div>
        <div class="space-y-1.5">
          <Label for="captcha-timeout" class="text-xs text-muted-foreground">Таймаут модели, секунд</Label>
          <Input id="captcha-timeout" v-model="timeoutSeconds" type="number" min="5" max="300" />
        </div>
      </div>

      <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
      <p v-if="notice" class="text-sm text-muted-foreground">{{ notice }}</p>
      <p v-if="testResult" class="text-sm" :class="testResult.ok ? '' : 'text-destructive'">
        <template v-if="testResult.ok">
          Прочитано: «{{ testResult.text }}» за {{ testResult.durationMs }} мс (картинка {{ testResult.picture }}).
        </template>
        <template v-else>Проверка не удалась: {{ testResult.error }}</template>
      </p>

      <div class="flex gap-2">
        <Button :disabled="busy" @click="save">Сохранить</Button>
        <Button
          variant="outline"
          :disabled="busy || harnessId === '' || model === ''"
          title="Прогон по последней сохранённой картинке капчи; работает для локальных серверов"
          @click="test"
        >
          Проверить на последней капче
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
