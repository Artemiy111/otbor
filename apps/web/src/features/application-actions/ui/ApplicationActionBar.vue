<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { CircleAlert, CircleCheck, LoaderCircle, RotateCcw, Send, SkipForward } from "@lucide/vue"
import type { ApplicationRecord } from "@otbor/contract"
import { Alert, AlertDescription, AlertTitle, Button } from "@/shared/ui"
import { describeError, vacancyPath } from "@/shared/lib"
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
}>()

const emit = defineEmits<{ done: [kind: "sent" | "skipped" | "retried" | "letter-retried"] }>()

const actions = useApplicationActions()

type Confirm = "send" | "skip" | null
const confirming = ref<Confirm>(null)
const busy = ref<"send" | "skip" | "retry" | "letter" | null>(null)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

/** Другой отклик (кнопка «Следующий» меняет id): сообщения прошлого отклика не переносим. */
watch(
  () => props.application.id,
  () => {
    confirming.value = null
    error.value = null
    notice.value = null
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
  error.value = null
  notice.value = null
  try {
    await task()
    notice.value = done
    emit("done", event)
  } catch (cause) {
    error.value = explain(cause)
  } finally {
    busy.value = null
    confirming.value = null
  }
}

const explain = (cause: unknown): string => {
  const problems = (cause as { problems?: ReadonlyArray<unknown> } | null)?.problems
  if (Array.isArray(problems) && problems.length > 0) {
    return problems
      .map((problem) =>
        typeof problem === "string" ? problem : String((problem as { message?: unknown })?.message ?? JSON.stringify(problem))
      )
      .join("; ")
  }
  const tag = (cause as { _tag?: unknown } | null)?._tag
  if (tag === "limit") return "Дневной лимит откликов исчерпан: отправка станет возможна, когда он освободится."
  return describeError(cause)
}

const send = () =>
  run(
    "send",
    () =>
      actions.send({
        id: props.application.id,
        vacancyId: props.application.vacancyId,
        hhAccountId: props.application.hhAccountId,
        kitFormHash: props.kitFormHash
      }),
    "Отклик поставлен в очередь на отправку.",
    "sent"
  )
const skip = () => run("skip", () => actions.skip(props.application.id), "Отклик пропущен.", "skipped")
const retry = () =>
  run("retry", () => actions.retry(props.application.id), "Повтор запущен: форма и письмо будут проверены заново.", "retried")
const retryLetter = () =>
  run("letter", () => actions.retryLetter(props.application.id), "Письмо будет написано заново на ближайшем запуске.", "letter-retried")
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap items-center gap-2">
      <!-- Отправка: форма читается заново, поэтому нужно подтверждение -->
      <template v-if="canSend && confirming !== 'skip'">
        <Button v-if="confirming !== 'send'" :disabled="busy !== null" @click="confirming = 'send'">
          <Send class="size-4" />
          Отправить отклик
        </Button>
        <template v-else>
          <span class="text-xs text-muted-foreground">
            Форма прочитается заново, отклик уйдёт на hh.ru, отменить нельзя.
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

    <p v-if="notice" class="flex items-center gap-1.5 text-sm text-success" role="status">
      <CircleCheck class="size-4" />
      {{ notice }}
    </p>
    <Alert v-if="error" variant="destructive">
      <CircleAlert />
      <AlertTitle>Не получилось</AlertTitle>
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>
  </div>
</template>
