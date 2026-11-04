-- The hh response form ("employer test") belongs to the vacancy, not to an
-- application: every applicant sees the same questions, and the employer may
-- edit them. So the form is stored once per vacancy as immutable versions, and
-- a one-row-per-vacancy state points at the version hh shows now.
--
-- Shared like `vacancy`: everyone reads. Only the cloud writes (the harness
-- delivers pages, the cloud parses them), through the runtime role.

create table if not exists vacancy_form_version (
  id uuid primary key default uuidv7(),
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  form_hash text not null,
  layout text not null check (layout in ('known', 'unknown')),
  cover_letter text not null check (cover_letter in ('required', 'optional', 'absent')),
  form jsonb not null,
  url text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (vacancy_id, form_hash)
);

create table if not exists vacancy_form_state (
  vacancy_id uuid primary key references vacancy(id) on delete cascade,
  current_version_id uuid references vacancy_form_version(id) on delete set null,
  -- none: hh shows no questions. present: a form was read. unreadable: the
  -- layout was not recognized (never "no questions"). gone: archived.
  status text not null check (status in ('none', 'present', 'unreadable', 'gone')),
  -- Last successful read; a failed read leaves it untouched so the form stays stale.
  checked_at timestamptz not null default now(),
  -- When the current version last changed.
  changed_at timestamptz not null default now(),
  checked_by_account_id uuid references hh_account(id) on delete set null,
  -- Why the latest read did not succeed, if it did not.
  last_error text,
  last_error_at timestamptz
);

grant select, insert, update on vacancy_form_version, vacancy_form_state to otbor_runtime;

-- A form read is a browser job without an application.
alter table harness_jobs drop constraint if exists harness_jobs_stage_check;
alter table harness_jobs
  add constraint harness_jobs_stage_check
  check (stage in (
    'prepare', 'submit', 'reconcile', 'session', 'inference',
    'negotiations_sync', 'resume_sync', 'form_read'
  ));

-- `prepare` is replaced by `form_read`; nothing is carried over.
update harness_jobs
   set status = 'cancelled', last_error = 'replaced by form_read'
 where stage = 'prepare' and status in ('pending', 'leased');

drop table if exists application_form;
