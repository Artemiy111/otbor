<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { LocalModelInput, LocalModelServer } from "@otbor/contract"
import { applicationKeys } from "@/entities/application"
import { localModelApi, localModelKeys } from "@/entities/local-model"
import { useHarnessCatalog } from "@/features/harness-catalog"
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
  Label
} from "@/shared/ui"

const queryCache = useQueryCache()
const listQuery = useQuery({
  key: () => localModelKeys.list(),
  query: () => localModelApi.list()
})
const servers = computed(() => listQuery.data.value ?? [])
const { catalog, refetch: refetchCatalog } = useHarnessCatalog()

// Живость: сервер опрашивает `/models` каждого сервера, страница просто
// перечитывает результат, пока открыта.
const HEALTH_INTERVAL_MS = 30_000
const healthQuery = useQuery({
  key: () => localModelKeys.health(),
  query: () => localModelApi.check()
})
const healthOf = (serverId: string) =>
  healthQuery.data.value?.find((item) => item.id === serverId) ?? null
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => void healthQuery.refetch(), HEALTH_INTERVAL_MS)
})
onUnmounted(() => clearInterval(timer))
const clock = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU")

const id = ref("")
const url = ref("")
const name = ref("")
const apiKey = ref("")
const clearKey = ref(false)
const editing = ref<string | null>(null)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

const upsertMutation = useMutation<ReadonlyArray<LocalModelServer>, LocalModelInput>({
  mutation: (input) => localModelApi.upsert(input)
})
const removeMutation = useMutation<ReadonlyArray<LocalModelServer>, string>({
  mutation: (target) => localModelApi.remove(target)
})
const busy = computed(() => upsertMutation.isLoading.value || removeMutation.isLoading.value)

/** Что про сервер знает каталог харнеса: он обновляется раз в 30 минут и при старте. */
const catalogOf = (serverId: string) =>
  catalog.value?.harnesses.find((harness) => harness.id === serverId) ?? null

const reset = () => {
  id.value = ""
  url.value = ""
  name.value = ""
  apiKey.value = ""
  clearKey.value = false
  editing.value = null
}

const edit = (server: LocalModelServer) => {
  editing.value = server.id
  id.value = server.id
  url.value = server.url
  name.value = server.name === server.id ? "" : server.name
  apiKey.value = ""
  clearKey.value = false
  error.value = null
  notice.value = null
}

const refresh = async () => {
  await queryCache.invalidateQueries({ key: localModelKeys.all })
  void healthQuery.refetch()
  await queryCache.invalidateQueries({ key: applicationKeys.agentCatalog })
  void refetchCatalog()
}

const save = async () => {
  error.value = null
  notice.value = null
  try {
    await upsertMutation.mutateAsync({
      id: id.value.trim(),
      url: url.value.trim(),
      ...(name.value.trim() === "" ? {} : { name: name.value.trim() }),
      ...(apiKey.value.trim() === "" ? {} : { apiKey: apiKey.value.trim() }),
      ...(clearKey.value ? { clearKey: true } : {})
    })
    notice.value =
      "Сохранено в ~/.otbor/openai.json. Модели появятся в каталоге после следующего отчёта харнеса: перезапустите его или подождите до 30 минут."
    reset()
    await refresh()
  } catch (cause) {
    error.value = describeError(cause)
  }
}

