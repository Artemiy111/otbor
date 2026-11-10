import {
  BLOCKED_REASON_LABELS,
  type BlockedReason,
  type JobStage,
  type Overview,
  type OverviewEvent,
  type OverviewEventKind
} from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Executor, RepoEffect } from "../db/Database.ts"
import * as ConversationRepository from "./ConversationRepository.ts"

type Row = Record<string, unknown>

const DAY_MS = 24 * 60 * 60 * 1000

const iso = (value: unknown): string | null =>
  value === null || value === undefined ? null : new Date(value as string | Date).toISOString()

const int = (value: unknown): number => Number(value ?? 0)

const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))

/** Начало окна: полночь UTC первых из `days` суток, считая сегодняшние. */
export const windowStart = (now: Date, days: number): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * DAY_MS)

/**
 * Момент отклика по правилу дневного лимита (`dailyLimit.recentSubmits`):
 * у otbor слот тратится при захвате, у импортированных берётся время hh.
 * Только состояния, которые занимают слот.
 */
const SLOT_AT = sql`
  case when origin = 'otbor' and state in ('queued', 'submitting', 'submitted')
         then coalesce(intent_at, submitted_at)
       when origin <> 'otbor' and state = 'submitted'
         then coalesce(hh_responded_at, submitted_at) end`

/** Момент, когда отклик отправлен (state submitted, любой origin): правило слота без queued/submitting. */
const SENT_AT = sql`
  case when state <> 'submitted' then null
       when origin = 'otbor' then coalesce(submitted_at, intent_at)
       else coalesce(hh_responded_at, submitted_at) end`

const STATES = ["draft", "preparing", "queued", "submitting", "submitted", "skipped", "needs_human", "failed"] as const

const ATTENTION_STATES = ["needs_human", "failed"] as const

const STUCK_STATUSES = ["needs_human", "needs_reconcile", "dead", "failed"] as const

/**
 * Снимок для главной страницы одним проходом: десяток запросов под RLS
 * пользователя, без запросов в цикле. Общий корпус (`vacancy`) читается без
 * пользовательского фильтра, всё остальное фильтруется по `user_id` явно
 * (RLS - вторая линия защиты).
 */
