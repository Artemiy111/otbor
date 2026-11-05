<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { ChevronLeft, ChevronRight, X } from "@lucide/vue"
import { Input } from "@/shared/ui"
import { areaLabel, areasModule, loadAreas } from "@/shared/lib"

/**
 * Multi-select over hh's country > region > city tree. Picking a country
 * covers all its cities; the stored values are hh area ids as strings.
 * Without a query the list drills down level by level; typing searches the
 * whole tree and shows where each hit lives.
 */
const props = withDefaults(
  defineProps<{ modelValue: ReadonlyArray<string>; disabled?: boolean }>(),
  { disabled: false }
)
const emit = defineEmits<{ "update:modelValue": [value: string[]] }>()

onMounted(() => void loadAreas())

const query = ref("")
/** Ids from the root down to the level being shown; empty means the countries. */
const trail = ref<Array<number>>([])

const tree = computed(() => areasModule.value)
const level = computed(() => trail.value[trail.value.length - 1] ?? 0)

const rows = computed(() => {
  const module = tree.value
  if (module === null) return []
  const needle = query.value.trim()
  const areas = needle === "" ? module.areaChildren(level.value) : module.searchAreas(needle, 60)
  return areas.map((area) => ({
    id: area.id,
    name: area.name,
    context: needle === ""
      ? ""
      : module.areaPath(area.id).slice(0, -1).map((item) => item.name).join(", "),
    hasChildren: module.areaChildren(area.id).length > 0
  }))
})

const crumbs = computed(() => {
  const module = tree.value
  if (module === null) return []
  return trail.value.map((id) => ({ id, name: module.findArea(id)?.name ?? String(id) }))
})

const selected = computed(() => new Set(props.modelValue))

const toggle = (id: number) => {
  const value = String(id)
  emit(
    "update:modelValue",
    selected.value.has(value)
      ? props.modelValue.filter((item) => item !== value)
      : [...props.modelValue, value]
  )
}

const open = (id: number) => {
  query.value = ""
  trail.value = [...trail.value, id]
}
const upTo = (index: number) => {
  trail.value = trail.value.slice(0, index)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-if="props.modelValue.length > 0" class="flex flex-wrap gap-1">
      <span
        v-for="id in props.modelValue"
        :key="id"
        class="inline-flex items-center gap-1 rounded-full border bg-accent/50 px-2 py-0.5 text-xs"
      >
        {{ areaLabel(id) }}
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground disabled:opacity-50"
          :disabled="props.disabled"
          @click="toggle(Number(id))"
        >
          <X class="h-3 w-3" />
        </button>
      </span>
    </div>

    <Input v-model="query" class="h-7 text-xs" placeholder="Найти страну, регион или город" :disabled="props.disabled" />

    <div v-if="query.trim() === '' && trail.length > 0" class="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <button type="button" class="inline-flex items-center hover:text-foreground" @click="upTo(0)">
        <ChevronLeft class="h-3 w-3" /> Все страны
      </button>
      <template v-for="(crumb, index) in crumbs" :key="crumb.id">
        <span>/</span>
        <button type="button" class="hover:text-foreground" @click="upTo(index + 1)">{{ crumb.name }}</button>
      </template>
    </div>

    <div class="max-h-72 overflow-y-auto">
      <p v-if="tree === null" class="px-2 py-1 text-xs text-muted-foreground">Загружаю справочник…</p>
      <p v-else-if="rows.length === 0" class="px-2 py-1 text-xs text-muted-foreground">Ничего не найдено</p>
      <div
        v-for="row in rows"
        :key="row.id"
        class="flex items-center gap-1 rounded-sm hover:bg-accent"
      >
        <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1 text-xs">
          <input
            type="checkbox"
            class="size-3.5 shrink-0 rounded border-input accent-primary"
            :checked="selected.has(String(row.id))"
            :disabled="props.disabled"
            @change="toggle(row.id)"
          />
          <span class="truncate">{{ row.name }}</span>
          <span v-if="row.context !== ''" class="truncate text-muted-foreground">{{ row.context }}</span>
        </label>
        <button
          v-if="row.hasChildren && query.trim() === ''"
          type="button"
          class="inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          title="Показать вложенные"
          @click="open(row.id)"
        >
          <ChevronRight class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>
