<script setup lang="ts">
import { computed, ref } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { ProxyRotate, ProxyStatus } from "@otbor/contract"
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

const kind = ref<Kind>("subscription")
const url = ref("")
const rotate = ref<ProxyRotate>("captcha")
const maxRotations = ref("3")
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

const configureMutation = useMutation<ProxyStatus, Parameters<typeof hydrationApi.proxyConfigure>[0]>({
  mutation: (input) => hydrationApi.proxyConfigure(input)
})
const clearMutation = useMutation<ProxyStatus, void>({
  mutation: () => hydrationApi.proxyClear()
})
const busy = computed(() => configureMutation.isLoading.value || clearMutation.isLoading.value)

const save = async () => {
  error.value = null
  notice.value = null
  const count = Number(maxRotations.value)
  if (!Number.isInteger(count) || count < 0 || count > 20) {
    error.value = "Лимит смен IP: целое число 0–20."
    return
  }
  try {
    const saved = await configureMutation.mutateAsync({
      kind: kind.value,
      ...(url.value.trim() === "" ? {} : { url: url.value.trim() }),
      rotate: rotate.value,
      maxRotations: count
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
        · ротация: {{ status.rotate === "captcha" ? `при капче, до ${status.maxRotations ?? 0}` : "выключена" }}
      </p>
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
        <div class="space-y-1.5">
          <Label for="proxy-rotate" class="text-xs text-muted-foreground">Смена IP</Label>
          <Select :model-value="rotate" @update:model-value="(value) => (rotate = value as ProxyRotate)">
            <SelectTrigger id="proxy-rotate"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="captcha">При капче</SelectItem>
              <SelectItem value="off">Выключена</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="space-y-1.5">
          <Label for="proxy-max" class="text-xs text-muted-foreground">Смен IP за запуск (0–20)</Label>
          <Input id="proxy-max" v-model="maxRotations" inputmode="numeric" :disabled="rotate === 'off'" />
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
