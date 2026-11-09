<script setup lang="ts">
import { useQuery } from "@pinia/colada"
import { useIntervalFn } from "@vueuse/core"
import { CircleAlert } from "@lucide/vue"
import { healthApi, healthKeys } from "@/entities/health"
import { RefreshButton } from "@/features/refresh-button"
import { apiEndpoint } from "@/shared/api"
import { describeError, formatDate } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  StatusBadge
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import { StatCard } from "@/widgets/stat-card"

const query = useQuery({
  key: healthKeys.current(),
  query: healthApi.get
})

/** Связь с локальной моделью проверяется постоянно: раз в 15 секунд, пока страница открыта. */
useIntervalFn(() => void query.refetch(), 15_000)
</script>

<template>
  <section>
    <PageHeader title="Здоровье" description="Состояние RPC-сервера облака, базы данных, харнессов и локальной модели анализа.">
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
      </template>
    </PageHeader>

    <Alert v-if="query.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>RPC недоступен</AlertTitle>
      <AlertDescription>
        <p>{{ describeError(query.error.value) }}</p>
        <p class="mt-1 text-xs opacity-80">
          Запустите сервер командой <code>bun run server</code>.
        </p>
      </AlertDescription>
    </Alert>

    <div v-if="query.isPending.value" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Skeleton v-for="index in 4" :key="index" class="h-24 w-full" />
    </div>

    <div v-else-if="query.data.value" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Статус">
        <StatusBadge :value="query.data.value.status" raw />
      </StatCard>
      <StatCard label="База данных">
        <StatusBadge :value="query.data.value.database ? 'ok' : 'down'" raw />
      </StatCard>
      <StatCard label="Версия" :value="query.data.value.version" mono />
      <StatCard label="Время сервера" :value="formatDate(query.data.value.now)" />
    </div>

    <Card v-if="query.data.value" class="mt-4">
      <CardHeader>
        <CardTitle>Харнессы</CardTitle>
        <CardDescription>
          Браузерный harness выполняет задачи на hh.ru: загрузку резюме, формы, отправку. Онлайн, если опрашивал сервер за последние 2 минуты.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-2">
        <Alert v-if="!(query.data.value.harnesses ?? []).some((h) => h.online && h.kinds.includes('browser'))" variant="destructive">
          <CircleAlert />
          <AlertTitle>Браузерный harness не запущен</AlertTitle>
          <AlertDescription>
            Загрузка резюме, формы откликов и отправка не работают. Запустите <code>otbor harness run</code>.
          </AlertDescription>
        </Alert>
        <div
          v-for="h in query.data.value.harnesses ?? []"
          :key="h.id"
          class="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm"
        >
          <StatusBadge :value="h.online ? 'ok' : 'down'" raw />
          <span class="font-medium">{{ h.name }}</span>
          <span class="text-muted-foreground">{{ h.kinds.join(", ") }}</span>
          <span class="text-muted-foreground">
            {{ h.lastSeenAt ? `последний опрос ${formatDate(h.lastSeenAt)}` : "ещё не опрашивал" }}
          </span>
        </div>
        <p v-if="!(query.data.value.harnesses ?? []).length" class="text-sm text-muted-foreground">
          Ни один harness не зарегистрирован.
        </p>
      </CardContent>
    </Card>

    <Card v-if="query.data.value?.systemOne" class="mt-4">
      <CardHeader>
        <CardTitle>Локальная модель анализа</CardTitle>
        <CardDescription>
          SystemOne разбирает вакансии (уровень, роль, условия). Без неё правила по <code>analysis_*</code> отсекают
          неразобранные вакансии. Проверка каждые 15 секунд.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-2">
        <Alert v-if="!query.data.value.systemOne.reachable" variant="destructive">
          <CircleAlert />
          <AlertTitle>Модель анализа недоступна</AlertTitle>
          <AlertDescription>
            {{ query.data.value.systemOne.error }}. Анализ вакансий не идёт; запустите сервер модели.
          </AlertDescription>
        </Alert>
        <div class="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
          <StatusBadge :value="query.data.value.systemOne.reachable ? 'ok' : 'down'" raw />
          <span class="font-medium">{{ query.data.value.systemOne.model }}</span>
          <code class="text-xs text-muted-foreground">{{ query.data.value.systemOne.endpoint }}</code>
          <span v-if="query.data.value.systemOne.latencyMs !== null && query.data.value.systemOne.reachable" class="text-muted-foreground">
            ответ за {{ query.data.value.systemOne.latencyMs }} мс
          </span>
        </div>
      </CardContent>
    </Card>

    <Card class="mt-4">
      <CardHeader>
        <CardTitle>Подключение</CardTitle>
        <CardDescription>
          Тот же путь RPC, что у CLI. В разработке запрос проксируется на локальный сервер.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <code class="block truncate rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
          {{ apiEndpoint }}
        </code>
      </CardContent>
    </Card>
  </section>
</template>
