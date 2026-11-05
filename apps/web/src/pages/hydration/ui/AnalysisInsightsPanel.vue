<script setup lang="ts">
import { computed, ref } from "vue"
import { useQuery } from "@pinia/colada"
import { CircleAlert } from "@lucide/vue"
import { analysisApi, analysisKeys } from "@/entities/analysis"
import { describeError, formatAge, formatDate } from "@/shared/lib"
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from "@/shared/ui"
import { StatCard } from "@/widgets/stat-card"

const days = ref(14)
const RANGES = [7, 14, 30, 90]
type Metric = "count" | "avg"
const metric = ref<Metric>("count")

const query = useQuery({
  key: () => analysisKeys.insights(days.value),
  query: () => analysisApi.insights(days.value)
})
const data = computed(() => query.data.value)

/** Milliseconds as the operator reads them: "850 мс", "4,2 с", "2 мин 10 с". */
const ms = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "—"
  if (value < 1000) return `${value} мс`
  if (value < 60_000) return `${(value / 1000).toFixed(1).replace(".", ",")} с`
  return `${Math.floor(value / 60_000)} мин ${Math.round((value % 60_000) / 1000)} с`
}

/** Every day of the window, so a quiet day shows as an empty bar instead of vanishing. */
const series = computed(() => {
  const d = data.value
  if (d === undefined) return []
  const byDay = new Map(d.byDay.map((row) => [row.day, row]))
  const out: Array<{ day: string; count: number; avgMs: number | null }> = []
  const now = new Date()
  for (let i = d.days - 1; i >= 0; i--) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i))
    const day = date.toISOString().slice(0, 10)
    const row = byDay.get(day)
    out.push({ day, count: row?.count ?? 0, avgMs: row?.avgMs ?? null })
  }
  return out
})

const value = (point: { count: number; avgMs: number | null }): number =>
  metric.value === "count" ? point.count : (point.avgMs ?? 0)
const peak = computed(() => Math.max(1, ...series.value.map(value)))
const hovered = ref<number | null>(null)
const hoverText = computed(() => {
  const point = hovered.value === null ? undefined : series.value[hovered.value]
  if (point === undefined) return "Наведите на столбец"
  return `${point.day}: проанализировано ${point.count}, среднее ${ms(point.avgMs)}`
})

const W = 640
const H = 160
const barWidth = computed(() => (series.value.length === 0 ? 0 : W / series.value.length))

const remaining = computed(() => (data.value ? Math.max(data.value.total - data.value.analysed, 0) : 0))
const eta = computed(() => {
  const avg = data.value?.latency.avgMs
  if (avg === null || avg === undefined || remaining.value === 0) return null
  return formatAge((remaining.value * avg) / 1000)
})

