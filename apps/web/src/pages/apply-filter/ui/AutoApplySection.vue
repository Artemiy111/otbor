<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { ApplyFilterView, ApplySort, AutoMode, SortDirection } from "@otbor/contract"
import { CircleAlert, Play, Save } from "@lucide/vue"
import {
  applyFilterApi,
  applyFilterKeys,
  applySortOptions,
  sortDirectionOptions,
  autoModeOptions
} from "@/entities/apply-filter"
import { scheduleKeys } from "@/entities/schedule"
import { useHarnessCatalog } from "@/features/harness-catalog"
import { RUN_COUNT_LABELS, useAutoApplyRun } from "@/features/auto-apply-run"
import { FieldPicker, RuleRow, buildRule, isComplete, newRule, toEditableRule } from "@/features/rule-builder"
import type { EditableRule } from "@/features/rule-builder"
import { applyFilterHelp } from "../model/help"
import { describeError } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  FieldLabel,
  HarnessModelPicker,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/shared/ui"

/**
 * Auto-apply settings of the filter row the page shows. They are saved on
 * their own: the rules stay exactly as stored, so a half-edited filter above
 * is never sent by accident.
 */
const props = defineProps<{
  accountId: string
  resumeId: string | null
  view: ApplyFilterView | null
}>()

const queryCache = useQueryCache()

interface BoostRow {
  readonly id: number
  rule: EditableRule
  weight: number
}

let boostSequence = 0
const mode = ref<AutoMode>("off")
const dailyLimit = ref(200)
const batchSize = ref(20)
const sort = ref<ApplySort>("priority")
const sortDirection = ref<SortDirection>("desc")
const minPriority = ref(0)
const writingHarness = ref("")
const writingModel = ref("")
const writingEffort = ref("")
const boosts = ref<Array<BoostRow>>([])
const confirmed = ref(false)
const formError = ref<string | null>(null)
const notice = ref<string | null>(null)

const load = (value: ApplyFilterView) => {
  mode.value = value.autoMode
  dailyLimit.value = value.dailyLimit
  batchSize.value = value.batchSize
  sort.value = value.sort
  sortDirection.value = value.sortDirection
  minPriority.value = value.minPriority
  writingHarness.value = value.writingHarness ?? ""
  writingModel.value = value.writingModel ?? ""
  writingEffort.value = value.writingEffort ?? ""
  boosts.value = value.boosts.map((boost) => ({
    id: boostSequence++,
    rule: reactive(toEditableRule(boost.rule)),
    weight: boost.weight
  }))
  confirmed.value = false
  formError.value = null
}
watch(() => props.view, (value) => value !== null && load(value), { immediate: true })

const storedMode = computed<AutoMode>(() => props.view?.autoMode ?? "off")
/** Switching to real sending (from anything else) needs an explicit confirmation. */
const needsConfirm = computed(() => mode.value === "auto" && storedMode.value !== "auto")
const modeHint = computed(() => autoModeOptions.find((option) => option.value === mode.value)?.hint ?? "")

const addBoost = (field: Parameters<typeof newRule>[0]) => {
  boosts.value.push({ id: boostSequence++, rule: reactive(newRule(field)), weight: 5 })
}
const removeBoost = (id: number) => {
  boosts.value = boosts.value.filter((boost) => boost.id !== id)
}
const incompleteBoosts = computed(() => boosts.value.some((boost) => !isComplete(boost.rule)))

/* Writer: the same picker as the cover-letter generator. Empty = harness default ---- */

const {
  harnesses: catalogHarnesses,
  models: catalogModels,
  loading: catalogLoading,
  error: catalogError,
  refetch: refetchCatalog
} = useHarnessCatalog()
const writerSet = computed(
  () => writingHarness.value !== "" || writingModel.value !== "" || writingEffort.value !== ""
)
const resetWriter = () => {
  writingHarness.value = ""
  writingModel.value = ""
  writingEffort.value = ""
}

/* Usage ------------------------------------------------------------------- */

const usageQuery = useQuery({
  key: () => applyFilterKeys.usage(props.accountId),
  query: () => applyFilterApi.usage(props.accountId),
  enabled: () => props.accountId !== ""
})
const usage = computed(() => usageQuery.data.value ?? null)

const { ensureSchedule, run, runState, runCounts, runError, running } = useAutoApplyRun({
  accountId: () => props.accountId,
  scheduleEnabled: () => mode.value !== "off"
})

/* Save -------------------------------------------------------------------- */

