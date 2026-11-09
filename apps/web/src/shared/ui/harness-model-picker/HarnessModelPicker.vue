<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import { ChevronDownIcon } from "@lucide/vue";
import { cn } from "@/shared/lib";
import { Popover, PopoverContent, PopoverTrigger } from "../popover";
import { ProviderLogo } from "../provider-logo";
import HarnessModelListRow from "./HarnessModelListRow.vue";
import HarnessModelPickerRail from "./HarnessModelPickerRail.vue";
import { resolveHarnessEffort } from "./effort";
import { rankHarnessModels } from "./model-picker-search";
import {
  FAVORITES_TAB,
  type HarnessEntry,
  type HarnessModel,
} from "./types";

const props = withDefaults(
  defineProps<{
    harnesses: HarnessEntry[];
    models: HarnessModel[];
    provider: string;
    model: string;
    effort: string;
    loading?: boolean;
    error?: string | null;
    disabled?: boolean;
    compact?: boolean;
    size?: "sm" | "xs";
    placeholder?: string;
    ariaLabel?: string;
    /** id кнопки-триггера для `<label for>`. */
    triggerId?: string;
    /** Ключи избранного вида `provider/id`; без пропа звёзды скрыты. */
    favorites?: string[];
    /** Разрешить сбросить модель на выбор провайдера по умолчанию. */
    allowClear?: boolean;
    /** Разрешить ввести id модели вручную, если поиск ничего не нашёл. */
    allowCustom?: boolean;
  }>(),
  {
    loading: false,
    error: null,
    disabled: false,
    compact: false,
    size: "sm",
    placeholder: "Выберите модель",
    ariaLabel: "Модель",
    allowClear: false,
    allowCustom: false,
  },
);

const emit = defineEmits<{
  (event: "update:provider", value: string): void;
  (event: "update:model", value: string): void;
  (event: "update:effort", value: string): void;
  (event: "update:open", value: boolean): void;
  (event: "refresh"): void;
  (event: "update:favorites", value: string[]): void;
}>();

const pickerId = useId();
const listId = `${pickerId}-list`;
const open = ref(false);
const searchQuery = ref("");
const activeTab = ref<string>(props.provider);
const activeIndex = ref(0);
const searchInputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const railRef = ref<InstanceType<typeof HarnessModelPickerRail> | null>(null);

const selectedModel = computed<HarnessModel | null>(() => {
  const byHarness = props.models.find(
    (item) => item.harness === props.provider && item.id === props.model,
  );
  return byHarness ?? props.models.find((item) => item.id === props.model) ?? null;
});

const displayLabel = computed(() => {
  if (selectedModel.value) return selectedModel.value.label || selectedModel.value.id;
  return props.model || props.placeholder;
});

const triggerTitle = computed(() =>
  [displayLabel.value, selectedModel.value?.variant, props.effort].filter(Boolean).join(" · "),
);

const favoritesEnabled = computed(() => props.favorites !== undefined);
const favoriteSet = computed(() => new Set(props.favorites ?? []));
const isSearching = computed(() => searchQuery.value.trim().length > 0);

const visibleModels = computed<HarnessModel[]>(() => {
  if (isSearching.value) return rankHarnessModels(props.models, searchQuery.value);
  if (activeTab.value === FAVORITES_TAB) {
    return props.models.filter((item) => favoriteSet.value.has(modelKey(item)));
  }
  // Список приходит для одного харнеса: вкладка рейла фильтрует его, пока не
  // загрузится новый, и вместо чужих моделей показывается состояние загрузки.
  return props.models.filter((item) => item.harness === activeTab.value);
});

const activeHarnessError = computed(
  () => props.harnesses.find((entry) => entry.id === activeTab.value)?.error ?? null,
);

const customModel = computed<string | null>(() => {
  const value = searchQuery.value.trim();
  if (!props.allowCustom || !value) return null;
  return visibleModels.value.some((item) => item.id === value) ? null : value;
});

const activeOptionId = computed(() => {
  if (visibleModels.value.length === 0) return undefined;
  const index = Math.min(activeIndex.value, visibleModels.value.length - 1);
  return optionId(index);
});

const triggerClass = computed(() =>
  cn(
    "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-2 font-medium text-sm text-foreground/80 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    props.size === "xs"
      ? "h-7 gap-1 px-1.75 font-normal text-foreground/70 hover:text-foreground dark:text-muted-foreground sm:h-6 sm:text-xs"
      : "h-7",
    props.compact ? "max-w-42" : "max-w-48 sm:max-w-56",
  ),
);

function optionId(index: number): string {
  return `${pickerId}-option-${index}`;
}

