-- One account may apply to the same vacancy with different resumes, so the
-- uniqueness moves from (account, vacancy) to (account, vacancy, resume).
-- NULLS NOT DISTINCT keeps "no known resume" (imported applications) to a
-- single row per vacancy instead of letting duplicates through.
alter table application drop constraint if exists application_hh_account_id_vacancy_id_key;
drop index if exists application_account_vacancy_idx;

create unique index if not exists application_account_vacancy_resume_idx
  on application (hh_account_id, vacancy_id, resume_id) nulls not distinct;
