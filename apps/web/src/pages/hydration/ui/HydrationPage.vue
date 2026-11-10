<script setup lang="ts">
import { computed, h, ref } from "vue"
import { useQuery, useQueryCache } from "@pinia/colada"
import { useIntervalFn } from "@vueuse/core"
import type {
  EmployerHydrationTarget,
  HydrationTarget,
  ProxyMode
} from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import { hydrationApi, hydrationKeys } from "@/entities/hydration"
import { scheduleApi, scheduleKeys, scheduleStateLine } from "@/entities/schedule"
import { RefreshButton } from "@/features/refresh-button"
import {
  describeError,
  formatDate,
  formatNumber,
  formatRating
} from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  sortableHeader,
  useToast
} from "@/shared/ui"
import AnalysisInsightsPanel from "./AnalysisInsightsPanel.vue"
import { PageHeader } from "@/widgets/page-header"
import { StatCard } from "@/widgets/stat-card"

type HydrationKind = "vacancy" | "employer"

const queryCache = useQueryCache()
const statsQuery = useQuery({
  key: () => hydrationKeys.stats(),
  query: () => hydrationApi.stats()
})
const proxyStatusQuery = useQuery({
  key: () => hydrationKeys.proxyStatus(),
  query: () => hydrationApi.proxyStatus()
})
const vacancyTargetsQuery = useQuery({
  key: () => hydrationKeys.vacancyTargets(),
  query: () => hydrationApi.vacancyTargets({ limit: 25 })
})
const employerTargetsQuery = useQuery({
  key: () => hydrationKeys.employerTargets(),
  query: () => hydrationApi.employerTargets({ limit: 25 })
})
const schedulesQuery = useQuery({
  key: () => scheduleKeys.list(),
  query: () => scheduleApi.list()
})

const stats = computed(() => statsQuery.data.value)
const vacancySchedule = computed(() =>
  (schedulesQuery.data.value ?? []).find((schedule) => schedule.kind === "vacancy_hydration")
)
const employerSchedule = computed(() =>
  (schedulesQuery.data.value ?? []).find((schedule) => schedule.kind === "employer_hydration")
)
const vacancyTargets = computed(() => vacancyTargetsQuery.data.value ?? [])
const employerTargets = computed(() => employerTargetsQuery.data.value ?? [])
const proxyStatus = computed(() => proxyStatusQuery.data.value)

/** Расписания живут на странице «Расписания»; здесь только их состояние. */
const now = ref(Date.now())
useIntervalFn(() => {
  now.value = Date.now()
  if (!document.hidden) void schedulesQuery.refetch()
}, 20_000)
const vacancyLine = computed(() => scheduleStateLine("Вакансии", vacancySchedule.value, now.value))
const employerLine = computed(() => scheduleStateLine("Компании", employerSchedule.value, now.value))

const manualProxyMode = ref<ProxyMode>("auto")
const effectiveProxyLabel = (mode: ProxyMode): string => {
  if (mode === "direct") return "напрямую"
  const status = proxyStatus.value
  if (status?.configured) return status.label
  return mode === "proxy" ? "не настроен" : "напрямую"
}

const isRefreshing = computed(
  () =>
    statsQuery.isPending.value ||
    vacancyTargetsQuery.isPending.value ||
    employerTargetsQuery.isPending.value ||
    schedulesQuery.isPending.value ||
    proxyStatusQuery.isPending.value
)

const refetch = (query: { refetch?: () => void }) => query.refetch?.()
const refreshAll = () => {
  void refetch(statsQuery)
  void refetch(vacancyTargetsQuery)
  void refetch(employerTargetsQuery)
  void refetch(schedulesQuery)
  void refetch(proxyStatusQuery)
}


const invalidateHydration = async () => {
  await queryCache.invalidateQueries({ key: hydrationKeys.all })
}

const hydratingIds = ref(new Set<string>())
const toast = useToast()

