-- Link each hh.ru account to a local session profile (cookie jar) name.
-- The profile name is a local secret-ish identifier; it is never a credential
-- and never stored in Postgres as a secret. NULL means "use the default jar".

alter table hh_account add column if not exists session_profile text;
