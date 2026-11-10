<script setup lang="ts">
import { computed, h, ref } from "vue"
import { useQuery, useQueryCache } from "@pinia/colada"
import type { HhAccountRecord } from "@otbor/contract"
import type { ColumnDef } from "@tanstack/vue-table"
import { CircleAlert } from "@lucide/vue"
import {
  CaptchaBlockAlert,
  CaptchaEpisodesCard,
  hhAccountApi,
  hhAccountColor,
  hhAccountKeys,
  useDefaultAccount
} from "@/entities/hh-account"
import { RefreshButton } from "@/features/refresh-button"
import { describeError, formatDate } from "@/shared/lib"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DataTable,
  sortableHeader
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"

const query = useQuery({
  key: () => hhAccountKeys.list(),
  query: () => hhAccountApi.list()
})

const accounts = computed<ReadonlyArray<HhAccountRecord>>(() => query.data.value ?? [])
/** Аккаунты, чьи отправки на паузе из-за капчи. */
const blocked = computed(() => accounts.value.filter((account) => account.submitBlockedAt != null))

const queryCache = useQueryCache()
const actionError = ref<string | null>(null)
const { defaultAccountId } = useDefaultAccount()

/**
 * The upsert payload that keeps every stored field. Optional fields left out
 * of the request reach the server as `null` and would wipe the session profile
 * and the name, so each one is sent explicitly.
 */
const keep = (account: HhAccountRecord) => ({
  id: account.id,
  label: account.label,
  isDefault: account.isDefault,
  sessionProfile: account.sessionProfile ?? undefined,
  firstName: account.firstName ?? undefined,
  lastName: account.lastName ?? undefined,
  areaName: account.areaName ?? undefined
})

/** `null` goes back to the automatic colour. Other fields are passed through unchanged. */
const saveColor = async (account: HhAccountRecord, color: string | null) => {
  actionError.value = null
  try {
    await hhAccountApi.upsert({ ...keep(account), color })
    await queryCache.invalidateQueries({ key: hhAccountKeys.all })
  } catch (error) {
    actionError.value = describeError(error)
  }
}

/**
 * Makes the account the default one for the CLI, the harness and the header
 * switcher (the switcher keeps its own pick in the browser, so it is updated too).
 */
const makeDefault = async (account: HhAccountRecord) => {
  actionError.value = null
  try {
    await hhAccountApi.upsert({ ...keep(account), isDefault: true })
    defaultAccountId.value = account.id
    await queryCache.invalidateQueries({ key: hhAccountKeys.all })
  } catch (error) {
    actionError.value = describeError(error)
  }
}

/** Аккаунты, для которых сейчас идёт повтор заявок. */
const retrying = ref<ReadonlySet<string>>(new Set())
const notice = ref<string | null>(null)

/** Повторяет заявки аккаунта, остановленные капчей или сбоем чтения формы. */
const retryStopped = async (account: HhAccountRecord) => {
  actionError.value = null
  notice.value = null
  retrying.value = new Set([...retrying.value, account.id])
  try {
    const result = await hhAccountApi.retryCaptcha(account.id)
    notice.value = `${account.label}: повторено ${result.retried}, пропущено ${result.skipped.length}`
  } catch (error) {
    actionError.value = describeError(error)
  } finally {
    retrying.value = new Set([...retrying.value].filter((id) => id !== account.id))
  }
}

