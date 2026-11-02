<script setup lang="ts">
import { computed, ref } from "vue"
import { useQuery } from "@pinia/colada"
import { CircleAlert, Search } from "@lucide/vue"
import { keywordApi, keywordKeys } from "@/entities/keyword"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatNumber } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const appliedQuery = ref("")
const draft = ref("")

const query = useQuery({
  key: () => keywordKeys.list(appliedQuery.value),
  query: () =>
    keywordApi.list({
      query: appliedQuery.value === "" ? undefined : appliedQuery.value,
      limit: 1000
    })
})

const keywords = computed(() => query.data.value ?? [])
const enabledCount = computed(() => keywords.value.filter((keyword) => keyword.enabled).length)

const search = () => {
  appliedQuery.value = draft.value.trim()
}

const reset = () => {
  draft.value = ""
  appliedQuery.value = ""
}

const refresh = () => {
  void query.refetch()
}
</script>

<template>
  <section>
    <PageHeader
      title="Ключевые слова"
      description="Словарь терминов и алиасов. Включённые слова участвуют в разборе вакансий."
    >
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="refresh" />
      </template>
    </PageHeader>

    <form class="mb-4 flex flex-wrap items-end gap-3" @submit.prevent="search">
      <div class="min-w-64 flex-1 space-y-1.5">
        <Label for="keyword-search" class="text-xs text-muted-foreground">Поиск по слову или алиасу</Label>
        <div class="relative">
          <Search class="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
          <Input
            id="keyword-search"
            v-model="draft"
            type="text"
            placeholder="Например, Kubernetes или k8s"
            class="pl-9"
          />
        </div>
      </div>
      <Button type="submit" :disabled="query.isLoading.value">Найти</Button>
      <Button type="button" variant="outline" :disabled="query.isLoading.value" @click="reset">
        Сбросить
      </Button>
    </form>

    <p class="mb-3 text-xs text-muted-foreground">
      Терминов: {{ formatNumber(keywords.length) }} · включено: {{ formatNumber(enabledCount) }}
    </p>

    <Alert v-if="query.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить словарь</AlertTitle>
      <AlertDescription>{{ describeError(query.error.value) }}</AlertDescription>
    </Alert>

    <Card>
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Термин</TableHead>
              <TableHead>Алиасы</TableHead>
              <TableHead>Состояние</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="query.isPending.value">
              <TableRow v-for="index in 8" :key="index">
                <TableCell :colspan="3">
                  <Skeleton class="h-4 w-full" />
                </TableCell>
              </TableRow>
            </template>

            <TableRow v-else-if="keywords.length === 0">
              <TableCell :colspan="3">
                <EmptyState
                  :title="appliedQuery === '' ? 'Словарь пуст' : 'Ничего не найдено'"
                  description="Добавьте термины через CLI или измените поисковый запрос."
                />
              </TableCell>
            </TableRow>

            <TableRow v-for="keyword in keywords" :key="keyword.id">
              <TableCell class="align-top">
                <div class="font-medium">{{ keyword.term }}</div>
                <code class="text-[11px] text-muted-foreground">{{ keyword.normalizedTerm }}</code>
              </TableCell>
              <TableCell>
                <div v-if="keyword.aliases.length > 0" class="flex flex-wrap gap-1">
                  <Badge
                    v-for="alias in keyword.aliases"
                    :key="alias.id"
                    variant="secondary"
                    class="font-normal"
                    :title="`${alias.matchType}${alias.typo ? ' · опечатка' : ''}`"
                  >
                    {{ alias.alias }}
                    <span v-if="alias.typo" class="ml-1 text-[10px] opacity-60">опечатка</span>
                  </Badge>
                </div>
                <span v-else class="text-sm text-muted-foreground">—</span>
              </TableCell>
              <TableCell>
                <Badge :variant="keyword.enabled ? 'success' : 'neutral'">
                  {{ keyword.enabled ? "Включено" : "Выключено" }}
                </Badge>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </section>
</template>
