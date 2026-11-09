<script setup lang="ts">
import { computed, ref } from "vue"
import type { PresetField } from "@otbor/contract"
import { ChevronDown, Plus, Search, Sparkles } from "@lucide/vue"
import { Input, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui"
import { PRESET_FIELD_GROUPS, presetFieldMeta } from "../model/fields"

/**
 * Searchable, grouped list of fields. Without `current` the trigger is a
 * "+ label" button (add a rule); with it the trigger looks like a select showing
 * the current field, so changing and adding a field share one list and one style.
 */
const props = withDefaults(
  defineProps<{ label?: string; disabled?: boolean; current?: PresetField }>(),
  { label: "Правило", disabled: false, current: undefined }
)
const currentMeta = computed(() => (props.current === undefined ? null : presetFieldMeta(props.current)))
const emit = defineEmits<{ pick: [field: PresetField] }>()

const open = ref(false)
const search = ref("")

const groups = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase("ru-RU")
  return PRESET_FIELD_GROUPS.map((group) => ({
    group: group.group,
    fields: group.fields.filter(
      (meta) => needle === "" || meta.label.toLocaleLowerCase("ru-RU").includes(needle)
    )
  })).filter((group) => group.fields.length > 0)
})

const pickFirst = () => {
  const first = groups.value[0]?.fields[0]
  if (first !== undefined) pick(first.field)
}

const pick = (field: PresetField) => {
  emit("pick", field)
  open.value = false
  search.value = ""
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        v-if="currentMeta === null"
        type="button"
        class="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-border px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        :disabled="props.disabled"
      >
        <Plus class="h-3.5 w-3.5" />
        {{ props.label }}
      </button>
      <button
        v-else
        type="button"
        class="inline-flex h-7 w-[170px] items-center justify-between gap-1 whitespace-nowrap rounded-md border bg-transparent px-2 text-xs shadow-sm hover:bg-accent disabled:opacity-50"
        :class="currentMeta.ai ? 'border-violet-500/50 bg-violet-500/10 text-violet-500' : 'border-input'"
        :title="currentMeta.hint"
        :disabled="props.disabled"
      >
        <span class="flex min-w-0 items-center gap-1">
          <Sparkles v-if="currentMeta.ai" class="h-3 w-3 shrink-0" />
          <span class="truncate">{{ currentMeta.label }}</span>
        </span>
        <ChevronDown class="h-4 w-4 shrink-0 opacity-50" />
      </button>
    </PopoverTrigger>
    <PopoverContent class="w-64 p-2" align="start">
      <div class="relative mb-1.5">
        <Search class="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          v-model="search"
          class="h-7 pl-7 text-xs"
          placeholder="Поле…"
          @keydown.enter.prevent="pickFirst"
        />
      </div>
      <div class="max-h-72 overflow-auto">
        <div v-for="group in groups" :key="group.group" class="mb-1">
          <p
            class="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.06em]"
            :class="group.fields.some((m) => m.ai) ? 'text-violet-500' : 'text-muted-foreground'"
          >
            <Sparkles v-if="group.fields.some((m) => m.ai)" class="h-3 w-3" />
            {{ group.group }}
          </p>
          <button
            v-for="m in group.fields"
            :key="m.field"
            type="button"
            class="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-xs hover:bg-accent"
            :title="m.hint"
            :class="m.field === props.current ? 'bg-accent' : ''"
            @click="pick(m.field)"
          >
            {{ m.label }}
            <span
              v-if="m.ai"
              class="ml-auto rounded bg-violet-500/15 px-1 text-[10px] font-semibold text-violet-500"
            >ИИ</span>
          </button>
        </div>
        <p v-if="groups.length === 0" class="p-2 text-xs text-muted-foreground">Ничего не найдено.</p>
      </div>
    </PopoverContent>
  </Popover>
</template>
