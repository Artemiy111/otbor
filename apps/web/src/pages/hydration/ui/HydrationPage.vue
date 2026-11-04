<script setup lang="ts">
import { computed, h, onUnmounted, ref, watch } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type {
  CrawlSchedule,
  EmployerHydrationTarget,
  HydrationTarget,
  ProxyMode,
  ScheduleRun
} from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert, DatabaseZap } from "@lucide/vue"
import { hydrationApi, hydrationKeys } from "@/entities/hydration"
import { scheduleApi, scheduleKeys } from "@/entities/schedule"
import { scheduleRunApi, scheduleRunKeys } from "@/entities/schedule-run"
import { RefreshButton } from "@/features/refresh-button"
import {
  describeError,
  formatDate,
  formatNumber,
  formatRating,
  scheduleKindLabel
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
  Input,
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
  sortableHeader
} from "@/shared/ui"
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
const vacancyRunsQuery = useQuery({
  key: () => scheduleRunKeys.list(undefined, "vacancy_hydration"),
  query: () => scheduleRunApi.list({ kind: "vacancy_hydration", limit: 10 })
})
const employerRunsQuery = useQuery({
  key: () => scheduleRunKeys.list(undefined, "employer_hydration"),
  query: () => scheduleRunApi.list({ kind: "employer_hydration", limit: 10 })
})

const stats = computed(() => statsQuery.data.value)
const hydrationSchedules = computed<ReadonlyArray<CrawlSchedule>>(() =>
  (schedulesQuery.data.value ?? []).filter(
    (schedule) => schedule.kind === "vacancy_hydration" || schedule.kind === "employer_hydration"
  )
)
const vacancySchedule = computed(() =>
  hydrationSchedules.value.find((schedule) => schedule.kind === "vacancy_hydration")
)
const employerSchedule = computed(() =>
  hydrationSchedules.value.find((schedule) => schedule.kind === "employer_hydration")
)
const vacancyTargets = computed(() => vacancyTargetsQuery.data.value ?? [])
const employerTargets = computed(() => employerTargetsQuery.data.value ?? [])
const runItems = (query: typeof vacancyRunsQuery): ReadonlyArray<ScheduleRun> =>
  ((query.data.value as { items?: ReadonlyArray<ScheduleRun> } | undefined)?.items ?? [])
const hydrationRuns = computed<ReadonlyArray<ScheduleRun>>(() =>
  [...runItems(vacancyRunsQuery), ...runItems(employerRunsQuery)]
    .sort((left, right) => +new Date(right.startedAt) - +new Date(left.startedAt))
    .slice(0, 20)
)
const proxyStatus = computed(() => proxyStatusQuery.data.value)

const normalizeProxyMode = (value: unknown): ProxyMode =>
  value === "direct" || value === "proxy" ? value : "auto"

const scheduleProxyMode = (schedule: CrawlSchedule): ProxyMode =>
  normalizeProxyMode(schedule.options.proxyMode)

const manualProxyMode = ref<ProxyMode>("auto")
const proxyModeLabel = (mode: ProxyMode): string =>
  mode === "direct"
    ? "Напрямую"
    : mode === "proxy"
      ? "Только через прокси"
      : "Авто (прокси, если настроен)"
const effectiveProxyLabel = (mode: ProxyMode): string => {
  if (mode === "direct") return "напрямую"
  const status = proxyStatus.value
  if (status?.configured) return status.label
  return mode === "proxy" ? "не настроен" : "напрямую"
}
const runDetailRecord = (run: ScheduleRun): Record<string, unknown> => {
  const detail = run.detail as Record<string, unknown> | null | undefined
  return detail ?? {}
}
// Matches the worker sweeper: a long crawl or hydration pass is still healthy.
const isStaleRun = (run: ScheduleRun) =>
  run.status === "running" && Date.now() - new Date(run.startedAt).getTime() > 45 * 60_000
