-- Темп отправок и предохранитель от капчи, по аккаунту hh.
--
-- hh отвечает капчей на POST отклика, когда их идёт слишком много подряд.
-- `submit_next_at` - раньше этого момента claim не выдаёт действующую задачу
-- (submit, letter_attach) аккаунта; его ставит сам claim под блокировкой строки
-- `account_lease`. `submit_paused_until` - пауза после капчи: пока она не
-- вышла, действующие задачи аккаунта не выдаются (читающие идут как обычно).
-- Пауза фиксированная (`OTBOR_ACCOUNT_CAPTCHA_PAUSE_SECONDS`, 5 минут) и проходит сама.
alter table hh_account add column if not exists submit_next_at timestamptz;
alter table hh_account add column if not exists submit_paused_until timestamptz;
alter table hh_account add column if not exists submit_pause_reason text;

alter table hh_account
  add constraint hh_account_submit_pause_reason_check
  check (submit_pause_reason is null or submit_pause_reason in ('captcha'));

-- Новая причина остановки заявки: автоотклик ждёт конца паузы после капчи.
alter table application drop constraint if exists application_blocked_reason_check;
alter table application
  add constraint application_blocked_reason_check
  check (blocked_reason is null or blocked_reason in (
    'no_resume',
    'form_unreadable',
    'form_gone',
    'form_read_failed',
    'form_hint_blocked',
    'kit_refused',
    'writing_failed',
    'daily_cap',
    'captcha',            -- hh попросил капчу; отправки аккаунта на паузе до retry_at
    'submit_not_sent',
    'reconcile_unclear',
    'operator'
  ));
