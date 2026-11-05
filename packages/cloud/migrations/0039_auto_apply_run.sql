-- The `apply` schedule kind and the durable marker of the auto-apply runner.
--
-- `application.auto_run` is set only when AutoApplyRunner created the
-- application ('drafts' or 'auto', the apply filter mode at that moment). The
-- runner progresses (writes the letter, stores the kit) only applications that
-- carry it, so an application made by hand is never touched.
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
    'analysis',
    'apply'
  ));

alter table application add column if not exists auto_run text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'application_auto_run_check') then
    alter table application add constraint application_auto_run_check
      check (auto_run is null or auto_run in ('drafts', 'auto'));
  end if;
end $$;

create index if not exists application_auto_run_idx
  on application (user_id, state)
  where auto_run is not null;
