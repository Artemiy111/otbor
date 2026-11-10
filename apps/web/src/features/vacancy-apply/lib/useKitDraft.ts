import { computed, reactive, ref, watch } from "vue"
import type { FormQuestion, KitAnswer, KitRecord, StoredHint } from "@otbor/contract"
import { answersFromKit, buildKitAnswers, isKitDirty, kitSignature, type AnswerMap, type AnswerState } from "./answers"

export interface KitDraftSource {
  /** Отклик, чей кит редактируется: при смене экран начинается заново. */
  readonly applicationId: () => string
  readonly questions: () => ReadonlyArray<FormQuestion>
  readonly hints: () => ReadonlyArray<StoredHint>
  readonly kit: () => KitRecord | null
}

/**
 * Письмо и ответы отклика, которые правит человек. Экран заполняется из
 * сохранённого кита; пока человек правит, обновление кита с сервера его
 * правки не затирает, а после сохранения экран совпадает с китом, и
 * признак «есть несохранённое» гаснет.
 */
export const useKitDraft = (source: KitDraftSource) => {
  const letter = ref("")
  const answers = reactive<AnswerMap>({})

  const hasQuestions = computed(() => source.questions().length > 0)

  const dirty = computed(() => {
    const kit = source.kit()
    if (kit === null) return false
    return isKitDirty({
      questions: source.questions(),
      answers,
      hints: source.hints(),
      saved: kit.answers,
      letter: letter.value,
      savedLetter: kit.letter
    })
  })

  /** Что сейчас на экране, в сравнимом виде. */
  const screen = () =>
    kitSignature(
      letter.value,
      buildKitAnswers({ questions: source.questions(), answers, hints: source.hints(), saved: source.kit()?.answers })
    )
  /** Как выглядел экран сразу после заполнения из кита: пока он такой, правок человека нет. */
  let baseline = ""

  const hydrate = () => {
    const kit = source.kit()
    letter.value = kit?.letter ?? ""
    for (const name of Object.keys(answers)) delete answers[name]
    // Подсказки не подставляются: это правка, а не черновик, и «изменено» должно значить правку.
    Object.assign(answers, answersFromKit(source.questions(), kit?.answers, source.hints(), false))
    baseline = screen()
  }

  let hydratedFor = ""
  watch(
    () => [source.applicationId(), source.kit()?.id ?? "", source.kit()?.createdAt ?? "", source.questions().length],
    () => {
      const id = source.applicationId()
      if (id !== hydratedFor || screen() === baseline) hydrate()
      else if (!dirty.value) baseline = screen()
      hydratedFor = id
    },
    { immediate: true }
  )

  const change = (questionId: string, value: AnswerState) => {
    answers[questionId] = value
  }

  /** Ответы для сохранения: если формы нет, сохранённые остаются нетронутыми. */
  const answersToSave = (): ReadonlyArray<KitAnswer> =>
    hasQuestions.value
      ? buildKitAnswers({
          questions: source.questions(),
          answers,
          hints: source.hints(),
          saved: source.kit()?.answers
        })
      : (source.kit()?.answers ?? [])

  return { letter, answers, dirty, change, hydrate, answersToSave }
}