export const snapshot = (
  tx: Executor,
  userId: string,
  input: { readonly days: number; readonly fallbackDailyLimit: number; readonly now: Date }
): RepoEffect<Overview> =>
  Effect.gen(function*() {
    const { days, now } = input
    const start = windowStart(now, days).toISOString()
    const prevStart = new Date(windowStart(now, days).getTime() - days * DAY_MS).toISOString()

    // 1. Заявки по состоянию и причине: byState, needsAttention, waiting, draftsToReview.
    const states = (yield* tx.execute(sql`
      select state, blocked_reason,
             count(*)::int as n,
             count(*) filter (where origin = 'otbor')::int as n_otbor,
             min(updated_at) as oldest,
             min(retry_at) as next_retry
      from application
      where user_id = ${userId}
      group by state, blocked_reason
    `)).rows as ReadonlyArray<Row>

    // 2. Отправки и воронка заявок за окно и 24 часа.
    const sent = ((yield* tx.execute(sql`
      select
        count(*) filter (where r.slot_at > now() - interval '24 hours')::int as sent_today,
        count(*) filter (where r.sent_at >= ${start}::timestamptz)::int as sent_window,
        count(*) filter (where r.sent_at >= ${prevStart}::timestamptz and r.sent_at < ${start}::timestamptz)::int as sent_prev,
        count(*) filter (where r.sent_at >= ${start}::timestamptz
          and r.hh_status in ('VIEWED', 'INTERVIEW', 'OFFER', 'DISCARD', 'DISCARD_AFTER_INTERVIEW'))::int as viewed,
        count(*) filter (where r.sent_at >= ${start}::timestamptz
          and r.hh_status in ('INTERVIEW', 'OFFER'))::int as invited,
        count(*) filter (where r.sent_at >= ${start}::timestamptz
          and r.hh_status in ('DISCARD', 'DISCARD_AFTER_INTERVIEW'))::int as rejected,
        count(*) filter (where r.origin = 'otbor' and r.created_at >= ${start}::timestamptz)::int as created
      from (
        select origin, hh_status, created_at, ${SLOT_AT} as slot_at, ${SENT_AT} as sent_at
        from application
        where user_id = ${userId}
          and (created_at >= ${start}::timestamptz
            or state in ('queued', 'submitting', 'submitted'))
      ) r
    `)).rows[0] ?? {}) as Row

    // 3. Хронология по суткам окна (UTC), нули тоже.
    const timeline = (yield* tx.execute(sql`
      with days as (
        select generate_series(${start}::timestamptz, ${start}::timestamptz + make_interval(days => ${days - 1}), interval '1 day') as d
      ),
      found as (
        select date_trunc('day', first_seen_at at time zone 'utc') as d, count(*)::int as n
        from vacancy where first_seen_at >= ${start}::timestamptz group by 1
      ),
      sent as (
        select date_trunc('day', r.at at time zone 'utc') as d, count(*)::int as n
        from (select ${SENT_AT} as at from application where user_id = ${userId}) r
        where r.at >= ${start}::timestamptz group by 1
      ),
      invited as (
        select date_trunc('day', hh_responded_at at time zone 'utc') as d, count(*)::int as n
        from application
        where user_id = ${userId} and hh_status in ('INTERVIEW', 'OFFER')
          and hh_responded_at >= ${start}::timestamptz
        group by 1
      )
      select to_char(days.d at time zone 'utc', 'YYYY-MM-DD') as day,
             coalesce(found.n, 0) as found, coalesce(sent.n, 0) as sent, coalesce(invited.n, 0) as invited
      from days
      left join found on found.d = days.d at time zone 'utc'
      left join sent on sent.d = days.d at time zone 'utc'
      left join invited on invited.d = days.d at time zone 'utc'
      order by days.d
    `)).rows as ReadonlyArray<Row>

    // 4. Решения за окно: самое свежее по паре вакансия + аккаунт + резюме.
    const decisions = ((yield* tx.execute(sql`
      select count(*) filter (where d.verdict in ('apply', 'draft'))::int as apply,
             count(*) filter (where d.verdict = 'skip')::int as skip
      from decision d
      where d.user_id = ${userId} and d.created_at >= ${start}::timestamptz
        and not exists (
          select 1 from decision n
          where n.user_id = d.user_id and n.vacancy_id = d.vacancy_id
            and n.hh_account_id is not distinct from d.hh_account_id
            and n.resume_id is not distinct from d.resume_id
            and (n.created_at, n.id) > (d.created_at, d.id)
        )
    `)).rows[0] ?? {}) as Row

    const skipReasons = (yield* tx.execute(sql`
      select d.reasons -> 0 ->> 'code' as code, count(*)::int as n
      from decision d
      where d.user_id = ${userId} and d.verdict = 'skip' and d.created_at >= ${start}::timestamptz
        and not exists (
          select 1 from decision n
          where n.user_id = d.user_id and n.vacancy_id = d.vacancy_id
            and n.hh_account_id is not distinct from d.hh_account_id
            and n.resume_id is not distinct from d.resume_id
            and (n.created_at, n.id) > (d.created_at, d.id)
        )
        and d.reasons -> 0 ->> 'code' is not null
      group by 1
      order by n desc, code
      limit 6
    `)).rows as ReadonlyArray<Row>

    // 5. Аккаунты: сессия, пауза, капчи, расход лимита, очередь заявок.
    const accounts = (yield* tx.execute(sql`
      select a.id,
             coalesce(
               nullif(trim(concat_ws(' ', a.first_name, a.last_name)), ''),
               nullif(a.label, ''),
               a.id::text
             ) as name,
             a.color, a.is_default,
             s.state as session_state, s.last_error as session_error,
             a.submit_blocked_at, a.submit_block_reason, a.submit_retry_at,
             (select f.daily_limit from apply_filter f
               where f.hh_account_id = a.id and f.resume_id is null limit 1) as daily_limit,
             (select count(*)::int from hh_captcha_episode e
               where e.hh_account_id = a.id and e.captcha_at > now() - interval '24 hours') as captchas_24h,
             u.used, u.last_sent_at, u.active, u.attention
      from hh_account a
      left join hh_account_session s on s.hh_account_id = a.id
      left join lateral (
        select count(*) filter (where r.slot_at > now() - interval '24 hours')::int as used,
               max(r.sent_at) as last_sent_at,
               count(*) filter (where r.state in ('preparing', 'queued', 'submitting'))::int as active,
               count(*) filter (where r.state in ('needs_human', 'failed'))::int as attention
        from (
          select state, ${SLOT_AT} as slot_at, ${SENT_AT} as sent_at
          from application p
          where p.hh_account_id = a.id and p.user_id = ${userId}
        ) r
      ) u on true
      where a.user_id = ${userId}
      order by a.is_default desc, name
    `)).rows as ReadonlyArray<Row>

    const autoModes = (yield* tx.execute(sql`
      select f.hh_account_id, f.resume_id, r.title as resume_title, f.auto_mode
      from apply_filter f
      left join resume r on r.id = f.resume_id
      where f.user_id = ${userId}
      order by (f.resume_id is not null), r.title
    `)).rows as ReadonlyArray<Row>

    // 6. Очередь задач.
    const jobs = (yield* tx.execute(sql`
      select status, stage, count(*)::int as n, min(updated_at) as oldest_updated,
             extract(epoch from now() - min(run_at))::int as age
      from harness_jobs
      where user_id = ${userId}
        and ((status in ('leased', 'running', 'needs_human', 'needs_reconcile'))
          or (status = 'pending' and run_at <= now())
          or (status in ('dead', 'failed') and updated_at > now() - interval '24 hours'))
      group by status, stage
      order by stage
    `)).rows as ReadonlyArray<Row>

    // 7. Входящие.
    const inbox = ((yield* tx.execute(sql`
      select (select count(*)::int from conversation c
               where c.user_id = ${userId} and not c.archived and ${ConversationRepository.unreadExpr} > 0) as unread,
             (select max(sent_at) from conversation_message
               where user_id = ${userId} and direction = 'in') as last_inbound
    `)).rows[0] ?? {}) as Row

    // 8. Лента событий: UNION ALL из заявок, запусков расписаний и капч.
    const events = (yield* tx.execute(sql`
      (select a.submitted_at as at, 'sent' as kind, v.title as title, e.name as subtitle,
              null::text as detail, a.vacancy_id, a.id as application_id, a.hh_account_id
       from application a
       join vacancy v on v.id = a.vacancy_id
       left join employer e on e.id = v.employer_id
       where a.user_id = ${userId} and a.origin = 'otbor' and a.state = 'submitted'
         and a.submitted_at is not null
       order by a.submitted_at desc limit 30)
      union all
      (select a.hh_responded_at,
              case when a.hh_status in ('INTERVIEW', 'OFFER') then 'invited'
                   when a.hh_status in ('DISCARD', 'DISCARD_AFTER_INTERVIEW') then 'rejected'
                   else 'viewed' end,
              v.title, e.name, null::text, a.vacancy_id, a.id, a.hh_account_id
       from application a
       join vacancy v on v.id = a.vacancy_id
       left join employer e on e.id = v.employer_id
       where a.user_id = ${userId} and a.hh_responded_at is not null
         and a.hh_status in ('VIEWED', 'INTERVIEW', 'OFFER', 'DISCARD', 'DISCARD_AFTER_INTERVIEW')
       order by a.hh_responded_at desc limit 30)
      union all
      (select a.updated_at, a.state, v.title, a.blocked_reason, left(a.last_error, 200),
              a.vacancy_id, a.id, a.hh_account_id
       from application a
       join vacancy v on v.id = a.vacancy_id
       where a.user_id = ${userId} and a.state in ('needs_human', 'failed')
       order by a.updated_at desc limit 30)
      union all
      (select r.finished_at,
              case when r.status = 'error' then
                     case when s.kind in ('search', 'source') then 'crawl_error' else 'schedule_error' end
                   else 'crawl_done' end,
              case when s.kind in ('search', 'source')
                   then coalesce((select q.title from search_query q where q.url = s.target_id limit 1), s.target_id)
                   else s.kind end,
              case when r.status = 'error' then left(r.error, 200)
                   when r.detail ->> 'inserted' is not null then '+' || (r.detail ->> 'inserted') || ' новых'
                   end,
              null::text, null::uuid, null::uuid, null::uuid
       from schedule_run r
       join schedule s on s.id = r.schedule_id
       where s.user_id = ${userId} and r.finished_at is not null
         and ((r.status = 'done' and s.kind in ('search', 'source'))
           or r.status = 'error')
       order by r.finished_at desc limit 30)
      union all
      (select c.captcha_at, 'captcha',
              coalesce(nullif(trim(concat_ws(' ', a.first_name, a.last_name)), ''), nullif(a.label, ''), a.id::text),
              case when c.submits_confirmed > 0 then 'после ' || c.submits_confirmed || ' откликов' end,
              null::text, null::uuid, null::uuid, c.hh_account_id
       from hh_captcha_episode c
       join hh_account a on a.id = c.hh_account_id
       where c.user_id = ${userId}
       order by c.captcha_at desc limit 30)
      order by at desc
      limit 30
    `)).rows as ReadonlyArray<Row>

    // ---- Сборка ----
    const byState = Object.fromEntries(STATES.map((state) => [state, 0])) as Record<(typeof STATES)[number], number>
    for (const row of states) byState[String(row.state) as (typeof STATES)[number]] += int(row.n)

    const reason = (row: Row): BlockedReason | null => (row.blocked_reason === null ? null : (row.blocked_reason as BlockedReason))

    const needsAttention = states
      .filter((row) => (ATTENTION_STATES as ReadonlyArray<string>).includes(String(row.state)))
      .map((row) => ({
        state: String(row.state) as "needs_human" | "failed",
        reason: reason(row),
        count: int(row.n),
        oldestAt: iso(row.oldest)
      }))
      .sort((a, b) => b.count - a.count)

    const waiting = states
      .filter((row) => row.state === "preparing")
      .map((row) => ({ reason: reason(row), count: int(row.n), nextRetryAt: iso(row.next_retry) }))
      .sort((a, b) => b.count - a.count)

    const modesFor = (accountId: string) =>
      autoModes
        .filter((row) => String(row.hh_account_id) === accountId)
        .map((row) => ({
          resumeId: str(row.resume_id) as never,
          resumeTitle: str(row.resume_title),
          autoMode: String(row.auto_mode) as "off" | "drafts" | "auto"
        }))

    const stageOf = (row: Row) => String(row.stage) as JobStage
    const pendingRows = jobs.filter((row) => row.status === "pending")

    return {
      generatedAt: now.toISOString(),
      days,
      applications: {
        byState,
        needsAttention,
        draftsToReview: states.filter((row) => row.state === "draft").reduce((total, row) => total + int(row.n_otbor), 0),
        waiting,
        sentToday: int(sent.sent_today),
        sentInWindow: int(sent.sent_window),
        sentPrevWindow: int(sent.sent_prev)
      },
      funnel: {
        vacanciesFound: timeline.reduce((total, row) => total + int(row.found), 0),
        decisionsApply: int(decisions.apply),
        decisionsSkip: int(decisions.skip),
        applicationsCreated: int(sent.created),
        sent: int(sent.sent_window),
        viewed: int(sent.viewed),
        invited: int(sent.invited),
        rejected: int(sent.rejected)
      },
      skipReasons: skipReasons.map((row) => ({ code: String(row.code), count: int(row.n) })),
      timeline: timeline.map((row) => ({
        day: String(row.day),
        found: int(row.found),
        sent: int(row.sent),
        invited: int(row.invited)
      })),
      accounts: accounts.map((row) => {
        const id = String(row.id)
        const limit = row.daily_limit === null || row.daily_limit === undefined
          ? input.fallbackDailyLimit
          : int(row.daily_limit)
        const used = int(row.used)
        return {
          id: id as never,
          name: String(row.name),
          color: str(row.color),
          isDefault: row.is_default === true,
          session: row.session_state === null || row.session_state === undefined
            ? null
            : (String(row.session_state) as "ok" | "expired" | "blocked"),
          sessionError: str(row.session_error),
          autoModes: modesFor(id),
          usage: { used, limit, remaining: Math.max(0, limit - used) },
          submitBlockedAt: iso(row.submit_blocked_at),
          submitBlockReason: str(row.submit_block_reason),
          submitRetryAt: iso(row.submit_retry_at),
          captchas24h: int(row.captchas_24h),
          lastSentAt: iso(row.last_sent_at),
          active: int(row.active),
          needsAttention: int(row.attention)
        }
      }),
      jobs: {
        stuck: jobs
          .filter((row) => (STUCK_STATUSES as ReadonlyArray<string>).includes(String(row.status)))
          .map((row) => ({
            status: String(row.status) as (typeof STUCK_STATUSES)[number],
            stage: stageOf(row),
            count: int(row.n),
            oldestAt: iso(row.oldest_updated)
          })),
        running: stageTotals(jobs.filter((row) => row.status === "leased" || row.status === "running")),
        pending: stageTotals(pendingRows),
        oldestPendingAgeSeconds: pendingRows.length === 0
          ? null
          : Math.max(...pendingRows.map((row) => int(row.age)))
      },
      inbox: { unreadConversations: int(inbox.unread), lastInboundAt: iso(inbox.last_inbound) },
      events: events.map((row): OverviewEvent => {
        const kind = String(row.kind) as OverviewEventKind
        const attention = kind === "needs_human" || kind === "failed"
        const code = row.subtitle as BlockedReason | null
        return {
          at: iso(row.at)!,
          kind,
          title: String(row.title),
          // У остановленной заявки: текст ошибки, иначе смысл кода причины.
          subtitle: attention
            ? str(row.detail) ?? (code === null ? null : BLOCKED_REASON_LABELS[code] ?? String(code))
            : str(row.subtitle),
          vacancyId: str(row.vacancy_id) as never,
          applicationId: str(row.application_id) as never,
          hhAccountId: str(row.hh_account_id) as never
        }
      })
    }
  })

/** Сумма по стадиям: leased и running сливаются в одну запись стадии. */
const stageTotals = (rows: ReadonlyArray<Row>) => {
  const totals = new Map<string, number>()
  for (const row of rows) totals.set(String(row.stage), (totals.get(String(row.stage)) ?? 0) + int(row.n))
  return [...totals].map(([stage, count]) => ({ stage: stage as JobStage, count }))
}
