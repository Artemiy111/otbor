-- A scheduled run records why it stopped without disturbing the neighbour
-- schedules. The worker writes this after the crawl; a successful run clears it.
alter table schedule add column if not exists last_error text;
