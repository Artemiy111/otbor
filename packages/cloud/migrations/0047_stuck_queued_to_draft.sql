-- Старые `retry` и `apply create --auto` оставляли ручные заявки и черновики в
-- `queued` без слота (`intent_at is null`) и без submit-задачи. Автозаявки
-- миграция 0046 уже перевела в `preparing`; этих никто не обслуживает, а
-- approve и retry отказывают для `queued`. Возвращаем их в `draft`.
update application a
set state = 'draft',
    last_error = 'the application was stuck in the queue without a submit job; it is a draft again, approve it to send',
    blocked_reason = null,
    retry_at = null,
    updated_at = now()
where a.state = 'queued'
  and a.intent_at is null
  and a.auto_run is distinct from 'auto'
  and not exists (
    select 1 from harness_jobs j
    where j.application_id = a.id and j.stage = 'submit'
  );
