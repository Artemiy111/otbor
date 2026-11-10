-- Отбраковка вакансии: «на неё не слать автоотклики».
--
-- Это строка `hidden_target` с типом `vacancy` в одном из трёх слоёв:
--   * `app`        — все резюме всех hh-аккаунтов пользователя;
--   * `hh_account` — все резюме одного hh-аккаунта;
--   * `resume`     — одно резюме (новый слой).
--
-- Слой `resume` несёт `resume_id` и не несёт `hh_account_id`: аккаунт резюме
-- известен из самой таблицы `resume`.

alter table hidden_target
  add column if not exists resume_id uuid references resume(id) on delete cascade;

alter table hidden_target drop constraint if exists hidden_target_scope_check;
alter table hidden_target add constraint hidden_target_scope_check
  check (scope in ('app', 'hh_account', 'hh_native', 'resume'));

alter table hidden_target drop constraint if exists hidden_target_scope_account_check;
alter table hidden_target add constraint hidden_target_scope_account_check
  check (
    (scope = 'app' and hh_account_id is null and resume_id is null)
    or (scope in ('hh_account', 'hh_native') and hh_account_id is not null and resume_id is null)
    or (scope = 'resume' and hh_account_id is null and resume_id is not null)
  );

-- Одна отбраковка на резюме и вакансию.
create unique index if not exists hidden_target_resume_unique_idx
  on hidden_target (resume_id, type, external_id)
  where scope = 'resume';
