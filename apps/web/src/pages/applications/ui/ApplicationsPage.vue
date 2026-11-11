<script setup lang="ts">
import { computed, h, ref, watch } from "vue"
import { useMutation, useQuery } from "@pinia/colada"
import { useDebounceFn, useIntervalFn } from "@vueuse/core"
import { BLOCKED_REASON_LABELS, type ApplicationRecord, type HhAccountRecord } from "@otbor/contract"
import type { ColumnDef, PaginationState } from "@tanstack/vue-table"
import { CircleAlert, ExternalLink, RotateCcw, Search, SkipForward, X } from "@lucide/vue"
import { resumeApi, resumeKeys } from "@/entities/resume"
import {
  APPLICATION_TABS,
  TAB_STATES,
  applicationApi,
  applicationKeys,
  applicationLinkFrom,
  filterToSearch,
  parseFilter,
  withTab,
  type ApplicationFilter,
  type ApplicationTab
} from "@/entities/application"
import {
  autoApplyApi,
  autoApplyKeys,
  employerResponse,
  humanStatus,
  HumanStatusBadge,
  modeLabel,
  modeTone,
  shortReasonLabel
} from "@/entities/auto-apply"
import { AccountChip, hhAccountColor, hhAccountName, hhAccountNameById, useAccountFilter } from "@/entities/hh-account"
import { useApplicationActions } from "@/features/application-actions"
import { RefreshButton } from "@/features/refresh-button"
import {
  applicationStateLabel,
  cn,
  describeError,
  formatAge,
  formatDate,
  locationSearch,
  plural,
  replaceSearch,
  toneClasses,
  vacancyPath
} from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const PAGE_SIZES = [25, 50, 100] as const
const REFRESH_MS = 5000

/* ---- фильтр живёт в адресе и следует за ним, пока страница открыта ----------------- */

const filter = computed<ApplicationFilter>(() => parseFilter(locationSearch.value))
const setFilter = (next: ApplicationFilter) => {
  pageIndex.value = 0
  replaceSearch(filterToSearch(next))
}

const { accounts } = useAccountFilter()
/** Без `?account=` смотрим все аккаунты: счётчики совпадают с обзором. */
const accountScope = computed(() => filter.value.account ?? "all")
const hhAccountId = computed(() => (accountScope.value === "all" ? undefined : accountScope.value))

const pageSize = ref<number>(50)
const pageIndex = ref(0)
const onPagination = (state: PaginationState) => {
  pageSize.value = state.pageSize
  pageIndex.value = state.pageIndex
}

/* ---- данные ---------------------------------------------------------------------- */

const query = useQuery({
  key: () =>
    applicationKeys.search(filterToSearch(filter.value), accountScope.value, pageIndex.value * pageSize.value, pageSize.value),
  query: () =>
    applicationApi.search({
      filter: filter.value,
      hhAccountId: hhAccountId.value,
      limit: pageSize.value,
      offset: pageIndex.value * pageSize.value
    })
})
const page = computed(() => query.data.value ?? null)
const rows = computed<ReadonlyArray<ApplicationRecord>>(() => page.value?.items ?? [])
const total = computed(() => page.value?.total ?? 0)
const capped = computed(() => page.value?.capped === true)

const count = (states: ReadonlyArray<string>): number =>
  states.reduce((sum, state) => sum + (page.value?.byState[state] ?? 0), 0)
const tabCounts = computed<Record<ApplicationTab, number | null>>(() => {
  if (page.value === null) return { attention: null, active: null, sent: null, all: null }
  return {
    attention: count(TAB_STATES.attention),
    active: count(TAB_STATES.active),
    sent: count(TAB_STATES.sent),
    all: Object.values(page.value.byState).reduce((sum, value) => sum + value, 0)
  }
})

const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })
const resumes = computed(() => resumesQuery.data.value ?? [])

/** Точный этап ждущих автооткликов отдаёт прогресс автооткликов: накладываем его на строки. */
const hasPreparing = computed(() => rows.value.some((row) => row.state === "preparing"))
const progressQuery = useQuery({
  key: () => autoApplyKeys.progress(hhAccountId.value ?? "all", true),
  query: () => autoApplyApi.progress({ hhAccountId: hhAccountId.value, limit: 200, activeOnly: true }),
  enabled: () => hasPreparing.value
})
const progressById = computed(
  () => new Map((progressQuery.data.value?.items ?? []).map((item) => [item.applicationId as string, item]))
)

