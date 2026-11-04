-- The resume sync is a browser job without an application: it reads the
-- account's resumes from hh.ru. It can also run on a schedule.

alter table harness_jobs drop constraint if exists harness_jobs_stage_check;
alter table harness_jobs
  add constraint harness_jobs_stage_check
  check (stage in ('prepare', 'submit', 'reconcile', 'session', 'inference', 'negotiations_sync', 'resume_sync'));

alter table schedule drop constraint if exists schedule_kind_check;
alter table schedule add constraint schedule_kind_check
  check (kind in (
    'search',
    'source',
    'vacancy_hydration',
    'employer_hydration',
    'mail_sync',
    'telegram_sync',
    'hh_chat_sync',
    'evaluate',
    'fit',
    'resume_sync'
  ));
