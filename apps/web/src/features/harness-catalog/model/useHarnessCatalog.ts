import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import { applicationApi, applicationKeys } from "@/entities/application"
import { describeError } from "@/shared/lib"
import type { HarnessEntry, HarnessModel } from "@/shared/ui"

/**
 * The agent catalog (harnesses and their models) in the shape
 * `HarnessModelPicker` expects. Shared by every screen that picks a writer.
 */
export const useHarnessCatalog = () => {
  const query = useQuery({
    key: () => applicationKeys.agentCatalog,
    query: () => applicationApi.agentCatalog(),
    staleTime: 30_000
  })
  const catalog = computed(() => query.data.value ?? null)

  const harnesses = computed<HarnessEntry[]>(() =>
    (catalog.value?.harnesses ?? []).map((harness) => ({
      id: harness.id,
      name: harness.name,
      error: harness.available ? null : (harness.error ?? "недоступен")
    }))
  )
  const models = computed<HarnessModel[]>(() =>
    (catalog.value?.harnesses ?? []).flatMap((harness) =>
      harness.models.map((model) => ({
        id: model.id,
        harness: harness.id,
        label: model.label,
        efforts: [...model.efforts],
        ...(model.defaultEffort ? { defaultEffort: model.defaultEffort } : {}),
        ...(model.variant ? { variant: model.variant } : {})
      }))
    )
  )
  const harnessOk = (id: string) =>
    catalog.value?.harnesses.find((harness) => harness.id === id)?.available === true
  const catalogEmpty = computed(
    () => catalog.value !== null && !models.value.some((item) => harnessOk(item.harness))
  )
  const error = computed(() =>
    query.error.value ? `Каталог моделей недоступен: ${describeError(query.error.value)}` : null
  )
  const find = (harness: string, id: string) =>
    models.value.find((item) => item.harness === harness && item.id === id) ?? null

  return {
    catalog,
    harnesses,
    models,
    loading: query.isLoading,
    error,
    catalogEmpty,
    harnessOk,
    find,
    refetch: () => query.refetch()
  }
}
