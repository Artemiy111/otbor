<script setup lang="ts">
import { computed, h, ref } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { KeywordMatchLocation, LexiconKeyword } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert, Pencil, Plus, Search, Trash2, X } from "@lucide/vue"
import { AccountChip, hhAccountApi, hhAccountKeys } from "@/entities/hh-account"
import { keywordApi, keywordKeys } from "@/entities/keyword"
import { presetApi, presetKeys } from "@/entities/preset"
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
const editorOpen = ref(false)
const editingId = ref<string | undefined>(undefined)
const termDraft = ref("")
const newAliasesDraft = ref("")
const aliasDraft = ref("")

/** The keyword being edited, live from the list so alias changes show up at once. */
const editing = computed(() =>
  keywords.value.find((keyword) => keyword.id === editingId.value)
)

const openEditor = (keyword?: LexiconKeyword) => {
  editingId.value = keyword?.id
  termDraft.value = keyword?.term ?? ""
  newAliasesDraft.value = ""
  aliasDraft.value = ""
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
  mutation: async (change: { add: string } | { remove: string }) => {
    if ("add" in change) return keywordApi.addAlias(editingId.value!, change.add)
    return keywordApi.removeAlias(change.remove)
  },
  onSuccess: async () => {
    aliasDraft.value = ""
    await invalidate()
  }
})

const addAlias = () => {
  const alias = aliasDraft.value.trim()
  if (alias !== "") aliasMutation.mutate({ add: alias })
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

const accountsColumn = (
  id: string,
  title: string,
  pick: (keyword: LexiconKeyword) => ReadonlyArray<string>
): ColumnDef<LexiconKeyword> => ({
  id,
  accessorFn: (row) => pick(row).length,
  enableGlobalFilter: false,
  header: sortableHeader<LexiconKeyword>(title),
  cell: ({ row }) => {
    const ids = pick(row.original)
    if (ids.length === 0) return h("span", { class: "text-sm text-muted-foreground" }, "—")
    return h(
      "div",
      { class: "flex flex-wrap gap-1" },
      ids.map((accountId) =>
        h(AccountChip, { key: accountId, accountId, accounts: accounts.value })
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
      if (stats.length === 0) {
        const aliases = row.original.aliases
        if (aliases.length === 0) return h("span", { class: "text-sm text-muted-foreground" }, "—")
        return h(
          "div",
          { class: "flex flex-wrap gap-1" },
          aliases.map((alias) =>
            h(
              Badge,
              {
                key: alias.id,
                variant: "secondary",
                class: "font-normal",
                title: `${alias.matchType}${alias.typo ? " · опечатка" : ""}`
              },
              () => [
                alias.alias,
                alias.typo
                  ? h("span", { class: "ml-1 text-[10px] opacity-60" }, "опечатка")
                  : null
              ]
            )
          )
        )
      }
      return h(
        "div",
        { class: "flex flex-wrap gap-1" },
        stats.map((stat) =>
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
              h("span", { class: "ml-1 text-muted-foreground" }, `${stat.share}%`)
            ]
          )
        )
      )
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
  accountsColumn("resumes", "В резюме", (keyword) => keyword.resumeAccountIds),
  accountsColumn("resumeSkills", "В навыках резюме", (keyword) => keyword.resumeSkillAccountIds)
]
</script>

<template>
  <section>
    <PageHeader
      title="Ключевые слова"
      description="Словарь терминов и алиасов. «В резюме» — аккаунты, у которых слово есть в тексте резюме; «В навыках резюме» — в списке навыков."
    >
      <template #actions>
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
