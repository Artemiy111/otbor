<script setup lang="ts">
import { computed, ref } from "vue"
import { useQuery } from "@pinia/colada"
import { CircleAlert } from "@lucide/vue"
import { applicationApi, applicationKeys } from "@/entities/application"
import { ApplicationStateFilter } from "@/features/application-filter"
import { RefreshButton } from "@/features/refresh-button"
import {
  applicationPath,
  describeError,
  formatDate,
  vacancyPath
} from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  EmptyState,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const state = ref("all")

const query = useQuery({
  key: () => applicationKeys.list(state.value),
  query: () =>
    applicationApi.list({
      limit: 200,
      state: state.value === "all" ? undefined : state.value
    })
})

const applications = computed(() => query.data.value ?? [])
</script>

<template>
  <section>
    <PageHeader
      title="Отклики"
      description="Один устойчивый процесс на отклик. Состоянием владеет облако, а не harness."
    >
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
      </template>
    </PageHeader>

    <div class="mb-4 flex flex-wrap items-end gap-3">
      <ApplicationStateFilter v-model="state" />
      <span class="pb-2 text-xs text-muted-foreground">Показано: {{ applications.length }}</span>
    </div>

    <Alert v-if="query.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить отклики</AlertTitle>
      <AlertDescription>{{ describeError(query.error.value) }}</AlertDescription>
    </Alert>

    <Card>
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Состояние</TableHead>
              <TableHead>Вакансия</TableHead>
              <TableHead>Компания</TableHead>
              <TableHead>Аккаунт</TableHead>
              <TableHead>Обновлён</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="query.isPending.value">
              <TableRow v-for="index in 8" :key="index">
                <TableCell :colspan="5">
                  <Skeleton class="h-4 w-full" />
                </TableCell>
              </TableRow>
            </template>

            <TableRow v-else-if="applications.length === 0">
              <TableCell :colspan="5">
                <EmptyState
                  title="Откликов не найдено"
                  description="Отклик появится здесь, когда решение станет рабочим процессом."
                />
              </TableCell>
            </TableRow>

            <TableRow v-for="application in applications" :key="application.id">
              <TableCell>
                <StatusBadge :value="application.state" raw />
                <div v-if="application.streamId" class="mt-1 text-xs text-muted-foreground">
                  поток <code class="font-mono">{{ application.streamId }}</code>
                </div>
              </TableCell>
              <TableCell class="max-w-[380px]">
                <a
                  :href="applicationPath(application.id)"
                  class="font-medium text-foreground transition-colors hover:text-primary"
                >
                  {{ application.vacancyTitle ?? application.vacancyId }}
                </a>
                <div class="text-xs text-muted-foreground">
                  <a :href="vacancyPath(application.vacancyId)" class="hover:text-foreground">
                    вакансия
                  </a>
                </div>
              </TableCell>
              <TableCell>{{ application.employerName ?? "—" }}</TableCell>
              <TableCell class="font-mono text-xs">{{ application.hhAccountId }}</TableCell>
              <TableCell class="whitespace-nowrap text-muted-foreground">
                {{ formatDate(application.updatedAt) }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </section>
</template>
