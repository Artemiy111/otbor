<script setup lang="ts">
import { ref, watch } from "vue"
import { Menu, X } from "lucide-vue-next"
import { apiEndpoint } from "@/shared/api"
import { cn } from "@/shared/lib"
import { Button } from "@/shared/ui"
import { navItems } from "../model/nav"

const props = defineProps<{ active: string }>()

const sidebarOpen = ref(false)

watch(
  () => props.active,
  () => {
    sidebarOpen.value = false
  }
)
</script>

<template>
  <div class="min-h-screen text-foreground">
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
      aria-hidden="true"
      @click="sidebarOpen = false"
    />

    <aside
      :class="
        cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-200 ease-in-out lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )
      "
    >
      <div class="flex items-center justify-between px-5 py-5">
        <a href="#/health" class="flex flex-col" @click="sidebarOpen = false">
          <span class="text-xl font-semibold tracking-tight">otbor</span>
          <span class="text-xs uppercase tracking-[0.2em] text-muted-foreground">operator</span>
        </a>
        <Button variant="ghost" size="icon" class="lg:hidden" @click="sidebarOpen = false">
          <X class="h-4 w-4" />
          <span class="sr-only">Close navigation</span>
        </Button>
      </div>

      <nav class="flex flex-1 flex-col gap-1 px-3">
        <a
          v-for="item in navItems"
          :key="item.section"
          :href="item.href"
          :class="
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              props.active === item.section
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
            )
          "
          :aria-current="props.active === item.section ? 'page' : undefined"
          @click="sidebarOpen = false"
        >
          <component :is="item.icon" class="h-4 w-4 shrink-0" />
          {{ item.label }}
        </a>
      </nav>

      <div
        class="m-3 flex items-center gap-2.5 border-t border-sidebar-border px-2 pt-4 text-xs text-muted-foreground"
      >
        <span
          class="h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.15)]"
        />
        <div class="min-w-0">
          <div>local bootstrap</div>
          <code class="block truncate font-mono">{{ apiEndpoint }}</code>
        </div>
      </div>
    </aside>

    <div class="lg:pl-64">
      <header
        class="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur lg:hidden"
      >
        <Button variant="ghost" size="icon" @click="sidebarOpen = true">
          <Menu class="h-5 w-5" />
          <span class="sr-only">Open navigation</span>
        </Button>
        <div class="flex items-baseline gap-2">
          <span class="text-base font-semibold tracking-tight">otbor</span>
          <span class="text-xs uppercase tracking-[0.16em] text-muted-foreground">operator</span>
        </div>
      </header>

      <main class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <slot />
      </main>
    </div>
  </div>
</template>