/** Строки, которыми сейчас занят раннер, обновляются сами. */
const hasMoving = computed(() => rows.value.some((row) => humanStatus(row).moving))
useIntervalFn(() => {
  if (document.hidden || !hasMoving.value || query.asyncStatus.value !== "idle") return
  void query.refetch()
  if (hasPreparing.value) void progressQuery.refetch()
}, REFRESH_MS)

/* ---- вкладки и фильтры ------------------------------------------------------------- */

const activeTab = computed(() => filter.value.tab)
const onTab = (value: string | number) => setFilter(withTab(filter.value, value as ApplicationTab))

const reasonOptions = [
  { value: "all", label: "Любая причина" },
  ...Object.keys(BLOCKED_REASON_LABELS).map((code) => ({
    value: code,
    label: shortReasonLabel(code)!.replace(/^(?!hh)./, (char) => char.toUpperCase())
  }))
]
const modeOptions = [
  { value: "all", label: "Любой режим" },
  { value: "manual", label: "Вручную" },
  { value: "any_auto", label: "Любой авто" },
  { value: "drafts", label: "Черновики" },
  { value: "auto", label: "Авто" }
]
const accountOptions = computed(() => [
  { value: "all", label: "Все аккаунты", color: undefined as string | undefined },
  ...accounts.value.map((account: HhAccountRecord) => ({
    value: account.id as string,
    label: hhAccountName(account),
    color: hhAccountColor(account) as string | undefined
  }))
])

const searchText = ref(filter.value.q)
watch(
  () => filter.value.q,
  (value) => {
    if (value !== searchText.value) searchText.value = value
  }
)
const commitSearch = useDebounceFn((value: string) => setFilter({ ...filter.value, q: value.trim() }), 350)
const onSearch = (value: string | number | undefined) => {
  const text = String(value ?? "")
  searchText.value = text
  void commitSearch(text)
}

const hasSecondary = computed(
  () => filter.value.reason !== null || filter.value.mode !== null || filter.value.account !== null || filter.value.q !== ""
)
const resetFilter = () => setFilter({ tab: "all", state: null, reason: null, mode: null, account: null, q: "" })

/* ---- действия над строками --------------------------------------------------------- */

const actions = useApplicationActions()
const toast = useToast()
const busyId = ref<string | null>(null)
const confirmSkipId = ref<string | null>(null)

const runRow = async (id: string, task: () => Promise<unknown>, done: string) => {
  if (busyId.value !== null) return
  busyId.value = id
  try {
    await task()
    toast.success(done)
  } catch (cause) {
    toast.error("Не удалось выполнить действие", { description: describeError(cause) })
  } finally {
    busyId.value = null
    confirmSkipId.value = null
  }
}
const retryRow = (row: ApplicationRecord) => runRow(row.id, () => actions.retry(row.id), "Повтор запущен")
const retryLetterRow = (row: ApplicationRecord) =>
  runRow(row.id, () => actions.retryLetter(row.id), "Письмо будет написано заново на ближайшем запуске")
const skipRow = (row: ApplicationRecord) => runRow(row.id, () => actions.skip(row.id), "Отклик пропущен")

/* ---- «Повторить все» для выбранной причины ---------------------------------------- */

