-- Выключатель анализа вакансий локальной моделью (SystemOne). Когда он
-- выключен, расписания `analysis` завершаются без обращения к модели.
-- Настройка живёт в user_settings и действует без перезапуска.
alter table user_settings
  add column if not exists analysis_enabled boolean not null default true;
