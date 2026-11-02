-- Corpus: employers, vacancies and what hh says about them.
--
-- Nothing here is user-owned: the corpus is shared and read-only for the
-- runtime role. Ingest writes it as the schema owner.

create table if not exists employer (
  id uuid primary key default uuidv7(),
  source text not null,
  external_id text not null,
  name text not null,
  rating double precision,
  reviews_count integer,
  recommendations_percent integer,
  site_url text,
  logo_url text,
  industries jsonb not null default '[]',
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create table if not exists vacancy (
  id uuid primary key default uuidv7(),
  source text not null,
  external_id text not null,
  canonical_url text not null,
  url text,
  title text not null,
  employer_id uuid references employer(id) on delete set null,
  area_id integer,
  area_name text,
  salary_from integer,
  salary_to integer,
  salary_currency text,
  salary_gross boolean,
  salary_negotiable boolean not null default false,
  experience_code text,
  employment_form text,
  work_formats jsonb not null default '[]',
  seniority text not null default 'unknown',
  published_at timestamptz,
  archived boolean not null default false,
  description_text text,
  description_html text,
  hydration_status text not null default 'full',
  card_snippet text,
  content_hash text not null,
  responses_total integer,
  responses_vacancy integer,
  signals jsonb not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index if not exists vacancy_published_idx on vacancy (published_at desc nulls last);
create index if not exists vacancy_employer_idx on vacancy (employer_id);
create index if not exists vacancy_archived_idx on vacancy (archived) where not archived;

create table if not exists vacancy_snapshot (
  id uuid primary key default uuidv7(),
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  content_hash text not null,
  captured_at timestamptz not null default now(),
  adapter text,
  raw jsonb not null,
  description_text text,
  unique (vacancy_id, content_hash)
);

create table if not exists vacancy_skill (
  id uuid primary key default uuidv7(),
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  term text not null,
  normalized_term text not null,
  source text not null default 'hh',
  position integer,
  unique (vacancy_id, normalized_term, source)
);

create table if not exists vacancy_response_sample (
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  bucket text not null,
  captured_at timestamptz not null default now(),
  total integer,
  vacancy integer,
  source text not null,
  primary key (vacancy_id, bucket)
);

-- An hh account is a candidate identity, not an auth account. Better Auth's
-- `account` table stays untouched; this one is always `hh_account`.
create table if not exists hh_account (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  label text,
  is_default boolean not null default false,
  first_name text,
  last_name text,
  email text,
  phone text,
  area_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hh_account_user_idx on hh_account (user_id);
create unique index if not exists hh_account_one_default_idx
  on hh_account (user_id) where is_default;

create table if not exists resume (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid not null references hh_account(id) on delete cascade,
  source text not null default 'hh',
  external_id text not null,
  hash text not null,
  content_hash text,
  title text not null,
  text text not null,
  about text not null default '',
  skills jsonb not null default '[]',
  experience jsonb not null default '[]',
  education jsonb not null default '[]',
  work_formats jsonb not null default '[]',
  salary_amount integer,
  salary_currency text,
  status text,
  is_active boolean not null default false,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index if not exists resume_account_idx on resume (hh_account_id);
create unique index if not exists resume_one_active_idx
  on resume (hh_account_id) where is_active;

create table if not exists resume_snapshot (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  resume_id uuid not null references resume(id) on delete cascade,
  content_hash text not null,
  captured_at timestamptz not null default now(),
  raw jsonb not null,
  unique (resume_id, content_hash)
);

create table if not exists resume_enrichment (
  user_id text not null references "user"(id) on delete cascade,
  resume_id uuid primary key references resume(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
