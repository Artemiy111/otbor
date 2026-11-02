-- Universal persisted run history for every schedule kind (search, hydration,
-- mail, telegram, ...). Replaces the legacy per-slot `schedule_run` table
-- with a simple "one row per invocation" history.
drop table if exists schedule_run cascade;

create table schedule_run (
  id uuid primary key default uuidv7(),
  schedule_id uuid not null references schedule(id) on delete cascade,
  kind text not null,
  status text not null check (status in ('running', 'done', 'error')),
  detail jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists schedule_run_schedule_started_idx
  on schedule_run (schedule_id, started_at desc);

-- RLS: a runtime user sees runs for schedules they own (or system schedules).
alter table schedule_run enable row level security;

drop policy if exists schedule_run_owner on schedule_run;
create policy schedule_run_owner on schedule_run
  using (
    exists (
      select 1
      from schedule s
      where s.id = schedule_run.schedule_id
        and (s.user_id is null or s.user_id = nullif(current_setting('app.user_id', true), ''))
    )
  )
  with check (
    exists (
      select 1
      from schedule s
      where s.id = schedule_run.schedule_id
        and s.user_id = nullif(current_setting('app.user_id', true), '')
    )
  );

grant select, insert, update, delete on schedule_run to otbor_runtime;