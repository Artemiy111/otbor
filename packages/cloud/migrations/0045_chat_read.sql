-- `chat_read` fetches one hh chat (chatik.hh.ru) with the account's session.
alter table harness_jobs drop constraint if exists harness_jobs_stage_check;
alter table harness_jobs
  add constraint harness_jobs_stage_check
  check (stage in (
    'prepare', 'submit', 'reconcile', 'session', 'inference',
    'negotiations_sync', 'resume_sync', 'form_read', 'letter_attach', 'chat_read'
  ));
