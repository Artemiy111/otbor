-- Переименование устройства, арендующего задачи: харнес -- это обёртка над
-- ИИ-агентом, а локальный процесс теперь называется раннером.
-- RLS-политики привязаны к таблице и сохраняются при её переименовании.

alter table if exists harness rename to runner;
alter table if exists harness_account rename to runner_account;
alter table if exists harness_jobs rename to runner_jobs;

-- Id устройства в bindings и журнале попыток.
alter table runner_account rename column harness_id to runner_id;
alter table application_attempt rename column harness_id to runner_id;

-- Первичный ключ и ограничение стадий: у ограничений тоже меняем имена.
alter table runner_account rename constraint harness_account_pkey to runner_account_pkey;
alter table runner_jobs rename constraint harness_jobs_stage_check to runner_jobs_stage_check;

-- Индексы при переименовании таблицы сохраняют старые имена.
alter index if exists harness_user_idx rename to runner_user_idx;
alter index if exists harness_account_single_idx rename to runner_account_single_idx;
alter index if exists harness_jobs_claim_idx rename to runner_jobs_claim_idx;
alter index if exists harness_jobs_account_idx rename to runner_jobs_account_idx;
alter index if exists harness_jobs_application_idx rename to runner_jobs_application_idx;
alter index if exists harness_jobs_lease_idx rename to runner_jobs_lease_idx;
alter index if exists harness_jobs_submit_leased_idx rename to runner_jobs_submit_leased_idx;

-- Настройка числа потоков тоже следует за новым именем процесса.
alter table user_settings rename column harness_slots to runner_slots;
alter table user_settings rename constraint user_settings_harness_slots_check to user_settings_runner_slots_check;
