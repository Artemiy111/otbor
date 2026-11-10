<script setup lang="ts">
import { computed, h, ref, watch } from "vue"
import { refDebounced } from "@vueuse/core"
import { useQuery, useQueryCache } from "@pinia/colada"
import type { BlacklistRecord, BlacklistScope, BlacklistTarget } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert, ExternalLink, Plus, Search, Undo2, Upload } from "@lucide/vue"
import { blacklistApi, blacklistKeys } from "@/entities/blacklist"
import { AccountChip, AccountOption, CommandChip, hhAccountApi, hhAccountKeys } from "@/entities/hh-account"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatDate } from "@/shared/lib"
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
  Textarea
} from "@/shared/ui"
import { ConfirmSheet } from "@/shared/ui/confirm-sheet"
import { PageHeader } from "@/widgets/page-header"
import {
  groupExclusions,
  hhUrl,
  originLabel,
  parseHhTarget,
  removalKind,
  scopeLabel,
  targetLabel,
  type ExclusionRow
} from "../model/exclusions"

const PAGE_SIZE = 50
const ALL = "all"

/* Фильтры: тип, где действует, аккаунт, поиск ------------------------------------ */
const typeFilter = ref<string>(ALL)
const scopeFilter = ref<string>(ALL)
const accountFilter = ref<string>(ALL)
const draftQuery = ref("")
const appliedQuery = refDebounced(draftQuery, 300)
const offset = ref(0)
const pageSize = ref(PAGE_SIZE)
const filtersActive = computed(
  () => typeFilter.value !== ALL || scopeFilter.value !== ALL || accountFilter.value !== ALL || draftQuery.value.trim() !== ""
)
const resetFilters = () => {
  typeFilter.value = ALL
  scopeFilter.value = ALL
  accountFilter.value = ALL
  draftQuery.value = ""
}
watch([typeFilter, scopeFilter, accountFilter, appliedQuery], () => {
  offset.value = 0
})

const SCOPE_FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: ALL, label: "Везде" },
  { value: "app", label: "Для всех аккаунтов" },
  { value: "hh_account", label: "Для одного аккаунта" },
  { value: "resume", label: "Для одного резюме" },
  { value: "hh_native", label: "Скрыто на hh.ru" }
]

const query = useQuery({
  key: () =>
    blacklistKeys.list({
      scope: scopeFilter.value,
      hhAccountId: accountFilter.value === ALL ? "" : accountFilter.value,
      targetType: typeFilter.value,
      query: appliedQuery.value.trim(),
      offset: offset.value
    }),
  query: () =>
    blacklistApi.list({
      scope: scopeFilter.value === ALL ? undefined : (scopeFilter.value as BlacklistScope),
      hhAccountId: accountFilter.value === ALL ? undefined : accountFilter.value,
      targetType: typeFilter.value === ALL ? undefined : (typeFilter.value as BlacklistTarget),
      query: appliedQuery.value.trim() === "" ? undefined : appliedQuery.value.trim(),
      limit: pageSize.value,
      offset: offset.value
    }),
  placeholderData: (previous) => previous
})

const accountsQuery = useQuery({ key: () => hhAccountKeys.list(), query: () => hhAccountApi.list() })
const accounts = computed(() => accountsQuery.data.value ?? [])
const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })
const resumeTitle = (id: string | null | undefined): string => {
  if (id == null) return "резюме"
  return resumesQuery.data.value?.find((resume) => resume.id === id)?.title ?? `резюме ${id.slice(0, 8)}`
}

const rows = computed(() => groupExclusions(query.data.value?.items ?? []))
const total = computed(() => query.data.value?.total ?? 0)
const errorText = computed(() => (query.error.value === null ? null : describeError(query.error.value)))

const queryCache = useQueryCache()
const reload = () => queryCache.invalidateQueries({ key: blacklistKeys.all })

