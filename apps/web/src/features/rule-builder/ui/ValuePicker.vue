<script setup lang="ts">
import { computed, onMounted, ref, watch, type Component } from "vue"
import type { HhAccountRecord, ResumeRecord } from "@otbor/contract"
import { Check, ChevronDown, Search, Users } from "@lucide/vue"
import {
  hhAccountColor,
  hhAccountColorById,
  hhAccountInitials,
  hhAccountName
} from "@/entities/hh-account"
import { resumeCode } from "@/entities/resume"
import { Input, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui"
import type { PresetFieldOption } from "../model/fields"
import AvatarCircle from "./AvatarCircle.vue"

/**
 * Множественный выбор значений правила: аккаунты и резюме.
 * Резюме сгруппированы по аккаунту, поэтому имя аккаунта не повторяется в каждой строке.
 */
const props = withDefaults(
  defineProps<{
    modelValue: ReadonlyArray<string>
    options: ReadonlyArray<PresetFieldOption>
    accounts: ReadonlyArray<HhAccountRecord>
    resumes: ReadonlyArray<ResumeRecord>
    placeholder?: string
    searchPlaceholder?: string
    disabled?: boolean
    autofocus?: boolean
  }>(),
  {
    placeholder: "Выбрать…",
    searchPlaceholder: "Поиск…",
    disabled: false,
    autofocus: false
  }
)
const emit = defineEmits<{ "update:modelValue": [values: Array<string>] }>()

const open = ref(false)
const search = ref("")
onMounted(() => {
  if (props.autofocus) open.value = true
})
watch(open, (value) => {
  if (!value) search.value = ""
})

const isSelected = (value: string): boolean => props.modelValue.includes(value)

interface Circle {
  readonly color: string
  readonly text: string
}

const selectorId = (value: string): string => (value.includes(":") ? (value.split(":")[1] ?? "") : "")

/** Кружок селектора: аккаунт — инициалы, резюме — код цветом своего аккаунта. */
const circleFor = (option: PresetFieldOption): Circle | null => {
  if (option.icon === "account") {
    const account = props.accounts.find((item) => item.id === selectorId(option.value))
    return account === undefined
      ? null
      : { color: hhAccountColor(account), text: hhAccountInitials(hhAccountName(account)) }
  }
  if (option.icon === "resume") {
    const resume = props.resumes.find((item) => item.id === selectorId(option.value))
    if (resume === undefined) return null
    const titles = props.resumes
      .filter((item) => item.hhAccountId === resume.hhAccountId)
      .map((item) => item.title)
    return {
      color: hhAccountColorById(props.accounts, resume.hhAccountId),
      text: resumeCode(resume.title, titles)
    }
  }
  return null
}

const byValue = computed(() => new Map(props.options.map((option) => [option.value, option])))
const selected = computed(() =>
  props.modelValue.map((value) => byValue.value.get(value) ?? { value, label: value })
)

const visible = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase("ru-RU")
  if (needle === "") return props.options
  return props.options.filter((option) =>
    `${option.label} ${option.description ?? ""} ${option.group ?? ""}`
      .toLocaleLowerCase("ru-RU")
      .includes(needle)
  )
})

interface OptionGroup {
  readonly key: string
  readonly title: string
  readonly icon: Component | null
  readonly groupId?: string
  readonly items: ReadonlyArray<PresetFieldOption>
}

const groups = computed<ReadonlyArray<OptionGroup>>(() => {
  const result: Array<{
    key: string
    title: string
    icon: Component | null
    groupId?: string
    items: PresetFieldOption[]
  }> = []
  const put = (
    key: string,
    title: string,
    icon: Component | null,
    option: PresetFieldOption,
    groupId?: string
  ) => {
    let group = result.find((item) => item.key === key)
    if (group === undefined) {
      group = { key, title, icon, groupId, items: [] }
      result.push(group)
    }
    group.items.push(option)
  }
  for (const option of visible.value) {
    if (option.group !== undefined && option.group !== "") {
      put(`group:${option.groupId ?? option.group}`, option.group, null, option, option.groupId)
      continue
    }
    switch (option.icon) {
      case "any":
        put("any", "Любые", Users, option)
        break
      case "account":
        put("account", "Аккаунты", Users, option)
        break
      case "resume":
        put("resume", "Резюме", Users, option)
        break
      default:
        put("other", "Прочее", null, option)
    }
  }
  return result
})

