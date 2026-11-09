-- Cookies аккаунта hh.ru (Playwright storageState) живут в облаке, а не в
-- профиле Chrome на диске харнесса.
--
-- Профиль Chrome запирается одним процессом (SingletonLock), поэтому два
-- харнесса или контейнер после пересоздания не могли открыть один аккаунт.
-- Теперь харнесс на каждую задачу берёт состояние отсюда, открывает обычный
-- изолированный контекст и возвращает обновлённые cookies.
--
-- `ciphertext` зашифрован на стороне облака (AES-256-GCM), в базе открытых
-- cookies нет. `version` растёт на каждой записи: запись с устаревшей версией
-- отклоняется, чтобы параллельная задача не затёрла более свежие cookies.
create table if not exists hh_account_session_state (
  hh_account_id uuid primary key references hh_account(id) on delete cascade,
  user_id text not null references "user"(id) on delete cascade,
  ciphertext text not null,
  version integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now()
);

alter table hh_account_session_state enable row level security;
drop policy if exists hh_account_session_state_owner on hh_account_session_state;
create policy hh_account_session_state_owner on hh_account_session_state
  using (user_id = nullif(current_setting('app.user_id', true), ''))
  with check (user_id = nullif(current_setting('app.user_id', true), ''));
grant select, insert, update, delete on hh_account_session_state to otbor_runtime;
