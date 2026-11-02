<script setup lang="ts">
import { useQuery } from "@pinia/colada"
import { CircleAlert, ExternalLink } from "lucide-vue-next"
import { vacancyApi, vacancyKeys } from "@/entities/vacancy"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatDate, formatSalary } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import { StatCard } from "@/widgets/stat-card"

const props = defineProps<{ id: string }>()

const { data, isPending, isLoading, error, refetch } = useQuery({
  key: () => vacancyKeys.detail(props.id),
  query: () => vacancyApi.get(props.id)
})
</script>

<template>
  <section>
    <PageHeader
      :title="data?.vacancy.title ?? 'Vacancy'"
      :description="
        data
          ? [data.vacancy.employerName ?? 'unknown employer', data.vacancy.areaName, data.vacancy.archived ? 'archived' : null]
              .filter(Boolean)
              .join(' · ')
          : undefined
      "
      back-to="#/vacancies"
      back-label="Vacancies"
    >
      <template #actions>
        <StatusBadge v-if="data?.titleVerdict" :value="data.titleVerdict" />
        <Button v-if="data" as-child variant="outline" size="sm">
          <a :href="data.vacancy.canonicalUrl" target="_blank" rel="noreferrer">
            Open on hh
            <ExternalLink class="h-4 w-4" />
          </a>
        </Button>
        <RefreshButton :loading="isLoading" @refresh="refetch()" />
      </template>
    </PageHeader>

    <Alert v-if="error" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Could not load vacancy</AlertTitle>
      <AlertDescription>{{ describeError(error) }}</AlertDescription>
    </Alert>

    <div v-if="isPending" class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton v-for="index in 4" :key="index" class="h-24 w-full" />
      </div>
      <Skeleton class="h-48 w-full" />
      <Skeleton class="h-64 w-full" />
    </div>

    <template v-else-if="data">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Salary"
          :value="
            formatSalary(data.vacancy.salaryFrom, data.vacancy.salaryTo, data.vacancy.salaryCurrency)
          "
        />
        <StatCard label="Seniority" :value="data.vacancy.seniority" />
        <StatCard label="Published" :value="formatDate(data.vacancy.publishedAt)" />
        <StatCard label="Last seen" :value="formatDate(data.vacancy.lastSeenAt)" />
      </div>

      <Card class="mt-4">
        <CardHeader>
          <CardTitle>Skills</CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="data.skills.length > 0" class="flex flex-wrap gap-1.5">
            <Badge v-for="skill in data.skills" :key="skill" variant="secondary">
              {{ skill }}
            </Badge>
          </div>
          <p v-else class="text-sm text-muted-foreground">No parsed skills.</p>
        </CardContent>
      </Card>

      <Card class="mt-4">
        <CardHeader>
          <CardTitle>Lexicon matches</CardTitle>
        </CardHeader>
        <CardContent class="p-0">
          <Table v-if="data.keywords.length > 0">
            <TableHeader>
              <TableRow>
                <TableHead>Term</TableHead>
                <TableHead>Matched form</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Body</TableHead>
                <TableHead>Skills</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="keyword in data.keywords" :key="keyword.keywordId">
                <TableCell class="font-medium">{{ keyword.term }}</TableCell>
                <TableCell>
                  {{ keyword.matchedForm }}
                  <span v-if="keyword.typo" class="text-xs text-muted-foreground"> · typo</span>
                </TableCell>
                <TableCell>{{ keyword.titleCount }}</TableCell>
                <TableCell>{{ keyword.bodyCount }}</TableCell>
                <TableCell>{{ keyword.inSkills ? "yes" : "—" }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <EmptyState v-else title="No lexicon matches" />
        </CardContent>
      </Card>

      <Card class="mt-4">
        <CardHeader>
          <CardTitle>Description</CardTitle>
        </CardHeader>
        <CardContent>
          <pre
            class="max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground"
          >{{ data.descriptionText || "No description parsed." }}</pre>
        </CardContent>
      </Card>
    </template>
  </section>
</template>