/* Вернуть --------------------------------------------------------------------- */
const removing = ref<ExclusionRow | null>(null)
const removeBusy = ref(false)
const removeError = ref<string | null>(null)
const confirmRemove = async () => {
  const row = removing.value
  if (row === null) return
  removeBusy.value = true
  removeError.value = null
  try {
    for (const id of row.ids) {
      if (removalKind(row) === "unreject") await blacklistApi.unreject(id)
      else await blacklistApi.remove(id)
    }
    removing.value = null
    await reload()
  } catch (cause) {
    removeError.value = describeError(cause)
    removing.value = null
  } finally {
    removeBusy.value = false
  }
}
const removeDescription = computed(() => {
  const row = removing.value
  if (row === null) return ""
  return removalKind(row) === "unreject"
    ? "Вакансия снова станет доступна для откликов; решение по ней пересчитается, а отклики, которые остановила отбраковка, вернутся в черновики."
    : row.scope === "hh_native"
      ? "Запись исчезнет только здесь. На hh.ru работодатель останется скрытым, а следующий импорт с hh добавит его снова."
      : "Система снова сможет откликаться на вакансии этого работодателя."
})

/* Добавить -------------------------------------------------------------------- */
const addOpen = ref(false)
const addScope = ref<"app" | "hh_account" | "hh_native">("app")
const addType = ref<BlacklistTarget>("employer")
const addAccount = ref("")
const addTarget = ref("")
const addName = ref("")
const addReason = ref("")
const addError = ref<string | null>(null)
const addBusy = ref(false)

const openAdd = () => {
  addScope.value = "app"
  addType.value = "employer"
  addAccount.value = accountFilter.value === ALL ? (accounts.value[0]?.id ?? "") : accountFilter.value
  addTarget.value = ""
  addName.value = ""
  addReason.value = ""
  addError.value = null
  addOpen.value = true
}
// Ссылка hh.ru сама определяет тип и номер.
watch(addTarget, (value) => {
  const parsed = parseHhTarget(value)
  if (parsed.type !== null) {
    addType.value = parsed.type
    addTarget.value = parsed.externalId
  }
})
const addNeedsAccount = computed(() => addScope.value !== "app")

const submitAdd = async () => {
  const externalId = addTarget.value.trim()
  if (externalId === "") {
    addError.value = "Вставьте ссылку на hh.ru или номер."
    return
  }
  if (addNeedsAccount.value && addAccount.value === "") {
    addError.value = "Выберите аккаунт."
    return
  }
  addBusy.value = true
  addError.value = null
  try {
    await blacklistApi.upsert({
      scope: addScope.value,
      targetType: addType.value,
      externalId,
      name: addName.value.trim() === "" ? undefined : addName.value.trim(),
      reason: addReason.value.trim() === "" ? undefined : addReason.value.trim(),
      hhAccountId: addNeedsAccount.value ? addAccount.value : undefined
    })
    addOpen.value = false
    await reload()
  } catch (cause) {
    addError.value = describeError(cause)
  } finally {
    addBusy.value = false
  }
}

/* Импорт с hh ----------------------------------------------------------------- */
const importOpen = ref(false)
const importAccount = ref("")
const openImport = () => {
  importAccount.value = accountFilter.value === ALL ? (accounts.value[0]?.id ?? "") : accountFilter.value
  importOpen.value = true
}
const importCommand = computed(
  () => `otbor blacklist scrape-hh --account ${importAccount.value === "" ? "<id аккаунта>" : importAccount.value}`
)

/* Таблица --------------------------------------------------------------------- */
const whereCell = (row: ExclusionRow) => {
  const chips = row.accountIds.map((id) =>
    h(AccountChip, { accountId: id, accounts: accounts.value, showName: row.accountIds.length === 1 })
  )
  if (row.scope === "resume") {
    return h("div", { class: "space-y-1" }, [
      h("div", null, `Для резюме «${resumeTitle(row.resumeId)}»`),
      h("div", { class: "flex flex-wrap items-center gap-1" }, chips)
    ])
  }
  return h("div", { class: "space-y-1" }, [
    h("div", null, scopeLabel(row.scope)),
    chips.length > 0 ? h("div", { class: "flex flex-wrap items-center gap-1" }, chips) : null
  ])
}

