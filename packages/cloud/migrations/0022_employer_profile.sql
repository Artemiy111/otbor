-- Useful part of the /employer/{id} profile: about text, kind, size, address,
-- trust markers and the active vacancy count.
alter table employer add column if not exists category text;
alter table employer add column if not exists size_category text;
alter table employer add column if not exists address text;
alter table employer add column if not exists site_host text;
alter table employer add column if not exists description_text text;
alter table employer add column if not exists badges jsonb not null default '[]'::jsonb;
alter table employer add column if not exists trusted boolean;
alter table employer add column if not exists accredited_it boolean;
alter table employer add column if not exists active_vacancies integer;
alter table employer add column if not exists profile_fetched_at timestamptz;
