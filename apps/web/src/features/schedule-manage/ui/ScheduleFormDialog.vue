<script setup lang="ts">
import { computed, ref, watch } from "vue"
import type { CrawlSchedule, ScheduleKind } from "@otbor/contract"
import { ArrowLeft, CircleAlert } from "@lucide/vue"
import {
  formKindOf,
  MANUAL_KINDS,
  OTHER_KINDS,
  SCHEDULE_KIND_META,
  scheduleKindName,
  ScheduleKindIcon,
  type ScheduleUpsertInput
} from "@/entities/schedule"
import { Alert, AlertDescription, AlertTitle, Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/shared/ui"
import { useScheduleActions } from "../model/use-schedule-actions"
import GenericScheduleForm from "./forms/GenericScheduleForm.vue"
import HydrationScheduleForm from "./forms/HydrationScheduleForm.vue"
import MailScheduleForm from "./forms/MailScheduleForm.vue"
import SearchScheduleForm from "./forms/SearchScheduleForm.vue"
import TelegramScheduleForm from "./forms/TelegramScheduleForm.vue"

const props = withDefaults(
  defineProps<{
    /** Расписание для правки; `null` - создание нового. */
    schedule?: CrawlSchedule | null
    /** Какие виды можно создать здесь (страница поиска оставляет только поиск). */
    kinds?: ReadonlyArray<ScheduleKind>
    /** Все расписания: у догрузки на вид бывает одно, повторно оно правится, а не создаётся. */
    existing?: ReadonlyArray<CrawlSchedule>
  }>(),
  { schedule: null, kinds: () => MANUAL_KINDS, existing: () => [] }
)

const open = defineModel<boolean>("open", { required: true })
const emit = defineEmits<{ saved: [schedule: CrawlSchedule] }>()

const actions = useScheduleActions()
const kind = ref<ScheduleKind | null>(null)

const reset = () => {
  actions.reset()
  if (props.schedule !== null) kind.value = formKindOf(props.schedule.kind)
  else kind.value = props.kinds.length === 1 ? (props.kinds[0] ?? null) : null
}

watch(open, (isOpen) => {
  if (isOpen) reset()
})

const isHydration = (value: ScheduleKind | null): value is "vacancy_hydration" | "employer_hydration" =>
  value === "vacancy_hydration" || value === "employer_hydration"

/** Что правим: выбранное расписание или уже существующая догрузка того же вида. */
const editing = computed<CrawlSchedule | null>(() => {
  if (props.schedule !== null) return props.schedule
  if (isHydration(kind.value)) return props.existing.find((item) => item.kind === kind.value) ?? null
  return null
})
const reusedExisting = computed(() => props.schedule === null && editing.value !== null)

const canPick = computed(() => props.schedule === null && props.kinds.length > 1)
const showPicker = computed(() => kind.value === null)
const showOthers = computed(() => props.schedule === null && props.kinds.length > 1)

const others = OTHER_KINDS.flatMap((value) => {
  const home = SCHEDULE_KIND_META[value].home
  return home === null ? [] : [{ kind: value, label: scheduleKindName(value), ...home }]
})

const title = computed(() => {
  if (props.schedule !== null) return `Изменить: ${scheduleKindName(props.schedule.kind)}`
  if (kind.value === null) return "Добавить расписание"
  if (reusedExisting.value) return `Изменить: ${scheduleKindName(kind.value)}`
  return `Новое расписание: ${scheduleKindName(kind.value)}`
})

const submit = async (input: ScheduleUpsertInput) => {
  const saved = await actions.save(input)
  if (saved !== null) {
    open.value = false
    emit("saved", saved)
  }
}
</script>

<template>
  <Sheet v-model:open="open">
    <SheetContent
      side="top"
      class="inset-x-auto top-1/2 left-1/2 max-h-[90vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border data-[state=closed]:slide-out-to-top-0 data-[state=open]:slide-in-from-top-0"
    >
      <SheetHeader>
        <SheetTitle>{{ title }}</SheetTitle>
        <SheetDescription>
          <template v-if="showPicker">Выберите, что должно запускаться само.</template>
          <template v-else-if="reusedExisting">
            Такое расписание уже есть, поэтому здесь его настройки: второе создать нельзя.
          </template>
          <template v-else>Запуск пойдёт сам с выбранной частотой; его можно выключить в любой момент.</template>
        </SheetDescription>
      </SheetHeader>

      <div class="space-y-4 px-4 pb-4">
        <Alert v-if="actions.error.value" variant="destructive">
          <CircleAlert />
          <AlertTitle>Не удалось сохранить</AlertTitle>
          <AlertDescription>{{ actions.error.value }}</AlertDescription>
        </Alert>

        <div v-if="showPicker" class="space-y-4">
          <ul class="grid gap-2">
            <li v-for="value in kinds" :key="value">
              <button
                type="button"
                class="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                @click="kind = value"
              >
                <ScheduleKindIcon :kind="value" />
                <span class="min-w-0">
                  <span class="block text-sm font-medium">{{ scheduleKindName(value) }}</span>
                  <span class="block text-xs text-muted-foreground">{{ SCHEDULE_KIND_META[value].description }}</span>
                </span>
              </button>
            </li>
          </ul>

          <div v-if="showOthers" class="rounded-lg border border-dashed p-3 text-sm">
            <p class="font-medium">Остальные расписания создаются на своих страницах</p>
            <ul class="mt-1 space-y-0.5 text-xs text-muted-foreground">
              <li v-for="home in others" :key="home.kind">
                <a :href="home.href" class="underline-offset-4 hover:text-foreground hover:underline" @click="open = false">
                  <span class="font-medium text-foreground">{{ home.label }}</span>: {{ home.text }}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <template v-else>
          <Button v-if="canPick" variant="ghost" size="sm" class="-ml-2" @click="kind = null">
            <ArrowLeft />
            Другой вид
          </Button>

          <SearchScheduleForm
            v-if="kind === 'search'"
            :key="`search-${editing?.id ?? 'new'}`"
            :schedule="editing"
            :saving="actions.saving.value"
            @submit="submit"
            @cancel="open = false"
          />
          <HydrationScheduleForm
            v-else-if="isHydration(kind)"
            :key="`${kind}-${editing?.id ?? 'new'}`"
            :kind="kind"
            :schedule="editing"
            :saving="actions.saving.value"
            @submit="submit"
            @cancel="open = false"
          />
          <MailScheduleForm
            v-else-if="kind === 'mail_sync'"
            :key="`mail-${editing?.id ?? 'new'}`"
            :schedule="editing"
            :saving="actions.saving.value"
            @submit="submit"
            @cancel="open = false"
          />
          <TelegramScheduleForm
            v-else-if="kind === 'telegram_sync'"
            :key="`telegram-${editing?.id ?? 'new'}`"
            :schedule="editing"
            :saving="actions.saving.value"
            @submit="submit"
            @cancel="open = false"
          />
          <GenericScheduleForm
            v-else-if="editing !== null"
            :key="`generic-${editing.id}`"
            :schedule="editing"
            :saving="actions.saving.value"
            @submit="submit"
            @cancel="open = false"
          />
        </template>
      </div>
    </SheetContent>
  </Sheet>
</template>
