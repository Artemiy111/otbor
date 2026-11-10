<script setup lang="ts">
import { CheckIcon, StarIcon } from "@lucide/vue";
import { cn } from "@/shared/lib";
import type { HarnessModel } from "./types";

const props = withDefaults(
  defineProps<{
    model: HarnessModel;
    optionId: string;
    /** Строка под курсором или выбрана клавиатурой. */
    active?: boolean;
    /** Модель выбрана в приложении. */
    selected?: boolean;
    favoritesEnabled?: boolean;
    favorite?: boolean;
    currentEffort?: string;
    disabled?: boolean;
  }>(),
  {
    active: false,
    selected: false,
    favoritesEnabled: false,
    favorite: false,
    currentEffort: "",
    disabled: false,
  },
);

const emit = defineEmits<{
  (event: "select"): void;
  (event: "hover"): void;
  (event: "favorite"): void;
  (event: "effort", value: string): void;
}>();

function chooseEffort(value: string): void {
  if (props.disabled) return;
  emit("effort", value);
}
</script>

<template>
  <div
    :id="optionId"
    role="option"
    :aria-selected="selected"
    :tabindex="-1"
    :class="
      cn(
        'group relative flex w-full min-w-0 max-w-full cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-left outline-none transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
        disabled && 'pointer-events-none opacity-50',
      )
    "
    @click="emit('select')"
    @mousemove="emit('hover')"
  >
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-center gap-2">
        <span class="min-w-0 truncate text-sm font-normal leading-snug">
          {{ model.label || model.id }}
        </span>
      </div>

      <div v-if="model.variant" class="mt-0.5 truncate text-xs font-normal leading-snug text-muted-foreground/70">
        {{ model.variant }}
      </div>

      <div
        v-if="selected && model.efforts.length > 1"
        class="mt-1 flex flex-wrap gap-1"
        role="group"
        aria-label="Усилие"
      >
        <button
          v-for="effort in model.efforts"
          :key="effort"
          type="button"
          :aria-pressed="effort === currentEffort"
          :disabled="disabled"
          :class="
            cn(
              'rounded border px-1.5 py-0.5 text-xs leading-none transition-colors',
              effort === currentEffort
                ? 'border-primary text-primary'
                : 'border-border text-muted-foreground hover:bg-background/60',
            )
          "
          @click.stop="chooseEffort(effort)"
          @keydown.stop
        >
          {{ effort }}
        </button>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-1.5 pt-0.5">
      <button
        v-if="favoritesEnabled"
        type="button"
        class="-mr-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-xs transition-colors hover:bg-foreground/10 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
        :aria-label="favorite ? 'Убрать из избранного' : 'В избранное'"
        :title="favorite ? 'Убрать из избранного' : 'В избранное'"
        :disabled="disabled"
        @click.stop="emit('favorite')"
        @keydown.stop
      >
        <StarIcon
          :class="
            cn(
              'size-3.5',
              favorite
                ? 'fill-current text-primary'
                : 'text-muted-foreground/60 group-hover:text-muted-foreground',
            )
          "
          aria-hidden="true"
        />
      </button>
      <CheckIcon
        :class="cn('size-3.5 shrink-0', !selected && 'invisible')"
        aria-hidden="true"
      />
    </div>
  </div>
</template>
