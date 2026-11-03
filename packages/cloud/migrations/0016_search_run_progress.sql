-- Track live search progress so the UI can show which page is being crawled.

alter table search_run add column if not exists current_page integer;
alter table search_run add column if not exists pages_total integer;

update search_run
set current_page = greatest(coalesce(next_page, 0) - 1, 0)
where current_page is null;