const retryableFilter = computed<ApplicationFilter>(() => ({ ...filter.value, tab: "attention", state: null }))
const bulkEnabled = computed(() => filter.value.reason !== null)
const bulkCountQuery = useQuery({
  key: () => ["applications", "bulk-count", filterToSearch(retryableFilter.value), accountScope.value] as const,
  query: () =>
    applicationApi.search({ filter: retryableFilter.value, hhAccountId: hhAccountId.value, limit: 1, offset: 0 }),
  enabled: () => bulkEnabled.value
})
const bulkCount = computed(() => bulkCountQuery.data.value?.total ?? 0)
const confirmBulk = ref(false)
const bulkProgress = ref<{ done: number; failed: number; of: number } | null>(null)
const bulkMutation = useMutation({
  mutation: async () => {
    const ids: Array<string> = []
    for (let offset = 0; ; offset += 200) {
      const chunk = await applicationApi.search({
        filter: retryableFilter.value,
        hhAccountId: hhAccountId.value,
        limit: 200,
        offset
      })
      ids.push(...chunk.items.map((item) => item.id as string))
      if (chunk.items.length < 200 || ids.length >= chunk.total) break
    }
    bulkProgress.value = { done: 0, failed: 0, of: ids.length }
    for (const id of ids) {
      try {
        await applicationApi.retry(id)
        bulkProgress.value = { ...bulkProgress.value!, done: bulkProgress.value!.done + 1 }
      } catch {
        bulkProgress.value = { ...bulkProgress.value!, failed: bulkProgress.value!.failed + 1 }
      }
    }
  },
  onSettled: async () => {
    confirmBulk.value = false
    await actions.invalidate()
  }
})

/* ---- подтянуть отклики, сделанные на hh.ru вручную ---------------------------------- */

const syncMessage = ref("")
const syncMutation = useMutation({
  mutation: async () => {
    const targets = hhAccountId.value ? [hhAccountId.value] : accounts.value.map((a) => a.id as string)
    const lines: Array<string> = []
    for (const id of targets) {
      const name = hhAccountNameById(accounts.value, id as HhAccountRecord["id"])
      let status = await applicationApi.syncRun(id)
      syncMessage.value = `${name}: читаю список откликов на hh.ru…`
      const deadline = Date.now() + 180_000
      while (!["done", "failed", "needs_human"].includes(status.status) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2_000))
        status = await applicationApi.syncStatus(id)
      }
      const c = status.counts
      lines.push(
        status.status === "done" && c
          ? `${name}: новых ${c.imported}, обновлено ${c.updated}, без изменений ${c.unchanged}` +
              (c.unknownVacancy > 0 ? `, вакансии нет в базе: ${c.unknownVacancy}` : "") +
              (c.complete ? "" : " (список прочитан не до конца)")
          : `${name}: не удалось${status.message ? ` — ${status.message}` : ""}`
      )
      syncMessage.value = lines.join(" · ")
    }
  },
  onSettled: () => actions.invalidate()
})

/* ---- таблица ----------------------------------------------------------------------- */

const ageOf = (value: string): string => {
  const time = Date.parse(value)
  return Number.isNaN(time) ? "—" : `${formatAge(Math.max(0, (Date.now() - time) / 1000))} назад`
}

const canRetry = (row: ApplicationRecord) => row.state === "needs_human" || row.state === "failed"
const canRetryLetter = (row: ApplicationRecord) =>
  row.state === "preparing" && progressById.value.get(row.id)?.retryable === true
const canSkip = (row: ApplicationRecord) => ["draft", "preparing", "queued", "needs_human", "failed"].includes(row.state)

const statusOf = (row: ApplicationRecord) => humanStatus(row, progressById.value.get(row.id)?.stage ?? null)