const groupCircle = (group: OptionGroup): Circle | null => {
  if (group.groupId === undefined) return null
  const account = props.accounts.find((item) => item.id === group.groupId)
  return account === undefined
    ? null
    : { color: hhAccountColor(account), text: hhAccountInitials(hhAccountName(account)) }
}

const toggle = (value: string) => {
  const next = isSelected(value)
    ? props.modelValue.filter((item) => item !== value)
    : [...props.modelValue, value]
  emit("update:modelValue", next)
}
const clear = () => emit("update:modelValue", [])
const toggleFirst = () => {
  const first = visible.value[0]
  if (first !== undefined) toggle(first.value)
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="inline-flex h-8 min-w-0 max-w-full flex-1 items-center justify-between gap-1 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm transition-colors hover:bg-accent disabled:opacity-50"
        :disabled="props.disabled"
      >
        <span v-if="selected.length === 0" class="truncate text-muted-foreground">{{ props.placeholder }}</span>
        <span v-else class="flex min-w-0 items-center gap-1 overflow-hidden">
          <span
            v-for="option in selected.slice(0, 2)"
            :key="option.value"
            class="inline-flex min-w-0 items-center gap-1 rounded bg-muted/70 py-0.5 pl-0.5 pr-1.5"
          >
            <AvatarCircle
              :color="circleFor(byValue.get(option.value) ?? option)?.color"
              :text="circleFor(byValue.get(option.value) ?? option)?.text"
            />
            <span class="truncate">{{ option.label }}</span>
          </span>
          <span v-if="selected.length > 2" class="shrink-0 text-muted-foreground">+{{ selected.length - 2 }}</span>
        </span>
        <ChevronDown class="size-3.5 shrink-0 opacity-50" />
      </button>
    </PopoverTrigger>
    <PopoverContent class="w-[320px] p-1.5" align="start">
      <div class="relative mb-1.5">
        <Search class="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground" />
        <Input
          v-model="search"
          class="h-7 pl-7 text-xs"
          :placeholder="props.searchPlaceholder"
          @keydown.enter.prevent="toggleFirst"
        />
      </div>
      <div class="max-h-72 overflow-auto pr-0.5">
        <template v-for="(group, index) in groups" :key="group.key">
          <div v-if="index > 0" class="mx-2 my-1.5 h-px bg-border/70" />
          <div class="mb-1.5 last:mb-0">
            <p class="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground">
              <AvatarCircle
                v-if="groupCircle(group)"
                :color="groupCircle(group)?.color"
                :text="groupCircle(group)?.text"
              />
              <Search v-else-if="group.icon" class="size-3" />
              {{ group.title }}
            </p>
            <button
              v-for="option in group.items"
              :key="option.value"
              type="button"
              class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors"
              :class="isSelected(option.value) ? 'bg-primary/10 text-foreground' : 'hover:bg-accent'"
              :title="option.description === undefined ? option.label : `${option.label} — ${option.description}`"
              @click="toggle(option.value)"
            >
              <AvatarCircle :color="circleFor(option)?.color" :text="circleFor(option)?.text" />
              <span class="min-w-0 flex-1">
                <span class="block truncate">{{ option.label }}</span>
                <span v-if="option.description" class="block truncate text-[11px] text-muted-foreground">{{ option.description }}</span>
              </span>
              <Check v-if="isSelected(option.value)" class="size-3.5 shrink-0 text-primary" />
            </button>
          </div>
        </template>
        <p v-if="groups.length === 0" class="px-2 py-3 text-xs text-muted-foreground">Ничего не найдено.</p>
      </div>
      <div v-if="props.modelValue.length > 0" class="mt-1 flex justify-end border-t pt-1">
        <button
          type="button"
          class="rounded px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          @click="clear"
        >
          Очистить
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>
