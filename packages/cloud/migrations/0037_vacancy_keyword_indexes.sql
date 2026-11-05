-- The keywords page counts vacancies per keyword (twice per row, plus an
-- EXISTS for presets) and groups match stats by keyword. The primary key leads
-- with vacancy_id, and the partial title/body indexes only help when a
-- location is chosen, so the default "any location" count and the skills count
-- scanned the whole table once per keyword.
--
-- (keyword_id, vacancy_id) makes every `where keyword_id = $1` count and join
-- to vacancy an index-only range scan; the skills index does the same for the
-- always-on skills count.
create index if not exists vacancy_keyword_keyword_vacancy_idx
  on vacancy_keyword (keyword_id, vacancy_id);
create index if not exists vacancy_keyword_skills_idx
  on vacancy_keyword (keyword_id, vacancy_id) where in_skills;

analyze vacancy_keyword;