const columns = computed<ColumnDef<ApplicationRecord>[]>(() => [
  {
    id: "vacancy",
    header: "Вакансия",
    enableSorting: false,
    meta: { class: "max-sm:w-full" },
    cell: ({ row }) =>
      h("div", { class: "max-w-[300px] min-w-[180px] max-sm:max-w-none" }, [
        h(
          "a",
          {
            href: applicationLinkFrom(row.original.id, filter.value),
            class: "font-medium text-foreground transition-colors hover:text-primary"
          },
          row.original.vacancyTitle ?? "Вакансия без названия"
        ),
        row.original.employerName
          ? h("div", { class: "text-xs text-muted-foreground" }, row.original.employerName)
          : null,
        // Уже ширины xl второстепенные колонки сворачиваются сюда второй строкой.
        h("div", { class: "mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs xl:hidden" }, [
          h(AccountChip, {
            accountId: row.original.hhAccountId,
            accounts: accounts.value,
            resumeIds: [row.original.resumeId],
            resumes: resumes.value
          }),
          h(Badge, { variant: modeTone(row.original.autoRun) }, () => modeLabel(row.original.autoRun)),
          h(
            "span",
            { class: "whitespace-nowrap text-muted-foreground tabular-nums", title: formatDate(row.original.updatedAt) },
            ageOf(row.original.updatedAt)
          )
        ])
      ])
  },
  {
    id: "account",
    header: "Аккаунт",
    enableSorting: false,
    meta: { class: "max-xl:hidden" },
    cell: ({ row }) =>
      h(AccountChip, {
        accountId: row.original.hhAccountId,
        accounts: accounts.value,
        resumeIds: [row.original.resumeId],
        resumes: resumes.value
      })
  },
  {
    id: "status",
    header: "Состояние",
    enableSorting: false,
    cell: ({ row }) => h(HumanStatusBadge, { status: statusOf(row.original) })
  },
  {
    id: "letter",
    header: "Письмо",
    enableSorting: false,
    meta: { class: "max-xl:hidden" },
    cell: ({ row }) => {
      const has = row.original.hasLetter
      return has === null || has === undefined
        ? h("span", { class: "text-muted-foreground" }, "—")
        : h(Badge, { variant: has ? "success" : "warning" }, () => (has ? "Есть" : "Нет"))
    }
  },
  {
    id: "response",
    header: "Ответ работодателя",
    enableSorting: false,
    cell: ({ row }) => {
      const response = employerResponse(row.original)
      return response === null
        ? h("span", { class: "text-muted-foreground" }, "—")
        : h(Badge, { variant: response.tone }, () => response.label)
    }
  },
  {
    id: "mode",
    header: "Режим",
    enableSorting: false,
    meta: { class: "max-xl:hidden" },
    cell: ({ row }) => h(Badge, { variant: modeTone(row.original.autoRun) }, () => modeLabel(row.original.autoRun))
  },
  {
    id: "updatedAt",
    header: "Обновлён",
    enableSorting: false,
    meta: { class: "max-xl:hidden" },
    cell: ({ row }) =>
      h(
        "span",
        { class: "whitespace-nowrap text-muted-foreground tabular-nums", title: formatDate(row.original.updatedAt) },
        ageOf(row.original.updatedAt)
      )
  },
  {
    id: "actions",
    header: "",
    enableSorting: false,
    meta: { class: "max-sm:ml-auto" },
    cell: ({ row }) => {
      const item = row.original
      const busy = busyId.value !== null
      if (confirmSkipId.value === item.id) {
        return h("div", { class: "flex items-center justify-end gap-1" }, [
          h("span", { class: "text-xs text-muted-foreground" }, "Пропустить насовсем?"),
          h(Button, { size: "sm", variant: "destructive", disabled: busy, onClick: () => skipRow(item) }, () => "Да"),
          h(Button, { size: "sm", variant: "ghost", onClick: () => (confirmSkipId.value = null) }, () => "Нет")
        ])
      }
      return h("div", { class: "flex items-center justify-end gap-1" }, [
        canRetry(item)
          ? h(
              Button,
              { size: "sm", variant: "outline", disabled: busy, onClick: () => retryRow(item) },
              () => [h(RotateCcw, { class: "size-4" }), "Повторить"]
            )
          : null,
        canRetryLetter(item)
          ? h(
              Button,
              { size: "sm", variant: "outline", disabled: busy, onClick: () => retryLetterRow(item) },
              () => [h(RotateCcw, { class: "size-4" }), "Письмо заново"]
            )
          : null,
        canSkip(item)
          ? h(
              Button,
              {
                size: "icon",
                variant: "ghost",
                class: "size-8",
                title: "Пропустить",
                "aria-label": `Пропустить: ${item.vacancyTitle ?? "отклик"}`,
                disabled: busy,
                onClick: () => (confirmSkipId.value = item.id)
              },
              () => h(SkipForward, { class: "size-4" })
            )
          : null,
        h(
          Button,
          {
            size: "icon",
            variant: "ghost",
            as: "a",
            class: "size-8",
            href: vacancyPath(item.vacancyId),
            title: "Открыть вакансию",
            "aria-label": `Открыть вакансию: ${item.vacancyTitle ?? ""}`
          },
          () => h(ExternalLink, { class: "size-4" })
        )
      ])
    }
  }
])