const activeRuns = computed(() => hydrationRuns.value.filter((run) => run.status === "running"))
const hasFreshActiveRun = computed(() => activeRuns.value.some((run) => !isStaleRun(run)))
const elapsedLabel = (startedAt: string): string => {
  const millis = Math.max(0, Date.now() - new Date(startedAt).getTime())
  const minutes = Math.floor(millis / 60_000)
  return minutes >= 1 ? `${minutes} мин` : `${Math.floor(millis / 1000)} сек`
}

let runsPollTimer: ReturnType<typeof setInterval> | null = null
const stopRunsPolling = () => {
  if (runsPollTimer !== null) {
    clearInterval(runsPollTimer)
    runsPollTimer = null
  }
}
const startRunsPolling = () => {
  if (runsPollTimer !== null) return
  runsPollTimer = setInterval(() => {
    void refetch(vacancyRunsQuery)
    void refetch(employerRunsQuery)
  }, 2_000)
}
watch(hasFreshActiveRun, (active) => {
  if (active) startRunsPolling()
  else stopRunsPolling()
}, { immediate: true })

const isRefreshing = computed(
  () =>
    statsQuery.isPending.value ||
    vacancyTargetsQuery.isPending.value ||
    employerTargetsQuery.isPending.value ||
    schedulesQuery.isPending.value ||
    proxyStatusQuery.isPending.value ||
    vacancyRunsQuery.isPending.value ||
    employerRunsQuery.isPending.value
)

const refetch = (query: { refetch?: () => void }) => query.refetch?.()
const refreshAll = () => {
  void refetch(statsQuery)
  void refetch(vacancyTargetsQuery)
  void refetch(employerTargetsQuery)
  void refetch(schedulesQuery)
  void refetch(proxyStatusQuery)
  void refetch(vacancyRunsQuery)
  void refetch(employerRunsQuery)
}

const invalidateHydration = async () => {
  await queryCache.invalidateQueries({ key: hydrationKeys.all })
}

const hydratingIds = ref(new Set<string>())
const notice = ref<string | null>(null)
const actionError = ref<string | null>(null)
const noticeTone = ref<"info" | "warning">("info")
const confirmDeleteKind = ref<HydrationKind | null>(null)

const hydrateOne = async (kind: HydrationKind, id: string) => {
  actionError.value = null
  notice.value = null
  hydratingIds.value = new Set([...hydratingIds.value, id])
  try {
    const result = kind === "vacancy"
      ? await hydrationApi.hydrateVacancy(id, manualProxyMode.value)
      : await hydrationApi.hydrateEmployer(id, manualProxyMode.value)
    noticeTone.value = result.hydrated ? "info" : "warning"
    notice.value = result.hydrated
      ? kind === "vacancy"
        ? "Вакансия гидратирована."
        : "Профиль компании обновлён."
      : "Не получилось. Проверьте доступ к hh.ru или попробуйте позже."
    await invalidateHydration()
  } catch (error) {
    actionError.value = describeError(error)
  } finally {
    const next = new Set(hydratingIds.value)
    next.delete(id)
    hydratingIds.value = next
  }
}
const isHydrating = (id: string) => hydratingIds.value.has(id)

const vacancyInterval = ref("30")
const vacancyLimit = ref("25")
const vacancyDelay = ref("1000")
const vacancyEnabled = ref(true)
const vacancyProxyMode = ref<ProxyMode>("auto")
const employerInterval = ref("30")
const employerLimit = ref("25")
const employerDelay = ref("750")
const employerEnabled = ref(true)
const employerProxyMode = ref<ProxyMode>("auto")
const vacancyFormReady = ref(false)
const employerFormReady = ref(false)

const optionString = (
  options: Record<string, unknown>,
  key: string,
  fallback: string
): string => {
  const value = options[key]
  return typeof value === "number" && Number.isFinite(value) ? String(value) : fallback
}