const columns: ColumnDef<HhAccountRecord>[] = [
  {
    id: "color",
    enableSorting: false,
    header: "Цвет",
    cell: ({ row }) =>
      h("div", { class: "flex items-center gap-2" }, [
        h("input", {
          type: "color",
          value: hhAccountColor(row.original),
          class: "h-7 w-9 cursor-pointer rounded border border-input bg-transparent p-0.5",
          "aria-label": `Цвет аккаунта ${row.original.label}`,
          // `change` fires once the picker closes, so one pick is one request.
          onChange: (event: Event) =>
            void saveColor(row.original, (event.target as HTMLInputElement).value)
        }),
        row.original.color
          ? h(
              Button,
              {
                variant: "ghost",
                size: "sm",
                class: "h-7 px-2 text-xs",
                onClick: () => void saveColor(row.original, null)
              },
              () => "Сбросить"
            )
          : null
      ])
  },
  {
    accessorKey: "label",
    header: sortableHeader<HhAccountRecord>("Аккаунт"),
    cell: ({ row }) => h("span", { class: "font-medium" }, row.original.label)
  },
  {
    id: "name",
    accessorFn: (row) => [row.firstName, row.lastName].filter(Boolean).join(" "),
    header: sortableHeader<HhAccountRecord>("Имя"),
    cell: ({ row }) =>
      h("span", null, [row.original.firstName, row.original.lastName].filter(Boolean).join(" ") || "—")
  },
  {
    id: "contacts",
    header: "Контакты",
    enableSorting: false,
    cell: ({ row }) => {
      const contacts = row.original.contacts
      const lines: Array<[string, string | null | undefined]> = [
        ["Телефон", contacts?.phone],
        ["Почта", contacts?.email],
        ["Telegram", contacts?.telegram]
      ]
      return h(
        "div",
        { class: "space-y-0.5 text-xs" },
        lines.map(([label, value]) =>
          h("div", null, [h("span", { class: "text-muted-foreground" }, `${label}: `), value ?? "—"])
        )
      )
    }
  },
  {
    accessorKey: "areaName",
    header: sortableHeader<HhAccountRecord>("Регион"),
    cell: ({ row }) => h("span", null, row.original.areaName ?? "—")
  },
  {
    accessorKey: "sessionProfile",
    header: sortableHeader<HhAccountRecord>("Профиль сессии"),
    cell: ({ row }) =>
      h("span", { class: "font-mono text-xs" }, row.original.sessionProfile ?? "—")
  },
  {
    id: "default",
    accessorFn: (row) => (row.isDefault ? "да" : "нет"),
    header: sortableHeader<HhAccountRecord>("По умолчанию"),
    cell: ({ row }) =>
      row.original.isDefault
        ? h(Badge, { variant: "success" }, () => "Да")
        : h(
            Button,
            {
              variant: "outline",
              size: "sm",
              class: "h-7 px-2 text-xs",
              onClick: () => void makeDefault(row.original)
            },
            () => "Сделать основным"
          )
  },
  {
    id: "retry",
    enableSorting: false,
    header: "Заявки",
    cell: ({ row }) =>
      h(
        Button,
        {
          variant: "outline",
          size: "sm",
          class: "h-7 px-2 text-xs",
          disabled: retrying.value.has(row.original.id),
          onClick: () => void retryStopped(row.original)
        },
        () => (retrying.value.has(row.original.id) ? "Повторяю…" : "Повторить после капчи")
      )
  },
  {
    accessorKey: "createdAt",
    header: sortableHeader<HhAccountRecord>("Создан"),
    cell: ({ row }) =>
      h("span", { class: "whitespace-nowrap text-muted-foreground" }, formatDate(row.original.createdAt))
  }
]

const refresh = () => void query.refetch()
</script>

<template>
  <section>
    <PageHeader title="Аккаунты hh.ru" description="Соискательские аккаунты и привязанные сессии.">
      <template #actions>
        <RefreshButton :loading="query.isLoading.value" @refresh="refresh" />
      </template>
    </PageHeader>

    <Alert v-if="actionError" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось сохранить аккаунт</AlertTitle>
      <AlertDescription>{{ actionError }}</AlertDescription>
    </Alert>

    <Alert v-if="notice" class="mb-4">
      <AlertTitle>Повтор заявок</AlertTitle>
      <AlertDescription>{{ notice }}</AlertDescription>
    </Alert>

    <Alert v-if="query.error.value" variant="destructive" class="mb-4">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить аккаунты</AlertTitle>
      <AlertDescription>{{ describeError(query.error.value) }}</AlertDescription>
    </Alert>

    <CaptchaBlockAlert
      v-for="account in blocked"
      :key="account.id"
      class="mb-4"
      :account-id="account.id"
      :account-name="account.label"
    />

    <DataTable
      :columns="columns"
      :data="accounts"
      :is-loading="query.isPending.value"
      :loading-row-count="4"
      empty-title="Аккаунтов нет"
      empty-description="Выполните otbor hh login, чтобы создать аккаунт."
    />

    <CaptchaEpisodesCard class="mt-6" />
  </section>
</template>
