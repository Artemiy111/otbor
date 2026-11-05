-- Which ACP agent, model and effort write the auto-apply letters and answers.
-- Null means the harness default. These steer the writer only: they never
-- change a verdict or fit, so they do not make decisions stale.
alter table apply_filter add column if not exists writing_harness text;
alter table apply_filter add column if not exists writing_model text;
alter table apply_filter add column if not exists writing_effort text;