/* ---- пустые состояния ------------------------------------------------------------- */

const emptyCopy = computed(() => {
  if (filter.value.q !== "" || hasSecondary.value || filter.value.state !== null) {
    return { title: "Ничего не нашлось", description: "Под выбранные фильтры не подошёл ни один отклик.", reset: true }
  }
  switch (activeTab.value) {
    case "attention":
      return { title: "Ничего не требует вашего участия", description: "Черновиков, остановок и ошибок нет.", reset: false }
    case "active":
      return { title: "Сейчас ничего не отправляется", description: "Когда раннер возьмёт отклик в работу, он появится здесь.", reset: false }
    case "sent":
      return { title: "Отправленных откликов нет", description: "Они появятся здесь после первой отправки или синхронизации с hh.ru.", reset: false }
    default:
      return { title: "Откликов пока нет", description: "Отклик создаётся со страницы вакансии или автооткликами.", reset: false }
  }
})

const totalLabel = computed(() =>
  capped.value
    ? `Видны только последние 200 откликов, подошло из них: ${total.value.toLocaleString("ru-RU")}`
    : `Найдено: ${total.value.toLocaleString("ru-RU")} ${plural(total.value, ["отклик", "отклика", "откликов"])}`
)

const stateChip = computed(() => (filter.value.state === null ? null : applicationStateLabel(filter.value.state)))
</script>

