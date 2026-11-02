<script setup lang="ts">
import { apiEndpoint } from "@/shared/api"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar
} from "@/shared/ui/sidebar"
import { navSections } from "../model/nav"

const props = defineProps<{ active: string }>()

const { isMobile, setOpenMobile } = useSidebar()

/** On a phone the sidebar is a sheet: a navigation click must close it. */
const closeMobile = () => {
  if (isMobile.value) setOpenMobile(false)
}
</script>

<template>
  <Sidebar collapsible="icon">
    <SidebarHeader class="border-b border-sidebar-border">
      <a
        href="/vacancies"
        class="flex items-center gap-2 px-1 py-0.5"
        aria-label="Отбор на hh.ru — на главную"
        @click="closeMobile"
      >
        <span
          class="inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-[#d6001c] text-[11px] font-extrabold tracking-tight text-white"
        >
          HH
        </span>
        <div class="min-w-0 group-data-[collapsible=icon]:hidden">
          <div class="truncate text-sm font-bold tracking-tight">Отбор</div>
          <div class="truncate text-[10px] text-muted-foreground">кабинет оператора</div>
        </div>
      </a>
    </SidebarHeader>

    <SidebarContent>
      <SidebarGroup v-for="section in navSections" :key="section.id">
        <SidebarGroupLabel>{{ section.label }}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in section.items" :key="item.id">
              <SidebarMenuButton as-child :is-active="props.active === item.id" :tooltip="item.label">
                <a :href="item.href" :aria-current="props.active === item.id ? 'page' : undefined" @click="closeMobile">
                  <component :is="item.icon" />
                  <span>{{ item.label }}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter class="border-t border-sidebar-border">
      <div class="px-2 text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
        <div class="flex items-center gap-2">
          <span class="size-2 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.15)]" />
          <span>локальный режим</span>
        </div>
        <code class="mt-1 block truncate font-mono">{{ apiEndpoint }}</code>
      </div>
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>
