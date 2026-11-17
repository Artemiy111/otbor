-- Язык капчи в журнале: по нему видно, на каком языке была капча и решил ли её харнес.
-- Старые строки до миграции считаются английскими (так работал решатель раньше).
alter table captcha_attempt add column if not exists language text not null default 'en';

alter table captcha_attempt drop constraint if exists captcha_attempt_language_check;
alter table captcha_attempt
  add constraint captcha_attempt_language_check check (language in ('en', 'ru'));
