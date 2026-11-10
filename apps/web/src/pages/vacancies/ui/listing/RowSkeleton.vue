<script setup lang="ts">
import { Skeleton } from "@/shared/ui"
</script>

<template>
  <div
    class="grid grid-cols-[44px_minmax(0,1fr)] gap-x-4 gap-y-3 px-3 py-4 lg:grid-cols-[44px_minmax(0,1fr)_264px]"
    aria-hidden="true"
  >
    <Skeleton class="size-11 rounded-lg" />
    <div class="space-y-2">
      <Skeleton class="h-5 w-3/5" />
      <Skeleton class="h-4 w-2/5" />
      <Skeleton class="h-4 w-full" />
      <div class="flex gap-1.5 pt-1">
        <Skeleton class="h-5 w-16" />
        <Skeleton class="h-5 w-20" />
        <Skeleton class="h-5 w-14" />
      </div>
    </div>
    <div class="col-start-2 space-y-2 lg:col-start-3 lg:row-start-1 lg:border-l lg:border-border lg:pl-4">
      <Skeleton class="h-7 w-16" />
      <Skeleton class="h-1 w-full" />
      <Skeleton class="h-4 w-3/4" />
      <Skeleton class="h-5 w-24" />
    </div>
  </div>
</template>
