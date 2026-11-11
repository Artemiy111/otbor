import type {
  ApplyBoost,
  ApplyFilterView,
  ApplySort,
  AutoMode,
  PresetFilter,
  SortDirection,
  TestsPolicy
} from "@otbor/contract"

/**
 * Одна RPC `ApplyFilterSet` пишет и правила отбора, и настройки автооткликов.
 * Обе страницы редактируют каждая свою половину, поэтому чужую половину нельзя
 * брать из устаревшего кэша формы: здесь она собирается из свежего ответа
 * сервера. Функции чистые, сетевой вызов делает `api.ts`.
 */

/** Правила отбора: то, что редактирует страница «Фильтр откликов». */
export interface RulesValues {
  readonly filter: PresetFilter
  readonly minFit: number
  readonly tests: TestsPolicy
  readonly freshHalfLifeHours: number
}

/** Настройки автооткликов: то, что редактирует страница «Автоотклики». */
export interface AutoSettingsValues {
  readonly autoMode: AutoMode
  readonly dailyLimit: number
  readonly batchSize: number
  readonly sort: ApplySort
  readonly sortDirection: SortDirection
  readonly minPriority: number
  /** Автоотправка только с сопроводительным письмом. */
  readonly requireLetter: boolean
  readonly boosts: ReadonlyArray<ApplyBoost>
  /** Пустая строка очищает значение (умолчание харнеса). */
  readonly writingHarness: string
  readonly writingModel: string
  readonly writingEffort: string
}

/** Тело `ApplyFilterSet`: что не указано, сервер оставляет как есть. */
export interface ApplyFilterSavePayload {
  readonly hhAccountId: string
  readonly resumeId?: string | null
  readonly filter: PresetFilter
  readonly minFit?: number
  readonly tests?: TestsPolicy
  readonly freshHalfLifeHours?: number
  readonly templatePresetId?: string | null
  readonly autoMode?: AutoMode
  readonly dailyLimit?: number
  readonly batchSize?: number
  readonly sort?: ApplySort
  readonly sortDirection?: SortDirection
  readonly minPriority?: number
  readonly requireLetter?: boolean
  readonly boosts?: ReadonlyArray<ApplyBoost>
  readonly writingHarness?: string | null
  readonly writingModel?: string | null
  readonly writingEffort?: string | null
}

export interface SaveTarget {
  readonly hhAccountId: string
  /** Не указано или null: строка аккаунта. */
  readonly resumeId?: string | null
}

/** Свой ряд в таблице уже есть: сервер сохранит всё, что мы не пришлём. */
const ownsRow = (fresh: ApplyFilterView): boolean => fresh.source === "exact"

/** Половина «правила» из свежего ответа сервера. */
export const rulesHalf = (fresh: ApplyFilterView) => ({
  minFit: fresh.minFit,
  tests: fresh.tests,
  freshHalfLifeHours: fresh.freshHalfLifeHours,
  templatePresetId: fresh.templatePresetId
})

/** Половина «автоотклики» из свежего ответа сервера. */
export const autoHalf = (fresh: ApplyFilterView) => ({
  autoMode: fresh.autoMode,
  dailyLimit: fresh.dailyLimit,
  batchSize: fresh.batchSize,
  sort: fresh.sort,
  sortDirection: fresh.sortDirection,
  minPriority: fresh.minPriority,
  requireLetter: fresh.requireLetter,
  boosts: fresh.boosts,
  writingHarness: fresh.writingHarness,
  writingModel: fresh.writingModel,
  writingEffort: fresh.writingEffort
})

const idOf = (target: SaveTarget) => ({
  hhAccountId: target.hhAccountId,
  resumeId: target.resumeId ?? null
})

/**
 * Сохранение настроек автооткликов. `filter` обязателен в контракте, поэтому он
 * берётся из свежего ответа, а не из формы. Если у пары ещё нет своего ряда
 * (действует ряд аккаунта или встроенный), создаваемый ряд наследует правила
 * действующего фильтра, иначе сервер подставил бы значения по умолчанию.
 */
