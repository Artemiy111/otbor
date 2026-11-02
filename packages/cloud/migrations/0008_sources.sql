-- Sources: contacts, conversations, mail and Telegram accounts.
--
-- Every table here is user-owned. The runtime role sees only rows whose
-- `user_id` matches `app.user_id`; ingest and the worker write as the owner.
-- Vendor identifiers (RFC Message-ID, IMAP UID, Telegram chat id) live in
-- `external_id`/`rfc_message_id`/`uid`, never in a primary key.

create table if not exists contact (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  person_name text,
  person_role text,
  kind text not null check (kind in ('email', 'telegram', 'phone', 'hh_chat', 'other')),
  value text not null,
  url text,
  source text not null check (source in ('hh_vacancy', 'mail', 'telegram', 'hh_chat', 'manual')),
  confidence double precision,
  evidence text,
  is_bot boolean not null default false,
  vacancy_id uuid references vacancy(id) on delete set null,
  employer_id uuid references employer(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, kind, value)
);

create index if not exists contact_user_seen_idx on contact (user_id, last_seen_at desc);
create index if not exists contact_user_source_idx on contact (user_id, source);
create index if not exists contact_vacancy_idx on contact (vacancy_id) where vacancy_id is not null;

create table if not exists conversation (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  channel text not null check (channel in ('mail', 'telegram', 'hh_chat')),
  account_id text not null default '',
  external_id text not null,
  title text,
  url text,
  person_name text,
  person_role text,
  last_message_at timestamptz,
  unread_count integer not null default 0 check (unread_count >= 0),
  archived boolean not null default false,
  raw jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, channel, account_id, external_id)
);

create index if not exists conversation_user_recent_idx
  on conversation (user_id, last_message_at desc nulls last);
create index if not exists conversation_channel_idx on conversation (user_id, channel);

create table if not exists conversation_message (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  conversation_id uuid not null references conversation(id) on delete cascade,
  external_id text not null,
  direction text not null check (direction in ('in', 'out')),
  sent_at timestamptz not null,
  kind text not null default 'text' check (kind in ('text', 'media', 'service')),
  text text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (conversation_id, external_id)
);

create index if not exists conversation_message_conversation_idx
  on conversation_message (conversation_id, sent_at);
create index if not exists conversation_message_user_idx on conversation_message (user_id);

create table if not exists conversation_vacancy (
  user_id text not null references "user"(id) on delete cascade,
  conversation_id uuid not null references conversation(id) on delete cascade,
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  kind text not null default 'primary',
  confidence double precision,
  source text not null default 'chat',
  evidence text,
  created_at timestamptz not null default now(),
  primary key (conversation_id, vacancy_id, kind)
);

create index if not exists conversation_vacancy_vacancy_idx on conversation_vacancy (vacancy_id);

create table if not exists mail_account (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  label text not null,
  address text not null,
  host text not null,
  port integer not null check (port > 0 and port <= 65535),
  secure boolean not null default true,
  username text not null,
  secret_ref text,
  include_sent boolean not null default false,
  backfill_days integer not null default 90 check (backfill_days >= 0),
  status text not null default 'idle' check (status in ('idle', 'ok', 'error', 'auth_failed')),
  enabled boolean not null default true,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, address)
);

create index if not exists mail_account_user_idx on mail_account (user_id);

create table if not exists mail_folder (
  user_id text not null references "user"(id) on delete cascade,
  account_id uuid not null references mail_account(id) on delete cascade,
  path text not null,
  role text not null default 'other' check (role in ('inbox', 'sent', 'archive', 'spam', 'trash', 'other')),
  uid_validity text,
  last_uid bigint not null default 0 check (last_uid >= 0),
  last_sync_at timestamptz,
  primary key (account_id, path)
);

create table if not exists mail_message (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  account_id uuid not null references mail_account(id) on delete cascade,
  conversation_id uuid references conversation(id) on delete set null,
  folder text not null,
  uid bigint not null check (uid >= 0),
  rfc_message_id text not null,
  in_reply_to text,
  subject text,
  from_json jsonb,
  to_json jsonb,
  cc_json jsonb,
  received_at timestamptz,
  snippet text,
  attachment_count integer not null default 0,
  attachment_names jsonb not null default '[]',
  size bigint,
  created_at timestamptz not null default now(),
  unique (account_id, folder, uid),
  unique (account_id, rfc_message_id)
);

create index if not exists mail_message_conversation_idx on mail_message (conversation_id);
create index if not exists mail_message_account_received_idx
  on mail_message (account_id, received_at desc);

create table if not exists telegram_account (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  label text not null,
  tg_user_id text,
  username text,
  phone_masked text,
  session_ref text,
  status text not null default 'idle' check (status in ('idle', 'ok', 'error')),
  enabled boolean not null default true,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, label)
);

create index if not exists telegram_account_user_idx on telegram_account (user_id);

-- --------------------------------------------------------------------------
-- Schedules gain the source kinds. `source` stays for compatibility with rows
-- created before the router learned individual kinds.
-- --------------------------------------------------------------------------

alter table schedule drop constraint if exists schedule_kind_check;
alter table schedule add constraint schedule_kind_check
  check (kind in (
    'search',
    'source',
    'vacancy_hydration',
    'employer_hydration',
    'mail_sync',
    'telegram_sync',
    'hh_chat_sync'
  ));

-- --------------------------------------------------------------------------
-- updated_at triggers for the tables that carry the column
-- --------------------------------------------------------------------------

do $$
declare
  t text;
  updated text[] := array['conversation', 'mail_account', 'telegram_account'];
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
-- RLS: every row belongs to exactly one user
-- --------------------------------------------------------------------------

do $$
declare
  t text;
  personal text[] := array[
    'contact', 'conversation', 'conversation_message', 'conversation_vacancy',
    'mail_account', 'mail_folder', 'mail_message', 'telegram_account'
  ];
begin
  foreach t in array personal loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_owner', t);
    execute format(
      'create policy %I on %I using (user_id = nullif(current_setting(''app.user_id'', true), '''')) with check (user_id = nullif(current_setting(''app.user_id'', true), ''''))',
      t || '_owner', t
    );
    execute format('grant select, insert, update, delete on %I to otbor_runtime', t);
  end loop;
end
$$;