const columns: ColumnDef<ExclusionRow>[] = [
  {
    id: "name",
    header: "Название",
    cell: ({ row }) =>
      h("div", { class: "max-w-[22rem] space-y-0.5" }, [
        h("div", { class: "font-medium" }, row.original.name ?? `№ ${row.original.externalId}`),
        h(
          "a",
          {
            href: hhUrl(row.original.targetType, row.original.externalId),
            target: "_blank",
            rel: "noopener",
            class: "inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground hover:text-foreground hover:underline"
          },
          [`hh.ru № ${row.original.externalId}`, h(ExternalLink, { class: "size-3" })]
        )
      ])
  },
  {
    id: "type",
    header: "Что исключено",
    cell: ({ row }) =>
      h(Badge, { variant: row.original.targetType === "vacancy" ? "info" : "secondary" }, () => targetLabel(row.original.targetType))
  },
  { id: "where", header: "Где действует", cell: ({ row }) => whereCell(row.original) },
  {
    id: "origin",
    header: "Кто добавил",
    cell: ({ row }) => h("span", { class: "text-sm" }, originLabel(row.original))
  },
  {
    id: "reason",
    header: "Причина",
    cell: ({ row }) => h("span", { class: "text-sm text-muted-foreground" }, row.original.reason ?? "—")
  },
  {
    id: "when",
    header: "Когда",
    cell: ({ row }) => h("span", { class: "whitespace-nowrap text-sm tabular-nums text-muted-foreground" }, formatDate(row.original.createdAt))
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) =>
      h(
        Button,
        {
          variant: "outline",
          size: "sm",
          "aria-label": `Вернуть: ${row.original.name ?? row.original.externalId}`,
          onClick: () => {
            removing.value = row.original
          }
        },
        () => [h(Undo2), "Вернуть"]
      )
  }
]

const onPagination = (state: { pageIndex: number; pageSize: number }) => {
  pageSize.value = state.pageSize
  offset.value = state.pageIndex * state.pageSize
}
</script>

