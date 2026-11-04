export type StatusTone = "success" | "info" | "warning" | "danger" | "neutral"

const SUCCESS = new Set([
  "ok",
  "up",
  "match",
  "apply",
  "submitted",
  "done",
  "prepared",
  "clicked",
  "active",
  "included"
])

const INFO = new Set([
  "unknown",
  "draft",
  "queued",
  "pending",
  "leased",
  "running",
  "prepare",
  "submit",
  "reconcile",
  "session",
  "inference",
  "explore"
])

const WARNING = new Set([
  "degraded",
  "submitting",
  "form_changed",
  "rate_limited",
  "already_responded",
  "not_submitted",
  "cancelled",
  "stopped"
])

const DANGER = new Set([
  "reject",
  "skip",
  "failed",
  "dead",
  "needs_human",
  "needs_reconcile",
  "down",
  "blocked",
  "session_expired",
  "captcha",
  "ambiguous",
  "permanent",
  "site_rejected",
  "answer_rejected",
  "inference_failed",
  "transport",
  "resume_mismatch",
  "error"
])

/**
 * One presentation map for every status token the contract can return. Unknown
 * values fall through as the raw token, which keeps debugging honest while the
 * interface itself stays Russian.
 */
const LABELS: Record<string, string> = {
  ok: "Работает",
  up: "Доступна",
  degraded: "Сбои",
  down: "Недоступна",
  active: "Активна",
  included: "Включено",

  match: "Подходит",
  unknown: "Неясно",
  reject: "Отклонено",

  apply: "Откликаться",
  draft: "Черновик",
  skip: "Пропуск",

  queued: "В очереди",
  submitting: "Отправляется",
  submitted: "Отправлен",
  skipped: "Пропущен",
  needs_human: "Нужен человек",
  needs_reconcile: "Нужна сверка",
  failed: "Ошибка",
  pending: "Ожидает",
  leased: "Взят в работу",
  running: "Выполняется",
  done: "Готово",
  dead: "Исчерпан",
  cancelled: "Отменён",

  prepare: "Подготовка",
  submit: "Отправка",
  reconcile: "Сверка",
  session: "Сессия",
  inference: "Генерация",
  browser: "Браузер",

  prepared: "Подготовлено",
  clicked: "Нажато",
  not_submitted: "Не отправлено",
  already_responded: "Уже откликнулись",
  blocked: "Заблокировано",
  form_changed: "Форма изменилась",
  session_expired: "Сессия истекла",
  captcha: "Капча",
  rate_limited: "Ограничение запросов",
  transport: "Сеть",
  resume_mismatch: "Резюме не совпало",
  answer_rejected: "Ответ отклонён",
  site_rejected: "Сайт отклонил",
  inference_failed: "Генерация не удалась",
  permanent: "Постоянная ошибка",
  ambiguous: "Неоднозначно",

  explore: "Поиск",

  junior: "Джун",
  middle: "Мидл",
  senior: "Сеньор",
  lead: "Лид",

  devops: "DevOps",
  sre: "SRE",
  platform: "Платформа",
  backend: "Бэкенд",
  frontend: "Фронтенд",
  mobile: "Мобильная разработка",
  qa: "QA",
  analyst: "Аналитик",
  manager: "Менеджер",
  other: "Другое",

  remote: "Удалённо",
  hybrid: "Гибрид",
  office: "Офис",
  stopped: "Остановлен",
  error: "Ошибка",
  idle: "Не подключён",
  authorized: "Авторизован",
  auth_failed: "Ошибка авторизации",

  skill_match: "Совпадение навыков",
  salary: "Зарплата",
  freshness: "Свежесть",
  fit: "Соответствие",
  role_match: "Роль подходит",
  role_unknown: "Роль неясна",
  role_rejected: "Роль отклонена",
  blocked_hidden: "Скрыто",
  blocked_applied: "Уже откликались",
  blocked_archived: "Архив",
  blocked_employer_cooldown: "Пауза работодателя",
  blocked_test: "Тест",
  blocked_salary: "Зарплата",
  blocked_work_format: "Формат работы",
  blocked_low_fit: "Низкое соответствие",
  blocked_keywords: "Ключевые слова",
  blocked_seniority: "Уровень",
  manual: "Вручную"
}

export const statusLabel = (value: string): string => LABELS[value] ?? value

/** Original token, kept next to a Russian label for debugging. */
export const statusRaw = (value: string): string => value

/** One presentation map for every status token the contract can return. */
export const statusTone = (value: string): StatusTone => {
  if (SUCCESS.has(value)) return "success"
  if (INFO.has(value)) return "info"
  if (WARNING.has(value)) return "warning"
  if (DANGER.has(value)) return "danger"
  return "neutral"
}

export const seniorityLabel = (value: string): string => LABELS[value] ?? value

export const roleFamilyLabel = (value: string | null | undefined): string =>
  value === null || value === undefined || value === "" ? "—" : (LABELS[value] ?? value)

export const decisionReasonLabel = (value: string): string => LABELS[value] ?? value

export const presetKindLabel = (value: string): string =>
  value === "apply" ? "Отклики" : value === "explore" ? "Поиск" : value

export const workFormatLabel = (value: string): string => LABELS[value] ?? value

export const jobKindLabel = (value: string): string =>
  value === "inference" ? "Генерация" : value === "browser" ? "Браузер" : value

export const jobStageLabel = (value: string): string =>
  value === "inference"
    ? "Генерация"
    : value === "prepare"
      ? "Подготовка"
      : value === "submit"
        ? "Отправка"
        : value === "reconcile"
          ? "Сверка"
          : value === "session"
            ? "Сессия"
            : value

export const applicationStateLabel = (value: string): string => statusLabel(value)

/** Contacts and conversations use their own vocabularies, not queue tokens. */
const CONTACT_KIND_LABELS: Record<string, string> = {
  email: "Email",
  telegram: "Telegram",
  phone: "Телефон",
  hh_chat: "Чат hh",
  other: "Другое"
}

export const contactKindLabel = (value: string): string =>
  CONTACT_KIND_LABELS[value] ?? value

const CONTACT_SOURCE_LABELS: Record<string, string> = {
  hh_vacancy: "Вакансия hh",
  mail: "Почта",
  telegram: "Telegram",
  hh_chat: "Чат hh",
  manual: "Вручную"
}

export const contactSourceLabel = (value: string): string =>
  CONTACT_SOURCE_LABELS[value] ?? value

const CONVERSATION_CHANNEL_LABELS: Record<string, string> = {
  mail: "Почта",
  telegram: "Telegram",
  hh_chat: "Чат hh"
}

export const conversationChannelLabel = (value: string): string =>
  CONVERSATION_CHANNEL_LABELS[value] ?? value

const SCHEDULE_KIND_LABELS: Record<string, string> = {
  search: "Поиск hh",
  source: "Источник hh",
  vacancy_hydration: "Гидратация вакансий",
  employer_hydration: "Гидратация компаний",
  mail_sync: "Синхронизация почты",
  telegram_sync: "Синхронизация Telegram",
  hh_chat_sync: "Чаты hh",
  resume_sync: "Резюме hh",
  evaluate: "Оценка вакансий"
}

export const scheduleKindLabel = (value: string): string =>
  SCHEDULE_KIND_LABELS[value] ?? value
