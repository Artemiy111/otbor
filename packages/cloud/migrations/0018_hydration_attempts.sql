-- Per-target retry memory for hydration. Before this table a failed vacancy or
-- company was picked again on the next pass, so one broken page could occupy a
-- slot forever. The row is deleted on success and only exists while a target is
-- waiting out its backoff.
create table if not exists hydration_attempt (
  target_kind text not null check (target_kind in ('vacancy', 'employer')),
  target_id uuid not null,
  external_id text not null,
  attempts int not null default 0 check (attempts >= 0),
  last_status text not null check (last_status in ('ok', 'failed')),
  last_error text,
  last_attempt_at timestamptz not null default now(),
  next_retry_at timestamptz not null default now(),
  primary key (target_kind, target_id)
);

create index if not exists hydration_attempt_due_idx
  on hydration_attempt (target_kind, next_retry_at);

-- The queue predicate reads these rows for every request-scoped selection, so
-- runtime users may read them; only the owner writes attempts.
alter table hydration_attempt enable row level security;

drop policy if exists hydration_attempt_read on hydration_attempt;
create policy hydration_attempt_read on hydration_attempt for select using (true);

grant select on hydration_attempt to otbor_runtime;