watch(
  hydrationSchedules,
  (schedules) => {
    const vacancy = schedules.find((schedule) => schedule.kind === "vacancy_hydration")
    const employer = schedules.find((schedule) => schedule.kind === "employer_hydration")
    if (vacancy && !vacancyFormReady.value) {
      vacancyInterval.value = String(vacancy.intervalMinutes)
      vacancyLimit.value = optionString(vacancy.options, "limit", "25")
      vacancyDelay.value = optionString(vacancy.options, "delayMs", "1000")
      vacancyEnabled.value = vacancy.enabled
      vacancyProxyMode.value = scheduleProxyMode(vacancy)
      vacancyFormReady.value = true
    }
    if (employer && !employerFormReady.value) {
      employerInterval.value = String(employer.intervalMinutes)
      employerLimit.value = optionString(employer.options, "limit", "25")
      employerDelay.value = optionString(employer.options, "delayMs", "750")
      employerEnabled.value = employer.enabled
      employerProxyMode.value = scheduleProxyMode(employer)
      employerFormReady.value = true
    }
  },
  { immediate: true }
)

const readInt = (
  raw: string,
  label: string,
  min: number,
  max: number
): number | null => {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    actionError.value = `${label}: целое число от ${min} до ${max}.`
    return null
  }
  return value
}

const scheduleFor = (kind: HydrationKind) =>
  kind === "vacancy" ? vacancySchedule.value : employerSchedule.value

const upsertMutation = useMutation<CrawlSchedule, {
  id?: string
  kind: "vacancy_hydration" | "employer_hydration"
  targetId: string
  intervalMinutes: number
  enabled: boolean
  options: Record<string, string | number>
}>({
  mutation: (input) => scheduleApi.upsert(input)
})
const runNowMutation = useMutation<{ readonly accepted: boolean }, string>({
  mutation: (id) => scheduleApi.runNow(id)
})
const removeMutation = useMutation<{ readonly deleted: boolean }, string>({
  mutation: (id) => scheduleApi.remove(id)
})

const saveSchedule = async (kind: HydrationKind) => {
  actionError.value = null
  notice.value = null

  const interval = kind === "vacancy"
    ? readInt(vacancyInterval.value, "Интервал", 5, 10_080)
    : readInt(employerInterval.value, "Интервал", 5, 10_080)
  const limit = kind === "vacancy"
    ? readInt(vacancyLimit.value, "Лимит", 1, 200)
    : readInt(employerLimit.value, "Лимит", 1, 200)
  const delayMs = kind === "vacancy"
    ? readInt(vacancyDelay.value, "Задержка", 0, 60_000)
    : readInt(employerDelay.value, "Задержка", 0, 60_000)
  if (interval === null || limit === null || delayMs === null) return

  const existing = scheduleFor(kind)
  try {
    await upsertMutation.mutateAsync({
      ...(existing === undefined ? {} : { id: existing.id }),
      kind: kind === "vacancy" ? "vacancy_hydration" : "employer_hydration",
      targetId: "global",
      intervalMinutes: interval,
      enabled: kind === "vacancy" ? vacancyEnabled.value : employerEnabled.value,
      options: {
        limit,
        delayMs,
        proxyMode: kind === "vacancy" ? vacancyProxyMode.value : employerProxyMode.value
      }
    })
    noticeTone.value = "info"
    notice.value = "Расписание сохранено. Worker подхватит его в ближайший интервал."
    await queryCache.invalidateQueries({ key: scheduleKeys.all })
    await queryCache.invalidateQueries({ key: scheduleRunKeys.all })
  } catch (error) {
    actionError.value = describeError(error)
  }
}

const runScheduleNow = async (kind: HydrationKind) => {
  const existing = scheduleFor(kind)
  if (existing === undefined) return
  actionError.value = null
  notice.value = null
  try {
    const result = await runNowMutation.mutateAsync(existing.id)
    noticeTone.value = result.accepted ? "info" : "warning"
    notice.value = result.accepted
      ? "Запуск принят: гидратация идёт в фоне."
      : "Запуск не принят."
    await queryCache.invalidateQueries({ key: scheduleRunKeys.all })
  } catch (error) {
    actionError.value = describeError(error)
  }
}

