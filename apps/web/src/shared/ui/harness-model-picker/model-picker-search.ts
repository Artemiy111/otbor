/**
 * Ранжирование моделей для поиска в поповере. Чистая функция без Vue:
 * точное совпадение имени выше префикса, префикс выше вхождения,
 * учитываются label, id, вид модели и харнес.
 */

export interface SearchableHarnessModel {
  id: string;
  label: string;
  harness?: string;
  variant?: string;
}

const EXACT_TIER = 0;
const PREFIX_TIER = 1;
const WORD_TIER = 2;
const INCLUDES_TIER = 3;
const TIER_STEP = 10;

/** Вес поля внутри одного уровня: имя, затем id. */
const LABEL_WEIGHT = 0;
const ID_WEIGHT = 4;
/** Совпадение по виду или харнесу всегда ниже любого совпадения по имени или id. */
const META_OFFSET = 100;

export function normalizeHarnessQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function matchTier(field: string, query: string): number | null {
  if (!field) return null;
  if (field === query) return EXACT_TIER;
  if (field.startsWith(query)) return PREFIX_TIER;
  if (field.includes(` ${query}`)) return WORD_TIER;
  if (field.includes(query)) return INCLUDES_TIER;
  return null;
}

/** Меньше значит выше в списке. null означает, что модель не подходит под запрос. */
export function scoreHarnessModel(
  model: SearchableHarnessModel,
  query: string,
): number | null {
  const needle = normalizeHarnessQuery(query);
  if (!needle) return 0;

  const fields: ReadonlyArray<{ value: string; weight: number; offset: number }> = [
    { value: normalizeHarnessQuery(model.label), weight: LABEL_WEIGHT, offset: 0 },
    { value: normalizeHarnessQuery(model.id), weight: ID_WEIGHT, offset: 0 },
    {
      value: normalizeHarnessQuery(model.variant ?? ""),
      weight: 0,
      offset: META_OFFSET,
    },
    {
      value: normalizeHarnessQuery(model.harness ?? ""),
      weight: 0,
      offset: META_OFFSET,
    },
  ];

  let best: number | null = null;
  for (const field of fields) {
    const tier = matchTier(field.value, needle);
    if (tier === null) continue;
    const score = field.offset + tier * TIER_STEP + field.weight;
    if (best === null || score < best) best = score;
  }
  return best;
}

/** Возвращает подходящие модели в порядке релевантности, сохраняя исходный порядок при равенстве. */
export function rankHarnessModels<T extends SearchableHarnessModel>(
  models: ReadonlyArray<T>,
  query: string,
): T[] {
  const ranked: Array<{ model: T; score: number; order: number }> = [];
  models.forEach((model, order) => {
    const score = scoreHarnessModel(model, query);
    if (score !== null) ranked.push({ model, score, order });
  });
  ranked.sort((a, b) => a.score - b.score || a.order - b.order);
  return ranked.map((entry) => entry.model);
}
