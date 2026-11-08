-- Капча блокирует отправки аккаунта до слова оператора; настройки темпа и
-- параллельности живут в базе, а не в переменных окружения.
--
-- Прежняя пауза после капчи (`submit_paused_until`, 5 минут) оказалась
-- бесполезной: пока человек не решил капчу в профиле браузера, hh показывает её
-- на каждом отклике, и пауза давала новую капчу каждые 5 минут. Теперь капча
-- ставит бессрочную блокировку (`submit_blocked_at`), и снимает её только
-- оператор (`HhAccountSubmitResume`). Читающие задачи идут как обычно.
alter table hh_account add column if not exists submit_blocked_at timestamptz;
alter table hh_account add column if not exists submit_block_reason text;
-- Действующая пауза из-за капчи становится бессрочной блокировкой: капча на
-- hh ещё не решена, и без этого отправки пошли бы сразу после миграции.
update hh_account
set submit_blocked_at = now(), submit_block_reason = 'captcha'
where submit_paused_until > now() and submit_pause_reason = 'captcha';
alter table hh_account drop column if exists submit_paused_until;
alter table hh_account drop column if exists submit_pause_reason;
-- Когда оператор в последний раз снял блокировку: от этого момента считаются
-- отклики до следующей капчи.
alter table hh_account add column if not exists submit_resumed_at timestamptz;

alter table hh_account
  add constraint hh_account_submit_block_reason_check
  check (submit_block_reason is null or submit_block_reason in ('captcha'));
alter table hh_account
  add constraint hh_account_submit_block_consistent
  check ((submit_blocked_at is null) = (submit_block_reason is null));

-- Автозаявки, ждавшие конца прежней паузы, теперь ждут не срока, а снятия
-- блокировки аккаунта: срок сбрасываем, пока аккаунт заблокирован, раннер их
-- пропускает.
update application
set blocked_reason = null, retry_at = null, updated_at = now()
where state = 'preparing' and blocked_reason = 'captcha';

-- Момент, когда задачу выдали харнессу: по нему считается лимит «не больше N
-- отправок за час».
alter table harness_jobs add column if not exists leased_at timestamptz;
create index if not exists harness_jobs_submit_leased_idx
  on harness_jobs (hh_account_id, leased_at) where stage = 'submit';

-- --------------------------------------------------------------------------
-- Эпизоды капчи: после скольких откликов и за сколько минут hh её показал
-- --------------------------------------------------------------------------
-- Строка открывается, когда капча блокирует аккаунт, и закрывается
-- (`resumed_at`), когда оператор нажал «Продолжить». `submits_confirmed` -
-- подтверждённые отклики аккаунта между прошлым снятием блокировки и капчей.
create table if not exists hh_captcha_episode (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid not null references hh_account(id) on delete cascade,
  captcha_at timestamptz not null default now(),
  resumed_at timestamptz,
  submits_confirmed integer not null default 0 check (submits_confirmed >= 0),
  first_submit_at timestamptz,
  last_submit_at timestamptz
);

create index if not exists hh_captcha_episode_account_idx
  on hh_captcha_episode (hh_account_id, captcha_at desc);

-- --------------------------------------------------------------------------
-- Настройки пользователя: темп отправок, параллельность, потоки харнесса
-- --------------------------------------------------------------------------
-- Одна строка на пользователя. Нет строки - действуют значения по умолчанию
-- (из окружения облака). claim читает строку при каждой выдаче задачи, поэтому
-- перезапуск после правки не нужен.
create table if not exists user_settings (
  user_id text primary key references "user"(id) on delete cascade,
  account_browser_concurrency integer not null default 4
    check (account_browser_concurrency between 1 and 12),
  account_acting_concurrency integer not null default 1
    check (account_acting_concurrency between 1 and 12),
  submit_interval_seconds integer not null default 75
    check (submit_interval_seconds between 0 and 3600),
  submit_jitter_percent integer not null default 50
    check (submit_jitter_percent between 0 and 200),
  -- null: без часового лимита.
  submit_hourly_limit integer check (submit_hourly_limit is null or submit_hourly_limit between 1 and 1000),
  harness_slots integer not null default 6 check (harness_slots between 1 and 12),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare
  t text;
  personal text[] := array['hh_captcha_episode', 'user_settings'];
begin
  drop trigger if exists user_settings_updated_at on user_settings;
  create trigger user_settings_updated_at before update on user_settings
    for each row execute function set_updated_at();

  foreach t in array personal loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_owner', t);
    execute format(
      'create policy %I on %I using (user_id = nullif(current_setting(''app.user_id'', true), '''')) with check (user_id = nullif(current_setting(''app.user_id'', true), ''''))',
      t || '_owner', t
    );
    execute format('grant select, insert, update, delete on %I to otbor_runtime', t);
  end loop;
end
$$;
