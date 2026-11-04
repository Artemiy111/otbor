<script setup lang="ts">
import { computed, type Component } from "vue"
import { useQuery } from "@pinia/colada"
import {
  Banknote, Briefcase, Building2, Clock, FileText, Flag, FlaskConical, FolderOpen, Gift,
  GitBranch, Globe, GraduationCap, HeartPulse, House, Mail, MapPin, MessageSquare, Moon, Phone,
  Plane, ShieldAlert, Sparkles, TriangleAlert, User, Users, Video, Wallet
} from "@lucide/vue"
import type { ContactRecord, VacancyDetail } from "@otbor/contract"
import { vacancyApi, vacancyKeys } from "@/entities/vacancy"
import {
  buildPassport,
  contactHref,
  contactKindLabel,
  formatDate,
  formatNumber,
  LADDER_STEPS,
  type PassportIcon
} from "@/shared/lib"
import { Button } from "@/shared/ui"

const props = defineProps<{
  data: VacancyDetail
  contacts: ReadonlyArray<ContactRecord>
  hydrating: boolean
}>()
defineEmits<{ hydrate: [] }>()

const query = useQuery({
  key: () => vacancyKeys.analysis(props.data.vacancy.id),
  query: () => vacancyApi.analysis(props.data.vacancy.id)
})
const analysis = computed(() => query.data.value ?? null)
const view = computed(() => buildPassport(analysis.value?.facts ?? null, props.data))

const icons: Record<PassportIcon, Component> = {
  home: House, building: Building2, briefcase: Briefcase, pin: MapPin, users: Users, user: User,
  graduation: GraduationCap, banknote: Banknote, mail: Mail, branch: GitBranch, folder: FolderOpen,
  chat: MessageSquare, phone: Phone, video: Video, wallet: Wallet, flask: FlaskConical, globe: Globe,
  clock: Clock, moon: Moon, plane: Plane, alert: TriangleAlert, shield: ShieldAlert, heart: HeartPulse,
  gift: Gift, file: FileText, flag: Flag
}

const hh = computed(() => props.data.facts?.hh ?? null)
const isHttp = (href: string | null) => /^https?:/i.test(href ?? "")
const hasHero = computed(
  () => view.value.role !== null || view.value.ladder.required !== null || view.value.ladder.title !== null || view.value.years !== null
)
const stepClass = (index: number) => {
  const { required, title } = view.value.ladder
  if (index === required) return "bg-primary text-primary-foreground"
  if (index === title) return "border border-dashed border-primary/60 text-foreground"
  return "bg-muted/50 text-muted-foreground"
}
const caption = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
</script>

