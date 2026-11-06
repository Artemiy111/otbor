-- Filters no longer hide archived vacancies and app-blacklisted companies on
-- their own: both are plain rules now (`archived is_false`, `hidden not_in app`).
-- Every stored filter gets the rules it was implicitly running with, unless it
-- already has a rule about that field or asked for the opposite with the
-- removed `includeArchived` / `includeBlacklisted` flags. The flags go away.
create function pg_temp.explicit_filter(f jsonb) returns jsonb
language sql immutable as $$
  select (f - 'includeArchived' - 'includeBlacklisted') || jsonb_build_object(
    'rules',
    coalesce(f->'rules', '[]'::jsonb)
    || case
      when coalesce((f->>'includeArchived')::boolean, false)
        or jsonb_path_exists(f, '$.rules[*] ? (@.field == "archived")')
        or jsonb_path_exists(f, '$.groups[*].branches[*].rules[*] ? (@.field == "archived")')
      then '[]'::jsonb
      else '[{"field": "archived", "op": "is_false"}]'::jsonb
    end
    || case
      when coalesce((f->>'includeBlacklisted')::boolean, false)
        or jsonb_path_exists(f, '$.rules[*] ? (@.field == "hidden")')
        or jsonb_path_exists(f, '$.groups[*].branches[*].rules[*] ? (@.field == "hidden")')
      then '[]'::jsonb
      else '[{"field": "hidden", "op": "not_in", "value": ["app"]}]'::jsonb
    end
  )
$$;

update preset set filter = pg_temp.explicit_filter(filter);
update apply_filter set filter = pg_temp.explicit_filter(filter);
