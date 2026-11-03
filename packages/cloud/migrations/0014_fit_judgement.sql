-- Gate G2: the personal fit judgement (LLM or external agent) per
-- (vacancy, resume). One row per distinct set of inputs: a changed vacancy
-- (content_hash), resume digest (resume_hash) or prompt version is a new row,
-- and the old one stays as history. The decision uses a row only while all
-- three still match (see isFitJudgementCurrent in @otbor/domain).
create table if not exists fit_judgement (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  resume_id uuid not null references resume(id) on delete cascade,
  vacancy_content_hash text not null,
  resume_hash text not null,
  prompt_version text not null,
  -- llm: produced by an inference job; external: supplied by a chat agent.
  source text not null check (source in ('llm', 'external')),
  status text not null check (status in ('pending', 'done', 'failed')),
  fit integer check (fit between 0 and 100),
  confidence double precision check (confidence between 0 and 1),
  verdict text check (verdict in ('strong', 'ok', 'weak', 'no')),
  reasons jsonb not null default '[]',
  disqualifiers jsonb not null default '[]',
  quotes jsonb not null default '[]',
  model text,
  -- The inference job that will fill (or filled) this row. Set null if the
  -- job row is ever purged; the judgement itself survives.
  inference_job_id uuid references harness_jobs(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A finished row carries a score; a pending or failed one does not need to.
  check (status <> 'done' or (fit is not null and confidence is not null and verdict is not null)),
  unique (user_id, vacancy_id, resume_id, vacancy_content_hash, resume_hash, prompt_version)
);

create index if not exists fit_judgement_user_vacancy_idx
  on fit_judgement (user_id, vacancy_id, updated_at desc);
create index if not exists fit_judgement_job_idx
  on fit_judgement (inference_job_id) where inference_job_id is not null;
create index if not exists fit_judgement_user_status_idx
  on fit_judgement (user_id, status, updated_at desc);

drop trigger if exists fit_judgement_updated_at on fit_judgement;
create trigger fit_judgement_updated_at
  before update on fit_judgement
  for each row execute function set_updated_at();

-- RLS: personal table, same policy as decision and the other user-owned rows.
alter table fit_judgement enable row level security;

drop policy if exists fit_judgement_owner on fit_judgement;
create policy fit_judgement_owner on fit_judgement
  using (user_id = nullif(current_setting('app.user_id', true), ''))
  with check (user_id = nullif(current_setting('app.user_id', true), ''));

grant select, insert, update, delete on fit_judgement to otbor_runtime;

-- Scheduled fit enqueueing: `fit` joins the schedule kinds.
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
    'fit'
  ));
