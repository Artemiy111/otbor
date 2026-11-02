-- The migrator's bookkeeping table is created before any migration runs, so it
-- cannot be covered by 0004. It holds no domain data; RLS with no policy keeps
-- it owner-only and satisfies the "every application table has RLS" check.
alter table if exists effect_sql_migrations enable row level security;
