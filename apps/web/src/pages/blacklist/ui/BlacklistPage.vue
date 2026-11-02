<script setup lang="ts">
import { computed, h, ref, watch } from "vue"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { BlacklistRecord, BlacklistScope, BlacklistTarget } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert, Plus, Search, Trash2, Upload } from "@lucide/vue"
import { blacklistApi, blacklistKeys } from "@/entities/blacklist"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatDate } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DataTable,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  sortableHeader
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const PAGE_SIZE = 50

const scopeTab = ref<BlacklistScope>("app")
const targetTypeFilter = ref<string>("all")
const draftQuery = ref("")
const appliedQuery = ref("")
const offset = ref(0)
const accountDraft = ref("")
const appliedAccount = ref("")

const scopeLabels: Record<BlacklistScope, string> = {
  app: "Приложение",
  hh_account: "Аккаунт hh",
  hh_native: "Скрыто в hh"
}

const targetTypeLabel = (t: BlacklistTarget): string =>
  t === "vacancy" ? "Вакансия" : "Компания"

const sourceLabel = (s: string): string =>
  s === "user" ? "Пользователь" : "hh"

watch(scopeTab, () => {
  offset.value = 0
})

const query = useQuery({
  key: () =>
    blacklistKeys.list({
      scope: scopeTab.value,
      hhAccountId: appliedAccount.value,
      targetType: targetTypeFilter.value,
      query: appliedQuery.value,
      offset: offset.value
    }),
  query: () =>
    blacklistApi.list({
      scope: scopeTab.value,
      hhAccountId: appliedAccount.value === "" ? undefined : appliedAccount.value,
      targetType: targetTypeFilter.value === "all" ? undefined : (targetTypeFilter.value as BlacklistTarget),
      query: appliedQuery.value === "" ? undefined : appliedQuery.value,
      limit: PAGE_SIZE,
      offset: offset.value
    })
})

const records = computed<ReadonlyArray<BlacklistRecord>>(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)

const search = () => {
  appliedQuery.value = draftQuery.value.trim()
  offset.value = 0
}
const reset = () => {
  draftQuery.value = ""
  appliedQuery.value = ""
  offset.value = 0
}
const applyAccount = () => {
  appliedAccount.value = accountDraft.value.trim()
  offset.value = 0
}

const queryCache = useQueryCache()

/* Add dialog */
const addOpen = ref(false)
const addScope = ref<BlacklistScope>("app")
const addTargetType = ref<BlacklistTarget>("employer")
const addExternalId = ref("")
const addName = ref("")
const addReason = ref("")
const addAccount = ref("")
const addError = ref<string | null>(null)

const upsertMutation = useMutation<BlacklistRecord, Parameters<typeof blacklistApi.upsert>[0]>({
  mutation: (input) => blacklistApi.upsert(input)
})

const openAdd = () => {
  addScope.value = scopeTab.value
  addTargetType.value = "employer"
  addExternalId.value = ""
  addName.value = ""
  addReason.value = ""
  addAccount.value = appliedAccount.value
  addError.value = null
  addOpen.value = true
}

const submitAdd = async () => {
  if (addExternalId.value.trim() === "") {
    addError.value = "Укажите внешний ID."
    return
  }
  if ((addScope.value === "hh_account" || addScope.value === "hh_native") && addAccount.value.trim() === "") {
    addError.value = "Укажите ID аккаунта hh."
    return
  }
  addError.value = null
  try {
    await upsertMutation.mutate({
      scope: addScope.value,
      targetType: addTargetType.value,
      externalId: addExternalId.value.trim(),
      name: addName.value.trim() === "" ? undefined : addName.value.trim(),
      reason: addReason.value.trim() === "" ? undefined : addReason.value.trim(),
      hhAccountId:
        addScope.value === "app" ? undefined : addAccount.value.trim()
    })
    addOpen.value = false
    await query.refetch()
  } catch (cause) {
    addError.value = describeError(cause)
  }
}

/* Remove */
const removingId = ref<string | null>(null)
const removeMutation = useMutation<{ readonly deleted: boolean }, string>({
  mutation: (id) => blacklistApi.remove(id)
})
const removeRecord = async (id: string) => {
  removingId.value = id
  try {
    await removeMutation.mutate(id)
    await query.refetch()
  } catch (cause) {
    // eslint-disable-next-line no-console
  } finally {
    removingId.value = null
  }
}

/* Import HH */
const importOpen = ref(false)
const importAccount = ref("")
const importText = ref("")
const importError = ref<string | null>(null)
const importResult = ref<string | null>(null)

