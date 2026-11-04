-- An hh account can have several resumes in use at once, and one vacancy can
-- get an application per resume, so "one active resume per account" goes away.
drop index if exists resume_one_active_idx;
create index if not exists resume_account_active_idx on resume (hh_account_id) where is_active;
