-- A running schedule_run proves it is alive by touching heartbeat_at. A run
-- whose heartbeat stopped (worker killed, process restarted) is dead within
-- minutes instead of looking busy for 45, and cannot block the next run.
alter table schedule_run add column if not exists heartbeat_at timestamptz;
create index if not exists schedule_run_running_kind_idx on schedule_run (kind) where status = 'running';
