<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { CaptchaSolverSettings, CaptchaSolverTestResult } from "@otbor/contract"
import { hhAccountApi } from "@/entities/hh-account"
import { localModelApi, localModelKeys } from "@/entities/local-model"
import { useHarnessCatalog } from "@/features/harness-catalog"
import { describeError } from "@/shared/lib"
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  HarnessModelPicker,
  Label,
  useToast
} from "@/shared/ui"

const queryCache = useQueryCache()
const settingsQuery = useQuery({
  key: () => localModelKeys.captcha(),
  query: () => localModelApi.captchaGet()
})
const solvesQuery = useQuery({
  key: () => [...localModelKeys.captcha(), "solves"],
  query: () => hhAccountApi.captchaSolves(15),
  staleTime: 10_000
})
const journal = computed(() => solvesQuery.data.value ?? { solves: [], models: [] })
const stamp = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })

const {
  harnesses,
  models,
  loading: catalogLoading,
  error: catalogError,
  refetch: refetchCatalog
} = useHarnessCatalog()

const enabled = ref(false)
const harnessId = ref("")
const model = ref("")
const maxAttempts = ref(5)
const timeoutSeconds = ref(60)
const toast = useToast()
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

// Пикер отдаёт провайдера, только когда кликнули вкладку, а модель можно ввести
// и без клика: без этого получилась бы модель без харнеса. Берём первый харнес.
watch(
  [harnessId, harnesses],
  () => {
    if (harnessId.value === "" && harnesses.value.length > 0) harnessId.value = harnesses.value[0]!.id
  },
  { immediate: true }
)

// Усилие для распознавания не нужно, но общий выбор модели его требует.
const effort = ref("")
const current = computed<CaptchaSolverSettings>(() => ({
  enabled: enabled.value,
  harnessId: harnessId.value,
  model: model.value,
  maxAttempts: Number(maxAttempts.value),
  timeoutSeconds: Number(timeoutSeconds.value)
}))

const saveMutation = useMutation<CaptchaSolverSettings, CaptchaSolverSettings>({
  mutation: (input) => localModelApi.captchaSet(input)
})
const testMutation = useMutation<CaptchaSolverTestResult, CaptchaSolverSettings>({
  mutation: (input) => localModelApi.captchaTest(input)
})
const busy = computed(() => saveMutation.isLoading.value || testMutation.isLoading.value)

const save = async () => {
  try {
    await saveMutation.mutateAsync(current.value)
    toast.success("Сохранено", { description: "Харнес читает настройки при каждой капче, перезапуск не нужен." })
    await queryCache.invalidateQueries({ key: localModelKeys.captcha() })
  } catch (cause) {
    toast.error("Не удалось сохранить", { description: describeError(cause) })
  }
}

const test = async () => {
  testResult.value = null
  try {
    testResult.value = await testMutation.mutateAsync(current.value)
  } catch (cause) {
    toast.error("Не удалось проверить", { description: describeError(cause) })
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
        <div class="space-y-1.5 md:col-span-2">
          <Label for="captcha-model" class="text-xs text-muted-foreground">
            Харнес и модель (нужна поддержка изображений)
          </Label>
          <HarnessModelPicker
            v-model:provider="harnessId"
            v-model:model="model"
            v-model:effort="effort"
            trigger-id="captcha-model"
            :harnesses="harnesses"
            :models="models"
            :loading="catalogLoading"
            :error="catalogError"
            :disabled="busy"
            allow-custom
            placeholder="Выберите модель для капчи"
            class="border-border"
            @refresh="refetchCatalog()"
          />
          <p class="text-xs text-muted-foreground">
            Нужной модели нет в списке (например, локальная ещё не попала в каталог): впишите её id в поиске.
          </p>
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

      <p v-if="testResult" class="text-sm" :class="testResult.ok ? '' : 'text-destructive'">
        <template v-if="testResult.ok">
          Прочитано: «{{ testResult.text }}» за {{ testResult.durationMs }} мс (картинка {{ testResult.picture }}).
        </template>
        <template v-else>Проверка не удалась: {{ testResult.error }}</template>
      </p>

      <div class="space-y-2 border-t pt-4">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-medium">Журнал капчи</h3>
          <Button size="sm" variant="ghost" :disabled="solvesQuery.isLoading.value" @click="solvesQuery.refetch()">
            Обновить
          </Button>
        </div>
        <p v-if="journal.solves.length === 0" class="text-sm text-muted-foreground">
          Капч с распознаванием пока не было.
        </p>
        <template v-else>
          <ul class="space-y-1 text-sm">
            <li v-for="item in journal.models" :key="item.harness + item.model">
              <code class="text-xs">{{ item.harness }}/{{ item.model }}</code>:
              решено {{ item.solved }} из {{ item.captchas }}, в среднем
              {{ (item.attempts / item.captchas).toFixed(1) }} попытки на капчу
            </li>
          </ul>
          <ul class="divide-y rounded-md border text-sm">
            <li v-for="item in journal.solves" :key="item.jobId + item.model" class="flex flex-wrap items-center gap-x-3 gap-y-1 p-2">
              <span class="text-muted-foreground">{{ stamp(item.at) }}</span>
              <span :class="item.solved ? 'text-success' : 'text-destructive'">{{ item.solved ? "решена" : "не решена" }}</span>
              <span>попыток: {{ item.attempts }}</span>
              <code class="text-xs">{{ item.harness }}/{{ item.model }}</code>
              <span v-if="item.answer" class="text-muted-foreground">ответ «{{ item.answer }}»</span>
              <span class="text-muted-foreground">{{ item.stage }}, {{ (item.durationMs / 1000).toFixed(1) }} с</span>
            </li>
          </ul>
        </template>
      </div>

      <div class="flex flex-wrap gap-2">
        <Button :disabled="busy" @click="save">Сохранить</Button>
        <Button
          variant="outline"
          :disabled="busy || harnessId === '' || model === ''"
          title="Прогон выбранной в форме модели по последней сохранённой картинке капчи; работает для локальных серверов"
          @click="test"
        >
          Проверить на последней капче
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
