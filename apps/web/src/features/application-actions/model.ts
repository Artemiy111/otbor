import { useQueryCache } from "@pinia/colada"
import { applicationApi, applicationKeys, type ApplicationSetKitInput } from "@/entities/application"
import { autoApplyApi, autoApplyKeys } from "@/entities/auto-apply"
import { overviewKeys } from "@/entities/overview"

/** Что нужно знать об отклике, чтобы отправить его безопасно. */
export interface SendTarget {
  readonly id: string
  readonly vacancyId: string
  readonly hhAccountId: string
  /** Хеш формы, под которую подготовлен кит; `null`, если кита ещё нет. */
  readonly kitFormHash: string | null
}

/** Хеш кита, сохранённого без формы (вакансия без теста). */
const NO_FORM = "no-form"

/**
 * Действия над откликом из одного места: список и страница отклика зовут их
 * одинаково. После каждого действия обновляются отклики, обзор и автоотклики,
 * поэтому счётчики вкладок и главной не отстают. Ошибки не глотаются: вызывающий
 * показывает их там, где оператор смотрит.
 */
export const useApplicationActions = () => {
  const cache = useQueryCache()

  const invalidate = async (): Promise<void> => {
    await Promise.all(
      [applicationKeys.all, overviewKeys.all, autoApplyKeys.all].map((key) => cache.invalidateQueries({ key }))
    )
  }

  const retry = async (id: string) => {
    const result = await applicationApi.retry(id)
    await invalidate()
    return result
  }

  /** Повтор письма автоотклика, у которого умерла задача записи. */
  const retryLetter = async (id: string) => {
    const result = await autoApplyApi.retry({ applicationId: id })
    await invalidate()
    return result
  }

  const skip = async (id: string, reason = "skipped from the application page") => {
    const result = await applicationApi.skip(id, reason)
    await invalidate()
    return result
  }

  /**
   * Отправка отклика на hh. Форма читается заново прямо перед отправкой: работодатель
   * мог поменять вопросы. Если форма изменилась, отправки нет, ответы нужно проверить.
   */
  const send = async (target: SendTarget) => {
    const current = await applicationApi.readFormNow(target.vacancyId, target.hhAccountId)
    if (
      current !== null &&
      target.kitFormHash !== null &&
      target.kitFormHash !== NO_FORM &&
      current !== target.kitFormHash
    ) {
      throw new Error("Форма на hh изменилась: проверьте письмо и ответы на странице вакансии и отправьте ещё раз.")
    }
    const result = await applicationApi.approve(target.id)
    await invalidate()
    return result
  }

  const saveLetter = async (input: {
    readonly id: string
    readonly formHash: string
    readonly letter: string | null
    readonly answers: ApplicationSetKitInput["answers"]
  }) => {
    await applicationApi.setKit({
      applicationId: input.id,
      formHash: input.formHash,
      letter: input.letter,
      answers: input.answers
    })
    await invalidate()
  }

  return { invalidate, retry, retryLetter, skip, send, saveLetter }
}