/** Ключ модели: id уникален только внутри харнеса. */
function modelKey(model: HarnessModel): string {
  return `${model.harness}/${model.id}`;
}

function focusSearch(): void {
  void nextTick(() => searchInputRef.value?.focus({ preventScroll: true }));
}

function focusList(): void {
  void nextTick(() => listRef.value?.focus({ preventScroll: true }));
}

function scrollActiveIntoView(): void {
  void nextTick(() => {
    const id = activeOptionId.value;
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ block: "nearest" });
  });
}

function syncActiveIndex(): void {
  const index = visibleModels.value.findIndex((item) => item.id === props.model);
  activeIndex.value = index >= 0 ? index : 0;
  scrollActiveIntoView();
}

function moveActive(delta: 1 | -1): void {
  const list = visibleModels.value;
  if (list.length === 0) return;
  activeIndex.value = (activeIndex.value + delta + list.length) % list.length;
  scrollActiveIntoView();
}

function close(): void {
  open.value = false;
}

function onOpenAutoFocus(event: Event): void {
  event.preventDefault();
  focusSearch();
}

function selectHarness(id: string): void {
  if (props.disabled) return;
  activeTab.value = id;
  searchQuery.value = "";
  if (id !== FAVORITES_TAB && id !== props.provider) {
    emit("update:provider", id);
  }
}

function selectModel(model: HarnessModel): void {
  if (props.disabled) return;
  const isSameModel = model.id === props.model && model.harness === props.provider;
  // Поиск показывает модели всех харнесов: выбор модели выбирает и её харнес.
  if (model.harness !== props.provider) emit("update:provider", model.harness);
  // Для другой модели reasoning сбрасывается: по умолчанию берём low.
  const nextEffort = resolveHarnessEffort(model, isSameModel ? props.effort : "");
  if (!isSameModel) emit("update:model", model.id);
  if (nextEffort !== props.effort) emit("update:effort", nextEffort);
  // Поповер остаётся открытым, пока есть из чего выбрать reasoning.
  if (model.efforts.length <= 1) close();
}

function chooseEffort(model: HarnessModel, value: string): void {
  if (props.disabled) return;
  if (model.harness !== props.provider) emit("update:provider", model.harness);
  if (model.id !== props.model) emit("update:model", model.id);
  if (value !== props.effort) emit("update:effort", value);
}

function toggleFavorite(model: HarnessModel): void {
  if (props.disabled || props.favorites === undefined) return;
  const key = modelKey(model);
  const next = new Set(props.favorites);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  emit("update:favorites", [...next]);
  if (activeTab.value === FAVORITES_TAB) {
    void nextTick(syncActiveIndex);
  }
}

function selectActive(): void {
  const list = visibleModels.value;
  if (list.length === 0) {
    selectCustom();
    return;
  }
  const model = list[Math.min(activeIndex.value, list.length - 1)];
  if (model) selectModel(model);
}

function selectCustom(): void {
  const value = customModel.value;
  if (value === null) return;
  emit("update:model", value);
  if (props.effort) emit("update:effort", "");
  close();
}

function clearModel(): void {
  emit("update:model", "");
  if (props.effort) emit("update:effort", "");
  close();
}

function onSearchKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveActive(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveActive(-1);
    return;
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    focusList();
    return;
  }
  if (event.key === "ArrowLeft" && searchQuery.value.length === 0) {
    event.preventDefault();
    railRef.value?.focusActive();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    selectActive();
  }
}

function onListKeydown(event: KeyboardEvent): void {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveActive(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveActive(-1);
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    focusSearch();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    selectActive();
  }
}

watch(open, (value) => {
  emit("update:open", value);
  if (!value) return;
  searchQuery.value = "";
  activeTab.value = props.provider;
  syncActiveIndex();
  const current = selectedModel.value;
  if (current) {
    const next = resolveHarnessEffort(current, props.effort);
    if (next !== props.effort) emit("update:effort", next);
  }
});

watch([searchQuery, activeTab], syncActiveIndex);

watch(visibleModels, () => {
  const last = visibleModels.value.length - 1;
  if (last < 0) {
    activeIndex.value = 0;
    return;
  }
  if (activeIndex.value > last) activeIndex.value = last;
});

watch(
  () => props.models,
  () => {
    if (!isSearching.value) syncActiveIndex();
  },
);

watch(
  () => props.provider,
  (value) => {
    activeTab.value = value;
    syncActiveIndex();
  },
);

defineExpose({ close });
</script>

