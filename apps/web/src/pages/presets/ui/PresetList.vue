<script setup lang="ts">
import { computed, ref } from "vue"
import type { PresetRecord } from "@otbor/contract"
import { Search } from "@lucide/vue"
import { formatDate } from "@/shared/lib"
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  Input,
  Skeleton
} from "@/shared/ui"
import { presetRules } from "@/features/rule-builder"

const props = withDefaults(
  defineProps<{
    presets: ReadonlyArray<PresetRecord>
    selectedId: string | null
    loading?: boolean
  }>(),
  { loading: false }
)

const emit = defineEmits<{ select: [id: string] }>()

const search = ref("")

const filtered = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase("ru-RU")
  if (needle === "") return props.presets
  return props.presets.filter((preset) =>
    preset.title.toLocaleLowerCase("ru-RU").includes(needle)
  )
})

const groups = computed(() =>
  [
    { title: "Системные", items: filtered.value.filter((preset) => preset.system) },
    { title: "Мои пресеты", items: filtered.value.filter((preset) => !preset.system) }
  ].filter((group) => group.items.length > 0)
)

const ruleCount = (preset: PresetRecord): number => presetRules(preset.filter).length + (preset.filter.groups?.length ?? 0)
</script>

<template>
  <Card class="overflow-hidden">
    <CardHeader class="gap-2 border-b border-border p-3">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          Список
        </span>
        <span class="text-[11px] tabular-nums text-muted-foreground">
          {{ props.presets.length }}
        </span>
      </div>
      <div class="relative">
        <Search
          class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          v-model="search"
          type="text"
          placeholder="Поиск по названию"
          class="h-8 pl-8 text-xs"
        />
      </div>
    </CardHeader>

    <CardContent class="p-0">
      <div v-if="props.loading" class="space-y-2 p-3">
        <Skeleton v-for="index in 5" :key="index" class="h-10 w-full" />
      </div>

      <template v-else-if="groups.length > 0">
        <div
          v-for="group in groups"
          :key="group.title"
          class="border-b border-border last:border-b-0"
        >
          <div class="flex items-center justify-between bg-muted/30 px-3 py-1">
            <span
              class="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
            >
              {{ group.title }}
            </span>
            <span class="text-[10px] tabular-nums text-muted-foreground">
              {{ group.items.length }}
            </span>
          </div>

          <button
            v-for="preset in group.items"
            :key="preset.id"
            type="button"
            class="flex w-full items-start gap-2 border-l-2 px-3 py-2 text-left transition-colors hover:bg-accent/40"
            :class="
              preset.id === props.selectedId
                ? 'border-l-primary bg-accent/50'
                : 'border-l-transparent'
            "
            @click="emit('select', preset.id)"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span class="truncate text-sm font-medium">{{ preset.title }}</span>
              </div>
              <div class="mt-0.5 text-[11px] text-muted-foreground">
                правил {{ ruleCount(preset) }} · {{ formatDate(preset.updatedAt) }}
              </div>
            </div>
          </button>
        </div>
      </template>

      <p v-else class="px-3 py-6 text-xs text-muted-foreground">
        {{ search.trim() === "" ? "Пресетов пока нет." : "По названию ничего не найдено." }}
      </p>
    </CardContent>
  </Card>
</template>
