<script setup lang="ts">
import { computed } from "vue"
import { useQuery } from "@pinia/colada"
import type { AutoApplyStage } from "@otbor/contract"
import { ArrowRight, CircleAlert } from "@lucide/vue"
import { autoApplyApi, autoApplyKeys, autoApplyStages } from "@/entities/auto-apply"
import { useVisibleInterval } from "@/features/auto-apply-run"
import { RefreshButton } from "@/features/refresh-button"
import { cn, describeError, toneClasses } from "@/shared/lib"
import { Alert, AlertDescription, AlertTitle, Card, CardContent, HelpHint, Skeleton } from "@/shared/ui"
import { autoApplyHelp } from "../model/help"

/** Ход автооткликов: счётчики по этапам, подробности в списке «Отклики». */
const props = defineProps<{ accountId: string }>()

/** Куда ведёт счётчик этапа: застрявшие в «Требует внимания», идущие в «В работе», готовые в «Отправлено». */
const hrefFor = (stage: AutoApplyStage): string =>
  stage === "needs_human" || stage === "failed"
    ? "/applications?tab=attention&auto=1"
    : stage === "submitted"
      ? "/applications?tab=sent&auto=1"
      : "/applications?tab=active&auto=1"

const query = useQuery({
  // Отдельный ключ: данные другой формы, чем у списка в откликах; префикс общий, сброс по `all` его тоже берёт.
  key: () => [...autoApplyKeys.all, "summary", props.accountId],
  query: () => autoApplyApi.progress({ hhAccountId: props.accountId, limit: 1 }),
  enabled: () => props.accountId !== ""
})
const summary = computed(() => query.data.value?.summary ?? null)

const tiles = computed(() =>
  autoApplyStages
    .map((stage) => ({ ...stage, count: summary.value?.[stage.value] ?? 0 }))
    .filter((stage) => stage.count > 0)
)
const inProgress = computed(() => tiles.value.some((stage) => stage.active))

// Обновление раз в 5 с, только пока что-то движется и вкладка видна.
useVisibleInterval(
  () => {
    if (!query.isLoading.value) void query.refetch()
  },
  () => inProgress.value && props.accountId !== ""
)

const error = computed(() => (query.error.value === null ? null : describeError(query.error.value)))
</script>

<template>
  <Card>
    <CardContent class="space-y-4 p-4">
      <div class="flex flex-wrap items-center gap-2">
        <p class="text-sm text-muted-foreground">Автоотклики этого аккаунта за последние 3 дня.</p>
        <HelpHint :text="autoApplyHelp.stages" label="этапы автооткликов" />
        <RefreshButton class="ml-auto" :loading="query.isLoading.value" @refresh="query.refetch()" />
        <a
          href="/applications?auto=1"
          class="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Открыть в откликах
          <ArrowRight class="size-4" />
        </a>
      </div>

      <Alert v-if="error" variant="destructive">
        <CircleAlert />
        <AlertTitle>Не удалось загрузить ход</AlertTitle>
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div v-if="query.isPending.value && summary === null" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Skeleton v-for="index in 3" :key="index" class="h-20" />
      </div>
      <p v-else-if="tiles.length === 0 && !error" class="text-sm text-muted-foreground">
        За последние 3 дня автооткликов не было.
      </p>
      <ul v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <li v-for="stage in tiles" :key="stage.value">
          <a
            :href="hrefFor(stage.value)"
            :class="
              cn(
                'flex h-full flex-col gap-1 rounded-xl border p-3 transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                toneClasses(stage.tone).border,
                toneClasses(stage.tone).bg
              )
            "
          >
            <span class="text-2xl font-semibold leading-none tabular-nums" :class="toneClasses(stage.tone).text">
              {{ stage.count }}
            </span>
            <span class="text-sm">{{ stage.label }}</span>
          </a>
        </li>
      </ul>
    </CardContent>
  </Card>
</template>