const saveMutation = useMutation({
  mutation: async (_: void) => {
    if (props.view === null) throw new Error("Фильтр ещё не загружен")
    const saved = await applyFilterApi.setAuto({
      hhAccountId: props.accountId,
      resumeId: props.resumeId,
      filter: props.view.filter,
      autoMode: mode.value,
      dailyLimit: dailyLimit.value,
      batchSize: batchSize.value,
      sort: sort.value,
      sortDirection: sortDirection.value,
      minPriority: minPriority.value,
      writingHarness: writingHarness.value.trim(),
      writingModel: writingModel.value.trim(),
      writingEffort: writingEffort.value.trim(),
      boosts: boosts.value.map((boost) => ({ rule: buildRule(boost.rule)!, weight: boost.weight }))
    })
    if (mode.value !== "off") await ensureSchedule(true)
    return saved
  },
  onSuccess: async () => {
    await Promise.all([
      queryCache.invalidateQueries({ key: applyFilterKeys.all }),
      queryCache.invalidateQueries({ key: scheduleKeys.all })
    ])
  }
})

const save = async () => {
  notice.value = null
  const intIn = (value: number, min: number, max: number) =>
    Number.isInteger(value) && value >= min && value <= max
  if (!intIn(dailyLimit.value, 0, Number.MAX_SAFE_INTEGER)) {
    formError.value = "Дневной лимит: целое число, не меньше 0."
    return
  }
  if (!intIn(batchSize.value, 1, 500)) {
    formError.value = "Размер партии: целое число от 1 до 500."
    return
  }
  if (typeof minPriority.value !== "number" || !Number.isFinite(minPriority.value) || minPriority.value < 0) {
    formError.value = "Минимальный приоритет: число, не меньше 0."
    return
  }
  if (boosts.value.some((boost) => !intIn(boost.weight, -50, 50))) {
    formError.value = "Вес правила: целое число от -50 до 50."
    return
  }
  if (incompleteBoosts.value) {
    formError.value = "Заполните значения правил в бонусах или удалите их."
    return
  }
  if (needsConfirm.value && !confirmed.value) {
    formError.value = "Подтвердите, что понимаете: режим «Отправка» отправляет реальные отклики."
    return
  }
  formError.value = null
  try {
    await saveMutation.mutateAsync()
    notice.value =
      mode.value === "off"
        ? "Сохранено. Автоотклики выключены."
        : mode.value === "drafts"
          ? "Сохранено. Режим «Черновики»: отправляете вы."
          : "Сохранено. Режим «Отправка» включён."
  } catch {
    // Rendered from the mutation error.
  }
}

/* Run now ----------------------------------------------------------------- */

const saveError = computed(() => (saveMutation.error.value === null ? null : describeError(saveMutation.error.value)))
const busy = computed(() => saveMutation.isLoading.value)
const modeBadge = (value: AutoMode) => (value === "off" ? "secondary" : value === "drafts" ? "outline" : "destructive")
</script>

