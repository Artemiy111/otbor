import type { CrawlRun, CrawlSchedule, Overview, ScheduleRun } from "@otbor/contract"
import { countWord, plural, type PluralForms } from "@/shared/lib/plural"
import { scheduleKindLabel } from "@/shared/lib/status"
import { formatAge } from "@/shared/lib/format"
import { inText } from "./time"

/** Как работа стадии звучит по-человечески: «читает 2 формы». */
const RUNNING_PHRASE: Record<string, { verb: string; forms: PluralForms }> = {
  form_read: { verb: "читает", forms: ["форму", "формы", "форм"] },
  letter_attach: { verb: "пишет", forms: ["письмо", "письма", "писем"] },
  prepare: { verb: "готовит", forms: ["отклик", "отклика", "откликов"] },
  submit: { verb: "отправляет", forms: ["отклик", "отклика", "откликов"] },
  reconcile: { verb: "сверяет", forms: ["отклик", "отклика", "откликов"] },
  inference: { verb: "пишет", forms: ["текст", "текста", "текстов"] },
  session: { verb: "проверяет", forms: ["вход в hh", "входа в hh", "входов в hh"] },
  chat_read: { verb: "читает", forms: ["чат", "чата", "чатов"] }
}

/** Стадии без счёта: одна фраза, сколько бы задач ни шло. */
const FIXED_PHRASE: Record<string, string> = {
  negotiations_sync: "обновляет статусы откликов",
  resume_sync: "обновляет резюме",
  resume_bump: "поднимает резюме"
}

export const runningPhrases = (running: Overview["jobs"]["running"]): ReadonlyArray<string> =>
  running
    .filter((row) => row.count > 0)
    .map((row) => {
      const fixed = FIXED_PHRASE[row.stage]
      if (fixed !== undefined) return fixed
      const phrase = RUNNING_PHRASE[row.stage]
      if (phrase === undefined) return `выполняет ${countWord(row.count, TASK_FORMS)}`
      return `${phrase.verb} ${row.count} ${plural(row.count, phrase.forms)}`
    })

const TASK_FORMS: PluralForms = ["задачу", "задачи", "задач"]

export const queueDepth = (jobs: Overview["jobs"]): number =>
  jobs.pending.reduce((sum, row) => sum + row.count, 0)

export const queueSentence = (jobs: Overview["jobs"]): string | null => {
  const depth = queueDepth(jobs)
  if (depth === 0) return null
  const words: PluralForms = ["задача ждёт", "задачи ждут", "задач ждут"]
  const wait = jobs.oldestPendingAgeSeconds
  return wait === null
    ? `В очереди ${countWord(depth, ["задача", "задачи", "задач"])}`
    : `${countWord(depth, words)}, самая старая — ${formatAge(wait)}`
}

export interface LiveCrawl {
  readonly id: string
  readonly title: string
  readonly progress: number | null
  readonly detail: string
}

const queryName = (url: string): string => {
  try {
    const text = new URL(url).searchParams.get("text")
    return text === null || text === "" ? "Поиск вакансий" : `Поиск «${text}»`
  } catch {
    return "Поиск вакансий"
  }
}

export const liveCrawls = (runs: ReadonlyArray<CrawlRun>): ReadonlyArray<LiveCrawl> =>
  runs.flatMap((run) => {
      if (run.status !== "running") return []
      const total = run.pagesTotal
      const progress = total !== null && total > 0 ? Math.min(100, Math.round((run.pagesDone / total) * 100)) : null
      const pages = total !== null && total > 0 ? `страница ${run.pagesDone} из ${total}` : `страниц: ${run.pagesDone}`
      return [
        {
          id: run.runId,
          title: queryName(run.normalizedUrl),
          progress,
          detail: `${pages}, найдено ${run.found}, новых ${run.inserted}`
        }
      ]
    })

export interface UpcomingRun {
  readonly id: string
  readonly title: string
  readonly when: string
  readonly at: number
}

const scheduleTitle = (schedule: CrawlSchedule): string => {
  const base = scheduleKindLabel(schedule.kind)
  if (schedule.kind !== "search") return base
  try {
    const text = new URL(schedule.targetId).searchParams.get("text")
    return text === null || text === "" ? base : `${base} «${text}»`
  } catch {
    return base
  }
}

/** Ближайшие запуски по расписаниям: уже идущие не показываем. */
export const upcomingRuns = (
  schedules: ReadonlyArray<CrawlSchedule>,
  running: ReadonlyArray<ScheduleRun>,
  now: number,
  limit = 4
): ReadonlyArray<UpcomingRun> => {
  const busy = new Set(running.flatMap((run) => (run.status === "running" ? [run.scheduleId as string] : [])))
  return schedules
    .flatMap((schedule): UpcomingRun[] => {
      if (!schedule.enabled || schedule.nextRunAt === null || busy.has(schedule.id)) return []
      const at = Date.parse(schedule.nextRunAt)
      if (Number.isNaN(at)) return []
      return [{ id: schedule.id as string, title: scheduleTitle(schedule), at, when: inText(schedule.nextRunAt, now) ?? "" }]
    })
    .sort((a, b) => a.at - b.at)
    .slice(0, limit)
}
