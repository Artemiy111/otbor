-- Журнал распознавания капчи: каждая попытка модели прочитать картинку hh.
--
-- Харнес снимает капчу в браузере и отдаёт её выбранной модели; он сам решает,
-- ввести ответ ли, но что было, знает облако: попытки приходят вместе с
-- выходом задачи (`HarnessComplete`) и пишутся сюда. По журналу видно, какая
-- модель решала, за сколько попыток и сколько капч прошла.
create table if not exists captcha_attempt (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid references hh_account(id) on delete set null,
  job_id uuid not null references harness_jobs(id) on delete cascade,
  stage text not null,
  -- Харнес и модель, которые читали картинку.
  harness text not null,
  model text not null,
  -- Номер попытки на этой капче, с 1.
  attempt integer not null check (attempt >= 1),
  -- Что вернула модель; null, если ответа не было.
  answer text,
  outcome text not null check (outcome in ('solved', 'rejected', 'error')),
  duration_ms integer not null check (duration_ms >= 0),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists captcha_attempt_user_idx on captcha_attempt (user_id, created_at desc);
create index if not exists captcha_attempt_job_idx on captcha_attempt (job_id);

alter table captcha_attempt enable row level security;
drop policy if exists captcha_attempt_owner on captcha_attempt;
create policy captcha_attempt_owner on captcha_attempt
  using (user_id = nullif(current_setting('app.user_id', true), ''))
  with check (user_id = nullif(current_setting('app.user_id', true), ''));
grant select, insert, update, delete on captcha_attempt to otbor_runtime;
