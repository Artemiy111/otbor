<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { LoaderCircle, RotateCcw, Send, SkipForward } from "@lucide/vue"
import type { ApplicationRecord } from "@otbor/contract"
import { Button, useToast } from "@/shared/ui"
import { describeError, kitProblems, problemText, toneClasses, vacancyPath } from "@/shared/lib"
import { useApplicationActions } from "../model"

/**
 * Панель действий над одним откликом. Кнопки зависят от состояния и совпадают с
 * тем, что разрешает сервер: отправить можно черновик, повторить - остановленный
 * или упавший, пропустить - всё, что ещё не ушло на hh.
 */
const props = defineProps<{
  application: ApplicationRecord
  /** Хеш формы, под которую подготовлен кит; нужен, чтобы заметить смену формы. */
  kitFormHash: string | null
  /** Письмо автоотклика можно написать заново (умерла задача записи). */
  letterRetryable: boolean
  /** На экране есть несохранённые правки письма и ответов. */
  unsaved?: boolean
  /** Почему отправлять пока нельзя (не заполнено письмо или вопрос); `null` - можно. */
  sendBlocker?: string | null
  /**
   * Сохраняет правки письма и ответов перед отправкой и возвращает хеш формы,
   * под который сохранено. Отказ (исключение) отменяет отправку.
   */
  saveFirst?: (() => Promise<string | null>) | null
}>()

const emit = defineEmits<{
  done: [kind: "sent" | "skipped" | "retried" | "letter-retried"]
  /** Сервер отказал в отправке из-за ответов: подробности по вопросам. */
  problems: [error: unknown]
}>()

const toast = useToast()

const actions = useApplicationActions()

type Confirm = "send" | "skip" | null
const confirming = ref<Confirm>(null)
const busy = ref<"send" | "skip" | "retry" | "letter" | null>(null)

/** Другой отклик (кнопка «Следующий» меняет id): сообщения прошлого отклика не переносим. */
watch(
  () => props.application.id,
  () => {
    confirming.value = null
  }
)

const state = computed(() => props.application.state)
const canSend = computed(() => state.value === "draft")
const canRetry = computed(() => state.value === "needs_human" || state.value === "failed")
const canRetryLetter = computed(() => state.value === "preparing" && props.letterRetryable)
/** Пропустить нельзя после отправки и пока идёт сама отправка: клик мог уже дойти до hh. */
const canSkip = computed(() => ["draft", "preparing", "queued", "needs_human", "failed"].includes(state.value))
const hasActions = computed(() => canSend.value || canRetry.value || canRetryLetter.value || canSkip.value)

const run = async (kind: NonNullable<typeof busy.value>, task: () => Promise<unknown>, done: string, event: "sent" | "skipped" | "retried" | "letter-retried") => {
  if (busy.value !== null) return
  busy.value = kind
  try {
    await task()
    toast.success(done)
    emit("done", event)
  } catch (cause) {
    emit("problems", cause)
    toast.error(failureTitle[kind], { description: explain(cause) })
  } finally {
    busy.value = null
    confirming.value = null
  }
}

const failureTitle: Record<NonNullable<typeof busy.value>, string> = {
  send: "Отклик не отправлен",
  skip: "Не удалось пропустить отклик",
  retry: "Не удалось повторить",
  letter: "Не удалось запустить письмо заново"
}

const explain = (cause: unknown): string => {
  const failed = kitProblems(cause)
  if (failed.length > 0) return [...new Set(failed.map(problemText))].join(" ")
  const tag = (cause as { _tag?: unknown } | null)?._tag
  if (tag === "limit") return "Дневной лимит откликов исчерпан: отправка станет возможна, когда он освободится."
  return describeError(cause)
}

const send = () =>
  run(
    "send",
    async () => {
      // Несохранённые правки не отправляются молча: сначала они сохраняются,
      // и только потом форма читается заново и отклик уходит.
      const savedHash = props.unsaved && props.saveFirst ? await props.saveFirst() : null
      await actions.send({
        id: props.application.id,
        vacancyId: props.application.vacancyId,
        hhAccountId: props.application.hhAccountId,
        kitFormHash: savedHash ?? props.kitFormHash
      })
    },
    "Отклик поставлен в очередь на отправку.",
    "sent"
  )