const removeSchedule = async (kind: HydrationKind) => {
  const existing = scheduleFor(kind)
  if (existing === undefined) return
  actionError.value = null
  try {
    await removeMutation.mutateAsync(existing.id)
    noticeTone.value = "info"
    notice.value = "Расписание удалено."
    confirmDeleteKind.value = null
    if (kind === "vacancy") vacancyFormReady.value = false
    else employerFormReady.value = false
    await queryCache.invalidateQueries({ key: scheduleKeys.all })
  } catch (error) {
    actionError.value = describeError(error)
  }
}

const missingLabels: Record<string, string> = {
  rating: "Рейтинг",
  siteUrl: "Сайт",
  logoUrl: "Логотип",
  industries: "Отрасли"
}
const missingText = (missing: ReadonlyArray<string>) =>
  missing.length === 0 ? "—" : missing.map((item) => missingLabels[item] ?? item).join(", ")
const runStatusVariant = (run: ScheduleRun) =>
  isStaleRun(run) ? "warning" : run.status === "done" ? "success" : run.status === "error" ? "destructive" : "info"
const runStatusLabel = (run: ScheduleRun) =>
  isStaleRun(run) ? "Завис" : run.status === "done" ? "Успешно" : run.status === "error" ? "Ошибка" : "Выполняется"
const proxyModeFromValue = (value: unknown): ProxyMode =>
  value === "direct" || value === "proxy" ? value : "auto"
const runProxySummary = (run: ScheduleRun): string => {
  const detail = runDetailRecord(run)
  const mode = proxyModeFromValue(detail.proxyMode)
  const endpoint = typeof detail.proxy === "string" ? detail.proxy : "напрямую"
  return `${proxyModeLabel(mode)} · ${endpoint}`
}
const runCurrentItem = (run: ScheduleRun): string | null => {
  const detail = runDetailRecord(run)
  const current = detail.currentTitle ?? detail.currentName
  return typeof current === "string" && current.trim() !== "" ? current.trim() : null
}
const runErrorLines = (run: ScheduleRun): ReadonlyArray<string> => {
  const detail = runDetailRecord(run)
  if (!Array.isArray(detail.errors)) return []
  return detail.errors
    .filter((item): item is string => typeof item === "string" && item.trim() !== "")
    .slice(0, 2)
}
const blockLabels: Record<string, string> = {
  captcha: "капча hh.ru",
  auth: "требование входа",
  forbidden: "HTTP 403",
  geo: "геоблок HTTP 451",
  rate_limit: "лимит запросов HTTP 429"
}
const runDetailLines = (run: ScheduleRun): ReadonlyArray<string> => {
  const detail = runDetailRecord(run)
  if (Object.keys(detail).length === 0) return ["—"]
  const processed = Number(detail.processed ?? 0)
  const target = typeof detail.target === "number" ? detail.target : null
  const successful = Number(detail.hydrated ?? detail.updated ?? 0)
  const failed = Number(detail.failed ?? 0)
  const lines = [
    `Обработано ${processed}${target === null ? "" : `/${target}`} · успешно ${successful} · ошибок ${failed}`,
    `Прокси: ${runProxySummary(run)}`
  ]
  const current = runCurrentItem(run)
  if (current !== null) lines.push(`Сейчас: ${current}`)
  const stoppedBy = typeof detail.stoppedBy === "string" ? detail.stoppedBy : null
  if (stoppedBy !== null) lines.push(`Остановлено: ${blockLabels[stoppedBy] ?? stoppedBy}`)
  const rotations = Number(detail.rotations ?? 0)
  if (rotations > 0) lines.push(`Ротаций прокси: ${rotations}`)
  const errors = runErrorLines(run)
  if (errors.length > 0) lines.push(`Ошибки: ${errors.join(" · ")}`)
  return lines
}

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
        class: "line-clamp-2 max-w-[320px] text-sm font-medium text-sky-300 underline-offset-4 hover:underline"
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
        class: "block max-w-[260px] truncate text-sm font-medium text-sky-300 underline-offset-4 hover:underline"
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

