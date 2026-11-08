-- Состояние `preparing`: автоотклик (auto_run = 'auto') без слота, который ждёт
-- форму, письмо или кит. `queued` теперь означает только «слот занят, submit
-- поставлен в очередь». Раньше оба случая были `queued`, различались по intent_at.
alter table application drop constraint if exists application_state_check;
alter table application
  add constraint application_state_check
  check (state in (
    'draft', 'preparing', 'queued', 'submitting', 'submitted', 'skipped', 'needs_human', 'failed'
  ));

-- Типизированная причина остановки заявки (замкнутый набор кодов), момент
-- автоматического возобновления и число уже сделанных автоповторов.
-- `last_error` остаётся человекочитаемым текстом.
alter table application add column blocked_reason text;
alter table application add column retry_at timestamptz;
alter table application add column auto_retries integer not null default 0;

alter table application
  add constraint application_blocked_reason_check
  check (blocked_reason is null or blocked_reason in (
    'no_resume',          -- нет резюме для откликов
    'form_unreadable',    -- раскладка формы не распознана или пришла форма другой вакансии
    'form_gone',          -- вакансия больше не принимает отклики
    'form_read_failed',   -- форму не удалось прочитать (после повторов)
    'form_hint_blocked',  -- подсказка ответа заблокирована
    'kit_refused',        -- кит не прошёл проверку
    'writing_failed',     -- задача письма не дала результата (после повторов)
    'daily_cap',          -- дневной лимит откликов аккаунта
    'submit_not_sent',    -- submit заведомо не отправил отклик
    'reconcile_unclear',  -- сверка не смогла установить, ушёл ли отклик
    'operator'            -- прочее или ручное решение
  ));

-- Автоотклики, которые ждали форму/письмо/кит, переходят в `preparing`.
-- Причины старых needs_human размечать нечем: у них остаётся только last_error.
update application
set state = 'preparing', updated_at = now()
where auto_run = 'auto' and state = 'queued' and intent_at is null;

-- Раннер выбирает ждущие автоотклики по (state, retry_at).
create index application_preparing_retry_idx
  on application (user_id, hh_account_id, retry_at)
  where state = 'preparing';
