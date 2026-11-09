-- Решения пересчитываются по расписанию для каждой пары (аккаунт, резюме).
--
-- Раньше пересчёт без явного аккаунта брал аккаунт по умолчанию, поэтому
-- остальные аккаунты не получали свежих решений, а автоотбор, читающий только
-- текущие решения, не находил кандидатов. Теперь `evaluate` с целью `global`
-- обходит все аккаунты с фильтром. Заводим такое расписание каждому пользователю,
-- у которого его ещё нет (раз в 30 минут), и запускаем сразу.
insert into schedule (user_id, kind, target_id, interval_minutes, options, enabled, next_run_at)
select u.id, 'evaluate', 'global', 30, '{}'::jsonb, true, now()
from "user" u
where exists (select 1 from hh_account a where a.user_id = u.id)
  and not exists (
    select 1 from schedule s
    where s.user_id = u.id and s.kind = 'evaluate' and s.enabled
  );