const runColumns: ColumnDef<ScheduleRun>[] = [
  {
    id: "kind",
    accessorFn: (row) => row.kind,
    header: sortableHeader<ScheduleRun>("Вид"),
    cell: ({ row }) => h("span", scheduleKindLabel(row.original.kind))
  },
  {
    accessorKey: "status",
    header: sortableHeader<ScheduleRun>("Статус"),
    cell: ({ row }) =>
      h(Badge, { variant: runStatusVariant(row.original) }, () => runStatusLabel(row.original))
  },
  {
    id: "result",
    accessorFn: (row) => runDetailLines(row).join(" "),
    header: sortableHeader<ScheduleRun>("Результат"),
    enableSorting: false,
    cell: ({ row }) =>
      h("div", {
        class: "space-y-0.5 text-xs leading-5",
        title: JSON.stringify(row.original.detail ?? {}, null, 2)
      }, runDetailLines(row.original).map((line) => h("div", { class: "whitespace-nowrap" }, line)))
  },
  {
    id: "startedAt",
    accessorFn: (row) => row.startedAt,
    header: sortableHeader<ScheduleRun>("Запущен"),
    cell: ({ row }) =>
      h("span", { class: "whitespace-nowrap text-muted-foreground" }, formatDate(row.original.startedAt))
  },
  {
    id: "error",
    accessorFn: (row) => row.error ?? "",
    header: sortableHeader<ScheduleRun>("Ошибка"),
    cell: ({ row }) =>
      row.original.error
        ? h("span", {
            class: "block max-w-[280px] truncate text-xs text-destructive",
            title: row.original.error
          }, row.original.error)
        : h("span", { class: "text-muted-foreground" }, "—")
  }
]

const isSaving = computed(() => upsertMutation.isLoading.value)
const isRunning = computed(() => runNowMutation.isLoading.value)
const isDeleting = computed(() => removeMutation.isLoading.value)
const runsPending = computed(
  () => vacancyRunsQuery.isPending.value || employerRunsQuery.isPending.value
)
const vacancyTargetsPending = computed(() => vacancyTargetsQuery.isPending.value)
const employerTargetsPending = computed(() => employerTargetsQuery.isPending.value)

onUnmounted(stopRunsPolling)
</script>

