<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { PanelLeft } from "@lucide/vue"
import { cn } from "@/shared/lib"
import { Button } from "@/shared/ui/button"
import { useSidebar } from "./utils"

const props = defineProps<{ class?: HTMLAttributes["class"] }>()

const { toggleSidebar } = useSidebar()
</script>

<template>
  <Button
    data-sidebar="trigger"
    data-slot="sidebar-trigger"
    variant="ghost"
    size="icon"
    :class="cn('h-8 w-8', props.class)"
    @click="toggleSidebar"
  >
    <PanelLeft />
    <span class="sr-only">Показать меню</span>
  </Button>
</template>