const skip = () => run("skip", () => actions.skip(props.application.id), "Отклик пропущен.", "skipped")
const retry = () =>
  run(
    "retry",
    async () => {
      // Правки, сделанные перед повтором, тоже сохраняются: повтор работает с сохранённым китом.
      if (props.unsaved && props.saveFirst) await props.saveFirst()
      await actions.retry(props.application.id)
    },
    "Повтор запущен: форма и письмо будут проверены заново.",
    "retried"
  )
const retryLetter = () =>
  run("letter", () => actions.retryLetter(props.application.id), "Письмо будет написано заново на ближайшем запуске.", "letter-retried")
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap items-center gap-2">
      <!-- Отправка: форма читается заново, поэтому нужно подтверждение -->
      <template v-if="canSend && confirming !== 'skip'">
        <Button v-if="confirming !== 'send'" :disabled="busy !== null || !!sendBlocker" @click="confirming = 'send'">
          <Send class="size-4" />
          Отправить отклик
        </Button>
        <template v-else>
          <span class="text-xs text-muted-foreground">
            <template v-if="unsaved">Правки письма и ответов сохранятся. </template>Форма прочитается заново, отклик уйдёт на hh.ru, отменить нельзя.
          </span>
          <Button variant="destructive" :disabled="busy !== null" @click="send">
            <LoaderCircle v-if="busy === 'send'" class="size-4 animate-spin" />
            Да, отправить
          </Button>
          <Button variant="ghost" :disabled="busy !== null" @click="confirming = null">Отмена</Button>
        </template>
      </template>

      <Button v-if="canRetry && confirming === null" :disabled="busy !== null" @click="retry">
        <LoaderCircle v-if="busy === 'retry'" class="size-4 animate-spin" />
        <RotateCcw v-else class="size-4" />
        Повторить
      </Button>
      <Button v-if="canRetryLetter && confirming === null" variant="outline" :disabled="busy !== null" @click="retryLetter">
        <LoaderCircle v-if="busy === 'letter'" class="size-4 animate-spin" />
        <RotateCcw v-else class="size-4" />
        Написать письмо заново
      </Button>

      <!-- Пропуск необратим: тоже через подтверждение -->
      <template v-if="canSkip && confirming !== 'send'">
        <Button v-if="confirming !== 'skip'" variant="outline" :disabled="busy !== null" @click="confirming = 'skip'">
          <SkipForward class="size-4" />
          Пропустить
        </Button>
        <template v-else>
          <span class="text-xs text-muted-foreground">Отклик не будет отправлен. Вернуть его потом нельзя.</span>
          <Button variant="destructive" :disabled="busy !== null" @click="skip">
            <LoaderCircle v-if="busy === 'skip'" class="size-4 animate-spin" />
            Да, пропустить
          </Button>
          <Button variant="ghost" :disabled="busy !== null" @click="confirming = null">Отмена</Button>
        </template>
      </template>

      <p v-if="state === 'submitting'" class="text-sm text-muted-foreground">
        Идёт отправка. Пропустить нельзя: отклик мог уже дойти до hh.
      </p>
      <p v-else-if="state === 'queued' && !canSkip" class="text-sm text-muted-foreground">Отклик ждёт своей очереди.</p>
      <Button v-if="state === 'skipped'" as-child variant="outline">
        <a :href="vacancyPath(application.vacancyId)">Открыть вакансию</a>
      </Button>

      <slot name="next" />
      <span v-if="!hasActions && !$slots.next && state !== 'skipped'" class="text-sm text-muted-foreground">
        Действий не требуется.
      </span>
    </div>

    <p v-if="canSend && sendBlocker" :class="['text-sm', toneClasses('warning').text]">
      Отправить пока нельзя: не заполнено {{ sendBlocker }}.
    </p>
  </div>
</template>
