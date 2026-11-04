-- The `analysis` schedule kind: a bounded pass of the vacancy analysis.
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
    'resume_sync',
    'analysis'
  ));