export const buildAutoSavePayload = (
  fresh: ApplyFilterView,
  target: SaveTarget,
  values: AutoSettingsValues
): ApplyFilterSavePayload => ({
  ...idOf(target),
  filter: fresh.filter,
  ...(ownsRow(fresh) ? {} : rulesHalf(fresh)),
  autoMode: values.autoMode,
  dailyLimit: values.dailyLimit,
  batchSize: values.batchSize,
  sort: values.sort,
  sortDirection: values.sortDirection,
  minPriority: values.minPriority,
  requireLetter: values.requireLetter,
  boosts: values.boosts,
  writingHarness: values.writingHarness.trim(),
  writingModel: values.writingModel.trim(),
  writingEffort: values.writingEffort.trim()
})

/**
 * Сохранение правил отбора. У пары есть свой ряд: настройки автооткликов не
 * отправляются вовсе, сервер оставляет их как есть. Своего ряда нет: новый ряд
 * наследует действующие настройки, иначе режим молча стал бы `off`.
 */
export const buildRulesSavePayload = (
  fresh: ApplyFilterView,
  target: SaveTarget,
  values: RulesValues
): ApplyFilterSavePayload => ({
  ...idOf(target),
  filter: values.filter,
  minFit: values.minFit,
  tests: values.tests,
  freshHalfLifeHours: values.freshHalfLifeHours,
  ...(ownsRow(fresh) ? {} : autoHalf(fresh))
})

/* Проверка и сравнение -------------------------------------------------------- */

const isInt = (value: unknown, min: number, max: number): boolean =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max

/** Текст первой ошибки настроек автооткликов или null. */
export const validateAutoSettings = (
  values: AutoSettingsValues,
  incompleteBoosts: boolean
): string | null => {
  if (!isInt(values.dailyLimit, 0, Number.MAX_SAFE_INTEGER)) return "Дневной лимит: целое число, не меньше 0."
  if (!isInt(values.batchSize, 1, 500)) return "Размер партии: целое число от 1 до 500."
  if (
    typeof values.minPriority !== "number" ||
    !Number.isFinite(values.minPriority) ||
    values.minPriority < 0
  )
    return "Минимальный приоритет: число, не меньше 0."
  if (values.boosts.some((boost) => !isInt(boost.weight, -50, 50)))
    return "Вес бонуса: целое число от -50 до 50."
  if (incompleteBoosts) return "Заполните значения правил в бонусах или удалите их."
  return null
}

/** Ключ для сравнения: два одинаковых набора настроек дают одинаковую строку. */
export const settingsKey = (values: AutoSettingsValues): string =>
  JSON.stringify([
    values.autoMode,
    values.dailyLimit,
    values.batchSize,
    values.sort,
    values.sortDirection,
    values.minPriority,
    values.requireLetter,
    values.writingHarness.trim(),
    values.writingModel.trim(),
    values.writingEffort.trim(),
    values.boosts.map((boost) => [boost.rule, boost.weight])
  ])

/** Настройки из ответа сервера: то, с чем сравнивается форма. */
export const settingsOf = (
  source: Pick<
    ApplyFilterView,
    | "autoMode"
    | "dailyLimit"
    | "batchSize"
    | "sort"
    | "sortDirection"
    | "minPriority"
    | "requireLetter"
    | "boosts"
    | "writingHarness"
    | "writingModel"
    | "writingEffort"
  >
): AutoSettingsValues => ({
  autoMode: source.autoMode,
  dailyLimit: source.dailyLimit,
  batchSize: source.batchSize,
  sort: source.sort,
  sortDirection: source.sortDirection,
  minPriority: source.minPriority,
  requireLetter: source.requireLetter,
  boosts: source.boosts,
  writingHarness: source.writingHarness ?? "",
  writingModel: source.writingModel ?? "",
  writingEffort: source.writingEffort ?? ""
})

/**
 * Несохранённые правки: ключ формы отличается от ключа последнего загруженного
 * состояния (оба построены одним и тем же кодом, поэтому круговое
 * преобразование правил не даёт ложных отличий) либо в бонусах есть
 * незаполненное правило.
 */
export const isDirty = (loadedKey: string | null, currentKey: string, incompleteBoosts: boolean): boolean =>
  loadedKey !== null && (incompleteBoosts || loadedKey !== currentKey)
