-- The title gate is gone: the apply filter (title rules included) is the only
-- source of hard conditions. Drop its cache, its decision columns and every
-- trace of it from stored filters.

-- Legacy `gate` / `role_family` rules and the legacy `gate` key are removed
-- from stored filters (rules arrays and group branches), exactly as
-- `parsePresetFilter` does for filters it still meets. Branches and groups that
-- end up empty are dropped, like blank rules are.
create or replace function _otbor_strip_gate_rules(rules jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(r.value order by r.ord), '[]'::jsonb)
  from jsonb_array_elements(rules) with ordinality as r(value, ord)
  where coalesce(r.value ->> 'field', '') not in ('gate', 'role_family')
$$;

create or replace function _otbor_strip_gate_filter(f jsonb) returns jsonb
language plpgsql immutable as $$
declare
  result jsonb;
begin
  if f is null or jsonb_typeof(f) <> 'object' then
    return f;
  end if;

  result := f - 'gate';

  if jsonb_typeof(result -> 'rules') = 'array' then
    result := jsonb_set(result, '{rules}', _otbor_strip_gate_rules(result -> 'rules'));
  end if;

  if jsonb_typeof(result -> 'groups') = 'array' then
    result := jsonb_set(result, '{groups}', (
      select coalesce(jsonb_agg(cleaned.value order by cleaned.ord), '[]'::jsonb)
      from (
        select g.ord,
          case
            when jsonb_typeof(g.value -> 'branches') = 'array' then
              jsonb_set(g.value, '{branches}', (
                select coalesce(jsonb_agg(
                  case
                    when jsonb_typeof(b.value -> 'rules') = 'array'
                      then jsonb_set(b.value, '{rules}', _otbor_strip_gate_rules(b.value -> 'rules'))
                    else b.value
                  end
                  order by b.ord
                ), '[]'::jsonb)
                from jsonb_array_elements(g.value -> 'branches') with ordinality as b(value, ord)
                where jsonb_typeof(b.value -> 'rules') is distinct from 'array'
                   or jsonb_array_length(_otbor_strip_gate_rules(b.value -> 'rules')) > 0
              ))
            else g.value
          end as value
        from jsonb_array_elements(result -> 'groups') with ordinality as g(value, ord)
      ) cleaned
      where jsonb_typeof(cleaned.value -> 'branches') is distinct from 'array'
         or jsonb_array_length(cleaned.value -> 'branches') > 0
    ));
  end if;

  return result;
end
$$;

update preset
set filter = _otbor_strip_gate_filter(filter)
where filter is distinct from _otbor_strip_gate_filter(filter);

update apply_filter
set filter = _otbor_strip_gate_filter(filter)
where filter is distinct from _otbor_strip_gate_filter(filter);

drop function if exists _otbor_strip_gate_filter(jsonb);
drop function if exists _otbor_strip_gate_rules(jsonb);

-- Dropping the table takes its index, RLS policy and updated_at trigger along.
drop table if exists title_verdict;

-- `gate` carried a check constraint; it goes with the column.
alter table decision drop column if exists gate;
alter table decision drop column if exists role_family;
alter table decision drop column if exists rules_version;