const importMutation = useMutation<
  { readonly imported: number; readonly updated: number; readonly skipped: number },
  Parameters<typeof blacklistApi.importHh>[0]
>({
  mutation: (input) => blacklistApi.importHh(input)
})

const openImport = () => {
  importAccount.value = appliedAccount.value || accountDraft.value
  importText.value = ""
  importError.value = null
  importResult.value = null
  importOpen.value = true
}

const parseImportEntries = (raw: string): Array<{ targetType: BlacklistTarget; externalId: string; name?: string }> => {
  const parsed = JSON.parse(raw)
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entries) ? parsed.entries : null
  if (!Array.isArray(list)) throw new Error("Ожидается массив записей или объект { entries: [...] }.")
  return list.map((entry: any) => ({
    targetType: (entry.targetType === "vacancy" ? "vacancy" : "employer") as BlacklistTarget,
    externalId: String(entry.externalId ?? entry.external_id ?? ""),
    name: entry.name ? String(entry.name) : undefined
  })).filter((e) => e.externalId !== "")
}

const submitImport = async () => {
  if (importAccount.value.trim() === "") {
    importError.value = "Укажите ID аккаунта hh."
    return
  }
  let entries
  try {
    entries = parseImportEntries(importText.value)
  } catch (cause) {
    importError.value = describeError(cause)
    return
  }
  if (entries.length === 0) {
    importError.value = "Нет записей для импорта."
    return
  }
  importError.value = null
  importResult.value = null
  try {
    const res = await importMutation.mutateAsync({
      hhAccountId: importAccount.value.trim(),
      entries
    })
    importResult.value = `Импортировано: ${res.imported}, обновлено: ${res.updated}, пропущено: ${res.skipped}.`
    await query.refetch()
  } catch (cause) {
    importError.value = describeError(cause)
  }
}

const onFile = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importText.value = await file.text()
}

const columns: ColumnDef<BlacklistRecord>[] = [
  {
    accessorKey: "name",
    header: sortableHeader<BlacklistRecord>("Название"),
    cell: ({ row }) =>
      h("div", { class: "max-w-[260px]" }, [
        h("div", { class: "font-medium" }, row.original.name ?? "—"),
        h("div", { class: "text-xs text-muted-foreground font-mono" }, row.original.externalId)
      ])
  },
  {
    id: "targetType",
    accessorFn: (row) => row.targetType,
    header: sortableHeader<BlacklistRecord>("Тип"),
    cell: ({ row }) => h(Badge, { variant: "secondary" }, () => targetTypeLabel(row.original.targetType))
  },
  {
    id: "scope",
    accessorFn: (row) => row.scope,
    header: sortableHeader<BlacklistRecord>("Область"),
    cell: ({ row }) => h("span", null, scopeLabels[row.original.scope])
  },
  {
    id: "source",
    accessorFn: (row) => row.source,
    header: sortableHeader<BlacklistRecord>("Источник"),
    cell: ({ row }) => h("span", { class: "text-xs text-muted-foreground" }, sourceLabel(row.original.source))
  },
  {
    id: "reason",
    accessorFn: (row) => row.reason ?? "",
    header: sortableHeader<BlacklistRecord>("Причина"),
    cell: ({ row }) => h("span", { class: "text-xs text-muted-foreground" }, row.original.reason ?? "—")
  },
  {
    accessorKey: "updatedAt",
    header: sortableHeader<BlacklistRecord>("Обновлён"),
    cell: ({ row }) =>
      h("span", { class: "whitespace-nowrap text-muted-foreground text-xs" }, formatDate(row.original.updatedAt))
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) =>
      h(
        Button,
        {
          variant: "ghost",
          size: "sm",
          disabled: removingId.value === row.original.id,
          onClick: () => void removeRecord(row.original.id)
        },
        () => h(Trash2, { class: "h-4 w-4" })
      )
  }
]

const errorText = computed(() =>
  query.error.value === null ? null : describeError(query.error.value)
)
</script>