const hydrateOne = async (kind: HydrationKind, id: string) => {
  hydratingIds.value = new Set([...hydratingIds.value, id])
  try {
    const result = kind === "vacancy"
      ? await hydrationApi.hydrateVacancy(id, manualProxyMode.value)
      : await hydrationApi.hydrateEmployer(id, manualProxyMode.value)
    if (result.hydrated) toast.success(kind === "vacancy" ? "Вакансия догружена" : "Профиль компании обновлён")
    else toast.warning("Не получилось догрузить", { description: "Проверьте доступ к hh.ru или попробуйте позже." })
    await invalidateHydration()
  } catch (error) {
    toast.error("Не удалось догрузить", { description: describeError(error) })
  } finally {
    const next = new Set(hydratingIds.value)
    next.delete(id)
    hydratingIds.value = next
  }
}
const isHydrating = (id: string) => hydratingIds.value.has(id)

const missingLabels: Record<string, string> = {
  rating: "Рейтинг",
  siteUrl: "Сайт",
  logoUrl: "Логотип",
  industries: "Отрасли"
}
const missingText = (missing: ReadonlyArray<string>) =>
  missing.length === 0 ? "—" : missing.map((item) => missingLabels[item] ?? item).join(", ")
const hydrationPercent = computed(() => {
  const total = stats.value?.vacancyTotal ?? 0
  return total === 0 ? 0 : Math.round(((stats.value?.vacancyFull ?? 0) / total) * 100)
})

const vacancyColumns: ColumnDef<HydrationTarget>[] = [
  {
    id: "title",
    accessorFn: (row) => row.title,
    header: sortableHeader<HydrationTarget>("Вакансия"),
    cell: ({ row }) =>
      h("a", {
        href: `/vacancies/${row.original.id}`,
        class: "line-clamp-2 max-w-[320px] text-sm font-medium text-info underline-offset-4 hover:underline"
      }, row.original.title)
  },
  {
    id: "employer",
    accessorFn: (row) => row.employerName ?? "",
    header: sortableHeader<HydrationTarget>("Компания"),
    cell: ({ row }) =>
      h("span", { class: "block max-w-[180px] truncate text-xs" }, row.original.employerName ?? "—")
  },
  {
    accessorKey: "areaName",
    header: sortableHeader<HydrationTarget>("Район"),
    cell: ({ row }) => h("span", row.original.areaName ?? "—")
  },
  {
    id: "publishedAt",
    accessorFn: (row) => row.publishedAt ?? "",
    header: sortableHeader<HydrationTarget>("Опубликована"),
    cell: ({ row }) =>
      h("span", { class: "whitespace-nowrap text-muted-foreground" }, formatDate(row.original.publishedAt))
  },
  {
    accessorKey: "descriptionLength",
    header: sortableHeader<HydrationTarget>("Символов"),
    cell: ({ row }) => h("span", { class: "tabular-nums" }, formatNumber(row.original.descriptionLength))
  },
  {
    id: "actions",
    enableSorting: false,
    enableGlobalFilter: false,
    header: "Действия",
    cell: ({ row }) =>
      h(Button, {
        size: "sm",
        variant: "secondary",
        disabled: isHydrating(row.original.id),
        onClick: () => void hydrateOne("vacancy", row.original.id)
      }, () => (isHydrating(row.original.id) ? "Гидратирую…" : "Гидратировать"))
  }
]

