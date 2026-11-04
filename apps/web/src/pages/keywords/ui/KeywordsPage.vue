<script setup lang="ts">
import { computed, h, onBeforeUnmount, ref } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { KeywordMatchLocation, LexiconKeyword } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert, Pencil, Plus, RefreshCw, Search, Trash2, X } from "@lucide/vue"
import { AccountChip, hhAccountApi, hhAccountKeys } from "@/entities/hh-account"
import { keywordApi, keywordKeys } from "@/entities/keyword"
import { presetApi, presetKeys } from "@/entities/preset"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatNumber } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DataTable,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
  sortableHeader
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const appliedQuery = ref("")
const draft = ref("")
const presetId = ref("all")
const location = ref<KeywordMatchLocation>("any")

const presetsQuery = useQuery({
  key: () => presetKeys.list("all"),
  query: () => presetApi.list({})
})

const query = useQuery({
  key: () => keywordKeys.list(appliedQuery.value, presetId.value, location.value),
  query: () =>
    keywordApi.list({
      query: appliedQuery.value === "" ? undefined : appliedQuery.value,
      limit: 5000,
      presetId: presetId.value === "all" ? undefined : presetId.value,
      location: location.value === "any" ? undefined : location.value
    })
})

const accountsQuery = useQuery({
  key: () => hhAccountKeys.list(),
  query: () => hhAccountApi.list()
})
const accounts = computed(() => accountsQuery.data.value ?? [])

const keywords = computed<ReadonlyArray<LexiconKeyword>>(() => query.data.value ?? [])
const presets = computed(() => presetsQuery.data.value ?? [])
const selectedPreset = computed(() =>
  presets.value.find((preset) => preset.id === presetId.value)
)
const presetsErrorText = computed(() =>
  presetsQuery.error.value === null ? null : describeError(presetsQuery.error.value)
)

const search = () => {
  appliedQuery.value = draft.value.trim()
}

const reset = () => {
  draft.value = ""
  appliedQuery.value = ""
  presetId.value = "all"
  location.value = "any"
}

const refresh = () => {
  void query.refetch()
}

const queryCache = useQueryCache()

// Matches are stored at ingest, so after a dictionary edit old vacancies must
// be re-matched. The cloud runs it detached; we poll its progress.
const rematchProgress = ref<{ running: boolean; processed: number; total: number } | null>(null)
let rematchTimer: ReturnType<typeof setInterval> | undefined

const stopPolling = () => {
  if (rematchTimer !== undefined) clearInterval(rematchTimer)
  rematchTimer = undefined
}

const pollRematch = () => {
  stopPolling()
  rematchTimer = setInterval(async () => {
    try {
      const progress = await keywordApi.rematchStatus()
      rematchProgress.value = progress
      if (!progress.running) {
        stopPolling()
        await invalidate()
      }
    } catch {
      stopPolling()
    }
  }, 2000)
}

const rematchMutation = useMutation({
  mutation: () => keywordApi.rematch(),
  onSuccess: (result) => {
    rematchProgress.value = result.progress
    if (result.progress.running) pollRematch()
  }
})

onBeforeUnmount(stopPolling)

const editorOpen = ref(false)
const editingId = ref<string | undefined>(undefined)
const termDraft = ref("")
const newAliasesDraft = ref("")
const aliasDraft = ref("")
const aliasTypoDraft = ref(false)

/** The keyword being edited, live from the list so alias changes show up at once. */
const editing = computed(() =>
  keywords.value.find((keyword) => keyword.id === editingId.value)
)

const openEditor = (keyword?: LexiconKeyword) => {
  editingId.value = keyword?.id
  termDraft.value = keyword?.term ?? ""
  newAliasesDraft.value = ""
  aliasDraft.value = ""
  aliasTypoDraft.value = false
  saveMutation.reset()
  aliasMutation.reset()
  editorOpen.value = true
}

const parseAliases = (text: string): Array<string> => [
  ...new Set(
    text
      .split(/[\n,]/)
      .map((alias) => alias.trim())
      .filter((alias) => alias !== "")
  )
]

const invalidate = () => queryCache.invalidateQueries({ key: keywordKeys.all })

