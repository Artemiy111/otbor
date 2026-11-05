-- The cover letter an operator is writing for a response hh already holds.
-- It belongs to the response (account + vacancy + resume), not to an otbor
-- application: the response may have been made on hh.ru directly, and every
-- resume of the same vacancy has its own response and its own chat.
-- A null resume is stored as the nil uuid so the key stays unique.
create table if not exists letter_draft (
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid not null references hh_account(id) on delete cascade,
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  resume_id uuid not null default '00000000-0000-0000-0000-000000000000',
  letter text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, hh_account_id, vacancy_id, resume_id)
);

alter table letter_draft enable row level security;

drop policy if exists letter_draft_owner on letter_draft;
create policy letter_draft_owner on letter_draft
  using (user_id = nullif(current_setting('app.user_id', true), ''))
  with check (user_id = nullif(current_setting('app.user_id', true), ''));

grant select, insert, update, delete on letter_draft to otbor_runtime;
