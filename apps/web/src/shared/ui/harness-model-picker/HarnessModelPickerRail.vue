<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { StarIcon } from "@lucide/vue";
import { cn } from "@/shared/lib";
import { ProviderLogo } from "../provider-logo";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../tooltip";
import { FAVORITES_TAB, type HarnessEntry } from "./types";

const props = withDefaults(
  defineProps<{
    harnesses: HarnessEntry[];
    /** id харнеса или FAVORITES_TAB. */
    active: string;
    showFavorites?: boolean;
    disabled?: boolean;
  }>(),
  { showFavorites: false, disabled: false },
);

const emit = defineEmits<{
  (event: "select", id: string): void;
  (event: "focus-search"): void;
}>();

const railRef = ref<HTMLElement | null>(null);

const buttonClass = cn(
  "relative isolate flex aspect-square w-full shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-foreground/10 focus-visible:bg-foreground/10 focus-visible:outline-none aria-pressed:bg-foreground/10 aria-pressed:text-foreground",
  "disabled:pointer-events-none disabled:opacity-50",
);

const tabIds = computed<string[]>(() => [
  ...(props.showFavorites ? [FAVORITES_TAB] : []),
  ...props.harnesses.map((entry) => entry.id),
]);

function focusActive(): void {
  const root = railRef.value;
  if (!root) return;
  const target =
    root.querySelector<HTMLButtonElement>('button[aria-pressed="true"]:not(:disabled)') ??
    root.querySelector<HTMLButtonElement>("button:not(:disabled)");
  target?.focus({ preventScroll: true });
}

function choose(id: string, focusSearch: boolean): void {
  if (props.disabled) return;
  emit("select", id);
  if (focusSearch) {
    emit("focus-search");
    return;
  }
  void nextTick(focusActive);
}

function move(direction: 1 | -1): void {
  const ids = tabIds.value;
  if (ids.length === 0) return;
  const index = ids.indexOf(props.active);
  const next = ids[(index < 0 ? 0 : index + direction + ids.length) % ids.length];
  if (next !== undefined) choose(next, false);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    move(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    emit("focus-search");
  }
}

defineExpose({ focusActive });
</script>

<template>
  <div
    ref="railRef"
    role="toolbar"
    aria-orientation="vertical"
    aria-label="Харнес"
    data-slot="harness-model-picker-rail"
    class="w-11 shrink-0 overflow-hidden bg-muted/30"
    @keydown="onKeydown"
  >
    <div
      class="flex h-full flex-col gap-1 overflow-y-auto overscroll-contain p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <TooltipProvider :delay-duration="0">
        <template v-if="showFavorites">
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                type="button"
                :class="buttonClass"
                :disabled="disabled"
                :aria-pressed="active === FAVORITES_TAB"
                aria-label="Избранное"
                @click="choose(FAVORITES_TAB, true)"
              >
                <StarIcon class="size-5 shrink-0 fill-current" aria-hidden="true" />
                <span
                  v-if="active === FAVORITES_TAB"
                  aria-hidden="true"
                  class="pointer-events-none absolute right-0 top-1/2 h-5 w-0.75 -translate-y-1/2 rounded-full bg-primary"
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" :side-offset="8" align="center">
              Избранное
            </TooltipContent>
          </Tooltip>
          <div class="border-b border-border/70" aria-hidden="true" />
        </template>

        <Tooltip v-for="entry in harnesses" :key="entry.id">
          <TooltipTrigger as-child>
            <button
              type="button"
              :class="cn(buttonClass, entry.error && 'opacity-50')"
              :disabled="disabled"
              :aria-pressed="active === entry.id"
              :aria-label="entry.name"
              :data-harness-id="entry.id"
              @click="choose(entry.id, true)"
            >
              <ProviderLogo :provider="entry.id" class="size-5" />
              <span
                v-if="active === entry.id"
                aria-hidden="true"
                class="pointer-events-none absolute right-0 top-1/2 h-5 w-0.75 -translate-y-1/2 rounded-full bg-primary"
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" :side-offset="8" align="center">
            {{ entry.name }}<template v-if="entry.error"> · недоступен: {{ entry.error }}</template>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </div>
</template>
