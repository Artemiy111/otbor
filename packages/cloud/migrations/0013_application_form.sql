-- The prepared response form of an application: what the cloud parsed from the
-- page the harness returned, plus the deterministic answer hints computed from
-- it. One row per (application, form_hash); the newest row is the current form.

create table if not exists application_form (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  application_id uuid not null,
  form_hash text not null,
  layout text not null check (layout in ('known', 'unknown')),
  form jsonb not null,
  hints jsonb not null default '[]',
  url text not null,
  created_at timestamptz not null default now(),
  unique (application_id, form_hash),
  constraint form_application_user
    foreign key (application_id, user_id) references application (id, user_id) on delete cascade
);

create index if not exists application_form_application_idx
  on application_form (application_id, created_at desc);

alter table application_form enable row level security;
drop policy if exists application_form_owner on application_form;
create policy application_form_owner on application_form
  using (user_id = nullif(current_setting('app.user_id', true), ''))
  with check (user_id = nullif(current_setting('app.user_id', true), ''));

grant select, insert, update, delete on application_form to otbor_runtime;
