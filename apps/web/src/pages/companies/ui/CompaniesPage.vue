<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import { ChevronLeft, ChevronRight, CircleAlert, Search } from "@lucide/vue"
import { companyApi, companyKeys } from "@/entities/company"
import { RefreshButton } from "@/features/refresh-button"
import { companyPath, describeError, formatNumber, formatRating } from "@/shared/lib"
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

const PAGE_SIZE = 50

const appliedQuery = ref("")
const draft = ref("")
const offset = ref(0)

const query = useQuery({
  key: () => companyKeys.list({ query: appliedQuery.value, offset: offset.value }),
  query: () =>
    companyApi.list({
      query: appliedQuery.value === "" ? undefined : appliedQuery.value,
      limit: PAGE_SIZE,
      offset: offset.value
    })
})

const companies = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const page = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1)

watch(totalPages, (pages) => {
  if (page.value > pages) offset.value = (pages - 1) * PAGE_SIZE
})

const search = () => {
  appliedQuery.value = draft.value.trim()
  offset.value = 0
}

const reset = () => {
  draft.value = ""
  appliedQuery.value = ""
  offset.value = 0
}

const refresh = () => {
  void query.refetch()
}
</script>

<template>
  <section>
    <PageHeader
      title="Компании"
      description="Работодатели из корпуса: рейтинг, отрасли и число сохранённых вакансий."
    >
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="refresh" />
      </template>
    </PageHeader>

    <form class="mb-4 flex flex-wrap items-end gap-3" @submit.prevent="search">
      <div class="min-w-64 flex-1 space-y-1.5">
        <Label for="company-search" class="text-xs text-muted-foreground">Поиск по названию</Label>
        <div class="relative">
          <Search class="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
          <Input
            id="company-search"
            v-model="draft"
            type="text"
            placeholder="Например, Яндекс"
            class="pl-9"
          />
        </div>
      </div>
      <Button type="submit" :disabled="query.isLoading.value">Найти</Button>
      <Button type="button" variant="outline" :disabled="query.isLoading.value" @click="reset">
        Сбросить
      </Button>
      <div class="flex-1" />
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          :disabled="offset === 0 || query.isLoading.value"
          @click="offset = Math.max(0, offset - PAGE_SIZE)"
        >
          <ChevronLeft class="h-4 w-4" />
          Назад
        </Button>
        <span class="text-xs text-muted-foreground">{{ page }} / {{ totalPages }}</span>
        <Button
          variant="outline"
          size="sm"
          :disabled="offset + PAGE_SIZE >= total || query.isLoading.value"
          @click="offset += PAGE_SIZE"
        >
          Вперёд
          <ChevronRight class="h-4 w-4" />
        </Button>
      </div>
    </form>

    <p class="mb-3 text-xs text-muted-foreground">
      Найдено компаний: {{ formatNumber(total) }}
      <span v-if="appliedQuery !== ''"> по запросу «{{ appliedQuery }}»</span>
    </p>

    <Alert v-if="query.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить компании</AlertTitle>
      <AlertDescription>{{ describeError(query.error.value) }}</AlertDescription>
    </Alert>

    <Card>
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Компания</TableHead>
              <TableHead>Рейтинг</TableHead>
              <TableHead>Отрасли</TableHead>
              <TableHead class="text-right">Вакансии</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="query.isPending.value">
              <TableRow v-for="index in 6" :key="index">
                <TableCell :colspan="4">
                  <Skeleton class="h-4 w-full" />
                </TableCell>
              </TableRow>
            </template>

            <TableRow v-else-if="companies.length === 0">
              <TableCell :colspan="4">
                <EmptyState
                  title="Компании не найдены"
                  description="Измените запрос или сохраните вакансии, чтобы работодатели появились в корпусе."
                />
              </TableCell>
            </TableRow>

            <TableRow v-for="company in companies" :key="company.id">
              <TableCell>
                <div class="flex items-center gap-2.5">
                  <img
                    v-if="company.logoUrl"
                    :src="company.logoUrl"
                    :alt="company.name"
                    class="size-8 shrink-0 rounded-md border bg-white object-contain"
                    loading="lazy"
                  />
                  <a
                    :href="companyPath(company.id)"
                    class="font-medium text-foreground transition-colors hover:text-primary"
                  >
                    {{ company.name }}
                  </a>
                </div>
              </TableCell>
              <TableCell class="whitespace-nowrap">
                <span class="text-amber-400">★</span>
                {{ formatRating(company.rating) }}
                <span v-if="company.reviewsCount" class="text-xs text-muted-foreground">
                  · {{ formatNumber(company.reviewsCount) }} отзывов
                </span>
              </TableCell>
              <TableCell>
                <div v-if="company.industries.length > 0" class="flex flex-wrap gap-1">
                  <Badge
                    v-for="industry in company.industries.slice(0, 3)"
                    :key="industry"
                    variant="secondary"
                    class="font-normal"
                  >
                    {{ industry }}
                  </Badge>
                  <Badge v-if="company.industries.length > 3" variant="outline">
                    +{{ company.industries.length - 3 }}
                  </Badge>
                </div>
                <span v-else class="text-muted-foreground">—</span>
              </TableCell>
              <TableCell class="text-right tabular-nums">
                {{ formatNumber(company.vacancyCount) }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </section>
</template>
