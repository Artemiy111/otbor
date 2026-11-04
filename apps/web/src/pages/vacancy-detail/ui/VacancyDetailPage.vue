<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useQuery } from "@pinia/colada"
import { CircleAlert, ExternalLink } from "@lucide/vue"
import { applicationApi, applicationKeys } from "@/entities/application"
import { contactApi, contactKeys } from "@/entities/contact"
import { decisionApi, decisionKeys } from "@/entities/decision"
import { vacancyApi, vacancyKeys } from "@/entities/vacancy"
import { useDefaultAccount } from "@/entities/hh-account"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatNumber } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import VacancyChips from "./VacancyChips.vue"
import VacancyFactsSidebar from "./VacancyFactsSidebar.vue"
import VacancyMetaLine from "./VacancyMetaLine.vue"

const props = defineProps<{ id: string }>()

const vacancyQuery = useQuery({
  key: () => vacancyKeys.detail(props.id),
  query: () => vacancyApi.get(props.id)
})

const decisionsQuery = useQuery({
  key: decisionKeys.list("all"),
  query: () => decisionApi.list({ limit: 200 })
})

const applicationsQuery = useQuery({
  key: applicationKeys.list("all"),
  query: () => applicationApi.list({ limit: 200 })
})

const contactsQuery = useQuery({
  key: () => contactKeys.vacancy(props.id),
  query: () => contactApi.list({ vacancyId: props.id, limit: 50 })
})

const data = computed(() => vacancyQuery.data.value)
const contacts = computed(() => contactsQuery.data.value?.items ?? [])

const { accounts, defaultAccountId } = useDefaultAccount()

const highlightKeywords = ref(true)

const keywordTotals = computed(() => {
  const totals = new Map<string, number>()
  for (const keyword of data.value?.keywords ?? []) {
    const count = keyword.titleCount + keyword.bodyCount
    totals.set(keyword.term, (totals.get(keyword.term) ?? 0) + count)
  }
  return totals
})

const groupedKeywords = computed(() => {
  const groups = new Map<
    string,
    { term: string; forms: Array<NonNullable<typeof data.value>["keywords"][number]>; total: number }
  >()
  for (const keyword of data.value?.keywords ?? []) {
    const group = groups.get(keyword.term) ?? { term: keyword.term, forms: [], total: 0 }
    group.forms.push(keyword)
    group.total += keyword.titleCount + keyword.bodyCount
    groups.set(keyword.term, group)
  }
  return [...groups.values()]
    .map((group) => ({
      term: group.term,
      total: group.total,
      titleCount: group.forms.reduce((sum, form) => sum + form.titleCount, 0),
      bodyCount: group.forms.reduce((sum, form) => sum + form.bodyCount, 0),
      inSkills: group.forms.some((form) => form.inSkills),
      forms: group.forms
        .map((form) => ({
          ...form,
          share:
            group.total > 0
              ? Math.round(((form.titleCount + form.bodyCount) / group.total) * 100)
              : 0
        }))
        .sort((a, b) => b.titleCount + b.bodyCount - (a.titleCount + a.bodyCount))
    }))
    .sort((a, b) => a.term.localeCompare(b.term, "ru"))
})

