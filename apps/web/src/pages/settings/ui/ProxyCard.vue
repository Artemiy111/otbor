<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { ProxyStatus } from "@otbor/contract"
import { hydrationApi, hydrationKeys } from "@/entities/hydration"
import { describeError } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  Badge,
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

type Kind = "subscription" | "endpoint"

const queryCache = useQueryCache()
const statusQuery = useQuery({
  key: () => hydrationKeys.proxyStatus(),
  query: () => hydrationApi.proxyStatus()
})
const status = computed(() => statusQuery.data.value)

// Node health appears seconds after mihomo starts, so keep looking while the
// engine is down or has not checked its nodes yet.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    const engine = status.value?.engine
    if (engine !== null && engine !== undefined && (!engine.reachable || engine.checked === 0)) {
      void statusQuery.refetch()
    }
  }, 5000)
})
onUnmounted(() => clearInterval(timer))

const kind = ref<Kind>("subscription")
const url = ref("")
const workers = ref("10")
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

const configureMutation = useMutation<ProxyStatus, Parameters<typeof hydrationApi.proxyConfigure>[0]>({
  mutation: (input) => hydrationApi.proxyConfigure(input)
})
const clearMutation = useMutation<ProxyStatus, void>({
  mutation: () => hydrationApi.proxyClear()
})
const formatBytes = (value: number): string => {
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"]
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}
const busy = computed(() => configureMutation.isLoading.value || clearMutation.isLoading.value)

const save = async () => {
  error.value = null
  notice.value = null
  const count = Number(workers.value)
  if (!Number.isInteger(count) || count < 1 || count > 15) {
    error.value = "Воркеры: целое число 1–15."
    return
  }
  try {
    const saved = await configureMutation.mutateAsync({
      kind: kind.value,
      ...(url.value.trim() === "" ? {} : { url: url.value.trim() }),
      workers: count
    })
    url.value = ""
    notice.value = saved.source === "subscription"
      ? "Сохранено. Локальный mihomo перезапускается — это займёт до минуты."
      : "Сохранено."
    await queryCache.invalidateQueries({ key: hydrationKeys.proxyStatus() })
  } catch (cause) {
    error.value = describeError(cause)
  }
}

const clear = async () => {
  error.value = null
  notice.value = null
  try {
    await clearMutation.mutateAsync()
    notice.value = "Сохранённые настройки удалены."
    await queryCache.invalidateQueries({ key: hydrationKeys.proxyStatus() })
  } catch (cause) {
    error.value = describeError(cause)
  }
}
</script>

<template>
  <Card>
    <CardHeader>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Прокси для hh.ru</CardTitle>
          <CardDescription>
            Ссылка подписки (mihomo в Docker) или готовый HTTP-прокси. Секрет хранится локально в
            <code>~/.otbor/proxy</code> и обратно не показывается.
          </CardDescription>
        </div>
        <Badge :variant="status?.configured ? 'success' : 'warning'">
          {{ status?.configured ? "Настроен" : "Не настроен" }}
        </Badge>
      </div>
    </CardHeader>
    <CardContent class="space-y-4">
      <p v-if="status?.configured" class="text-sm text-muted-foreground">
        {{ status.source === "subscription" ? `Подписка ${status.subscription ?? ""}` : "Готовый адрес" }}
        · {{ status.label }}
        · воркеров: {{ status.workers ?? 1 }}
      </p>
      <div v-if="status?.engine" class="grid grid-cols-2 gap-3 rounded-md border p-3 text-sm md:grid-cols-4">
        <template v-if="status.engine.reachable">
          <div>
            <div class="text-xs text-muted-foreground">Нод в подписке</div>
            <div class="font-medium">{{ status.engine.nodes }}</div>
          </div>
          <div>
            <div class="text-xs text-muted-foreground">Доступно</div>
            <div class="font-medium">
              {{ status.engine.checked === 0 ? "проверяется…" : `${status.engine.alive} из ${status.engine.checked}` }}
            </div>
          </div>
          <div v-if="status.engine.usedBytes !== null">
            <div class="text-xs text-muted-foreground">Трафик</div>
            <div class="font-medium">
              {{ formatBytes(status.engine.usedBytes) }}<template v-if="status.engine.totalBytes !== null"> из {{ formatBytes(status.engine.totalBytes) }}</template>
            </div>
          </div>
          <div v-if="status.engine.expiresAt">
            <div class="text-xs text-muted-foreground">Действует до</div>
            <div class="font-medium">{{ new Date(status.engine.expiresAt).toLocaleDateString("ru-RU") }}</div>
          </div>
          <p v-if="status.engine.nodes > 0 && (status.workers ?? 1) > status.engine.alive && status.engine.checked > 0" class="col-span-full text-xs text-amber-600">
            Живых нод меньше, чем воркеров: часть воркеров будет делить IP.
          </p>
        </template>
        <p v-else class="col-span-full text-muted-foreground">
          Движок mihomo не отвечает. Проверьте, что Docker запущен; после сохранения подписки он поднимается до минуты.
        </p>
      </div>
      <Alert v-if="status?.origin === 'env'" variant="warning">
        <AlertDescription>
          Прокси задан переменными <code>OTBOR_PROXY_*</code>: они имеют приоритет над сохранёнными настройками.
        </AlertDescription>
      </Alert>

      <div class="grid gap-4 md:grid-cols-2">
        <div class="space-y-1.5">
          <Label for="proxy-kind" class="text-xs text-muted-foreground">Тип</Label>
          <Select :model-value="kind" @update:model-value="(value) => (kind = value as Kind)">
            <SelectTrigger id="proxy-kind"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="subscription">Ссылка подписки</SelectItem>
              <SelectItem value="endpoint">Готовый HTTP-прокси</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="space-y-1.5">
          <Label for="proxy-url" class="text-xs text-muted-foreground">
            {{ kind === "subscription" ? "Ссылка подписки" : "Адрес прокси" }}
          </Label>
          <Input
            id="proxy-url"
            v-model="url"
            type="password"
            autocomplete="off"
            :placeholder="status?.configured ? 'Оставьте пустым, чтобы не менять' : kind === 'subscription' ? 'https://…' : 'http://127.0.0.1:7890'"
          />
        </div>
        <div v-if="kind === 'subscription'" class="space-y-1.5">
          <Label for="proxy-workers" class="text-xs text-muted-foreground">Параллельных воркеров (1–15)</Label>
          <Input id="proxy-workers" v-model="workers" inputmode="numeric" />
          <p class="text-xs text-muted-foreground">
            У каждого свой IP и свой порт, без кук. При блокировке hh.ru воркер сам меняет ноду.
          </p>
        </div>
      </div>

      <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
      <p v-if="notice" class="text-sm text-muted-foreground">{{ notice }}</p>

      <div class="flex gap-2">
        <Button :disabled="busy || (!status?.configured && url.trim() === '')" @click="save">Сохранить</Button>
        <Button v-if="status?.origin === 'file'" variant="outline" :disabled="busy" @click="clear">
          Удалить настройки
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