const employerColumns: ColumnDef<EmployerHydrationTarget>[] = [
  {
    accessorKey: "name",
    header: sortableHeader<EmployerHydrationTarget>("Компания"),
    cell: ({ row }) =>
      h("a", {
        href: `/companies/${row.original.id}`,
        class: "block max-w-[260px] truncate text-sm font-medium text-info underline-offset-4 hover:underline"
      }, row.original.name)
  },
  {
    id: "rating",
    accessorFn: (row) => row.rating ?? -1,
    header: sortableHeader<EmployerHydrationTarget>("Рейтинг"),
    cell: ({ row }) =>
      h("span", { class: "tabular-nums" }, row.original.rating === null
        ? "—"
        : `${formatRating(row.original.rating)} (${row.original.reviewsCount ?? 0})`)
  },
  {
    accessorKey: "vacancyCount",
    header: sortableHeader<EmployerHydrationTarget>("Вакансий"),
    cell: ({ row }) => h("span", { class: "tabular-nums" }, formatNumber(row.original.vacancyCount))
  },
  {
    id: "updatedAt",
    accessorFn: (row) => row.updatedAt,
    header: sortableHeader<EmployerHydrationTarget>("Обновлена"),
    cell: ({ row }) =>
      h("span", { class: "whitespace-nowrap text-muted-foreground" }, formatDate(row.original.updatedAt))
  },
  {
    id: "missing",
    accessorFn: (row) => row.missing.join(" "),
    header: sortableHeader<EmployerHydrationTarget>("Не хватает"),
    cell: ({ row }) =>
      h("span", { class: "text-xs text-muted-foreground" }, missingText(row.original.missing))
  },
  {
    id: "actions",
    enableSorting: false,
    enableGlobalFilter: false,
    header: "Действия",
    cell: ({ row }) =>
      h(Button, {
        size: "sm",
        variant: "secondary",
        disabled: isHydrating(row.original.id),
        onClick: () => void hydrateOne("employer", row.original.id)
      }, () => (isHydrating(row.original.id) ? "Обновляю…" : "Обновить"))
  }
]


const vacancyTargetsPending = computed(() => vacancyTargetsQuery.isPending.value)
const employerTargetsPending = computed(() => employerTargetsQuery.isPending.value)
</script>

