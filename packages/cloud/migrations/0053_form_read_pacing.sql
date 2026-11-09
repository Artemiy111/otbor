-- Темп чтения формы отклика: капчи приходят и на чтения, а чтения шли пачками
-- по 20 в минуту без ограничения. Теперь чтения (`form_read`, `prepare`) идут
-- с потолком параллельности и паузой между стартами на аккаунт, как отправки.
-- Настройки живут в user_settings и действуют без перезапуска.
alter table user_settings
  add column if not exists form_read_concurrency integer not null default 2
    check (form_read_concurrency between 1 and 12),
  add column if not exists form_read_interval_seconds integer not null default 4
    check (form_read_interval_seconds between 0 and 600),
  add column if not exists form_read_jitter_percent integer not null default 100
    check (form_read_jitter_percent between 0 and 200),
  -- Пока аккаунт заблокирован капчей, пауза между чтениями умножается на это число.
  add column if not exists form_read_blocked_factor integer not null default 3
    check (form_read_blocked_factor between 1 and 20);

-- Когда аккаунт принимает следующее чтение формы (параллельно submit_next_at).
alter table hh_account add column if not exists form_read_next_at timestamptz;
