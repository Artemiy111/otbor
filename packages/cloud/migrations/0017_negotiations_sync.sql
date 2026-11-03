-- Imported applications: responses the operator made by hand on hh.ru, read
-- from /applicant/negotiations. Existing rows are otbor's own.

alter table application
  add column if not exists origin text not null default 'otbor';
alter table application drop constraint if exists application_origin_check;
alter table application
  add constraint application_origin_check check (origin in ('otbor', 'imported'));

-- hh's own negotiation state (RESPONSE, INVITATION, DISCARD, ...) and the date
-- of the last change hh shows. Null for applications otbor never re-read.
alter table application add column if not exists hh_status text;
alter table application add column if not exists hh_responded_at timestamptz;

-- The negotiations sync is a browser job without an application.
alter table harness_jobs drop constraint if exists harness_jobs_stage_check;
alter table harness_jobs
  add constraint harness_jobs_stage_check
  check (stage in ('prepare', 'submit', 'reconcile', 'session', 'inference', 'negotiations_sync'));