// Create sends the initial aliases; a rename sends none and leaves them alone.
const saveMutation = useMutation({
  mutation: () =>
    keywordApi.save({
      id: editingId.value,
      term: termDraft.value.trim(),
      aliases: editingId.value === undefined ? parseAliases(newAliasesDraft.value) : undefined
    }),
  onSuccess: async () => {
    editorOpen.value = false
    await invalidate()
  }
})

const aliasMutation = useMutation({
  mutation: async (
    change:
      | { add: string; typo: boolean }
      | { remove: string }
      | { id: string; typo: boolean }
  ) => {
    if ("add" in change) return keywordApi.addAlias(editingId.value!, change.add, change.typo)
    if ("remove" in change) return keywordApi.removeAlias(change.remove)
    return keywordApi.setAliasTypo(change.id, change.typo)
  },
  onSuccess: async () => {
    aliasDraft.value = ""
    aliasTypoDraft.value = false
    await invalidate()
  }
})

const addAlias = () => {
  const alias = aliasDraft.value.trim()
  if (alias !== "") aliasMutation.mutate({ add: alias, typo: aliasTypoDraft.value })
}

const removeMutation = useMutation({
  mutation: (id: string) => keywordApi.remove(id),
  onSuccess: invalidate
})

const confirmRemove = (keyword: LexiconKeyword) => {
  if (window.confirm(`Удалить «${keyword.term}» и его алиасы?`)) {
    removeMutation.mutate(keyword.id)
  }
}

const saveErrorText = computed(() => {
  const error = saveMutation.error.value ?? aliasMutation.error.value
  return error === null ? null : describeError(error)
})

const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })
const resumes = computed(() => resumesQuery.data.value ?? [])

/** Chips per account, with the codes of the resumes that contain the keyword. */
const resumeColumn = (
  id: string,
  title: string,
  pick: (keyword: LexiconKeyword) => ReadonlyArray<string>
): ColumnDef<LexiconKeyword> => ({
  id,
  accessorFn: (row) => pick(row).length,
  enableGlobalFilter: false,
  header: sortableHeader<LexiconKeyword>(title),
  cell: ({ row }) => {
    const byAccount = new Map<string, string[]>()
    for (const resumeId of pick(row.original)) {
      const resume = resumes.value.find((item) => item.id === resumeId)
      if (resume === undefined) continue
      const list = byAccount.get(resume.hhAccountId) ?? []
      list.push(resumeId)
      byAccount.set(resume.hhAccountId, list)
    }
    if (byAccount.size === 0) return h("span", { class: "text-sm text-muted-foreground" }, "—")
    return h(
      "div",
      { class: "flex flex-wrap gap-1" },
      [...byAccount].map(([accountId, resumeIds]) =>
        h(AccountChip, {
          key: accountId,
          accountId,
          accounts: accounts.value,
          resumeIds,
          resumes: resumes.value
        })
      )
    )
  }
})

