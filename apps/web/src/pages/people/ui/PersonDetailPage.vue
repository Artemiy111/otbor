<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { refDebounced } from "@vueuse/core"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import type { ContactRecord, PersonRecord } from "@otbor/contract"
import { CircleAlert } from "@lucide/vue"
import { EmployerName, VacancyTitle, contactLinkText, personApi, personKeys } from "@/entities/person"
import { resumeApi, resumeKeys } from "@/entities/resume"
import { conversationKeys } from "@/entities/conversation"
import { contactKeys } from "@/entities/contact"
import {
  contactHref,
  contactKindLabel,
  contactSourceLabel,
  conversationChannelLabel,
  describeError,
  formatDate,
  personPath
} from "@/shared/lib"
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
  Input,
  Label,
  Skeleton,
  Textarea
} from "@/shared/ui"
import { PageHeader } from "@/widgets/page-header"
import ConfirmAction from "./ConfirmAction.vue"

const props = defineProps<{ id: string }>()
const queryCache = useQueryCache()

const query = useQuery({
  key: () => personKeys.detail(props.id),
  query: () => personApi.get(props.id)
})
const resumesQuery = useQuery({ key: () => resumeKeys.list(), query: () => resumeApi.list() })

const person = computed<PersonRecord | undefined>(() => query.data.value)
const errorText = computed(() =>
  query.error.value === null ? null : describeError(query.error.value)
)
const resumeTitle = (id: string): string =>
  resumesQuery.data.value?.find((resume) => resume.id === id)?.title ?? "Резюме"

/* ----------------------------- редактирование ----------------------------- */

const name = ref("")
const role = ref("")
const notes = ref("")
watch(
  person,
  (value) => {
    if (!value) return
    name.value = value.displayName ?? ""
    role.value = value.role ?? ""
    notes.value = value.notes ?? ""
  },
  { immediate: true }
)

const notice = ref<string | null>(null)
const noticeLink = ref<string | null>(null)
const actionError = ref<string | null>(null)
const busy = ref(false)

/** Одно место для всех действий: сбрасывает сообщения, ловит ошибки и обновляет кэш. */
const run = async (action: () => Promise<void>) => {
  actionError.value = null
  notice.value = null
  noticeLink.value = null
  busy.value = true
  try {
    await action()
    await queryCache.invalidateQueries({ key: personKeys.all })
    await queryCache.invalidateQueries({ key: contactKeys.all })
    await queryCache.invalidateQueries({ key: conversationKeys.all })
  } catch (error) {
    actionError.value = describeError(error)
  } finally {
    busy.value = false
  }
}

const emptyToNull = (value: string): string | null => (value.trim() === "" ? null : value.trim())

const updateMutation = useMutation<PersonRecord, Parameters<typeof personApi.update>[1]>({
  mutation: (input) => personApi.update(props.id, input)
})
const save = () =>
  run(async () => {
    await updateMutation.mutateAsync({
      name: emptyToNull(name.value),
      role: emptyToNull(role.value),
      notes: emptyToNull(notes.value)
    })
    notice.value = "Сохранено."
  })

/* ------------------------------ идентичности ------------------------------ */

const confirmMutation = useMutation<ContactRecord, string>({
  mutation: (id) => personApi.confirm(id)
})
const rejectMutation = useMutation<ContactRecord, string>({
  mutation: (id) => personApi.reject(id)
})
const splitMutation = useMutation<PersonRecord, string>({
  mutation: (id) => personApi.split(id)
})

const confirm = (contact: ContactRecord) =>
  run(async () => {
    await confirmMutation.mutateAsync(contact.id)
    notice.value = "Связь подтверждена."
  })
const reject = (contact: ContactRecord) =>
  run(async () => {
    await rejectMutation.mutateAsync(contact.id)
    notice.value = "Связь отклонена: контакт больше не привязан к человеку."
  })
const split = (contact: ContactRecord) =>
  run(async () => {
    const created = await splitMutation.mutateAsync(contact.id)
    notice.value = "Контакт вынесен в нового человека."
    noticeLink.value = personPath(created.id)
  })

const inboxHref = (conversationId: string): string => `/contacts?c=${encodeURIComponent(conversationId)}`
const isHttp = (href: string | null): boolean => href !== null && /^https?:\/\//i.test(href)

/* -------------------------------- слияние -------------------------------- */

