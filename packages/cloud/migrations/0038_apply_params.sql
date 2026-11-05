-- Auto-apply parameters and fit boosts, stored next to the apply filter.
--
-- `auto_mode` and the batch/limit/sort/min_priority knobs only steer the
-- (future) runner and the daily cap: they never change a decision. `boosts`
-- are scoring rules (`{ rule, weight }`) that replace the hard-coded fit
-- bonuses, so they do change fit and are tracked by `rules_changed_at`.
-- Rows that exist before this migration scored with the hard-coded bonuses, so
-- they get the same bonuses as boosts (only on the run that adds the column; a
-- later empty list is the operator's choice).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'apply_filter' and column_name = 'boosts'
  ) then
    alter table apply_filter add column boosts jsonb not null default '[]'::jsonb;
    update apply_filter set boosts = '[
      {"rule": {"field": "salary", "op": "gte", "value": 250000, "currency": "RUB"}, "weight": 8},
      {"rule": {"field": "work_format", "op": "in", "value": ["remote"]}, "weight": 5},
      {"rule": {"field": "seniority", "op": "in", "value": ["middle", "senior", "lead", "unknown"]}, "weight": 4}
    ]'::jsonb;
  end if;
end $$;

alter table apply_filter
  add column if not exists auto_mode text not null default 'off',
  add column if not exists daily_limit integer not null default 200,
  add column if not exists batch_size integer not null default 20,
  add column if not exists sort text not null default 'priority',
  add column if not exists min_priority numeric not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'apply_filter_auto_mode_check') then
    alter table apply_filter add constraint apply_filter_auto_mode_check
      check (auto_mode in ('off', 'drafts', 'auto'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'apply_filter_daily_limit_check') then
    alter table apply_filter add constraint apply_filter_daily_limit_check
      check (daily_limit >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'apply_filter_batch_size_check') then
    alter table apply_filter add constraint apply_filter_batch_size_check
      check (batch_size >= 1 and batch_size <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'apply_filter_sort_check') then
    alter table apply_filter add constraint apply_filter_sort_check
      check (sort in ('priority', 'fit', 'newest', 'salary'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'apply_filter_min_priority_check') then
    alter table apply_filter add constraint apply_filter_min_priority_check
      check (min_priority >= 0);
  end if;
end $$;