const columns: ColumnDef<LexiconKeyword>[] = [
  {
    accessorKey: "term",
    header: sortableHeader<LexiconKeyword>("Термин"),
    cell: ({ row }) =>
      h("div", null, [
        h("div", { class: "font-medium" }, row.original.term),
        h("code", { class: "text-[11px] text-muted-foreground" }, row.original.normalizedTerm)
      ])
  },
  {
    accessorKey: "vacancyCount",
    header: sortableHeader<LexiconKeyword>("Вакансий", "right"),
    cell: ({ row }) =>
      h(
        "span",
        { class: "block tabular-nums text-right" },
        formatNumber(row.original.vacancyCount)
      )
  },
  {
    accessorKey: "skillVacancyCount",
    header: sortableHeader<LexiconKeyword>("В навыках HH", "right"),
    cell: ({ row }) =>
      row.original.skillVacancyCount === 0
        ? h("span", { class: "block text-right text-sm text-muted-foreground" }, "—")
        : h(
            "span",
            { class: "block tabular-nums text-right" },
            formatNumber(row.original.skillVacancyCount)
          )
  },
  {
    id: "aliases",
    accessorFn: (row) => row.aliases.map((alias) => alias.alias).join(" "),
    enableGlobalFilter: false,
    header: sortableHeader<LexiconKeyword>("Алиасы"),
    cell: ({ row }) => {
      const stats = row.original.aliasStats ?? []
      // Stats only cover forms already found in vacancies, so aliases with no
      // match yet (for example just created) are appended without a share.
      const seen = new Set(stats.map((stat) => stat.normalizedAlias))
      const unmatched = row.original.aliases.filter(
        (alias) => !seen.has(alias.normalizedAlias)
      )
      if (stats.length === 0 && unmatched.length === 0) {
        return h("span", { class: "text-sm text-muted-foreground" }, "—")
      }
      return h("div", { class: "flex flex-wrap gap-1" }, [
        ...stats.map((stat) =>
          h(
            Badge,
            {
              key: stat.normalizedAlias,
              variant: "secondary",
              class: "font-normal",
              title: `${stat.vacancies} вакансий, ${stat.mentions} упоминаний`
            },
            () => [
              stat.alias,
              stat.typo ? h("span", { class: "ml-1 text-[10px] opacity-60" }, "опечатка") : null,
              h(
                "span",
                { class: "ml-1 text-muted-foreground" },
                // Math.round in the API turns a tiny share into 0%; don't claim "never".
                `${stat.share === 0 && stat.mentions > 0 ? "<1" : stat.share}% · ${formatNumber(stat.vacancies)}`
              )
            ]
          )
        ),
        ...unmatched.map((alias) =>
          h(
            Badge,
            {
              key: alias.id,
              variant: "outline",
              class: "font-normal",
              title: "Пока не встречался в вакансиях"
            },
            () => [
              alias.alias,
              alias.typo ? h("span", { class: "ml-1 text-[10px] opacity-60" }, "опечатка") : null
            ]
          )
        )
      ])
    }
  },
  {
    id: "actions",
    enableSorting: false,
    enableGlobalFilter: false,
    header: "",
    cell: ({ row }) =>
      h("div", { class: "flex justify-end gap-1" }, [
        h(
          Button,
          {
            variant: "ghost",
            size: "icon",
            title: "Изменить",
            onClick: () => openEditor(row.original)
          },
          () => h(Pencil, { class: "h-4 w-4" })
        ),
        h(
          Button,
          {
            variant: "ghost",
            size: "icon",
            title: "Удалить",
            onClick: () => confirmRemove(row.original)
          },
          () => h(Trash2, { class: "h-4 w-4" })
        )
      ])
  },
  resumeColumn("resumes", "В резюме", (keyword) => keyword.resumeIds),
  resumeColumn("resumeSkills", "В навыках резюме", (keyword) => keyword.resumeSkillIds)
]
</script>

