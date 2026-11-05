<script setup lang="ts">
import { computed } from "vue"
import { apiEndpoint } from "@/shared/api"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/shared/ui/sidebar"
import { navLabel } from "../model/nav"
import AccountSwitcher from "./AccountSwitcher.vue"
import AppSidebar from "./AppSidebar.vue"
import ThemeSwitcher from "./ThemeSwitcher.vue"

const props = defineProps<{ active: string }>()

const sectionLabel = computed(() => navLabel(props.active))
</script>

<template>
  <SidebarProvider>
    <AppSidebar :active="props.active" />

    <SidebarInset>
      <header
        class="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-3 backdrop-blur sm:px-4"
      >
        <SidebarTrigger />
        <span class="h-4 w-px bg-border" aria-hidden="true" />
        <div class="flex min-w-0 items-baseline gap-2">
          <span class="truncate text-sm font-semibold">{{ sectionLabel }}</span>
          <span class="hidden text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:inline">
            отбор
          </span>
        </div>
        <div class="flex-1" />
        <ThemeSwitcher />
        <AccountSwitcher />
        <code class="hidden truncate font-mono text-[11px] text-muted-foreground md:block">
          {{ apiEndpoint }}
        </code>
      </header>

      <div class="w-full min-w-0 px-3 py-5 sm:px-5 lg:px-8 lg:py-8">
        <slot />
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>
