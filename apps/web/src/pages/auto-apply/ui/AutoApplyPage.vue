<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import { CircleAlert, Save } from "@lucide/vue"
import { applyFilterApi, applyFilterKeys, applyFilterSourceHint } from "@/entities/apply-filter"
import { autoApplyKeys } from "@/entities/auto-apply"
import { hhAccountName } from "@/entities/hh-account"
import { scheduleKeys } from "@/entities/schedule"
import { useAutoApplyRun } from "@/features/auto-apply-run"
import {
  FilterTargetPicker,
  UnsavedChangesSheet,
  useFilterTarget,
  useUnsavedGuard,
  type FilterTarget
} from "@/features/filter-target"
import { RefreshButton } from "@/features/refresh-button"
import { describeError } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  EmptyState,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  useToast
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import { useAutoDraft, viewMatches } from "../model/useAutoDraft"
import AutoApplyModeCard from "./AutoApplyModeCard.vue"
import AutoApplyNextRunCard from "./AutoApplyNextRunCard.vue"
import AutoApplyProgressCard from "./AutoApplyProgressCard.vue"
import AutoApplySettingsCard from "./AutoApplySettingsCard.vue"

const queryCache = useQueryCache()
const filterTarget = useFilterTarget()
const { accountId, resumeId } = filterTarget

const viewQuery = useQuery({
  key: () => applyFilterKeys.get(accountId.value, resumeId.value),
  query: () => applyFilterApi.get({ hhAccountId: accountId.value, resumeId: resumeId.value }),
  enabled: () => accountId.value !== ""
})
const view = computed(() => (viewMatches(viewQuery.data.value ?? null, accountId.value, resumeId.value) ? viewQuery.data.value! : null))

const usageQuery = useQuery({
  key: () => applyFilterKeys.usage(accountId.value),
  query: () => applyFilterApi.usage(accountId.value),
  enabled: () => accountId.value !== ""
})
const usage = computed(() => usageQuery.data.value ?? null)

/* Черновик формы ---------------------------------------------------------- */

const draft = useAutoDraft()
const targetKey = computed(() => `${accountId.value}|${resumeId.value ?? ""}`)
let loadedFor = ""

// Форма следует за сервером, пока нет несохранённых правок; смена пары грузит заново.
watch(
  [view, targetKey],
  () => {
    const value = view.value
    if (value === null) return
    if (loadedFor !== targetKey.value || !draft.dirty.value) {
      draft.load(value)
      loadedFor = targetKey.value
    }
  },
  { immediate: true }
)

const storedMode = computed(() => view.value?.autoMode ?? "off")
const dirty = draft.dirty
const guard = useUnsavedGuard(dirty)
const onSelect = (next: FilterTarget) => guard.confirmThen(() => filterTarget.select(next))

/* Сохранение -------------------------------------------------------------- */

const { ensureSchedule, applySchedule } = useAutoApplyRun({
  accountId: () => accountId.value,
  scheduleEnabled: () => true
})

const toast = useToast()
const formError = ref<string | null>(null)
const modeText = (mode: "off" | "drafts" | "auto") =>
  mode === "off"
    ? "Автоотклики выключены"
    : mode === "drafts"
      ? "Режим «Черновики»: система готовит отклики, отправляете вы"
      : "Режим «Авто» включён"

const SCHEDULES_ACTION = { label: "Открыть расписания", href: "/schedules" } as const

const saveMutation = useMutation({
  mutation: async (_: void) => {
    const saved = await applyFilterApi.saveAuto(
      { hhAccountId: accountId.value, resumeId: resumeId.value },
      draft.values.value
    )
    // Расписание создаётся как побочный эффект включения режима: говорим об этом в интерфейсе.
    const schedule = saved.autoMode === "off" ? null : await ensureSchedule(true)
    return { saved, schedule }
  }
})

const confirmOpen = ref(false)

