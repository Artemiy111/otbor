<script setup lang="ts">
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from "@/shared/ui"

withDefaults(
  defineProps<{
    title: string
    description?: string
    backTo?: string
    backLabel?: string
  }>(),
  {
    description: undefined,
    backTo: undefined,
    backLabel: "Назад"
  }
)
</script>

<template>
  <header class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div class="min-w-0 space-y-1.5">
      <Breadcrumb v-if="backTo">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink :href="backTo">{{ backLabel }}</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage class="max-w-[52vw] truncate sm:max-w-xl">{{ title }}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">{{ title }}</h1>
        <slot name="title-aside" />
      </div>
      <p v-if="description" class="max-w-3xl text-sm text-muted-foreground">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
