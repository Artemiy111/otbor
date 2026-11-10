<script setup lang="ts">
import { applySortOptions, sortDirectionOptions } from "@/entities/apply-filter"
import { useHarnessCatalog } from "@/features/harness-catalog"
import { FieldPicker, RuleRow } from "@/features/rule-builder"
import {
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
import { computed } from "vue"
import { autoApplyHelp } from "../model/help"
import type { AutoDraft } from "../model/useAutoDraft"

const props = defineProps<{
  draft: AutoDraft
  disabled: boolean
  /** Выбрано конкретное резюме: дневной лимит общий на аккаунт и здесь не правится. */
  resumeLevel: boolean
  /** Действующий дневной лимит аккаунта (для резюме берётся из общей строки). */
  accountLimit: number | null
}>()
const emit = defineEmits<{ "edit-account": [] }>()

const draft = props.draft

const { harnesses, models, loading: catalogLoading, error: catalogError, refetch: refetchCatalog } = useHarnessCatalog()
const writerSet = computed(
  () => draft.writingHarness.value !== "" || draft.writingModel.value !== "" || draft.writingEffort.value !== ""
)
const resetWriter = () => {
  draft.writingHarness.value = ""
  draft.writingModel.value = ""
  draft.writingEffort.value = ""
}
</script>

<template>
  <Card>
    <CardContent class="space-y-5 p-4">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div class="space-y-1">
          <FieldLabel :hint="autoApplyHelp.dailyLimit">Лимит в сутки на аккаунт</FieldLabel>
          <template v-if="resumeLevel">
            <p class="flex h-8 items-center gap-2 text-sm">
              <span class="tabular-nums">{{ accountLimit ?? "—" }}</span>
              <Button variant="link" size="sm" class="h-auto p-0 text-xs" @click="emit('edit-account')">
                Изменить для аккаунта
              </Button>
            </p>
          </template>
          <Input v-else v-model.number="draft.dailyLimit.value" type="number" min="0" class="h-8" :disabled="disabled" />
        </div>
        <div class="space-y-1">
          <FieldLabel :hint="autoApplyHelp.batchSize">Размер партии (1–500)</FieldLabel>
          <Input v-model.number="draft.batchSize.value" type="number" min="1" max="500" class="h-8" :disabled="disabled" />
        </div>
        <div class="space-y-1">
          <FieldLabel :hint="autoApplyHelp.minPriority">Минимальный приоритет</FieldLabel>
          <Input v-model.number="draft.minPriority.value" type="number" min="0" class="h-8" :disabled="disabled" />
        </div>
        <div class="space-y-1">
          <FieldLabel :hint="autoApplyHelp.sort">Сортировка</FieldLabel>
          <Select v-model="draft.sort.value" :disabled="disabled">
            <SelectTrigger class="h-8 w-full text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in applySortOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="space-y-1">
          <FieldLabel :hint="autoApplyHelp.sortDirection">Порядок</FieldLabel>
          <Select v-model="draft.sortDirection.value" :disabled="disabled">
            <SelectTrigger class="h-8 w-full text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in sortDirectionOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
          <Badge v-if="draft.sortDirection.value === 'asc'" variant="warning">Порядок инвертирован</Badge>
        </div>
      </div>

      <div class="space-y-1 border-t border-border pt-4">
        <FieldLabel :hint="autoApplyHelp.writer">Кто пишет письма</FieldLabel>
        <div class="flex flex-wrap items-center gap-2">
          <HarnessModelPicker
            v-model:provider="draft.writingHarness.value"
            v-model:model="draft.writingModel.value"
            v-model:effort="draft.writingEffort.value"
            :harnesses="harnesses"
            :models="models"
            :loading="catalogLoading"
            :error="catalogError"
            :disabled="disabled"
            placeholder="по умолчанию"
            class="border-border"
            @refresh="refetchCatalog()"
          />
          <Button v-if="writerSet" variant="ghost" size="sm" class="h-7" :disabled="disabled" @click="resetWriter">
            Сбросить
          </Button>
          <span v-else class="text-xs text-muted-foreground">Агент, модель и уровень усилий по умолчанию.</span>
        </div>
      </div>

      <div class="space-y-2 border-t border-border pt-4">
        <FieldLabel :hint="autoApplyHelp.boosts">
          Бонусы к соответствию (вес от −50 до 50, прибавляется, когда правило выполнено)
        </FieldLabel>
        <div v-for="boost in draft.boosts.value" :key="boost.id" class="flex items-start gap-2">
          <div class="min-w-0 flex-1">
            <RuleRow :rule="boost.rule" :disabled="disabled" @remove="draft.removeBoost(boost.id)" />
          </div>
          <Input
            v-model.number="boost.weight"
            type="number"
            min="-50"
            max="50"
            step="1"
            class="h-8 w-20"
            aria-label="Вес бонуса"
            title="Вес"
            :disabled="disabled"
          />
        </div>
        <div class="flex items-center gap-2">
          <FieldPicker label="Бонус" :disabled="disabled" @pick="draft.addBoost" />
          <span v-if="draft.boosts.value.length === 0" class="text-xs text-muted-foreground">Бонусов нет.</span>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