<template>
  <Popover v-model:open="open" :modal="true">
    <PopoverTrigger as-child>
      <slot name="trigger" :open="open" :disabled="disabled">
        <button
          type="button"
          :id="triggerId"
          :class="triggerClass"
          :disabled="disabled"
          :aria-label="ariaLabel"
          aria-haspopup="dialog"
          :aria-expanded="open"
          :title="triggerTitle"
          data-slot="harness-model-picker-trigger"
        >
          <ProviderLogo :provider="provider" class="size-4" />
          <span
            class="min-w-0 truncate"
            :class="!model && 'text-muted-foreground'"
          >
            {{ displayLabel }}<template v-if="effort">
              <span class="text-muted-foreground"> · {{ effort }}</span>
            </template>
          </span>
          <ChevronDownIcon
            :class="cn('opacity-50', size === 'xs' ? 'size-3.5' : 'size-4')"
            aria-hidden="true"
          />
        </button>
      </slot>
    </PopoverTrigger>

    <PopoverContent
      align="start"
      :side-offset="4"
      :collision-padding="8"
      class="flex max-h-86.5 w-90 max-w-[calc(100vw-1rem)] flex-row overflow-hidden rounded-lg border bg-popover p-0 text-popover-foreground shadow-lg outline-hidden"
      data-slot="harness-model-picker-content"
      @open-auto-focus.prevent="onOpenAutoFocus"
    >
      <HarnessModelPickerRail
        ref="railRef"
        :harnesses="harnesses"
        :active="activeTab"
        :show-favorites="favoritesEnabled"
        :disabled="disabled"
        @select="selectHarness"
        @focus-search="focusSearch"
      />

      <div
        class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border/70 bg-muted/40"
      >
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          :aria-controls="listId"
          :aria-activedescendant="activeOptionId"
          aria-label="Поиск модели"
          placeholder="Поиск модели"
          autocomplete="off"
          spellcheck="false"
          class="h-9 w-full shrink-0 border-b border-border/70 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
          @keydown="onSearchKeydown"
        />

        <div
          v-if="props.loading && visibleModels.length === 0"
          class="px-3 py-8 text-center text-xs text-muted-foreground"
          role="status"
        >
          Загружаю модели
        </div>

        <div
          v-else-if="props.error && visibleModels.length === 0"
          class="flex flex-col items-center gap-2 px-4 py-6 text-center"
          role="alert"
        >
          <span class="text-xs text-destructive">{{ props.error }}</span>
          <button
            type="button"
            class="cursor-pointer text-xs font-medium text-primary hover:underline focus-visible:outline-none"
            @click="emit('refresh')"
          >
            Обновить
          </button>
        </div>

        <div
          v-else-if="visibleModels.length === 0 && !customModel"
          class="px-3 py-8 text-center text-xs text-muted-foreground"
        >
          <template v-if="activeHarnessError && !isSearching">Харнес недоступен: {{ activeHarnessError }}</template>
          <template v-else>{{ activeTab === FAVORITES_TAB && !isSearching ? "Нет избранного" : "Нет моделей" }}</template>
        </div>

        <div
          v-else
          :id="listId"
          ref="listRef"
          role="listbox"
          tabindex="-1"
          aria-label="Модели"
          :aria-activedescendant="activeOptionId"
          class="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1.5 pr-px outline-none"
          @keydown="onListKeydown"
        >
          <HarnessModelListRow
            v-for="(item, index) in visibleModels"
            :key="modelKey(item)"
            :model="item"
            :option-id="optionId(index)"
            :active="index === activeIndex"
            :selected="item.id === model"
            :favorites-enabled="favoritesEnabled"
            :favorite="favoriteSet.has(modelKey(item))"
            :current-effort="effort"
            :disabled="disabled"
            @hover="activeIndex = index"
            @select="selectModel(item)"
            @favorite="toggleFavorite(item)"
            @effort="(value) => chooseEffort(item, value)"
          />
        </div>

        <button
          v-if="customModel"
          type="button"
          class="shrink-0 cursor-pointer border-t border-border/70 px-3 py-2 text-left text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          @click="selectCustom"
        >
          Использовать «{{ customModel }}»
        </button>

        <button
          v-if="allowClear && model"
          type="button"
          class="shrink-0 cursor-pointer border-t border-border/70 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:outline-none"
          @click="clearModel"
        >
          Модель по умолчанию
        </button>

        <slot name="footer" />

        <div
          v-if="props.error && visibleModels.length > 0"
          class="flex shrink-0 items-center gap-2 border-t border-border/70 px-3 py-1.5"
          role="alert"
        >
          <span class="min-w-0 flex-1 truncate text-xs text-destructive">
            {{ props.error }}
          </span>
          <button
            type="button"
            class="shrink-0 cursor-pointer text-xs font-medium text-primary hover:underline focus-visible:outline-none"
            @click="emit('refresh')"
          >
            Обновить
          </button>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
