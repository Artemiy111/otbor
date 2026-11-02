-- The blacklist is a soft filter and a label, never a corpus delete.
--
-- One row is one hidden target at one of three layers:
--   * `app`        — the user's own list, applies to every hh account;
--   * `hh_account` — an extra list for one hh account;
--   * `hh_native`  — imported from hh's own "hidden" mechanism.
--
-- `hidden_target` already existed for hh-account-scoped rows, so this migration
-- extends it instead of introducing a parallel blacklist table.

alter table hidden_target alter column hh_account_id drop not null;

alter table hidden_target add column if not exists scope text not null default 'hh_account';
alter table hidden_target add column if not exists source text not null default 'user';
alter table hidden_target add column if not exists reason text;
alter table hidden_target add column if not exists last_seen_at timestamptz;
alter table hidden_target add column if not exists updated_at timestamptz not null default now();

alter table hidden_target drop constraint if exists hidden_target_scope_check;
alter table hidden_target add constraint hidden_target_scope_check
  check (scope in ('app', 'hh_account', 'hh_native'));

alter table hidden_target drop constraint if exists hidden_target_source_check;
alter table hidden_target add constraint hidden_target_source_check
  check (source in ('user', 'hh_hidden'));

-- App rows are owned by the user and carry no hh account. Account and native
-- rows always belong to one account.
alter table hidden_target drop constraint if exists hidden_target_scope_account_check;
alter table hidden_target add constraint hidden_target_scope_account_check
  check (
    (scope = 'app' and hh_account_id is null)
    or (scope in ('hh_account', 'hh_native') and hh_account_id is not null)
  );

-- One target per layer. The pre-existing `hidden_target_unique_idx` stays in
-- place for rows created before scopes existed; it also keeps account/native
-- rows unique because NULL account ids never collide in a unique index.
create unique index if not exists hidden_target_app_unique_idx
  on hidden_target (user_id, type, external_id)
  where scope = 'app';

create unique index if not exists hidden_target_account_scope_unique_idx
  on hidden_target (hh_account_id, type, external_id)
  where scope in ('hh_account', 'hh_native');

drop trigger if exists hidden_target_updated_at on hidden_target;
create trigger hidden_target_updated_at
  before update on hidden_target
  for each row execute function set_updated_at();
