-- The hard blocks of vacancy selection, per (hh account, resume).
--
-- `filter` is a PresetFilter (AND rules plus OR groups), the same format as a
-- preset, evaluated by the same SQL as search. A null resume is the account
-- row: the fallback for resumes that have no row of their own. With neither
-- row the built-in default filter applies (packages/domain applyFilter.ts).
--
-- A preset is only a template: `template_preset_id` remembers where the copy
-- came from, it does not link them.
create table if not exists apply_filter (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid not null references hh_account(id) on delete cascade,
  resume_id uuid references resume(id) on delete cascade,
  filter jsonb not null default '{}'::jsonb,
  -- Scoring settings that live next to the filter.
  min_fit integer not null default 45 check (min_fit between 0 and 100),
  tests text not null default 'human' check (tests in ('human', 'skip', 'allow')),
  fresh_half_life_hours integer not null default 72 check (fresh_half_life_hours >= 1),
  template_preset_id uuid references preset(id) on delete set null,
  -- When the filter or the settings last changed (not the template link, not a
  -- no-op save). Decisions older than this are stale.
  rules_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists apply_filter_account_resume_idx
  on apply_filter (user_id, hh_account_id, resume_id) nulls not distinct;

drop trigger if exists apply_filter_updated_at on apply_filter;
create trigger apply_filter_updated_at
  before update on apply_filter
  for each row execute function set_updated_at();

alter table apply_filter enable row level security;

drop policy if exists apply_filter_owner on apply_filter;
create policy apply_filter_owner on apply_filter
  using (user_id = nullif(current_setting('app.user_id', true), ''))
  with check (user_id = nullif(current_setting('app.user_id', true), ''));

grant select, insert, update, delete on apply_filter to otbor_runtime;
