-- Подъём резюме в поиске (`resume_bump`): задача браузера и вид расписания.
--
-- hh разрешает поднимать резюме раз в 4 часа. Облако помнит по каждому резюме,
-- когда подъём последний раз удался и чем кончилась последняя попытка, чтобы не
-- ставить новую задачу раньше срока. Харнесс не доверенный: исход решает облако
-- по свидетельствам задачи. Новые столбцы лежат в `resume`, поэтому политика RLS
-- этой таблицы (пользователь видит только свои строки) действует на них же.

-- Новая стадия очереди.
alter table harness_jobs drop constraint if exists harness_jobs_stage_check;
alter table harness_jobs
  add constraint harness_jobs_stage_check
  check (stage in (
    'prepare', 'submit', 'reconcile', 'session', 'inference',
    'negotiations_sync', 'resume_sync', 'form_read', 'letter_attach', 'chat_read',
    'resume_bump'
  ));

-- Новый вид расписания.
alter table schedule drop constraint if exists schedule_kind_check;
alter table schedule add constraint schedule_kind_check
  check (kind in (
    'search',
    'source',
    'vacancy_hydration',
    'employer_hydration',
    'mail_sync',
    'telegram_sync',
    'hh_chat_sync',
    'evaluate',
    'fit',
    'resume_sync',
    'analysis',
    'apply',
    'resume_bump'
  ));

-- Когда облако в последний раз считало подъём состоявшимся (или нажатие без
-- подтверждения): от этого момента считается четырёхчасовой отдых.
alter table resume add column if not exists last_bumped_at timestamptz;
-- Когда была последняя попытка подъёма, любая.
alter table resume add column if not exists last_bump_attempt_at timestamptz;
-- Чем кончилась последняя попытка.
alter table resume add column if not exists last_bump_outcome text;
-- Строка «Последнее — ...» со страницы после попытки, как её показал hh.
alter table resume add column if not exists last_bump_text text;
-- Пояснение к исходу: подпись недоступной кнопки, причина отказа.
alter table resume add column if not exists last_bump_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'resume_last_bump_outcome_check') then
    alter table resume add constraint resume_last_bump_outcome_check
      check (last_bump_outcome is null or last_bump_outcome in ('bumped', 'unavailable', 'unconfirmed'));
  end if;
end $$;
