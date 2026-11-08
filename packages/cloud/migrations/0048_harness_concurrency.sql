-- Харнесс сообщает свои потоки (`OTBOR_HARNESS_CONCURRENCY`) при каждом lease,
-- чтобы страница очереди показывала «потоки 5/6». null, пока он не сообщил.
alter table harness add column if not exists concurrency integer;
