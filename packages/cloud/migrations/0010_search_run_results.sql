-- Persist per-run ingestion counters so past crawl results can be shown.

alter table search_run add column if not exists inserted integer not null default 0;
alter table search_run add column if not exists updated integer not null default 0;
alter table search_run add column if not exists skipped integer not null default 0;