<template>
  <section>
    <PageHeader
      title="Исключения"
      description="Работодатели и вакансии, на которые система не откликается. Запись не удаляет вакансию из базы, а только скрывает её из откликов. «Вернуть» снимает исключение."
    >
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="query.refetch()" />
        <Button variant="outline" size="sm" @click="openImport">
          <Upload />
          Импорт скрытых с hh
        </Button>
        <Button size="sm" @click="openAdd">
          <Plus />
          Добавить
        </Button>
      </template>
    </PageHeader>

    <form class="mb-4 flex flex-wrap items-end gap-3" role="search" @submit.prevent>
      <div class="min-w-56 flex-1 space-y-1.5">
        <Label for="exclusion-search" class="text-xs text-muted-foreground">Поиск по названию или номеру</Label>
        <div class="relative">
          <Search class="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input id="exclusion-search" v-model="draftQuery" type="search" class="pl-9" placeholder="Например, Яндекс" />
        </div>
      </div>
      <div class="w-full space-y-1.5 sm:w-auto">
        <Label for="exclusion-type" class="text-xs text-muted-foreground">Что исключено</Label>
        <Select v-model="typeFilter">
          <SelectTrigger id="exclusion-type" class="w-full sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem :value="ALL">Всё</SelectItem>
            <SelectItem value="employer">Работодатели</SelectItem>
            <SelectItem value="vacancy">Вакансии</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="w-full space-y-1.5 sm:w-auto">
        <Label for="exclusion-scope" class="text-xs text-muted-foreground">Где действует</Label>
        <Select v-model="scopeFilter">
          <SelectTrigger id="exclusion-scope" class="w-full sm:w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in SCOPE_FILTER_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="w-full space-y-1.5 sm:w-auto">
        <Label for="exclusion-account" class="text-xs text-muted-foreground">Аккаунт hh</Label>
        <Select v-model="accountFilter">
          <SelectTrigger id="exclusion-account" class="w-full sm:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem :value="ALL">Все аккаунты</SelectItem>
            <SelectItem v-for="account in accounts" :key="account.id" :value="account.id">
              <AccountOption :account="account" />
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button v-if="filtersActive" type="button" variant="ghost" @click="resetFilters">Сбросить</Button>
    </form>

    <Alert v-if="errorText" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить исключения</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>
    <Alert v-if="removeError" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось вернуть</AlertTitle>
      <AlertDescription>{{ removeError }}</AlertDescription>
    </Alert>

    <DataTable
      :columns="columns"
      :data="rows"
      :is-loading="query.isPending.value"
      :loading-row-count="6"
      :row-numbers="false"
      server-side
      :page-size="pageSize"
      :page-size-options="[25, 50, 100]"
      :row-count="total"
      :empty-title="filtersActive ? 'Ничего не найдено' : 'Исключений нет'"
      :empty-description="
        filtersActive
          ? 'Измените или сбросьте фильтры.'
          : 'Добавьте работодателя или вакансию, отбракуйте вакансию кнопкой на её странице или импортируйте скрытых с hh.'
      "
      @update:pagination="onPagination"
    >
      <template #summary>
        <p class="mb-2 text-xs tabular-nums text-muted-foreground">Всего: {{ total }}</p>
      </template>
    </DataTable>

    <ConfirmSheet
      :open="removing !== null"
      :title="`Вернуть «${removing?.name ?? removing?.externalId ?? ''}»?`"
      :description="removeDescription"
      confirm-label="Вернуть"
      :busy="removeBusy"
      @update:open="(value) => { if (!value) removing = null }"
      @confirm="confirmRemove"
    />

    <!-- Добавить -->
    <Sheet v-model:open="addOpen">
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Добавить исключение</SheetTitle>
          <SheetDescription>Система перестанет откликаться на это.</SheetDescription>
        </SheetHeader>
        <form class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4" @submit.prevent="submitAdd">
          <Alert v-if="addError" variant="destructive">
            <CircleAlert />
            <AlertDescription>{{ addError }}</AlertDescription>
          </Alert>
          <div class="space-y-1.5">
            <Label for="add-target">Ссылка на hh.ru или номер</Label>
            <Input id="add-target" v-model="addTarget" type="text" placeholder="https://hh.ru/employer/1740" />
            <p class="text-xs text-muted-foreground">Тип определится по ссылке на работодателя или вакансию.</p>
          </div>
          <div class="space-y-1.5">
            <Label for="add-type">Что исключаем</Label>
            <Select v-model="addType">
              <SelectTrigger id="add-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="employer">Работодателя</SelectItem>
                <SelectItem value="vacancy">Вакансию</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <Label for="add-scope">Где действует</Label>
            <Select v-model="addScope">
              <SelectTrigger id="add-scope"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="app">Для всех аккаунтов</SelectItem>
                <SelectItem value="hh_account">Для одного аккаунта</SelectItem>
                <SelectItem value="hh_native">Как скрытое на hh.ru (для аккаунта)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div v-if="addNeedsAccount" class="space-y-1.5">
            <Label for="add-account">Аккаунт hh</Label>
            <Select v-model="addAccount">
              <SelectTrigger id="add-account"><SelectValue placeholder="Выберите аккаунт" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="account in accounts" :key="account.id" :value="account.id">
                  <AccountOption :account="account" />
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <Label for="add-name">Название (необязательно)</Label>
            <Input id="add-name" v-model="addName" type="text" />
          </div>
          <div class="space-y-1.5">
            <Label for="add-reason">Причина (необязательно)</Label>
            <Textarea id="add-reason" v-model="addReason" rows="2" />
          </div>
          <div class="mt-auto flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" @click="addOpen = false">Отмена</Button>
            <Button type="submit" :disabled="addBusy">{{ addBusy ? "Сохраняю…" : "Добавить" }}</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>

    <!-- Импорт с hh -->
    <Sheet v-model:open="importOpen">
      <SheetContent class="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Импорт скрытых с hh</SheetTitle>
          <SheetDescription>
            Забирает список работодателей, которых вы скрыли на hh.ru, и добавляет их сюда как «Скрыто на hh.ru».
            На hh.ru ничего не меняется. Тех, кого вы позже убрали из скрытых на hh.ru, здесь никто не удаляет.
          </SheetDescription>
        </SheetHeader>
        <div class="space-y-4 px-4 pb-4">
          <div class="space-y-1.5">
            <Label for="import-account">Из какого аккаунта</Label>
            <Select v-model="importAccount">
              <SelectTrigger id="import-account"><SelectValue placeholder="Выберите аккаунт" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="account in accounts" :key="account.id" :value="account.id">
                  <AccountOption :account="account" />
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-2 text-sm">
            <p>Запустите в терминале. Откроется браузер: войдите в hh.ru вручную, после этого список импортируется сам.</p>
            <CommandChip :command="importCommand" />
          </div>
          <div class="flex justify-end">
            <Button variant="outline" @click="importOpen = false">Закрыть</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  </section>
</template>