<template>
  <section>
    <PageHeader
      title="Догрузка данных"
      description="Полные описания вакансий и профили компаний: что осталось дозагрузить, что можно обновить вручную и когда это происходит само."
    >
      <template #actions>
        <RefreshButton :loading="isRefreshing" @refresh="refreshAll" />
      </template>
    </PageHeader>

    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
      <StatCard label="Вакансий" :value="stats ? formatNumber(stats.vacancyTotal) : '—'" :hint="`${stats?.vacancyFull ?? 0} с полным описанием`" />
      <StatCard label="Нужна догрузка" :value="stats ? formatNumber(stats.vacancyStub) : '—'" :hint="`${hydrationPercent}% корпуса готово`" />
      <StatCard label="Компаний" :value="stats ? formatNumber(stats.employerTotal) : '—'" :hint="`${stats?.employersLinked ?? 0} привязано к вакансиям`" />
      <StatCard label="Без рейтинга" :value="stats ? formatNumber(stats.employersWithoutRating) : '—'" hint="нет данных hh" />
      <StatCard label="Без сайта" :value="stats ? formatNumber(stats.employersWithoutSite) : '—'" hint="нечего открыть для проверки" />
      <StatCard label="Старше 30 дней" :value="stats ? formatNumber(stats.employersStale30Days) : '—'" hint="профили давно не обновлялись" />
      <StatCard
        label="Ждут повтора"
        :value="stats ? formatNumber(stats.deferredVacancies + stats.deferredEmployers) : '—'"
        :hint="stats ? `вакансии ${stats.deferredVacancies} · компании ${stats.deferredEmployers}` : 'после ошибок'"
      />
      <StatCard
        label="Проблемные"
        :value="stats ? formatNumber(stats.poisonedTargets) : '—'"
        :hint="stats?.nextRetryAt ? `ближайший повтор ${formatDate(stats.nextRetryAt)}` : 'нет отложенных'"
      />
    </div>

    <Alert v-if="(stats?.poisonedTargets ?? 0) > 0" variant="warning" class="mb-4">
      <CircleAlert />
      <AlertTitle>{{ stats?.poisonedTargets }} целей падают больше пяти раз подряд</AlertTitle>
      <AlertDescription>
        Они не блокируют очередь: повтор раз в сутки. Проверьте ошибки в истории запусков — обычно это чужая страница,
        удалённая вакансия или блокировка hh.ru.
      </AlertDescription>
    </Alert>

    <Card class="mb-4">
      <CardHeader>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Прокси для hh.ru</CardTitle>
            <CardDescription>
              Применяется к загрузке вакансий и профилей компаний. Секреты proxy не показываются.
            </CardDescription>
          </div>
          <Badge :variant="proxyStatus?.configured ? 'success' : 'warning'">
            {{ proxyStatus?.configured ? 'Прокси настроен' : 'Прокси не настроен' }}
          </Badge>
        </div>
      </CardHeader>
      <CardContent class="grid gap-6 md:grid-cols-2">
        <div class="space-y-2">
          <Label for="manual-proxy">Режим для ручных действий</Label>
          <Select :model-value="manualProxyMode" @update:model-value="(value) => (manualProxyMode = value as ProxyMode)">
            <SelectTrigger id="manual-proxy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Авто — прокси, если настроен</SelectItem>
              <SelectItem value="direct">Напрямую</SelectItem>
              <SelectItem value="proxy">Только через прокси</SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">
            Сейчас будет использовано: {{ effectiveProxyLabel(manualProxyMode) }}
          </p>
          <Alert v-if="manualProxyMode === 'proxy' && !proxyStatus?.configured" variant="warning" class="mt-2">
            <CircleAlert />
            <AlertTitle>Прокси не настроен</AlertTitle>
            <AlertDescription>Настройте прокси в «Настройках» или переключите режим на «Авто»/«Напрямую».</AlertDescription>
          </Alert>
        </div>
        <div class="space-y-2">
          <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Глобальная настройка</p>
          <p class="text-sm font-medium">
            {{ proxyStatus?.configured ? proxyStatus.label : 'Прокси не настроен' }}
          </p>
          <p v-if="proxyStatus?.configured" class="text-xs text-muted-foreground">
            Источник: {{ proxyStatus.source === 'subscription' ? 'подписка' : 'готовый адрес' }}
            · откуда: {{ proxyStatus.origin === 'env' ? 'environment' : 'файл' }}
            · ротация: {{ proxyStatus.rotate === 'captcha' ? `при капче, до ${proxyStatus.maxRotations ?? 0}` : 'выключена' }}
          </p>
          <p v-else class="text-xs text-muted-foreground">
            Без прокси запросы идут напрямую. Если hh.ru блокирует IP, настройте прокси в «Настройках».
          </p>
        </div>
      </CardContent>
    </Card>

    <div class="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg border bg-card px-4 py-3 text-sm" data-testid="hydration-schedules">
      <div class="min-w-0 space-y-0.5">
        <p>{{ vacancyLine }}</p>
        <p>{{ employerLine }}</p>
      </div>
      <a href="/schedules?kind=vacancy_hydration,employer_hydration" class="shrink-0 text-primary underline-offset-4 hover:underline">
        Расписания догрузки →
      </a>
    </div>

    <Tabs default-value="vacancies">
      <TabsList>
        <TabsTrigger value="vacancies">Вакансии</TabsTrigger>
        <TabsTrigger value="employers">Компании</TabsTrigger>
        <TabsTrigger value="analysis">Анализ</TabsTrigger>
      </TabsList>

      <TabsContent value="vacancies">
        <Card>
          <CardHeader>
            <CardTitle>Вакансии без полного описания</CardTitle>
            <CardDescription>
              Worker загружает страницу вакансии и сохраняет полный текст. Здесь — 25 самых свежие цели.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              :columns="vacancyColumns"
              :data="vacancyTargets"
              :is-loading="vacancyTargetsPending"
              :loading-row-count="6"
              :row-numbers="false"
              filter
              filter-label="Поиск"
              filter-placeholder="Должность, компания или район"
              empty-title="Всё гидратировано"
              empty-description="Вакансии без полного описания закончились. Worker можно отправить на следующий проход расписанием."
            />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="analysis">
        <AnalysisInsightsPanel />
      </TabsContent>

      <TabsContent value="employers">
        <Card>
          <CardHeader>
            <CardTitle>Профили компаний, которые пора освежить</CardTitle>
            <CardDescription>
              Только компании с вакансиями в корпусе, самые старые профили первыми. Нехватка данных указана явно.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              :columns="employerColumns"
              :data="employerTargets"
              :is-loading="employerTargetsPending"
              :loading-row-count="6"
              :row-numbers="false"
              filter
              filter-label="Поиск"
              filter-placeholder="Название компании или отрасль"
              empty-title="Компаний пока нет"
              empty-description="Сначала hh.ru должен найти вакансии в корпусе; профили компаний появятся после этого."
            />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  </section>
</template>
