<script setup lang="ts">
const model = defineModel<"chips" | "matrix" | "digest">({ required: true })
const items = [
  { id: "chips", label: "Чипы", hint: "Компактные чипы с метками источников" },
  { id: "matrix", label: "Таблица", hint: "Сверка hh, текст, ИИ построчно" },
  { id: "digest", label: "Сводка", hint: "Только расхождения и важное, остальное свёрнуто" }
] as const
</script>

<template>
  <div class="inline-flex items-center gap-1.5">
    <span class="text-[11px] text-muted-foreground">Факты:</span>
    <div class="inline-flex rounded-md border border-border bg-muted/40 p-0.5" role="tablist" aria-label="Вид блока фактов">
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        role="tab"
        :aria-selected="model === item.id"
        :title="item.hint"
        class="rounded px-2 py-1 text-xs font-medium transition-colors"
        :class="model === item.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
        @click="model = item.id"
      >
        {{ item.label }}
      </button>
    </div>
  </div>
</template>
