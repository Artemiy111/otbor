<script setup lang="ts">
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/shared/ui/sidebar"
import AccountSwitcher from "./AccountSwitcher.vue"
import AppSidebar from "./AppSidebar.vue"
import SystemStatus from "./SystemStatus.vue"
import ThemeSwitcher from "./ThemeSwitcher.vue"

const props = defineProps<{ active: string }>()
</script>

<template>
  <SidebarProvider>
    <AppSidebar :active="props.active" />

    <SidebarInset>
      <header
        class="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-3 backdrop-blur sm:px-4"
      >
        <SidebarTrigger />
        <div class="flex-1" />
        <SystemStatus />
        <ThemeSwitcher />
        <AccountSwitcher />
      </header>

      <!-- Ширина контента ограничена, чтобы на больших экранах страницы не растягивались. -->
      <div class="mx-auto w-full min-w-0 max-w-[1600px] px-3 py-5 sm:px-5 lg:px-8 lg:py-8">
        <slot />
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>
