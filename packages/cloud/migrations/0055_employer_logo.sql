-- Логотипы работодателей, сохранённые в базе (`employer_logo`).
--
-- Раньше веб каждый раз грузил картинку с CDN hh. Теперь облако один раз
-- скачивает логотип, при необходимости ужимает его и хранит байты в Postgres,
-- а веб берёт их у себя. Таблица отдельная: тяжёлые байты не попадают в
-- обычные выборки `employer`. Корпус общий, поэтому строк пользователей и RLS нет.

create table if not exists employer_logo (
  employer_id uuid primary key references employer(id) on delete cascade,
  -- Адрес, с которого скачано. Если `employer.logo_url` стал другим, логотип качается заново.
  source_url text not null,
  content_type text not null,
  bytes bytea not null,
  byte_size integer not null,
  -- Сколько весил оригинал до сжатия.
  original_byte_size integer not null,
  width integer,
  height integer,
  fetched_at timestamptz not null default now()
);

grant select, insert, update, delete on employer_logo to otbor_runtime;
