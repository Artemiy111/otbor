<script setup lang="ts">
import type { HhAccountRecord, PresetRecord } from "@otbor/contract"
import { ALL_ACCOUNTS, DEFAULT_ACCOUNT } from "@/entities/hh-account"
import { accountFilterOptions } from "@/features/account-filter"
import { RuleBuilder } from "@/features/rule-builder"
import type { AnalysedFilter } from "../model/filters"
import { Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui"

/**
 * Панель «Фильтры»: то, что реже нужно, чем поиск и быстрые фильтры. Прежние
 * скрытые списки (архив, чёрный список, ИИ-анализ, аккаунт) лежат здесь с
 * понятными подписями, ниже пресеты и конструктор правил.
 */
// RuleBuilder принимает редактируемое значение целиком, как и страница.
const rules = defineModel<any>("rules", { required: true })

defineProps<{
  /** Выбор аккаунта: `default`, `all` или id. */
  account: string
  archived: boolean
  blacklisted: boolean
  analysed: AnalysedFilter
  accounts: ReadonlyArray<HhAccountRecord>
  defaultAccountId: string | undefined
  presets: ReadonlyArray<PresetRecord>
  ruleCount: number
}>()

const emit = defineEmits<{
  account: [value: string]
  archived: [value: boolean]
  blacklisted: [value: boolean]
  analysed: [value: AnalysedFilter]
  preset: [id: string]
  "clear-rules": []
}>()

const ARCHIVE = [
  { value: "hide", label: "Скрыты" },
  { value: "show", label: "Показывать" }
] as const
const BLACKLIST = [
  { value: "hide", label: "Скрыт" },
  { value: "show", label: "Показывать с пометкой" }
] as const
const ANALYSED = [
  { value: "all", label: "Любые" },
  { value: "yes", label: "Только проанализированные" },
  { value: "no", label: "Только без анализа" }
] as const
</script>

<template>
  <section class="mb-4 space-y-4 rounded-lg border border-border bg-card p-4" aria-label="Фильтры">
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div class="space-y-1.5">
        <Label for="vf-account">Аккаунт hh</Label>
        <Select :model-value="account" @update:model-value="emit('account', String($event))">
          <SelectTrigger id="vf-account" class="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="option in accountFilterOptions(accounts, defaultAccountId)"
              :key="option.value"
              :value="option.value"
            >
              {{ option.value === DEFAULT_ACCOUNT ? option.label.replace('Как в шапке', 'Основной') : option.value === ALL_ACCOUNTS ? 'Все (решения основного аккаунта)' : option.label }}
            </SelectItem>
          </SelectContent>
        </Select>
        <p class="text-xs text-muted-foreground">От его имени считаются вердикты, отклики и чёрный список.</p>
      </div>
      <div class="space-y-1.5">
        <Label for="vf-archived">Архивные вакансии</Label>
        <Select :model-value="archived ? 'show' : 'hide'" @update:model-value="emit('archived', $event === 'show')">
          <SelectTrigger id="vf-archived" class="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="o in ARCHIVE" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="space-y-1.5">
        <Label for="vf-blacklist">Чёрный список</Label>
        <Select :model-value="blacklisted ? 'show' : 'hide'" @update:model-value="emit('blacklisted', $event === 'show')">
          <SelectTrigger id="vf-blacklist" class="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="o in BLACKLIST" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="space-y-1.5">
        <Label for="vf-analysed">ИИ-анализ</Label>
        <Select :model-value="analysed" @update:model-value="emit('analysed', $event as AnalysedFilter)">
          <SelectTrigger id="vf-analysed" class="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="o in ANALYSED" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <div class="space-y-2 border-t border-border pt-4">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-sm font-medium">Правила отбора</h3>
        <Select v-if="presets.length > 0" model-value="" @update:model-value="emit('preset', String($event))">
          <SelectTrigger class="h-8 w-[220px] text-xs" aria-label="Применить сохранённый набор правил">
            <SelectValue placeholder="Взять из пресета…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="preset in presets" :key="preset.id" :value="preset.id">{{ preset.title }}</SelectItem>
          </SelectContent>
        </Select>
        <Button v-if="ruleCount > 0" variant="ghost" size="sm" @click="emit('clear-rules')">Сбросить правила</Button>
      </div>
      <RuleBuilder v-model="rules" :flags="false" />
    </div>
  </section>
</template>