const mergeSearch = ref("")
const debouncedMergeSearch = refDebounced(mergeSearch, 300)
const candidatesQuery = useQuery({
  key: () => personKeys.list(`merge:${debouncedMergeSearch.value.trim()}`),
  query: () => personApi.list({ query: debouncedMergeSearch.value.trim(), limit: 8 }),
  enabled: () => debouncedMergeSearch.value.trim().length >= 2
})
const candidates = computed(() =>
  (candidatesQuery.data.value?.items ?? []).filter((item) => item.id !== props.id)
)
const mergeMutation = useMutation<PersonRecord, string>({
  mutation: (into) => personApi.merge(into, props.id)
})
const merge = (into: string) =>
  run(async () => {
    await mergeMutation.mutateAsync(into)
    mergeSearch.value = ""
    notice.value = "Человек объединён. Контакты и диалоги перенесены."
    noticeLink.value = personPath(into)
  })
</script>

<template>
  <section>
    <div v-if="query.isPending.value" class="space-y-3">
      <Skeleton class="h-8 w-1/3" />
      <Skeleton class="h-40 w-full" />
    </div>

    <Alert v-else-if="errorText" variant="destructive">
      <CircleAlert />
      <AlertTitle>Не удалось загрузить человека</AlertTitle>
      <AlertDescription>{{ errorText }}</AlertDescription>
    </Alert>

    <template v-else-if="person">
      <PageHeader
        :title="person.displayName ?? 'Без имени'"
        :description="person.role ?? undefined"
        back-to="/people"
        back-label="Люди"
      />

      <Alert v-if="actionError" variant="destructive" class="mb-4">
        <CircleAlert />
        <AlertTitle>Не удалось выполнить действие</AlertTitle>
        <AlertDescription>{{ actionError }}</AlertDescription>
      </Alert>
      <Alert v-if="notice" variant="info" class="mb-4">
        <CircleAlert />
        <AlertTitle>Готово</AlertTitle>
        <AlertDescription>
          {{ notice }}
          <a v-if="noticeLink" :href="noticeLink" class="underline underline-offset-4">Открыть</a>
        </AlertDescription>
      </Alert>

      <div class="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Данные</CardTitle></CardHeader>
          <CardContent class="space-y-3">
            <div class="space-y-1.5">
              <Label for="person-name" class="text-xs text-muted-foreground">Имя</Label>
              <Input id="person-name" v-model="name" />
            </div>
            <div class="space-y-1.5">
              <Label for="person-role" class="text-xs text-muted-foreground">Роль</Label>
              <Input id="person-role" v-model="role" placeholder="Рекрутер, hiring manager…" />
            </div>
            <div class="space-y-1.5">
              <Label for="person-notes" class="text-xs text-muted-foreground">Заметки</Label>
              <Textarea id="person-notes" v-model="notes" rows="4" />
            </div>
            <div class="flex items-center gap-3">
              <Button :disabled="busy" @click="save">Сохранить</Button>
              <span class="text-xs text-muted-foreground">
                Правки оператора синхронизация больше не перезаписывает.
              </span>
            </div>
            <div class="text-xs text-muted-foreground">
              Компания: <EmployerName :id="person.employerId" /> · последний контакт:
              {{ formatDate(person.lastSeenAt) }}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Это тот же человек?</CardTitle></CardHeader>
          <CardContent class="space-y-3">
            <p class="text-sm text-muted-foreground">
              Найдите дубликат: контакты и диалоги этого человека перейдут к выбранному.
            </p>
            <Input v-model="mergeSearch" type="search" placeholder="Найти человека по имени или контакту…" />
            <ul v-if="candidates.length > 0" class="divide-y divide-border rounded-md border border-border">
              <li
                v-for="item in candidates"
                :key="item.id"
                class="flex items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <span class="min-w-0 truncate">
                  {{ item.displayName ?? "Без имени" }}
                  <span v-if="item.role" class="text-muted-foreground">· {{ item.role }}</span>
                </span>
                <ConfirmAction
                  label="Объединить в него"
                  confirm-label="Да, объединить"
                  :hint="`Объединить — оба человека станут одним (останется «${item.displayName ?? 'Без имени'}»); отменить можно разделением: «Вынести в нового» у нужного контакта.`"
                  destructive
                  :busy="busy"
                  @confirm="merge(item.id)"
                />
              </li>
            </ul>
            <p
              v-else-if="debouncedMergeSearch.trim().length >= 2 && !candidatesQuery.isPending.value"
              class="text-xs text-muted-foreground"
            >
              Никого не нашли.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card class="mt-4">
        <CardHeader><CardTitle>Контакты ({{ person.contacts.length }})</CardTitle></CardHeader>
        <CardContent>
          <EmptyState v-if="person.contacts.length === 0" title="Контактов нет" />
          <ul v-else class="divide-y divide-border">
            <li
              v-for="contact in person.contacts"
              :key="contact.id"
              class="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary">{{ contactKindLabel(contact.kind) }}</Badge>
                  <a
                    v-if="contactHref(contact)"
                    :href="contactHref(contact) ?? undefined"
                    :target="isHttp(contactHref(contact)) ? '_blank' : undefined"
                    rel="noreferrer"
                    class="break-all text-info underline-offset-4 hover:underline"
                  >{{ contact.value }}</a>
                  <span v-else class="break-all">{{ contact.value }}</span>
                  <Badge v-if="contact.isBot" variant="neutral">бот</Badge>
                </div>
                <div class="mt-0.5 text-xs text-muted-foreground">
                  {{ contactSourceLabel(contact.source) }} ·
                  <span :class="contact.personLink === 'suggested' ? 'text-warning' : ''">{{ contactLinkText(contact.personLink, contact.confidence) }}</span>
                </div>
              </div>
              <div class="flex flex-wrap items-center gap-1.5">
                <template v-if="contact.personLink === 'suggested'">
                  <Button size="sm" :disabled="busy" @click="confirm(contact)">Это он</Button>
                  <ConfirmAction
                    label="Это не он"
                    confirm-label="Да, не он"
                    hint="Контакт останется в списке контактов, но перестанет принадлежать этому человеку. Вернуть связь можно только объединением людей."
                    destructive
                    :busy="busy"
                    @confirm="reject(contact)"
                  />
                </template>
                <ConfirmAction
                  v-if="person.contacts.length > 1"
                  label="Вынести в нового"
                  confirm-label="Да, вынести"
                  hint="Контакт и его диалоги уйдут к новому человеку; вернуть их можно объединением."
                  variant="ghost"
                  :busy="busy"
                  @confirm="split(contact)"
                />
              </div>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card class="mt-4">
        <CardHeader><CardTitle>Диалоги ({{ person.conversations.length }})</CardTitle></CardHeader>
        <CardContent>
          <EmptyState v-if="person.conversations.length === 0" title="Диалогов нет" />
          <ul v-else class="divide-y divide-border">
            <li v-for="conversation in person.conversations" :key="conversation.id" class="space-y-1 py-2">
              <div class="flex flex-wrap items-center gap-2 text-sm">
                <Badge :variant="conversation.channel === 'telegram' ? 'info' : 'secondary'">
                  {{ conversationChannelLabel(conversation.channel) }}
                </Badge>
                <a
                  :href="inboxHref(conversation.id)"
                  class="font-medium underline-offset-4 hover:underline"
                >{{ conversation.title ?? conversation.externalId }}</a>
                <a
                  v-if="conversation.url"
                  :href="conversation.url"
                  target="_blank"
                  rel="noreferrer"
                  class="text-xs text-info underline-offset-4 hover:underline"
                >в источнике</a>
                <span class="text-xs tabular-nums text-muted-foreground">{{ formatDate(conversation.lastMessageAt) }}</span>
                <Badge v-if="conversation.unreadCount > 0" variant="warning">{{ conversation.unreadCount }}</Badge>
              </div>
              <p v-if="conversation.lastMessage" class="truncate text-sm text-muted-foreground">
                {{ conversation.lastMessage }}
              </p>
              <div v-if="conversation.vacancyId" class="text-xs">
                Вакансия: <VacancyTitle :id="conversation.vacancyId" />
              </div>
            </li>
          </ul>
        </CardContent>
      </Card>

      <div class="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Вакансии ({{ person.vacancyIds.length }})</CardTitle></CardHeader>
          <CardContent>
            <EmptyState v-if="person.vacancyIds.length === 0" title="Вакансий нет" />
            <ul v-else class="space-y-1">
              <li v-for="vacancyId in person.vacancyIds" :key="vacancyId">
                <VacancyTitle :id="vacancyId" />
              </li>
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Резюме ({{ person.resumeIds.length }})</CardTitle></CardHeader>
          <CardContent>
            <EmptyState v-if="person.resumeIds.length === 0" title="Резюме нет" />
            <ul v-else class="space-y-1 text-sm">
              <li v-for="resumeId in person.resumeIds" :key="resumeId">{{ resumeTitle(resumeId) }}</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </template>
  </section>
</template>
