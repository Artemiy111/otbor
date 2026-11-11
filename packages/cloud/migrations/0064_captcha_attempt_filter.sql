-- Какой фильтр применили к картинке капчи перед моделью: по журналу видно,
-- помогает ли подготовка картинки. `none` - модель получила оригинал (так же
-- помечены все попытки, сделанные до появления фильтров).
alter table captcha_attempt add column if not exists filter text not null default 'none';
alter table captcha_attempt drop constraint if exists captcha_attempt_filter_check;
alter table captcha_attempt
  add constraint captcha_attempt_filter_check check (filter in ('none', 'normalize'));
