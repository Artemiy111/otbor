-- `letter_attach` adds a cover letter to a response hh already holds. It is a
-- browser job on a vacancy, not on an application.
alter table harness_jobs drop constraint if exists harness_jobs_stage_check;
alter table harness_jobs
  add constraint harness_jobs_stage_check
  check (stage in (
    'prepare', 'submit', 'reconcile', 'session', 'inference',
    'negotiations_sync', 'resume_sync', 'form_read', 'letter_attach'
  ));