<template>
  <section>
    <PageHeader
      title="Ключевые слова"
      description="Словарь терминов и алиасов. «В резюме» — аккаунты, у которых слово есть в тексте резюме; «В навыках резюме» — в списке навыков."
    >
      <template #actions>
        <Button
          type="button"
          variant="outline"
          title="Заново найти слова и алиасы во всех собранных вакансиях"
          :disabled="rematchProgress?.running || rematchMutation.isLoading.value"
          @click="rematchMutation.mutate()"
        >
          <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': rematchProgress?.running }" />
          <template v-if="rematchProgress?.running">
            Пересчёт {{ formatNumber(rematchProgress.processed) }} / {{ formatNumber(rematchProgress.total) }}
          </template>
          <template v-else>Пересчитать</template>
        </Button>
        <Button type="button" @click="openEditor()">
          <Plus class="h-4 w-4" /> Добавить
        </Button>
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
      <div class="space-y-1.5">
        <Label for="keyword-preset" class="text-xs text-muted-foreground">Пресет</Label>
        <Select v-model="presetId">
          <SelectTrigger id="keyword-preset" class="w-[240px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Без пресета</SelectItem>
            <SelectItem v-for="preset in presets" :key="preset.id" :value="preset.id">
              {{ preset.title }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="space-y-1.5">
        <Label for="keyword-location" class="text-xs text-muted-foreground">Где искать</Label>
        <Select v-model="location">
          <SelectTrigger id="keyword-location" class="w-[210px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Везде</SelectItem>
            <SelectItem value="skills">В навыках HH</SelectItem>
            <SelectItem value="body">В тексте вакансии</SelectItem>
            <SelectItem value="text_or_skills">Текст + навыки</SelectItem>
            <SelectItem value="title">В заголовке</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" :disabled="query.isLoading.value">Найти</Button>
      <Button type="button" variant="outline" :disabled="query.isLoading.value" @click="reset">
        Сбросить
      </Button>
    </form>

    <p v-if="presetsErrorText" class="mb-3 text-xs text-muted-foreground">
      Пресеты недоступны: {{ presetsErrorText }}. Словарь показан без пресета.
    </p>

    <p class="mb-3 text-xs text-muted-foreground">
      Терминов: {{ formatNumber(keywords.length) }}
    </p>

    <p v-if="selectedPreset" class="mb-3 text-xs text-muted-foreground">
      Пресет «{{ selectedPreset.title }}»: показаны только термины, которые встречаются в его
      вакансиях, и счётчики считают только эти вакансии.
    </p>

    <p v-if="location !== 'any'" class="mb-3 text-xs text-muted-foreground">
      Учитываются только совпадения в выбранном месте вакансии. «Текст + навыки» — любое из двух.
    </p>

    <Alert v-if="query.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить словарь</AlertTitle>
      <AlertDescription>{{ describeError(query.error.value) }}</AlertDescription>
    </Alert>

    <DataTable
      :columns="columns"
      :data="keywords"
      :is-loading="query.isPending.value"
      :loading-row-count="8"
      :empty-title="appliedQuery === '' ? 'Словарь пуст' : 'Ничего не найдено'"
      empty-description="Добавьте термины через CLI или измените поисковый запрос."
    />

    <Sheet v-model:open="editorOpen">
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{{ editingId ? "Изменить слово" : "Новое слово" }}</SheetTitle>
          <SheetDescription>
            Алиасы — другие написания того же термина. При создании — по одному на строку или через запятую; у существующего слова добавляются и удаляются по одному сразу.
          </SheetDescription>
        </SheetHeader>
        <form class="flex flex-1 flex-col gap-4 px-4 pb-4" @submit.prevent="saveMutation.mutate()">
          <div class="space-y-1.5">
            <Label for="keyword-term">Термин</Label>
            <Input id="keyword-term" v-model="termDraft" placeholder="Kubernetes" required />
          </div>
          <div v-if="editingId === undefined" class="space-y-1.5">
            <Label for="keyword-aliases">Алиасы</Label>
            <Textarea
              id="keyword-aliases"
              v-model="newAliasesDraft"
              rows="6"
              placeholder="k8s&#10;кубернетес"
            />
          </div>
          <div v-else class="space-y-1.5">
            <Label for="keyword-alias-new">Алиасы</Label>
            <div class="flex flex-wrap gap-1">
              <Badge
                v-for="alias in editing?.aliases ?? []"
                :key="alias.id"
                variant="secondary"
                class="gap-1 font-normal"
              >
                {{ alias.alias }}
                <button
                  type="button"
                  class="text-[10px] underline-offset-2 hover:underline"
                  :class="alias.typo ? '' : 'opacity-50'"
                  :title="alias.typo ? 'Это опечатка. Нажмите, чтобы снять' : 'Отметить как опечатку'"
                  :disabled="aliasMutation.isLoading.value"
                  @click="aliasMutation.mutate({ id: alias.id, typo: !alias.typo })"
                >
                  {{ alias.typo ? "опечатка" : "не опечатка" }}
                </button>
                <button
                  type="button"
                  class="opacity-60 hover:opacity-100"
                  title="Удалить алиас"
                  :disabled="aliasMutation.isLoading.value"
                  @click="aliasMutation.mutate({ remove: alias.id })"
                >
                  <X class="h-3 w-3" />
                </button>
              </Badge>
              <span v-if="(editing?.aliases.length ?? 0) === 0" class="text-sm text-muted-foreground">
                Алиасов нет
              </span>
            </div>
            <label class="flex items-center gap-2 text-xs text-muted-foreground">
              <input v-model="aliasTypoDraft" type="checkbox" />
              Новый алиас — опечатка
            </label>
            <div class="flex gap-2">
              <Input
                id="keyword-alias-new"
                v-model="aliasDraft"
                placeholder="Новый алиас"
                @keydown.enter.prevent="addAlias"
              />
              <Button
                type="button"
                variant="outline"
                :disabled="aliasDraft.trim() === '' || aliasMutation.isLoading.value"
                @click="addAlias"
              >
                Добавить
              </Button>
            </div>
          </div>
          <p v-if="saveErrorText" class="text-sm text-destructive">{{ saveErrorText }}</p>
          <Button type="submit" :disabled="termDraft.trim() === '' || saveMutation.isLoading.value">
            {{ editingId ? "Переименовать" : "Создать" }}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  </section>
</template>