const remove = async (target: string) => {
  error.value = null
  notice.value = null
  try {
    await removeMutation.mutateAsync(target)
    if (editing.value === target) reset()
    await refresh()
  } catch (cause) {
    error.value = describeError(cause)
  }
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Локальные модели</CardTitle>
      <CardDescription>
        Любой сервер с OpenAI-совместимым API (oMLX, LM Studio, llama.cpp, vLLM). Настройки и ключ
        хранятся локально в <code>~/.otbor/openai.json</code>, не в базе, и ключ обратно не
        показывается. Харнес читает тот же файл.
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <ul v-if="servers.length > 0" class="divide-y rounded-md border text-sm">
        <li v-for="server in servers" :key="server.id" class="flex flex-wrap items-center gap-3 p-3">
          <div class="min-w-0 flex-1">
            <div class="font-medium">
              {{ server.name }} <code class="text-xs text-muted-foreground">{{ server.id }}</code>
            </div>
            <div class="truncate font-mono text-xs text-muted-foreground">{{ server.url }}</div>
          </div>
          <Badge variant="outline">{{ server.hasKey ? "ключ задан" : "без ключа" }}</Badge>
          <Badge
            v-if="healthOf(server.id)"
            :variant="healthOf(server.id)?.ok ? 'success' : healthOf(server.id)?.alive ? 'warning' : 'destructive'"
            :title="`Проверено ${clock(healthOf(server.id)!.checkedAt)}${healthOf(server.id)?.error ? ': ' + healthOf(server.id)?.error : ''}`"
          >
            {{
              healthOf(server.id)?.ok
                ? `онлайн · ${healthOf(server.id)?.latencyMs} мс · моделей: ${healthOf(server.id)?.models}`
                : (healthOf(server.id)?.error ?? "не отвечает")
            }}
          </Badge>
          <Badge v-else variant="secondary">проверяется…</Badge>
          <Badge v-if="healthOf(server.id)?.ok && !catalogOf(server.id)" variant="secondary" title="Каталог харнеса обновляется при старте и раз в 30 минут">
            ещё не в каталоге
          </Badge>
          <Button size="sm" variant="outline" :disabled="busy" @click="edit(server)">Изменить</Button>
          <Button size="sm" variant="outline" :disabled="busy" @click="remove(server.id)">Удалить</Button>
        </li>
      </ul>
      <p v-else class="text-sm text-muted-foreground">Серверов пока нет.</p>
      <div v-if="servers.length > 0" class="flex items-center gap-3 text-xs text-muted-foreground">
        <span>Живость проверяется каждые 30 секунд, пока открыта страница.</span>
        <Button size="sm" variant="outline" :disabled="healthQuery.isLoading.value" @click="healthQuery.refetch()">
          Проверить сейчас
        </Button>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <div class="space-y-1.5">
          <Label for="local-model-id" class="text-xs text-muted-foreground">Идентификатор</Label>
          <Input
            id="local-model-id"
            v-model="id"
            :disabled="editing !== null"
            placeholder="omlx"
            autocomplete="off"
          />
        </div>
        <div class="space-y-1.5">
          <Label for="local-model-url" class="text-xs text-muted-foreground">Адрес API (с /v1)</Label>
          <Input id="local-model-url" v-model="url" placeholder="http://127.0.0.1:8000/v1" autocomplete="off" />
        </div>
        <div class="space-y-1.5">
          <Label for="local-model-name" class="text-xs text-muted-foreground">Название (необязательно)</Label>
          <Input id="local-model-name" v-model="name" placeholder="oMLX" autocomplete="off" />
        </div>
        <div class="space-y-1.5">
          <Label for="local-model-key" class="text-xs text-muted-foreground">Ключ API (необязательно)</Label>
          <Input
            id="local-model-key"
            v-model="apiKey"
            type="password"
            autocomplete="off"
            :placeholder="editing !== null ? 'Оставьте пустым, чтобы не менять' : ''"
          />
          <label v-if="editing !== null" class="flex items-center gap-2 text-xs text-muted-foreground">
            <input v-model="clearKey" type="checkbox" /> Удалить сохранённый ключ
          </label>
        </div>
      </div>

      <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
      <p v-if="notice" class="text-sm text-muted-foreground">{{ notice }}</p>

      <div class="flex gap-2">
        <Button :disabled="busy || id.trim() === '' || url.trim() === ''" @click="save">
          {{ editing !== null ? "Сохранить" : "Добавить" }}
        </Button>
        <Button v-if="editing !== null" variant="outline" :disabled="busy" @click="reset">Отмена</Button>
      </div>
    </CardContent>
  </Card>
</template>
