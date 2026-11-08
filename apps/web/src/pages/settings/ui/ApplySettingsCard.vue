<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { SettingsView, UserSettings } from "@otbor/contract"
import { queueJobKeys } from "@/entities/queue-job"
import { settingsApi, settingsKeys } from "@/entities/settings"
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
  Label
} from "@/shared/ui"

/**
 * Темп откликов, параллельность и потоки харнесса. Лежат в базе и действуют
 * со следующей выдачи задачи, без перезапуска.
 */
const queryCache = useQueryCache()
const query = useQuery({ key: () => settingsKeys.get(), query: () => settingsApi.get() })
const view = computed(() => query.data.value)

/** Поля формы - строки: пустое «в час» значит «без лимита». */
const form = ref({
  accountBrowserConcurrency: "",
  accountActingConcurrency: "",
  submitIntervalSeconds: "",
  submitJitterPercent: "",
  submitHourlyLimit: "",
  harnessSlots: ""
})

const fill = (settings: UserSettings) => {
  form.value = {
    accountBrowserConcurrency: String(settings.accountBrowserConcurrency),
    accountActingConcurrency: String(settings.accountActingConcurrency),
    submitIntervalSeconds: String(settings.submitIntervalSeconds),
    submitJitterPercent: String(settings.submitJitterPercent),
    submitHourlyLimit: settings.submitHourlyLimit === null ? "" : String(settings.submitHourlyLimit),
    harnessSlots: String(settings.harnessSlots)
  }
}
watch(view, (next) => next && fill(next.settings), { immediate: true })

interface Field {
  readonly key: keyof typeof form.value
  readonly label: string
  readonly hint: string
  readonly min: number
  readonly max: number
  readonly optional?: boolean
}

const fields: ReadonlyArray<Field> = [
  {
    key: "accountBrowserConcurrency",
    label: "Браузерных задач на аккаунт",
    hint: "Сколько задач одного аккаунта идёт в браузере разом (чтение форм, сверка, чаты и отправки вместе).",
    min: 1,
    max: 12
  },
  {
    key: "accountActingConcurrency",
    label: "Отправок на аккаунт разом",
    hint: "Из них действующих: клик «Откликнуться» и письмо в чат. Не больше, чем браузерных. Обычно 1.",
    min: 1,
    max: 12
  },
  {
    key: "submitIntervalSeconds",
    label: "Пауза между отправками, секунд",
    hint: "Минимум между двумя отправками одного аккаунта. 0 выключает паузу.",
    min: 0,
    max: 3600
  },
  {
    key: "submitJitterPercent",
    label: "Случайная добавка к паузе, %",
    hint: "К паузе прибавляется случайная доля до этого процента, чтобы отправки шли не по метроному.",
    min: 0,
    max: 200
  },
  {
    key: "submitHourlyLimit",
    label: "Не больше отправок в час",
    hint: "Скользящий час, на каждый аккаунт. Пусто — без лимита. Задайте, когда узнаете, после скольких откликов hh просит капчу.",
    min: 1,
    max: 1000,
    optional: true
  },
  {
    key: "harnessSlots",
    label: "Потоки харнесса",
    hint: "Сколько задач харнесс держит разом (1–12). Работающий харнесс подхватывает число сам, переменная OTBOR_HARNESS_CONCURRENCY остаётся запасной.",
    min: 1,
    max: 12
  }
]

const error = ref<string | null>(null)
const notice = ref<string | null>(null)

const mutation = useMutation<SettingsView, UserSettings>({
  mutation: (input) => settingsApi.update(input)
})

const parse = (field: Field): number | null | "invalid" => {
  const raw = form.value[field.key].trim()
  if (raw === "") return field.optional === true ? null : "invalid"
  const value = Number(raw)
  return Number.isInteger(value) && value >= field.min && value <= field.max ? value : "invalid"
}

const save = async () => {
  error.value = null
  notice.value = null
  const parsed: Record<string, number | null> = {}
  for (const field of fields) {
    const value = parse(field)
    if (value === "invalid") {
      error.value = `${field.label}: целое число от ${field.min} до ${field.max}${field.optional ? " или пусто" : ""}.`
      return
    }
    parsed[field.key] = value
  }
  const next = parsed as unknown as UserSettings
  if (next.accountActingConcurrency > next.accountBrowserConcurrency) {
    error.value = "Отправок на аккаунт не может быть больше, чем браузерных задач."
    return
  }
  try {
    const saved = await mutation.mutateAsync(next)
    fill(saved.settings)
    notice.value = "Сохранено. Действует со следующей выдачи задач, перезапуск не нужен."
    await Promise.all([
      queryCache.invalidateQueries({ key: settingsKeys.all }),
      queryCache.invalidateQueries({ key: queueJobKeys.concurrency() })
    ])
  } catch (cause) {
    error.value = describeError(cause)
  }
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Отклики и браузер</CardTitle>
      <CardDescription>
        Темп отправок, параллельность по аккаунту и потоки харнесса. Хранятся в базе; пока вы ничего не
        сохранили, действуют значения по умолчанию из окружения.
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <p v-if="query.error.value" class="text-sm text-destructive">
        Не удалось прочитать настройки: {{ describeError(query.error.value) }}
      </p>
      <div class="grid gap-4 md:grid-cols-2">
        <div v-for="field in fields" :key="field.key" class="space-y-1.5">
          <Label :for="`settings-${field.key}`" class="text-xs text-muted-foreground">{{ field.label }}</Label>
          <Input
            :id="`settings-${field.key}`"
            v-model="form[field.key]"
            inputmode="numeric"
            :placeholder="field.optional ? 'без лимита' : undefined"
          />
          <p class="text-xs text-muted-foreground">{{ field.hint }}</p>
        </div>
      </div>

      <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
      <p v-if="notice" class="text-sm text-muted-foreground">{{ notice }}</p>

      <Button :disabled="mutation.isLoading.value || !view" @click="save">Сохранить</Button>
    </CardContent>
  </Card>
</template>
