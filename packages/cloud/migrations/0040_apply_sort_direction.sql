-- Order in which the auto-apply runner takes candidates: 'desc' is best first
-- (the `sort` key descending), 'asc' reverses the whole ordering. Steers the
-- runner only; it never changes a verdict, so it does not make decisions stale.
alter table apply_filter add column if not exists sort_direction text not null default 'desc';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'apply_filter_sort_direction_check') then
    alter table apply_filter add constraint apply_filter_sort_direction_check
      check (sort_direction in ('desc', 'asc'));
  end if;
end $$;