<template>
  <section>
    <PageHeader
      title="Гидратация"
      description="Полные описания вакансий и профили компаний: что осталось дозагрузить, что можно обновить вручную и что делают расписания."
    >
      <template #actions>
        <RefreshButton :loading="isRefreshing" @refresh="refreshAll" />
      </template>
    </PageHeader>

    <Alert v-if="actionError" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось выполнить действие</AlertTitle>
      <AlertDescription>{{ actionError }}</AlertDescription>
    </Alert>
    <Alert v-if="notice" :variant="noticeTone" class="mb-4">
      <CircleAlert />
      <AlertTitle>{{ noticeTone === "warning" ? "Обратите внимание" : "Готово" }}</AlertTitle>
      <AlertDescription>{{ notice }}</AlertDescription>
    </Alert>

    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
      <StatCard label="Вакансий" :value="stats ? formatNumber(stats.vacancyTotal) : '—'" :hint="`${stats?.vacancyFull ?? 0} с полным описанием`" />
      <StatCard label="Нужна гидратация" :value="stats ? formatNumber(stats.vacancyStub) : '—'" :hint="`${hydrationPercent}% корпуса готово`" />
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
            <AlertDescription>Установите proxy через CLI или переключите режим на «Авто»/«Напрямую».</AlertDescription>
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
            Без прокси запросы идут напрямую. Если hh.ru блокирует IP, запустите <code>otbor proxy set</code>.
          </p>
        </div>
      </CardContent>
    </Card>

    <Tabs default-value="vacancies">
      <TabsList>
        <TabsTrigger value="vacancies">Вакансии</TabsTrigger>
        <TabsTrigger value="employers">Компании</TabsTrigger>
        <TabsTrigger value="automation">Автоматизация</TabsTrigger>
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

      <TabsContent value="automation" class="space-y-4">
        <Card v-if="activeRuns.length > 0" class="border-sky-500/30">
          <CardHeader>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Идёт гидратация</CardTitle>
                <CardDescription>Обновляется каждые 2 секунды, пока нет свежих активных запусков.</CardDescription>
              </div>
              <Badge variant="info">{{ activeRuns.length }} активно</Badge>
            </div>
          </CardHeader>
          <CardContent class="space-y-3">
            <div
              v-for="run in activeRuns"
              :key="run.id"
              class="rounded-lg border border-sky-500/20 bg-sky-500/5 p-4"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p class="text-sm font-medium">{{ scheduleKindLabel(run.kind) }}</p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    Запущен {{ formatDate(run.startedAt) }} · идёт {{ elapsedLabel(run.startedAt) }}
                  </p>
                </div>
                <Badge variant="info">{{ runStatusLabel(run) }}</Badge>
              </div>
              <Alert v-if="isStaleRun(run)" variant="warning" class="mt-3">
                <CircleAlert />
                <AlertTitle>Запуск давно не обновляется</AlertTitle>
                <AlertDescription>Worker, скорее всего, остановился до завершения. Данные можно запустить заново.</AlertDescription>
              </Alert>
              <div class="mt-3 space-y-1 text-xs">
                <p v-for="line in runDetailLines(run)" :key="line" class="text-muted-foreground">{{ line }}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <div class="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Гидратация вакансий</CardTitle>
              <CardDescription>За один проход worker берёт ограниченную порцию stub-вакансий.</CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div class="space-y-2">
                  <Label for="vacancy-interval">Интервал, мин</Label>
                  <Input id="vacancy-interval" v-model="vacancyInterval" type="number" min="5" step="1" />
                </div>
                <div class="space-y-2">
                  <Label for="vacancy-limit">Лимит вакансий</Label>
                  <Input id="vacancy-limit" v-model="vacancyLimit" type="number" min="1" max="200" step="1" />
                </div>
                <div class="space-y-2">
                  <Label for="vacancy-delay">Задержка, мс</Label>
                  <Input id="vacancy-delay" v-model="vacancyDelay" type="number" min="0" max="60000" step="1" />
                </div>
                <div class="space-y-2">
                  <Label for="vacancy-proxy">Прокси</Label>
                  <Select :model-value="vacancyProxyMode" @update:model-value="(value) => (vacancyProxyMode = value as ProxyMode)">
                    <SelectTrigger id="vacancy-proxy"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Авто</SelectItem>
                      <SelectItem value="direct">Напрямую</SelectItem>
                      <SelectItem value="proxy">Только прокси</SelectItem>
                    </SelectContent>
                  </Select>
                  <p class="text-xs text-muted-foreground">Сейчас: {{ effectiveProxyLabel(vacancyProxyMode) }}</p>
                </div>
              </div>
              <Label class="flex items-center gap-2 font-normal">
                <input v-model="vacancyEnabled" type="checkbox" class="size-4 accent-primary" />
                Расписание включено
              </Label>
              <div class="flex flex-wrap gap-2">
                <Button :disabled="isSaving" @click="saveSchedule('vacancy')">
                  {{ vacancySchedule ? "Сохранить настройки" : "Создать расписание" }}
                </Button>
                <Button v-if="vacancySchedule" variant="secondary" :disabled="isRunning" @click="runScheduleNow('vacancy')">Запустить сейчас</Button>
                <Button v-if="vacancySchedule && confirmDeleteKind !== 'vacancy'" variant="ghost" @click="confirmDeleteKind = 'vacancy'">Удалить</Button>
                <template v-if="confirmDeleteKind === 'vacancy'">
                  <Button variant="destructive" :disabled="isDeleting" @click="removeSchedule('vacancy')">Да, удалить</Button>
                  <Button variant="outline" @click="confirmDeleteKind = null">Отмена</Button>
                </template>
              </div>
              <p v-if="vacancySchedule" class="text-xs text-muted-foreground">
                Последний запуск: {{ formatDate(vacancySchedule.lastRunAt) }} · следующий: {{ formatDate(vacancySchedule.nextRunAt) }}<br />
                Прокси: {{ proxyModeLabel(scheduleProxyMode(vacancySchedule)) }} · {{ effectiveProxyLabel(scheduleProxyMode(vacancySchedule)) }}
              </p>
              <Alert v-if="vacancySchedule?.lastError" variant="destructive">
                <CircleAlert /><AlertTitle>Последняя ошибка</AlertTitle><AlertDescription>{{ vacancySchedule.lastError }}</AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Обновление компаний</CardTitle>
              <CardDescription>Недостающие рейтинг, сайт, логотип и отрасли подтягиваются с hh.ru.</CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div class="space-y-2">
                  <Label for="employer-interval">Интервал, мин</Label>
                  <Input id="employer-interval" v-model="employerInterval" type="number" min="5" step="1" />
                </div>
                <div class="space-y-2">
                  <Label for="employer-limit">Лимит компаний</Label>
                  <Input id="employer-limit" v-model="employerLimit" type="number" min="1" max="200" step="1" />
                </div>
                <div class="space-y-2">
                  <Label for="employer-delay">Задержка, мс</Label>
                  <Input id="employer-delay" v-model="employerDelay" type="number" min="0" max="60000" step="1" />
                </div>
                <div class="space-y-2">
                  <Label for="employer-proxy">Прокси</Label>
                  <Select :model-value="employerProxyMode" @update:model-value="(value) => (employerProxyMode = value as ProxyMode)">
                    <SelectTrigger id="employer-proxy"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Авто</SelectItem>
                      <SelectItem value="direct">Напрямую</SelectItem>
                      <SelectItem value="proxy">Только прокси</SelectItem>
                    </SelectContent>
                  </Select>
                  <p class="text-xs text-muted-foreground">Сейчас: {{ effectiveProxyLabel(employerProxyMode) }}</p>
                </div>
              </div>
              <Label class="flex items-center gap-2 font-normal">
                <input v-model="employerEnabled" type="checkbox" class="size-4 accent-primary" />
                Расписание включено
              </Label>
              <div class="flex flex-wrap gap-2">
                <Button :disabled="isSaving" @click="saveSchedule('employer')">
                  {{ employerSchedule ? "Сохранить настройки" : "Создать расписание" }}
                </Button>
                <Button v-if="employerSchedule" variant="secondary" :disabled="isRunning" @click="runScheduleNow('employer')">Запустить сейчас</Button>
                <Button v-if="employerSchedule && confirmDeleteKind !== 'employer'" variant="ghost" @click="confirmDeleteKind = 'employer'">Удалить</Button>
                <template v-if="confirmDeleteKind === 'employer'">
                  <Button variant="destructive" :disabled="isDeleting" @click="removeSchedule('employer')">Да, удалить</Button>
                  <Button variant="outline" @click="confirmDeleteKind = null">Отмена</Button>
                </template>
              </div>
              <p v-if="employerSchedule" class="text-xs text-muted-foreground">
                Последний запуск: {{ formatDate(employerSchedule.lastRunAt) }} · следующий: {{ formatDate(employerSchedule.nextRunAt) }}<br />
                Прокси: {{ proxyModeLabel(scheduleProxyMode(employerSchedule)) }} · {{ effectiveProxyLabel(scheduleProxyMode(employerSchedule)) }}
              </p>
              <Alert v-if="employerSchedule?.lastError" variant="destructive">
                <CircleAlert /><AlertTitle>Последняя ошибка</AlertTitle><AlertDescription>{{ employerSchedule.lastError }}</AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>История запусков</CardTitle>
            <CardDescription>Последние прогоны гидратации вакансий и компаний.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              :columns="runColumns"
              :data="hydrationRuns"
              :is-loading="runsPending"
              :loading-row-count="5"
              :row-numbers="false"
              filter
              filter-label="Поиск"
              filter-placeholder="Вид, статус или ошибка"
              empty-title="Запусков пока нет"
              empty-description="Создайте расписание выше или нажмите «Запустить сейчас»."
            />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  </section>
</template>
