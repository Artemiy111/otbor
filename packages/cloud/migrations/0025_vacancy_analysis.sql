-- Layer A of the vacancy analysis: facts about a vacancy extracted by the local
-- decision model. Shared like `vacancy` (everyone reads, only the owner writes),
-- one row per vacancy and prompt version.
--
-- `answers` is the raw model output and never changes meaning; `facts` is the
-- interpretation at `threshold`, so the same answers can be re-read at another
-- threshold without calling the model again. `input_hash` is the stable hash of
-- the exact state sent: a changed vacancy, employer profile or prompt version
-- makes the row stale.
create table if not exists vacancy_analysis (
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  prompt_version text not null,
  input_hash text not null,
  model text not null,
  answers jsonb not null,
  facts jsonb not null,
  threshold double precision not null,
  latency_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (vacancy_id, prompt_version)
);

create index if not exists vacancy_analysis_updated_idx
  on vacancy_analysis (prompt_version, updated_at);

drop trigger if exists vacancy_analysis_updated_at on vacancy_analysis;
create trigger vacancy_analysis_updated_at
  before update on vacancy_analysis
  for each row execute function set_updated_at();

alter table vacancy_analysis enable row level security;
drop policy if exists vacancy_analysis_read on vacancy_analysis;
create policy vacancy_analysis_read on vacancy_analysis for select using (true);

grant select on vacancy_analysis to otbor_runtime;
