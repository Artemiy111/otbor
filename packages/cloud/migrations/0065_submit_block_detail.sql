-- Предохранитель отправок: аккаунт встаёт на паузу не только после капчи, но и
-- когда исполнитель браузера много раз подряд получает один и тот же
-- детерминированный отказ (`repeated_failure`). Текст последнего отказа
-- хранится рядом, чтобы показать его человеку.
alter table hh_account add column if not exists submit_block_detail text;

alter table hh_account drop constraint if exists hh_account_submit_block_reason_check;
alter table hh_account
  add constraint hh_account_submit_block_reason_check
  check (submit_block_reason is null or submit_block_reason in ('captcha', 'repeated_failure'));