<template>
  <section>
    <PageHeader title="Чёрный список" description="Мягкий фильтр: записи скрывают вакансии и компании, но не удаляют их из корпуса.">
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
        <Button variant="outline" size="sm" @click="openImport">
          <Upload class="h-4 w-4" />
          Как импортировать из hh
        </Button>
        <Button size="sm" @click="openAdd">
          <Plus class="h-4 w-4" />
          Добавить
        </Button>
      </template>
    </PageHeader>

    <Tabs v-model="scopeTab" class="mb-4">
      <TabsList>
        <TabsTrigger value="app">Приложение</TabsTrigger>
        <TabsTrigger value="hh_account">Аккаунт hh</TabsTrigger>
        <TabsTrigger value="hh_native">Скрыто в hh</TabsTrigger>
      </TabsList>
    </Tabs>

    <form class="mb-4 flex flex-wrap items-end gap-3" @submit.prevent="search">
      <div class="min-w-64 flex-1 space-y-1.5">
        <Label class="text-xs text-muted-foreground">Поиск по названию / ID</Label>
        <div class="relative">
          <Search class="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
          <Input v-model="draftQuery" type="text" class="pl-9" placeholder="Например, Яндекс" />
        </div>
      </div>
      <div class="space-y-1.5">
        <Label class="text-xs text-muted-foreground">Тип</Label>
        <Select v-model="targetTypeFilter">
          <SelectTrigger class="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="vacancy">Вакансии</SelectItem>
            <SelectItem value="employer">Компании</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit">Найти</Button>
      <Button type="button" variant="outline" @click="reset">Сбросить</Button>
    </form>

    <div v-if="scopeTab !== 'app'" class="mb-4 flex flex-wrap items-end gap-3">
      <div class="min-w-64 flex-1 space-y-1.5">
        <Label class="text-xs text-muted-foreground">ID аккаунта hh</Label>
        <Input v-model="accountDraft" type="text" placeholder="UUID аккаунта" />
      </div>
      <Button type="button" variant="outline" @click="applyAccount">Применить</Button>
    </div>

    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить чёрный список</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>

    <DataTable
      :columns="columns"
      :data="records"
      :is-loading="query.isPending.value"
      :loading-row-count="6"
      empty-title="Записей нет"
      empty-description="Добавьте запись или импортируйте список из hh."
    />

    <p class="mt-3 text-xs text-muted-foreground">Всего: {{ total }}</p>

    <!-- Add dialog -->
    <Sheet v-model:open="addOpen">
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Добавить в чёрный список</SheetTitle>
          <SheetDescription>Запись скроет совпадающие вакансии/компании из списков по умолчанию.</SheetDescription>
        </SheetHeader>
        <div class="space-y-3">
          <Alert v-if="addError" variant="destructive">
            <CircleAlert />
            <AlertDescription>{{ addError }}</AlertDescription>
          </Alert>
          <div class="space-y-1.5">
            <Label>Область</Label>
            <Select v-model="addScope">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="app">Приложение</SelectItem>
                <SelectItem value="hh_account">Аккаунт hh</SelectItem>
                <SelectItem value="hh_native">Скрыто в hh</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <Label>Тип</Label>
            <Select v-model="addTargetType">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="employer">Компания</SelectItem>
                <SelectItem value="vacancy">Вакансия</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div v-if="addScope !== 'app'" class="space-y-1.5">
            <Label>ID аккаунта hh</Label>
            <Input v-model="addAccount" type="text" />
          </div>
          <div class="space-y-1.5">
            <Label>Внешний ID</Label>
            <Input v-model="addExternalId" type="text" />
          </div>
          <div class="space-y-1.5">
            <Label>Название</Label>
            <Input v-model="addName" type="text" />
          </div>
          <div class="space-y-1.5">
            <Label>Причина</Label>
            <Textarea v-model="addReason" />
          </div>
        </div>
          <Button variant="outline" @click="addOpen = false">Отмена</Button>
          <Button :disabled="upsertMutation.isLoading.value" @click="submitAdd">
            {{ upsertMutation.isLoading.value ? "Сохраняю…" : "Сохранить" }}
          </Button>
      </SheetContent>
    </Sheet>

    <!-- Import dialog -->
    <Sheet v-model:open="importOpen">
      <SheetContent class="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Импорт из hh</SheetTitle>
          <SheetDescription>
            Автоматический импорт запускается из терминала:
            <code class="block mt-2 rounded bg-muted p-2 text-xs">otbor blacklist scrape-hh --account &lt;id аккаунта hh&gt;</code>
            Откроется браузер Chromium, войдите в hh.ru вручную, затем список заблокированных компаний будет импортирован автоматически.
          </SheetDescription>
        </SheetHeader>
        <div class="mt-4">
          <Button variant="outline" @click="importOpen = false">Закрыть</Button>
        </div>
      </SheetContent>
    </Sheet>
  </section>
</template>
