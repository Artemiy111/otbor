-- Автоотправка только с сопроводительным письмом: переключатель строки apply
-- filter. По умолчанию выключен, поведение прежнее. Ручное одобрение
-- оператором письмо не требует.
alter table apply_filter
  add column if not exists require_letter boolean not null default false;
