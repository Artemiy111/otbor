-- What a harness can run: ACP agents, their models and efforts, as the harness
-- itself probed them. The cloud never starts an agent; it only stores this and
-- lets the web app offer a choice.
alter table harness add column if not exists catalog jsonb;
alter table harness add column if not exists catalog_at timestamptz;
