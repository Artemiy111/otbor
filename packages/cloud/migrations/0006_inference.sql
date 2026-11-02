-- Inference jobs share the harness queue with browser jobs.
--
-- `result` carries the typed output of an ACP prompt (text, model, usage).
-- The stage check is recreated because the original inline constraint only
-- knew prepare/submit/reconcile/session.

alter table harness_jobs add column if not exists result jsonb;

alter table harness_jobs drop constraint if exists harness_jobs_stage_check;
alter table harness_jobs
  add constraint harness_jobs_stage_check
  check (stage in ('prepare', 'submit', 'reconcile', 'session', 'inference'));