const highlightedDescription = computed(() => {
  const text = data.value?.descriptionText ?? ""
  if (text.trim() === "" || !highlightKeywords.value) return null
  const forms = [...new Set((data.value?.keywords ?? []).map((item) => item.matchedForm).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
  if (forms.length === 0) return null
  const escaped = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const pattern = new RegExp(`(${forms.map((form) => form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "giu")
  return escaped(text).replace(pattern, (match) => `<mark class="rounded bg-amber-200/60 px-0.5 text-foreground dark:bg-amber-400/30">${match}</mark>`)
})
const decisions = computed(() =>
  (decisionsQuery.data.value ?? []).filter((decision) => decision.vacancyId === props.id)
)
const applications = computed(() =>
  (applicationsQuery.data.value ?? []).filter((application) => application.vacancyId === props.id)
)

const isLoading = computed(() => vacancyQuery.isLoading.value)
const errorText = computed(() =>
  vacancyQuery.error.value === null ? null : describeError(vacancyQuery.error.value)
)

const refresh = () => {
  void vacancyQuery.refetch()
  void decisionsQuery.refetch()
  void applicationsQuery.refetch()
  void contactsQuery.refetch()
}

const hydrating = ref(false)
const autoHydrate = async () => {
  const detail = vacancyQuery.data.value
  if (detail === undefined || hydrating.value) return
  if (detail.descriptionText.trim() !== "") return
  hydrating.value = true
  try {
    const result = await vacancyApi.hydrate(props.id)
    if (result.hydrated) {
      await vacancyQuery.refetch()
      void contactsQuery.refetch()
    }
  } catch {
    // Hydration is best-effort; the stub stays visible if it fails.
  } finally {
    hydrating.value = false
  }
}
const hydrateNow = async () => {
  if (hydrating.value) return
  hydrating.value = true
  try {
    await vacancyApi.hydrate(props.id, true)
    await vacancyQuery.refetch()
    void contactsQuery.refetch()
  } catch {
    // The note stays visible; the operator can retry.
  } finally {
    hydrating.value = false
  }
}
watch(
  () => vacancyQuery.data.value,
  (detail) => {
    if (detail !== undefined && detail.descriptionText.trim() === "") {
      void autoHydrate()
    }
  },
  { immediate: true }
)
</script>

<template>
  <section>
    <PageHeader
      :title="data?.vacancy.title ?? 'Вакансия'"
      back-to="/vacancies"
      back-label="Вакансии"
    >
      <template #actions>
        <Button v-if="data" as-child variant="outline" size="sm">
          <a :href="data.vacancy.canonicalUrl" target="_blank" rel="noreferrer">
            Открыть на hh
            <ExternalLink class="h-4 w-4" />
          </a>
        </Button>
        <RefreshButton :loading="isLoading" @refresh="refresh" />
      </template>
    </PageHeader>

    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить вакансию</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>

    <div v-if="vacancyQuery.isPending.value" class="space-y-3">
      <Skeleton class="h-5 w-2/3" />
      <Skeleton class="h-6 w-1/2" />
      <Skeleton class="h-64 w-full" />
    </div>

    <template v-else-if="data">
      <VacancyMetaLine :data="data" />
      <VacancyChips :data="data" />

      <div class="grid gap-6 lg:grid-cols-3">
        <Tabs default-value="description" class="min-w-0 lg:col-span-2">
          <TabsList>
            <TabsTrigger value="description">Описание</TabsTrigger>
            <TabsTrigger value="skills">Навыки ({{ data.skills.length }})</TabsTrigger>
            <TabsTrigger value="keywords">Ключевые слова ({{ data.keywords.length }})</TabsTrigger>
          </TabsList>

          <TabsContent value="description">
            <label class="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <input v-model="highlightKeywords" type="checkbox" class="size-4 rounded border-input accent-primary" />
              Подсветить ключевые слова
            </label>
            <div
              v-if="highlightedDescription !== null"
              class="max-h-[75vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-4 text-sm leading-relaxed"
              v-html="highlightedDescription"
            />
            <pre
              v-else-if="data.descriptionText.trim() !== ''"
              class="max-h-[75vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-4 font-sans text-sm leading-relaxed"
            >{{ data.descriptionText }}</pre>
            <EmptyState v-else title="Описание не разобрано" description="Запустите догрузку вакансии." />
          </TabsContent>

          <TabsContent value="skills">
            <div v-if="data.skills.length > 0" class="flex flex-wrap gap-1.5">
              <Badge v-for="skill in data.skills" :key="skill" variant="secondary">
                {{ skill }}
              </Badge>
            </div>
            <EmptyState v-else title="Навыки не найдены" />
          </TabsContent>

          <TabsContent value="keywords">
            <Table v-if="groupedKeywords.length > 0">
              <TableHeader>
                <TableRow>
                  <TableHead>Термин</TableHead>
                  <TableHead>Формы</TableHead>
                  <TableHead>В заголовке</TableHead>
                  <TableHead>В тексте</TableHead>
                  <TableHead>В навыках</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="keyword in groupedKeywords" :key="keyword.term">
                  <TableCell class="font-medium">{{ keyword.term }}</TableCell>
                  <TableCell>
                    <div class="flex flex-wrap gap-1">
                      <span
                        v-for="form in keyword.forms"
                        :key="form.matchedForm"
                        class="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-xs"
                      >
                        {{ form.matchedForm }}
                        <span v-if="form.typo" class="text-muted-foreground">· опечатка</span>
                        <span class="text-muted-foreground">{{ form.share }}%</span>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{{ formatNumber(keyword.titleCount) }}</TableCell>
                  <TableCell>{{ formatNumber(keyword.bodyCount) }}</TableCell>
                  <TableCell>{{ keyword.inSkills ? "да" : "—" }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <EmptyState v-else title="Совпадений нет" description="Словарь не нашёл терминов в этой вакансии." />
          </TabsContent>
        </Tabs>

        <div class="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <VacancyFactsSidebar
            :data="data"
            :decisions="decisions"
            :applications="applications"
            :contacts="contacts"
            :accounts="accounts"
            :default-account-id="defaultAccountId"
            :hydrating="hydrating"
            @hydrate="hydrateNow"
          />
        </div>
      </div>
    </template>
  </section>
</template>
