-- Идентификаторы всей системы — UUIDv7: контракт проверяет версию при кодировании
-- ответа RPC, поэтому одна строка с видом отличным от 7 ломает весь список
-- (например, `ScheduleRunsList` на странице очередей падает на 200-й записи).
-- Такие строки появляются только как мусор тестов/ручных вставок: легальный путь
-- всегда получает id из `uuidv7()` в базе. Удаляем их, каскадные внешние ключи
-- убирают зависимые запуски этих расписаний и поисковых запросов.

delete from schedule_run where substring(id::text, 15, 1) <> '7';
delete from search_run where substring(id::text, 15, 1) <> '7';
delete from schedule where substring(id::text, 15, 1) <> '7';
delete from search_query where substring(id::text, 15, 1) <> '7';