<template>
  <section class="space-y-4 text-sm">
    <!-- hero: role, level ladder, experience -->
    <div v-if="hasHero" class="grid gap-4 rounded-xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-4 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1fr)]">
      <div class="min-w-0">
        <div :class="caption">Роль</div>
        <div class="mt-1 flex items-center gap-2 text-2xl font-semibold leading-tight">
          <Sparkles class="size-5 shrink-0 text-primary" />
          <span class="truncate">{{ view.role ?? "не определена" }}</span>
        </div>
        <div v-if="view.notIt" class="mt-1 text-xs text-red-300">модель считает, что это не IT</div>
      </div>

      <div v-if="view.ladder.required !== null || view.ladder.title !== null" class="min-w-0">
        <div :class="caption">Уровень</div>
        <div class="mt-2 flex gap-1">
          <span
            v-for="(step, index) in LADDER_STEPS"
            :key="step"
            class="flex-1 rounded-md px-1 py-1 text-center text-[11px] font-medium"
            :class="stepClass(index)"
          >
            {{ step }}
          </span>
        </div>
        <p class="mt-1.5 text-xs text-muted-foreground">
          <template v-if="view.ladder.requiredLabel">
            по тексту нужен <b class="text-foreground">{{ view.ladder.requiredLabel }}</b>
          </template>
          <template v-if="view.ladder.titleLabel && view.ladder.titleLabel !== view.ladder.requiredLabel">
            <template v-if="view.ladder.requiredLabel">, </template>в заголовке {{ view.ladder.titleLabel }}
          </template>
        </p>
      </div>

      <div v-if="view.years !== null" class="min-w-0">
        <div :class="caption">Опыт</div>
        <div class="mt-1 text-2xl font-semibold leading-tight">от {{ view.years }} {{ view.years === 1 ? "года" : "лет" }}</div>
        <div class="mt-2 flex gap-1" aria-hidden="true">
          <span
            v-for="n in 6"
            :key="n"
            class="h-1.5 flex-1 rounded-full"
            :class="n <= view.years ? 'bg-primary' : 'bg-muted'"
          />
        </div>
      </div>
    </div>

    <!-- tiles: neutral facts, one per card -->
    <div v-if="view.tiles.length > 0" class="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-2">
      <div
        v-for="tile in view.tiles"
        :key="tile.key"
        class="flex items-start gap-2.5 rounded-lg border border-border bg-card p-2.5"
      >
        <span class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <component :is="icons[tile.icon]" class="size-4" />
        </span>
        <div class="min-w-0">
          <div :class="caption">{{ tile.label }}</div>
          <div class="font-medium leading-snug">{{ tile.value }}</div>
        </div>
      </div>
    </div>

    <!-- what the response needs -->
    <div v-if="view.requests.length > 0" class="space-y-2">
      <h3 :class="caption">Что нужно для отклика</h3>
      <div class="flex flex-wrap gap-2">
        <span
          v-for="item in view.requests"
          :key="item.key"
          :title="item.detail"
          class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5"
          :class="item.level === 'required' ? 'border-amber-500/50 bg-amber-500/10 text-amber-200' : 'border-border bg-card'"
        >
          <component :is="icons[item.icon]" class="size-4 shrink-0" />
          {{ item.label }}
          <span class="text-[11px] opacity-70">{{ item.level === "required" ? "обязательно" : "желательно" }}</span>
        </span>
      </div>
    </div>

    <!-- risks and pluses, side by side -->
    <div v-if="view.warnings.length > 0 || view.perks.length > 0" class="grid gap-3" :class="view.warnings.length > 0 && view.perks.length > 0 ? 'md:grid-cols-2' : ''">
      <div v-if="view.warnings.length > 0" class="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
        <h3 class="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-300">
          <TriangleAlert class="size-3.5" /> Осторожно
        </h3>
        <ul class="space-y-1.5">
          <li v-for="item in view.warnings" :key="item.key" class="flex items-start gap-2">
            <component :is="icons[item.icon]" class="mt-0.5 size-4 shrink-0 text-red-300" />
            <span>
              {{ item.label }}
              <span v-if="item.detail" class="block text-xs text-muted-foreground">«{{ item.detail }}»</span>
            </span>
          </li>
        </ul>
      </div>
      <div v-if="view.perks.length > 0" class="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
        <h3 class="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
          <Gift class="size-3.5" /> Плюсы
        </h3>
        <ul class="space-y-1.5">
          <li v-for="item in view.perks" :key="item.key" class="flex items-start gap-2">
            <component :is="icons[item.icon]" class="mt-0.5 size-4 shrink-0 text-emerald-300" />
            {{ item.label }}
          </li>
        </ul>
      </div>
    </div>

    <!-- numbers, responses, contacts: one quiet strip -->
    <div
      v-if="view.numbers.length > 0 || data.responsesTotal != null || contacts.length > 0"
      class="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg bg-muted/30 px-3 py-2 text-xs"
    >
      <span v-for="fact in view.numbers" :key="fact.key">
        <span class="text-muted-foreground">{{ fact.label }}:</span> <b>{{ fact.value }}</b>
      </span>
      <span v-if="data.responsesTotal != null">
        <span class="text-muted-foreground">Откликов:</span> <b>{{ formatNumber(data.responsesTotal) }}</b>
      </span>
      <span v-for="contact in contacts" :key="contact.id" class="min-w-0">
        <span class="text-muted-foreground">{{ contactKindLabel(contact.kind) }}:</span>
        <a
          v-if="contactHref(contact)"
          :href="contactHref(contact) ?? undefined"
          :target="isHttp(contactHref(contact)) ? '_blank' : undefined"
          rel="noreferrer"
          class="break-all text-sky-300 underline-offset-4 hover:underline"
          :title="contact.evidence ?? undefined"
        >{{ contact.value }}</a>
        <span v-else class="break-all">{{ contact.value }}</span>
      </span>
    </div>

    <div class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
      <template v-if="analysis">
        Разбор: {{ analysis.model }} · {{ formatDate(analysis.updatedAt) }}. Показано только то, что относится к этой вакансии.
      </template>
      <template v-else-if="!query.isPending.value">Модель эту вакансию ещё не разбирала: показаны только данные из текста и hh.</template>
      <template v-if="hh === null">
        · данные отклика с hh не загружены
        <Button size="sm" variant="outline" :disabled="hydrating" @click="$emit('hydrate')">Загрузить</Button>
      </template>
    </div>
  </section>
</template>