const doSave = async () => {
  confirmOpen.value = false
  try {
    const { saved, schedule } = await saveMutation.mutateAsync()
    draft.load(saved)
    const title = `Сохранено. ${modeText(saved.autoMode)}`
    if (schedule?.created) {
      toast.info(title, {
        description: `Расписание создано: запуск каждые ${schedule.schedule.intervalMinutes} мин.`,
        action: SCHEDULES_ACTION
      })
    } else if (schedule !== null && !schedule.schedule.enabled) {
      toast.warning(title, {
        description: "Расписание автооткликов на паузе: пока его не включить, запусков не будет.",
        action: SCHEDULES_ACTION
      })
    } else toast.success(title)
    await Promise.all([
      queryCache.invalidateQueries({ key: applyFilterKeys.all }),
      queryCache.invalidateQueries({ key: autoApplyKeys.all }),
      queryCache.invalidateQueries({ key: scheduleKeys.all })
    ])
  } catch (cause) {
    toast.error("Не удалось сохранить", { description: describeError(cause) })
  }
}

const save = () => {
  const problem = draft.error.value
  formError.value = problem
  if (problem !== null) return
  // Включение отправки — необратимое действие: сначала явное подтверждение.
  if (draft.mode.value === "auto" && storedMode.value !== "auto") {
    confirmOpen.value = true
    return
  }
  void doSave()
}

const saving = computed(() => saveMutation.isLoading.value)
watch(dirty, () => (formError.value = null))

/* Подписи ----------------------------------------------------------------- */

const accountName = computed(() => (filterTarget.account.value === null ? "" : hhAccountName(filterTarget.account.value)))
const resumeTitle = computed(() => filterTarget.resume.value?.title ?? "Все резюме аккаунта")
const effectiveLimit = computed(() =>
  resumeId.value === null ? draft.dailyLimit.value : (usage.value?.limit ?? draft.dailyLimit.value)
)
const sourceNote = computed(() => (view.value === null ? "" : applyFilterSourceHint(view.value.source, resumeId.value !== null)))
const viewError = computed(() => (viewQuery.error.value === null ? null : describeError(viewQuery.error.value)))
const pageError = computed(() => (filterTarget.error.value === null ? null : describeError(filterTarget.error.value)))
const filterHref = computed(() => filterTarget.pathWithTarget("/apply-filter"))
const targetReady = computed(() => accountId.value !== "")

const editAccount = () => onSelect({ accountId: accountId.value, resumeId: null })
const refresh = () => {
  void viewQuery.refetch()
  void usageQuery.refetch()
}
</script>

