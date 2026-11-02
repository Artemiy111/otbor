-- Row level security, the runtime role and updated_at triggers.
--
-- Two roles:
--   * the owner (`app`) runs migrations, ingest, the queue claim and the
--     scheduler; it bypasses RLS.
--   * `otbor_runtime` is the role the request path and every application write
--     uses. It has no BYPASSRLS and sees only rows for `app.user_id`.
--
-- `nullif(current_setting('app.user_id', true), '')` is fail-closed: an unset
-- context is NULL, and NULL never equals a user id.

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

do $$
declare
  t text;
  updated text[] := array[
    'employer', 'vacancy', 'hh_account', 'resume', 'resume_enrichment',
    'keyword', 'title_verdict', 'preset', 'search_query', 'schedule',
    'stream', 'application', 'hh_account_session', 'harness', 'harness_jobs'
  ];
begin
  foreach t in array updated loop
    execute format('drop trigger if exists %I on %I', t || '_updated_at', t);
    execute format(
      'create trigger %I before update on %I for each row execute function set_updated_at()',
      t || '_updated_at', t
    );
  end loop;
end
$$;

-- --------------------------------------------------------------------------
-- Roles
-- --------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'otbor_runtime') then
    execute 'create role otbor_runtime noinherit nologin';
  end if;

  -- Convenience for the single-owner deployment: the owner may SET ROLE.
  -- A superuser already can; a non-superuser owner gets an explicit grant.
  if current_user <> 'otbor_runtime' then
    execute format('grant otbor_runtime to %I', current_user);
  end if;
end
$$;

grant usage on schema public to otbor_runtime;

-- --------------------------------------------------------------------------
-- Policies
-- --------------------------------------------------------------------------

do $$
declare
  t text;

  personal text[] := array[
    'hh_account', 'resume', 'resume_snapshot', 'resume_enrichment',
    'decision', 'stream', 'application', 'application_kit',
    'application_attempt', 'hh_account_session', 'fit', 'hidden_target',
    'hidden_rule', 'harness', 'harness_account', 'harness_jobs'
  ];

  -- `user_id is null` is a system row: everyone reads it, only the owner writes.
  mixed text[] := array['preset', 'schedule', 'schedule_run'];

  shared text[] := array[
    'employer', 'vacancy', 'vacancy_snapshot', 'vacancy_skill',
    'vacancy_response_sample', 'keyword', 'keyword_alias', 'vacancy_keyword',
    'title_verdict', 'search_query', 'search_run', 'vacancy_search_hit'
  ];
begin
  foreach t in array personal loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_owner', t);
    execute format(
      'create policy %I on %I using (user_id = nullif(current_setting(''app.user_id'', true), '''')) with check (user_id = nullif(current_setting(''app.user_id'', true), ''''))',
      t || '_owner', t
    );
  end loop;

  foreach t in array mixed loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_owner', t);
    execute format(
      'create policy %I on %I using (user_id is null or user_id = nullif(current_setting(''app.user_id'', true), '''')) with check (user_id = nullif(current_setting(''app.user_id'', true), ''''))',
      t || '_owner', t
    );
  end loop;

  foreach t in array shared loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select using (true)', t || '_read', t);
  end loop;

  -- Infrastructure tables: RLS on, no policy. Only the owner can see them.
  foreach t in array array['account_lease'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end
$$;

-- Runtime can only read the shared corpus and write its own rows.
do $$
declare
  t text;
  shared text[] := array[
    'employer', 'vacancy', 'vacancy_snapshot', 'vacancy_skill',
    'vacancy_response_sample', 'keyword', 'keyword_alias', 'vacancy_keyword',
    'title_verdict', 'search_query', 'search_run', 'vacancy_search_hit'
  ];
  personal text[] := array[
    'hh_account', 'resume', 'resume_snapshot', 'resume_enrichment',
    'decision', 'stream', 'application', 'application_kit',
    'application_attempt', 'hh_account_session', 'fit', 'hidden_target',
    'hidden_rule', 'harness', 'harness_account', 'harness_jobs',
    'preset', 'schedule', 'schedule_run'
  ];
begin
  foreach t in array shared loop
    execute format('grant select on %I to otbor_runtime', t);
  end loop;

  foreach t in array personal loop
    execute format('grant select, insert, update, delete on %I to otbor_runtime', t);
  end loop;

  execute 'grant select on "user" to otbor_runtime';
end
$$;
