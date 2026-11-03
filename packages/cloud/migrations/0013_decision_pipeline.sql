-- Pipeline stage: batch evaluation, server-side ranking, evaluate schedules.

-- The vacancy content a decision was made for. A vacancy whose content_hash
-- differs from the latest decision's value (new crawl card, hydration) needs a
-- new decision. Rows from before this column read as stale once; the next
-- evaluation fills the value in without writing a second row.
alter table decision add column if not exists vacancy_content_hash text;

-- "Latest decision per vacancy" and the staleness anti-join.
create index if not exists decision_user_vacancy_idx
  on decision (user_id, vacancy_id, created_at desc);

-- Ranking: best first, for the whole user history and for the apply queue.
create index if not exists decision_user_priority_idx
  on decision (user_id, priority desc, created_at desc);

alter table schedule drop constraint if exists schedule_kind_check;
alter table schedule add constraint schedule_kind_check
  check (kind in (
    'search',
    'source',
    'vacancy_hydration',
    'employer_hydration',
    'mail_sync',
    'telegram_sync',
    'hh_chat_sync',
    'evaluate'
  ));