<template>
  <section>
    <PageHeader title="Отклики" description="Все отклики в одном списке: ручные, черновики и автоотклики.">
      <template #actions>
        <Button
          variant="outline"
          class="h-auto min-h-9 max-w-full whitespace-normal text-left"
          :disabled="syncMutation.isLoading.value || accounts.length === 0"
          title="Находит отклики, которые вы отправили на hh.ru сами, и добавляет их сюда"
          @click="syncMutation.mutate()"
        >
          {{ syncMutation.isLoading.value ? "Подтягиваю…" : "Подтянуть отклики, сделанные на hh.ru вручную" }}
        </Button>
        <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
      </template>
    </PageHeader>

    <p v-if="syncMessage" class="mb-4 text-sm text-muted-foreground" role="status">{{ syncMessage }}</p>

    <Alert v-if="query.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить отклики</AlertTitle>
      <AlertDescription class="flex flex-wrap items-center gap-3">
        {{ describeError(query.error.value) }}
        <Button size="sm" variant="outline" @click="query.refetch()">Повторить</Button>
      </AlertDescription>
    </Alert>

    <!-- Быстрые фильтры со счётчиками -->
    <div class="mb-3 flex flex-wrap items-center gap-2" role="tablist" aria-label="Группы откликов">
      <button
        v-for="tab in APPLICATION_TABS"
        :key="tab.value"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.value"
        :class="
          cn(
            'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            activeTab === tab.value
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card text-foreground hover:bg-muted'
          )
        "
        @click="onTab(tab.value)"
      >
        {{ tab.label }}
        <span
          v-if="tabCounts[tab.value] !== null"
          :class="
            cn(
              'rounded-full px-1.5 text-xs tabular-nums',
              activeTab === tab.value
                ? 'bg-primary-foreground/20'
                : tab.value === 'attention' && (tabCounts.attention ?? 0) > 0
                  ? toneClasses('warning').badge
                  : 'bg-muted text-muted-foreground'
            )
          "
        >
          {{ (tabCounts[tab.value] ?? 0).toLocaleString("ru-RU") }}{{ capped && tab.value === "all" ? "+" : "" }}
        </span>
      </button>
      <Badge v-if="stateChip" variant="neutral" class="gap-1 pr-1">
        Только: {{ stateChip.toLowerCase() }}
        <button
          type="button"
          class="rounded-full p-0.5 hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Снять фильтр по состоянию"
          @click="setFilter({ ...filter, state: null })"
        >
          <X class="size-3" />
        </button>
      </Badge>
    </div>

    <!-- Дополнительные фильтры -->
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <div class="relative min-w-52 flex-1 sm:max-w-xs">
        <Search class="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
        <Input
          :model-value="searchText"
          type="search"
          placeholder="Вакансия или компания"
          aria-label="Поиск по вакансии или компании"
          class="pl-9"
          @update:model-value="onSearch"
        />
      </div>
      <Select
        :model-value="filter.reason ?? 'all'"
        @update:model-value="(value) => setFilter({ ...filter, reason: value === 'all' ? null : String(value) })"
      >
        <SelectTrigger class="h-9 w-[210px]" aria-label="Причина остановки"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem v-for="option in reasonOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </SelectItem>
        </SelectContent>
      </Select>
      <Select
        :model-value="accountScope"
        @update:model-value="(value) => setFilter({ ...filter, account: value === 'all' ? null : String(value) })"
      >
        <SelectTrigger class="h-9 w-[190px]" aria-label="Аккаунт"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem v-for="option in accountOptions" :key="option.value" :value="option.value">
            <span class="inline-flex items-center gap-2">
              <span v-if="option.color" class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: option.color }" />
              {{ option.label }}
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
      <Select
        :model-value="filter.mode ?? 'all'"
        @update:model-value="(value) => setFilter({ ...filter, mode: value === 'all' ? null : (String(value) as ApplicationFilter['mode']) })"
      >
        <SelectTrigger class="h-9 w-[160px]" aria-label="Режим"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem v-for="option in modeOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </SelectItem>
        </SelectContent>
      </Select>
      <Button v-if="hasSecondary || filter.state !== null" variant="ghost" size="sm" @click="resetFilter">Сбросить</Button>
      <p class="ml-auto text-sm text-muted-foreground tabular-nums" aria-live="polite">
        <template v-if="page">{{ totalLabel }}</template>
      </p>
    </div>

    <!-- Повторить все остановленные по выбранной причине -->
    <div
      v-if="bulkEnabled && bulkCount > 0"
      class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 text-sm"
    >
      <template v-if="bulkMutation.isLoading.value && bulkProgress">
        <span class="tabular-nums">
          Повторяю: {{ bulkProgress.done + bulkProgress.failed }} из {{ bulkProgress.of }}
          <template v-if="bulkProgress.failed > 0">, не вышло {{ bulkProgress.failed }}</template>
        </span>
      </template>
      <template v-else-if="!confirmBulk">
        <span>
          Остановлено по этой причине: <strong class="tabular-nums">{{ bulkCount }}</strong>.
        </span>
        <Button size="sm" variant="outline" @click="confirmBulk = true">
          <RotateCcw class="size-4" />
          Повторить все ({{ bulkCount }})
        </Button>
      </template>
      <template v-else>
        <span>Каждый отклик пройдёт заново: форма прочитается и письмо проверится. Повторить {{ bulkCount }}?</span>
        <Button size="sm" :disabled="bulkMutation.isLoading.value" @click="bulkMutation.mutate()">Да, повторить все</Button>
        <Button size="sm" variant="ghost" @click="confirmBulk = false">Отмена</Button>
      </template>
    </div>
    <p v-if="bulkProgress && !bulkMutation.isLoading.value" class="mb-4 text-sm text-muted-foreground tabular-nums" role="status">
      Повторено: {{ bulkProgress.done }} из {{ bulkProgress.of }}<template v-if="bulkProgress.failed > 0">, не вышло: {{ bulkProgress.failed }}</template>.
    </p>

    <DataTable
      :key="filterToSearch(filter) + '|' + accountScope"
      :columns="columns"
      :data="rows"
      :is-loading="query.isPending.value"
      :loading-row-count="8"
      server-side
      :row-count="total"
      :page-size="pageSize"
      :page-size-options="[...PAGE_SIZES]"
      :row-numbers="false"
      cards
      @update:pagination="onPagination"
    >
      <template #empty>
        <EmptyState :title="emptyCopy.title" :description="emptyCopy.description">
          <Button v-if="emptyCopy.reset" variant="outline" size="sm" @click="resetFilter">Сбросить фильтры</Button>
          <Button v-else-if="activeTab !== 'all'" variant="outline" size="sm" @click="onTab('all')">Показать все отклики</Button>
        </EmptyState>
      </template>
    </DataTable>
  </section>
</template>