<template>
  <Card class="mb-4">
    <CardContent class="space-y-4 p-4">
      <div>
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-sm font-semibold">Автоотклики</h2>
        <Badge :variant="modeBadge(storedMode)">
          сейчас: {{ autoModeOptions.find((option) => option.value === storedMode)?.label }}
        </Badge>
        <span class="text-xs text-muted-foreground">
          <template v-if="usage">Сегодня отправлено {{ usage.used }} из {{ usage.limit }}</template>
          <template v-else-if="usageQuery.isLoading.value">Считаю отправленные…</template>
        </span>
      </div>
      <p class="mt-1 text-xs text-muted-foreground">
        Система сама выбирает вакансии, создаёт отклики и по режиму отправляет их. Запуск каждые 15 минут.
      </p>
      </div>

      <Alert v-if="notice" variant="info">
        <CircleAlert />
        <AlertTitle>Готово</AlertTitle>
        <AlertDescription>{{ notice }}</AlertDescription>
      </Alert>
      <Alert v-if="formError" variant="destructive">
        <CircleAlert />
        <AlertTitle>Проверьте форму</AlertTitle>
        <AlertDescription>{{ formError }}</AlertDescription>
      </Alert>
      <Alert v-if="saveError" variant="destructive">
        <CircleAlert />
        <AlertTitle>Не удалось сохранить автоотклики</AlertTitle>
        <AlertDescription>{{ saveError }}</AlertDescription>
      </Alert>

      <div class="space-y-2">
        <FieldLabel :hint="applyFilterHelp.mode">Режим</FieldLabel>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="option in autoModeOptions"
            :key="option.value"
            type="button"
            class="inline-flex h-8 items-center rounded-md border px-3 text-sm transition-colors disabled:opacity-50"
            :class="
              mode === option.value
                ? option.value === 'auto'
                  ? 'border-destructive bg-destructive/10 text-foreground'
                  : 'border-primary bg-primary/15 text-foreground'
                : 'border-border text-muted-foreground hover:bg-accent'
            "
            :disabled="busy"
            @click="mode = option.value; confirmed = false"
          >
            {{ option.label }}
          </button>
        </div>
        <p class="text-xs text-muted-foreground">{{ modeHint }}</p>
        <Alert v-if="needsConfirm" variant="destructive">
          <CircleAlert />
          <AlertTitle>Отправка реальных откликов</AlertTitle>
          <AlertDescription>
            <p>
              Готовые отклики будут уходить на hh.ru без вашего участия, в пределах дневного лимита. Отправленный
              отклик нельзя отозвать.
            </p>
            <label class="mt-2 flex items-center gap-2 text-sm">
              <input v-model="confirmed" type="checkbox" :disabled="busy" />
              Понимаю, включить отправку
            </label>
          </AlertDescription>
        </Alert>
      </div>

      <div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div class="space-y-1">
          <FieldLabel :hint="applyFilterHelp.dailyLimit">Лимит в сутки (на аккаунт hh)</FieldLabel>
          <Input v-model.number="dailyLimit" type="number" min="0" class="h-8" :disabled="busy" />
        </div>
        <div class="space-y-1">
          <FieldLabel :hint="applyFilterHelp.batchSize">Размер партии (1-500)</FieldLabel>
          <Input v-model.number="batchSize" type="number" min="1" max="500" class="h-8" :disabled="busy" />
        </div>
        <div class="space-y-1">
          <FieldLabel :hint="applyFilterHelp.sort">Сортировка</FieldLabel>
          <Select v-model="sort" :disabled="busy">
            <SelectTrigger class="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in applySortOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="space-y-1">
          <FieldLabel :hint="applyFilterHelp.sortDirection">Порядок</FieldLabel>
          <Select v-model="sortDirection" :disabled="busy">
            <SelectTrigger class="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in sortDirectionOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
          <span
            v-if="sortDirection === 'asc'"
            class="inline-block rounded border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-xs text-foreground"
          >
            Порядок инвертирован
          </span>
        </div>
        <div class="space-y-1">
          <FieldLabel :hint="applyFilterHelp.minPriority">Минимальный приоритет</FieldLabel>
          <Input v-model.number="minPriority" type="number" min="0" class="h-8" :disabled="busy" />
        </div>
      </div>

      <div class="space-y-1 border-t border-border pt-3">
        <FieldLabel :hint="applyFilterHelp.writer">Кто пишет письма</FieldLabel>
        <div class="flex flex-wrap items-center gap-2">
          <HarnessModelPicker
            v-model:provider="writingHarness"
            v-model:model="writingModel"
            v-model:effort="writingEffort"
            :harnesses="catalogHarnesses"
            :models="catalogModels"
            :loading="catalogLoading"
            :error="catalogError"
            :disabled="busy"
            placeholder="по умолчанию харнеса"
            class="border-border"
            @refresh="refetchCatalog()"
          />
          <Button v-if="writerSet" variant="ghost" size="sm" class="h-7" :disabled="busy" @click="resetWriter">
            Сбросить
          </Button>
          <span v-else class="text-xs text-muted-foreground">Агент, модель и effort по умолчанию харнеса.</span>
        </div>
      </div>

      <div class="space-y-2 border-t border-border pt-3">
        <FieldLabel :hint="applyFilterHelp.boosts">Бонусы к соответствию (вес от -50 до 50, прибавляется, когда правило выполнено)</FieldLabel>
        <div v-for="boost in boosts" :key="boost.id" class="flex items-start gap-2">
          <div class="min-w-0 flex-1">
            <RuleRow :rule="boost.rule" :disabled="busy" @remove="removeBoost(boost.id)" />
          </div>
          <Input
            v-model.number="boost.weight"
            type="number"
            min="-50"
            max="50"
            step="1"
            class="h-8 w-20"
            title="Вес"
            :disabled="busy"
          />
        </div>
        <div class="flex items-center gap-2">
          <FieldPicker label="Бонус" :disabled="busy" @pick="addBoost" />
          <span v-if="boosts.length === 0" class="text-xs text-muted-foreground">Бонусов нет.</span>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button size="sm" :disabled="busy || accountId === '' || view === null" @click="save">
          <Save class="h-4 w-4" />
          {{ busy ? "Сохраняю…" : "Сохранить автоотклики" }}
        </Button>
        <Button
          variant="outline"
          size="sm"
          :disabled="running || runState === 'waiting' || accountId === ''"
          title="Запускает расписание apply один раз, не дожидаясь интервала"
          @click="run"
        >
          <Play class="h-4 w-4" />
          {{ runState === "waiting" ? "Выполняется…" : "Запустить сейчас" }}
        </Button>
        <span v-if="storedMode === 'off'" class="text-xs text-muted-foreground">
          В режиме «Выкл» запуск ничего не создаёт.
        </span>
        <a href="/schedules" class="ml-auto text-xs text-muted-foreground underline">Расписания</a>
      </div>

      <Alert v-if="runError" variant="destructive">
        <CircleAlert />
        <AlertTitle>Запуск</AlertTitle>
        <AlertDescription>{{ runError }}</AlertDescription>
      </Alert>
      <p v-if="runState === 'done'" class="text-sm">
        <template v-if="runCounts">
          <span v-for="[key, label] in RUN_COUNT_LABELS" :key="key" class="mr-3">
            {{ label }}: <b>{{ runCounts[key] }}</b>
          </span>
        </template>
        <template v-else>Запуск завершён. Подробности на странице расписаний.</template>
      </p>
    </CardContent>
  </Card>
</template>