<template>
  <section class="space-y-6 pb-4">
    <PageHeader
      title="Автоотклики"
      description="Что система отправляет сама: режим, лимиты, ближайший запуск и ход. Какие вакансии подходят, задаётся в «Фильтре откликов»."
    >
      <template #actions>
        <RefreshButton :loading="viewQuery.isLoading.value" @refresh="refresh" />
      </template>
    </PageHeader>

    <Alert v-if="pageError" variant="destructive">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить аккаунты</AlertTitle>
      <AlertDescription>{{ pageError }}</AlertDescription>
    </Alert>

    <EmptyState
      v-if="!filterTarget.loading.value && filterTarget.accounts.value.length === 0 && !pageError"
      title="Нет аккаунтов hh"
      description="Автоотклики работают от имени аккаунта hh. Добавьте аккаунт на странице «Аккаунты»."
    >
      <a href="/accounts" class="text-sm underline">Открыть аккаунты</a>
    </EmptyState>

    <template v-if="targetReady">
      <FilterTargetPicker :state="filterTarget" :disabled="saving" @select="onSelect" />

      <Alert v-if="viewError" variant="destructive">
        <CircleAlert />
        <AlertTitle>Не удалось загрузить настройки</AlertTitle>
        <AlertDescription>{{ viewError }}</AlertDescription>
      </Alert>

      <p v-if="sourceNote" class="text-sm text-muted-foreground">{{ sourceNote }}</p>

      <div v-if="view === null && !viewError" class="space-y-4">
        <Skeleton class="h-36 w-full" />
        <Skeleton class="h-56 w-full" />
      </div>

      <template v-if="view !== null">
        <AutoApplyModeCard
          v-model="draft.mode.value"
          :stored-mode="storedMode"
          :usage="usage"
          :usage-loading="usageQuery.isLoading.value"
          :disabled="saving"
        />

        <section aria-labelledby="settings-title" class="space-y-3">
          <h2 id="settings-title" class="text-base font-semibold">Настройки</h2>
          <AutoApplySettingsCard
            :draft="draft"
            :disabled="saving"
            :resume-level="resumeId !== null"
            :account-limit="usage?.limit ?? null"
            @edit-account="editAccount"
          />
        </section>

        <section aria-labelledby="next-title" class="space-y-3">
          <h2 id="next-title" class="text-base font-semibold">Следующий запуск</h2>
          <AutoApplyNextRunCard
            :account-id="accountId"
            :resume-id="resumeId"
            :stored-mode="storedMode"
            :dirty="dirty"
          />
        </section>

        <section aria-labelledby="progress-title" class="space-y-3">
          <h2 id="progress-title" class="text-base font-semibold">Ход</h2>
          <AutoApplyProgressCard :account-id="accountId" />
        </section>

        <p class="text-xs text-muted-foreground">
          Правила отбора вакансий, порог соответствия и тесты:
          <a :href="filterHref" class="underline">Фильтр откликов</a>.
        </p>

        <!-- Сохранение одно на всю страницу; панель прилипает к низу, пока есть правки. -->
        <div
          v-if="dirty || saving || formError"
          class="sticky bottom-0 z-10 -mx-1 space-y-2 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur"
        >
          <Alert v-if="formError" variant="destructive">
            <CircleAlert />
            <AlertTitle>Проверьте форму</AlertTitle>
            <AlertDescription>{{ formError }}</AlertDescription>
          </Alert>
          <div v-if="dirty || saving" class="flex flex-wrap items-center gap-2">
            <Button :disabled="saving" @click="save">
              <Save class="size-4" />
              {{ saving ? "Сохраняю…" : "Сохранить" }}
            </Button>
            <Button variant="ghost" :disabled="saving" @click="draft.reset()">Отменить правки</Button>
            <span class="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
              <span class="size-2 rounded-full bg-warning" aria-hidden="true" />
              Есть несохранённые изменения
            </span>
          </div>
        </div>
      </template>
    </template>

    <Sheet :open="confirmOpen" @update:open="(value) => (confirmOpen = value)">
      <SheetContent side="bottom" class="mx-auto w-full gap-3 rounded-t-xl p-4 sm:max-w-lg">
        <SheetHeader class="p-0">
          <SheetTitle>Включить автоматическую отправку?</SheetTitle>
          <SheetDescription>
            Готовые отклики будут уходить на hh.ru без вашего участия. Отправленный отклик нельзя отозвать.
          </SheetDescription>
        </SheetHeader>
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt class="text-muted-foreground">Аккаунт</dt>
          <dd class="font-medium">{{ accountName }}</dd>
          <dt class="text-muted-foreground">Резюме</dt>
          <dd class="font-medium">{{ resumeTitle }}</dd>
          <dt class="text-muted-foreground">Дневной лимит</dt>
          <dd class="font-medium tabular-nums">до {{ effectiveLimit }} откликов в сутки на аккаунт</dd>
        </dl>
        <div class="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" @click="confirmOpen = false">Отмена</Button>
          <Button :disabled="saving" @click="doSave">Включить авто</Button>
        </div>
      </SheetContent>
    </Sheet>

    <UnsavedChangesSheet :open="guard.open.value" @leave="guard.leave" @stay="guard.stay" />
  </section>
</template>
