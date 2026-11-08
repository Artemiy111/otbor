-- Люди: человек-собеседник (рекрутер, наниматель) владеет контактами и диалогами.
--
-- Контакт остаётся «идентичностью» (email, телефон, @username, числовой id в
-- Telegram), а `person` объединяет несколько идентичностей одного человека.
-- Привязка контакта к человеку хранит происхождение (`person_link`): `auto` —
-- по однозначному сигналу, `suggested` — предложение, ждёт подтверждения,
-- `manual` — решение оператора, его автоматика не перезаписывает.
-- Все таблицы принадлежат пользователю и закрыты RLS так же, как в 0008.

create table if not exists person (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  display_name text,
  role text,
  employer_id uuid references employer(id) on delete set null,
  notes text,
  -- Проигравший при слиянии не удаляется: ссылка ведёт на победителя.
  merged_into_id uuid references person(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists person_user_idx on person (user_id) where merged_into_id is null;
create index if not exists person_employer_idx on person (employer_id) where employer_id is not null;
create index if not exists person_merged_into_idx on person (merged_into_id) where merged_into_id is not null;

-- --------------------------------------------------------------------------
-- contact: привязка к человеку и стабильный числовой id Telegram
-- --------------------------------------------------------------------------

alter table contact add column if not exists person_id uuid references person(id) on delete set null;
alter table contact add column if not exists person_link text;

alter table contact drop constraint if exists contact_person_link_check;
alter table contact add constraint contact_person_link_check
  check (person_link is null or person_link in ('auto', 'suggested', 'manual'));

create index if not exists contact_person_idx on contact (person_id) where person_id is not null;

alter table contact drop constraint if exists contact_kind_check;
alter table contact add constraint contact_kind_check
  check (kind in ('email', 'telegram', 'telegram_id', 'phone', 'hh_chat', 'other'));

-- --------------------------------------------------------------------------
-- conversation: человек, с которым идёт диалог
-- --------------------------------------------------------------------------

alter table conversation add column if not exists person_id uuid references person(id) on delete set null;

create index if not exists conversation_person_idx on conversation (person_id) where person_id is not null;

-- Ссылка на вакансию hh, которой ещё нет в базе: разрешается, когда вакансия
-- появится (поиск или гидрация).
create table if not exists conversation_vacancy_ref (
  user_id text not null references "user"(id) on delete cascade,
  conversation_id uuid not null references conversation(id) on delete cascade,
  source text not null default 'hh',
  external_id text not null,
  evidence text,
  created_at timestamptz not null default now(),
  primary key (conversation_id, external_id)
);

create index if not exists conversation_vacancy_ref_external_idx
  on conversation_vacancy_ref (user_id, source, external_id);

-- Резюме, о котором шёл диалог, с уверенностью и источником вывода.
create table if not exists conversation_resume (
  user_id text not null references "user"(id) on delete cascade,
  conversation_id uuid not null references conversation(id) on delete cascade,
  resume_id uuid not null references resume(id) on delete cascade,
  confidence double precision,
  source text,
  evidence text,
  created_at timestamptz not null default now(),
  primary key (conversation_id, resume_id)
);

create index if not exists conversation_resume_resume_idx on conversation_resume (resume_id);

-- --------------------------------------------------------------------------
-- Собственные контакты соискателя (hh.ru/applicant/profile/me). Нужны, чтобы
-- не принять свой телефон или email за контакт собеседника.
-- --------------------------------------------------------------------------

create table if not exists hh_account_contact (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid not null references hh_account(id) on delete cascade,
  kind text not null check (kind in ('phone', 'email', 'telegram')),
  value text not null,
  raw text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (hh_account_id, kind, value)
);

create index if not exists hh_account_contact_user_idx on hh_account_contact (user_id);

-- Какой аккаунт Telegram принадлежит какому аккаунту hh (одному человеку).
create table if not exists telegram_account_hh_account (
  user_id text not null references "user"(id) on delete cascade,
  telegram_account_id uuid not null references telegram_account(id) on delete cascade,
  hh_account_id uuid not null references hh_account(id) on delete cascade,
  source text not null check (source in ('auto', 'manual')),
  created_at timestamptz not null default now(),
  primary key (telegram_account_id, hh_account_id)
);

create index if not exists telegram_account_hh_account_hh_idx
  on telegram_account_hh_account (hh_account_id);

-- --------------------------------------------------------------------------
-- updated_at-триггер для таблицы, где есть колонка
-- --------------------------------------------------------------------------

do $$
declare
  t text;
  updated text[] := array['person'];
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
-- RLS: каждая строка принадлежит ровно одному пользователю
-- --------------------------------------------------------------------------

do $$
declare
  t text;
  personal text[] := array[
    'person', 'conversation_vacancy_ref', 'conversation_resume',
    'hh_account_contact', 'telegram_account_hh_account'
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
