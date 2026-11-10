-- Происхождение исключения: кнопка «Отбраковать» и ручная форма раньше писали
-- одинаковое `source = 'user'`. Новое значение `reject` пишет только путь
-- отбраковки вакансии (VacancyReject).

alter table hidden_target drop constraint if exists hidden_target_source_check;
alter table hidden_target add constraint hidden_target_source_check
  check (source in ('user', 'reject', 'hh_hidden'));

-- Честная дозаполнение: слой `resume` до этой миграции создавался только
-- отбраковкой (ручная форма его не принимала), поэтому такие строки точно
-- от кнопки. Строки слоёв `app` и `hh_account` с типом vacancy могли прийти и
-- от кнопки, и из формы: различить их по данным нельзя, они остаются `user`.
update hidden_target
set source = 'reject'
where scope = 'resume' and source = 'user';
