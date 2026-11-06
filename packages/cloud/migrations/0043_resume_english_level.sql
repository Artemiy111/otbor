-- English level as the resume states it (hh language block), e.g. "B2".
alter table resume add column if not exists english_level text;
