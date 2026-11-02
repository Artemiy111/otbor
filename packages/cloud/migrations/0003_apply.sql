-- Lexicon, decisions, applications and the harness queue.

create table if not exists keyword (
  id uuid primary key default uuidv7(),
  term text not null,
  normalized_term text not null unique,
  enabled boolean not null default true,
  notes text,
  created_by text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists keyword_alias (
  id uuid primary key default uuidv7(),
  keyword_id uuid not null references keyword(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  match_type text not null default 'word',
  typo boolean not null default false,
  unique (keyword_id, normalized_alias)
);

create index if not exists keyword_alias_keyword_idx on keyword_alias (keyword_id);

-- One row per *matched form*, not per (vacancy, term).
-- `matched_form` is stored normalized: `Kubernetes` and `kubernetes` collapse,
-- `k8s` stays a separate row. The snippet is deliberately not stored.
create table if not exists vacancy_keyword (
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  keyword_id uuid not null references keyword(id) on delete cascade,
  alias_id uuid references keyword_alias(id) on delete set null,
  matched_form text not null,
  in_title boolean not null default false,
  title_count integer not null default 0,
  in_body boolean not null default false,
  body_count integer not null default 0,
  in_skills boolean not null default false,
  typo boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (vacancy_id, keyword_id, matched_form)
);

create index if not exists vacancy_keyword_title_idx
  on vacancy_keyword (keyword_id) where in_title;
create index if not exists vacancy_keyword_body_idx
  on vacancy_keyword (keyword_id) where in_body;

-- The only place a title's role verdict is cached. Keyed by the normalized
-- title with grade and work-format words removed, so one decision covers
-- "Senior DevOps (remote)" and "DevOps engineer".
create table if not exists title_verdict (
  normalized_title text primary key,
  role_family text,
  verdict text not null check (verdict in ('match', 'unknown', 'reject')),
  source text not null check (source in ('rules', 'llm', 'user')),
  matched jsonb not null default '[]',
  rejected_by text,
  rules_version integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists title_verdict_verdict_idx on title_verdict (verdict);

-- A decision is an immutable artifact. `input_hash` makes a retried evaluate
-- return the same row instead of growing the table forever.
create table if not exists decision (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid references hh_account(id) on delete cascade,
  resume_id uuid references resume(id) on delete set null,
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  verdict text not null check (verdict in ('apply', 'draft', 'skip')),
  gate text not null check (gate in ('match', 'unknown', 'reject')),
  role_family text,
  fit integer not null default 0,
  priority double precision not null default 0,
  reasons jsonb not null default '[]',
  policy_version integer not null,
  rules_version integer not null,
  input_hash text not null,
  created_at timestamptz not null default now(),
  unique (user_id, vacancy_id, policy_version, input_hash)
);

create index if not exists decision_user_created_idx on decision (user_id, created_at desc);
create index if not exists decision_apply_idx on decision (user_id, priority desc) where verdict = 'apply';

create table if not exists preset (
  id uuid primary key default uuidv7(),
  user_id text references "user"(id) on delete cascade,
  kind text not null default 'apply' check (kind in ('explore', 'apply')),
  title text not null,
  filter jsonb not null default '{"all":[]}',
  system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists preset_user_kind_idx on preset (user_id, kind);

create table if not exists search_query (
  id uuid primary key default uuidv7(),
  url text not null,
  normalized_url text not null unique,
  title text,
  text_query text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists search_run (
  id uuid primary key default uuidv7(),
  query_id uuid not null references search_query(id) on delete cascade,
  status text not null,
  next_page integer,
  pages_done integer not null default 0,
  found integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists vacancy_search_hit (
  query_id uuid not null references search_query(id) on delete cascade,
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  position integer,
  found_at timestamptz not null default now(),
  primary key (query_id, vacancy_id)
);

create table if not exists schedule (
  id uuid primary key default uuidv7(),
  user_id text references "user"(id) on delete cascade,
  kind text not null check (kind in ('search', 'source')),
  target_id text not null,
  interval_minutes integer not null check (interval_minutes > 0),
  options jsonb not null default '{}',
  enabled boolean not null default true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists schedule_next_run_idx
  on schedule (next_run_at) where enabled;

create table if not exists schedule_run (
  id uuid primary key default uuidv7(),
  user_id text references "user"(id) on delete cascade,
  schedule_id uuid not null references schedule(id) on delete cascade,
  scheduled_for timestamptz not null,
  status text not null,
  error text,
  duration_ms integer,
  steps jsonb not null default '[]',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (schedule_id, scheduled_for)
);

create table if not exists hidden_target (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid not null references hh_account(id) on delete cascade,
  type text not null check (type in ('vacancy', 'employer')),
  external_id text not null,
  name text,
  created_at timestamptz not null default now(),
  unique (hh_account_id, type, external_id)
);

create table if not exists hidden_rule (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid not null references hh_account(id) on delete cascade,
  type text not null check (type in ('employer_name')),
  pattern text not null,
  source text not null default 'user',
  created_at timestamptz not null default now()
);

create table if not exists stream (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid not null references hh_account(id) on delete cascade,
  name text,
  preset_id uuid references preset(id) on delete set null,
  search_query_id uuid references search_query(id) on delete set null,
  mode text not null default 'drafts' check (mode in ('drafts', 'auto')),
  letter_policy text not null default 'required' check (letter_policy in ('required', 'optional', 'never')),
  tests_policy text not null default 'human' check (tests_policy in ('human', 'skip', 'allow')),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stream_account_idx on stream (hh_account_id);

-- One application per (account, vacancy) is a uniqueness invariant, not a
-- convention. Two accounts of the same user are two candidates.
create table if not exists application (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid not null references hh_account(id) on delete cascade,
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  resume_id uuid references resume(id) on delete set null,
  stream_id uuid references stream(id) on delete set null,
  decision_id uuid references decision(id) on delete set null,
  state text not null default 'draft'
    check (state in ('draft', 'queued', 'submitting', 'submitted', 'skipped', 'needs_human', 'failed')),
  intent_at timestamptz,
  submitted_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hh_account_id, vacancy_id),
  unique (id, user_id)
);

create index if not exists application_user_state_idx on application (user_id, state, updated_at desc);

create table if not exists application_kit (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  application_id uuid not null references application(id) on delete cascade,
  form_hash text not null,
  letter text,
  answers jsonb not null default '[]',
  model text,
  prompt_hash text,
  cost_usd double precision,
  created_at timestamptz not null default now(),
  unique (application_id, form_hash),
  constraint kit_application_user
    foreign key (application_id, user_id) references application (id, user_id) on delete cascade
);

-- Append-only attempt journal. The composite FK on (application_id, user_id)
-- keeps RLS simple without an `exists` subquery.
create table if not exists application_attempt (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  application_id uuid not null,
  seq integer not null,
  stage text not null check (stage in ('prepare', 'submit', 'reconcile')),
  harness_id uuid,
  exit jsonb,
  artifacts jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (application_id, seq),
  constraint attempt_application_user
    foreign key (application_id, user_id) references application (id, user_id) on delete cascade
);

create index if not exists attempt_application_idx on application_attempt (application_id, seq);

create table if not exists hh_account_session (
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid primary key references hh_account(id) on delete cascade,
  sealed bytea,
  state text not null default 'expired' check (state in ('ok', 'expired', 'blocked')),
  proxy_node text,
  last_ok_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists fit (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid not null references hh_account(id) on delete cascade,
  resume_id uuid not null references resume(id) on delete cascade,
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  content_hash text not null,
  resume_hash text not null,
  prompt_hash text not null,
  model text not null,
  verdict text not null check (verdict in ('fit', 'maybe', 'reject')),
  score integer not null,
  reasons jsonb not null default '[]',
  cost_usd double precision,
  created_at timestamptz not null default now(),
  unique (vacancy_id, resume_id, content_hash, resume_hash, prompt_hash, model)
);

create table if not exists harness (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  name text not null,
  kinds jsonb not null default '[]',
  token_hash text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists harness_user_idx on harness (user_id);

-- One account is served by exactly one harness. This is the storage half of
-- "one session, one performer"; `account_lease` is the runtime half.
create table if not exists harness_account (
  user_id text not null references "user"(id) on delete cascade,
  harness_id uuid not null references harness(id) on delete cascade,
  hh_account_id uuid not null references hh_account(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (harness_id, hh_account_id),
  unique (hh_account_id)
);

create table if not exists harness_jobs (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid references hh_account(id) on delete cascade,
  application_id uuid references application(id) on delete cascade,
  stage text not null check (stage in ('prepare', 'submit', 'reconcile', 'session')),
  kind text not null check (kind in ('browser', 'inference')),
  payload jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'leased', 'running', 'done', 'failed', 'dead', 'needs_human', 'needs_reconcile', 'cancelled')),
  priority integer not null default 0,
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  idempotency_key text not null unique,
  lease_id uuid,
  lease_epoch integer not null default 0,
  lease_until timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- At-most-once submit: a submit job can never be retried by the queue.
  -- Retries belong to prepare and reconcile; ambiguity goes to reconcile.
  constraint submit_is_single_attempt
    check (stage <> 'submit' or max_attempts <= 1)
);

create index if not exists harness_jobs_claim_idx
  on harness_jobs (kind, status, run_at, priority desc)
  where status = 'pending';

create index if not exists harness_jobs_account_idx
  on harness_jobs (hh_account_id, status);

create index if not exists harness_jobs_application_idx
  on harness_jobs (application_id);

create index if not exists harness_jobs_lease_idx
  on harness_jobs (status, lease_until)
  where status in ('leased', 'running');

-- Runtime serialization per account. Claimed as the owner (worker), checked by
-- every harness before it is allowed to touch the account.
create table if not exists account_lease (
  hh_account_id uuid primary key references hh_account(id) on delete cascade,
  holder text not null,
  epoch integer not null default 0,
  expires_at timestamptz not null
);
