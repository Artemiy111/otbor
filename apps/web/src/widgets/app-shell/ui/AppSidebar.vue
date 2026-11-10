<script setup lang="ts">
import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import { useStorage } from "@vueuse/core"
import { ChevronRight } from "@lucide/vue"
import { healthApi, healthKeys } from "@/entities/health"
import { cn, toneClasses } from "@/shared/lib"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar
} from "@/shared/ui/sidebar"
import { navSections, type NavSection } from "../model/nav"
import { useNavBadges, type NavBadgeId } from "../model/useNavBadges"

const props = defineProps<{ active: string }>()

const { isMobile, setOpenMobile } = useSidebar()

/** On a phone the sidebar is a sheet: a navigation click must close it. */
const closeMobile = () => {
  if (isMobile.value) setOpenMobile(false)
}

const badges = useNavBadges()
const badgeFor = (id: string) => badges.value[id as NavBadgeId]

/** Версия сервера берётся из того же запроса, что и индикатор в шапке. */
const health = useQuery({ key: () => healthKeys.current(), query: () => healthApi.get() })
const version = computed(() => health.data.value?.version ?? null)

/** Раскрытые сворачиваемые группы (id -> открыта), хранятся в браузере. */
const openGroups = useStorage<Record<string, boolean>>("otbor.nav.open-groups", {})

const containsActive = (section: NavSection) =>
  section.items.some((item) => item.id === props.active)

/** Группа открыта, если оператор её раскрыл или в ней текущая страница. */
const isOpen = (section: NavSection) =>
  section.collapsible !== true ||
  containsActive(section) ||
  (openGroups.value[section.id] ?? section.collapsedByDefault !== true)

const toggle = (section: NavSection) => {
  openGroups.value = { ...openGroups.value, [section.id]: !isOpen(section) }
}

/** Сумма счётчиков группы: показывается на заголовке, пока группа свёрнута. */
const groupCount = (section: NavSection) =>
  section.items.reduce((sum, item) => sum + (badgeFor(item.id)?.count ?? 0), 0)
</script>

<template>
  <Sidebar collapsible="icon">
    <SidebarHeader class="border-b border-sidebar-border">
      <a
        href="/"
        class="flex items-center gap-2 rounded-md px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        aria-label="Отбор на hh.ru: на главную"
        @click="closeMobile"
      >
        <span
          class="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#d6001c] text-xs font-extrabold tracking-tight text-white"
        >
          HH
        </span>
        <div class="min-w-0 group-data-[collapsible=icon]:hidden">
          <div class="truncate text-sm font-semibold tracking-tight">Отбор</div>
          <div class="truncate text-xs text-muted-foreground">кабинет оператора</div>
        </div>
      </a>
    </SidebarHeader>

    <SidebarContent>
      <SidebarGroup v-for="section in navSections" :key="section.id">
        <template v-if="section.label !== null">
          <SidebarGroupLabel v-if="section.collapsible" as-child>
            <button
              type="button"
              class="w-full cursor-pointer gap-1.5 hover:text-sidebar-foreground"
              :aria-expanded="isOpen(section)"
              @click="toggle(section)"
            >
              <ChevronRight
                class="size-3.5 transition-transform"
                :class="isOpen(section) ? 'rotate-90' : ''"
              />
              <span>{{ section.label }}</span>
              <span
                v-if="!isOpen(section) && groupCount(section) > 0"
                class="ml-auto size-1.5 rounded-full bg-warning"
                aria-hidden="true"
              />
            </button>
          </SidebarGroupLabel>
          <SidebarGroupLabel v-else>{{ section.label }}</SidebarGroupLabel>
        </template>

        <!-- В свёрнутой до иконок панели пункты свёрнутой группы всё равно видны. -->
        <SidebarGroupContent
          :class="isOpen(section) ? '' : 'hidden group-data-[collapsible=icon]:block'"
        >
          <SidebarMenu>
            <SidebarMenuItem v-for="item in section.items" :key="item.id">
              <SidebarMenuButton
                as-child
                :is-active="props.active === item.id"
                :tooltip="item.label"
                :class="badgeFor(item.id) ? 'pr-10' : ''"
              >
                <a
                  :href="item.href"
                  :aria-current="props.active === item.id ? 'page' : undefined"
                  @click="closeMobile"
                >
                  <component :is="item.icon" />
                  <span>{{ item.label }}</span>
                </a>
              </SidebarMenuButton>

              <template v-if="badgeFor(item.id)">
                <SidebarMenuBadge
                  :class="
                    cn(
                      'rounded-full border',
                      toneClasses(badgeFor(item.id)!.tone).badge
                    )
                  "
                >
                  {{ badgeFor(item.id)!.count > 99 ? "99+" : badgeFor(item.id)!.count }}
                </SidebarMenuBadge>
                <!-- В панели из одних иконок счётчик превращается в точку. -->
                <span
                  :class="
                    cn(
                      'pointer-events-none absolute right-1 top-1 hidden size-2 rounded-full ring-2 ring-sidebar group-data-[collapsible=icon]:block',
                      toneClasses(badgeFor(item.id)!.tone).dot
                    )
                  "
                  aria-hidden="true"
                />
              </template>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter class="border-t border-sidebar-border">
      <div
        v-if="version"
        class="px-2 text-xs tabular-nums text-muted-foreground group-data-[collapsible=icon]:hidden"
      >
        v{{ version }}
      </div>
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>