const runs = computed(() =>
  (data.value?.runs ?? []).map((run) => ({
    ...run,
    perVacancy: run.analysed > 0 ? (run.seconds * 1000) / run.analysed : null
  }))
)
const slowestRun = computed(() => Math.max(1, ...runs.value.map((r) => r.perVacancy ?? 0)))
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm text-muted-foreground">Период:</span>
      <Button v-for="r in RANGES" :key="r" size="sm" :variant="days === r ? 'default' : 'outline'" @click="days = r">
        {{ r }} дн.
      </Button>
      <Button size="sm" variant="ghost" @click="query.refetch()">Обновить</Button>
    </div>

    <Alert v-if="query.error.value" variant="destructive">
      <CircleAlert />
      <AlertTitle>Не удалось получить статистику</AlertTitle>
      <AlertDescription>{{ describeError(query.error.value) }}</AlertDescription>
    </Alert>

    <div v-if="query.isPending.value" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Skeleton v-for="i in 4" :key="i" class="h-24 w-full" />
    </div>

    <template v-else-if="data">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Среднее на вакансию" :value="ms(data.latency.avgMs)" :hint="`медиана ${ms(data.latency.p50Ms)}`" />
        <StatCard label="Медленные 5%" :value="ms(data.latency.p95Ms)" :hint="`максимум ${ms(data.latency.maxMs)}`" />
        <StatCard label="Проанализировано за период" :value="data.latency.count" :hint="`всего ${data.analysed} из ${data.total}`" />
        <StatCard
          label="Осталось разобрать"
          :value="remaining"
          :hint="eta ? `примерно ${eta} при такой скорости` : 'нечего разбирать'"
        />
      </div>

      <Card>
        <CardHeader>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>По дням</CardTitle>
              <CardDescription>{{ hoverText }}</CardDescription>
            </div>
            <div class="flex gap-1">
              <Button size="sm" :variant="metric === 'count' ? 'default' : 'outline'" @click="metric = 'count'">Вакансий в день</Button>
              <Button size="sm" :variant="metric === 'avg' ? 'default' : 'outline'" @click="metric = 'avg'">Среднее время</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <svg :viewBox="`0 0 ${W} ${H + 18}`" class="w-full" role="img" aria-label="Статистика анализа по дням" @mouseleave="hovered = null">
            <g v-for="(point, i) in series" :key="point.day" @mouseenter="hovered = i">
              <rect :x="i * barWidth" y="0" :width="barWidth" :height="H" fill="transparent" />
              <rect
                :x="i * barWidth + 2"
                :y="H - (value(point) / peak) * H"
                :width="Math.max(barWidth - 4, 1)"
                :height="(value(point) / peak) * H"
                rx="2"
                :class="hovered === i ? 'fill-primary' : 'fill-primary/60'"
              />
            </g>
            <text x="0" :y="H + 14" class="fill-muted-foreground text-[10px]">{{ series[0]?.day }}</text>
            <text :x="W" :y="H + 14" text-anchor="end" class="fill-muted-foreground text-[10px]">{{ series[series.length - 1]?.day }}</text>
          </svg>
        </CardContent>
      </Card>

      <div class="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>По моделям</CardTitle>
            <CardDescription>Сколько разобрала каждая модель и как быстро.</CardDescription>
          </CardHeader>
          <CardContent>
            <p v-if="!data.byModel.length" class="text-sm text-muted-foreground">За период разборов нет.</p>
            <table v-else class="w-full text-sm">
              <thead class="text-left text-xs text-muted-foreground">
                <tr><th class="pb-1">Модель</th><th>Шт.</th><th>Среднее</th><th>p95</th></tr>
              </thead>
              <tbody>
                <tr v-for="m in data.byModel" :key="m.model" class="border-t">
                  <td class="py-1 font-mono text-xs">{{ m.model }}</td>
                  <td class="tabular-nums">{{ m.count }}</td>
                  <td class="tabular-nums">{{ ms(m.avgMs) }}</td>
                  <td class="tabular-nums">{{ ms(m.p95Ms) }}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Самые долгие разборы</CardTitle>
            <CardDescription>Вакансии, на которые модель потратила больше всего времени.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-1.5">
            <p v-if="!data.slowest.length" class="text-sm text-muted-foreground">За период разборов нет.</p>
            <a
              v-for="s in data.slowest"
              :key="s.vacancyId"
              :href="`/vacancies/${s.vacancyId}`"
              class="flex items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-sm hover:bg-muted/40"
            >
              <span class="truncate">{{ s.title }}</span>
              <span class="shrink-0 tabular-nums text-muted-foreground">{{ ms(s.latencyMs) }}</span>
            </a>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Проходы worker</CardTitle>
          <CardDescription>Длительность каждого прохода и сколько времени ушло на одну вакансию.</CardDescription>
        </CardHeader>
        <CardContent>
          <p v-if="!runs.length" class="text-sm text-muted-foreground">За период проходов не было.</p>
          <table v-else class="w-full text-sm">
            <thead class="text-left text-xs text-muted-foreground">
              <tr><th class="pb-1">Начат</th><th>Длилось</th><th>Разобрано</th><th>Пропущено</th><th>Ошибок</th><th class="w-1/3">На вакансию</th></tr>
            </thead>
            <tbody>
              <tr v-for="run in runs" :key="run.startedAt" class="border-t">
                <td class="whitespace-nowrap py-1">{{ formatDate(run.startedAt) }}</td>
                <td class="tabular-nums">{{ formatAge(run.seconds) }}</td>
                <td class="tabular-nums">{{ run.analysed }}</td>
                <td class="tabular-nums">{{ run.skipped }}</td>
                <td class="tabular-nums" :class="run.failed ? 'text-destructive' : ''">{{ run.failed }}</td>
                <td>
                  <div v-if="run.perVacancy !== null" class="flex items-center gap-2">
                    <div class="h-2 rounded bg-primary/60" :style="{ width: `${(run.perVacancy / slowestRun) * 100}%` }" />
                    <span class="tabular-nums text-xs text-muted-foreground">{{ ms(Math.round(run.perVacancy)) }}</span>
                  </div>
                  <span v-else class="text-xs text-muted-foreground">
                    {{ run.stoppedBy ? `остановлен: ${run.stoppedBy}` : "—" }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
