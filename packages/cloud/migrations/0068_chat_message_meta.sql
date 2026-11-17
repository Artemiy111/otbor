-- Дополнительные факты о сообщении чата hh, которые раньше терялись в парсере.
--
-- `is_bot` — признак отправителя-бота, который сообщил hh; у почты и Telegram
-- поля нет, поэтому колонка nullable. `author_id` — id участника внутри чата:
-- он не стабилен между чатами и используется только для разбора одного чата.
-- `reply_options` — тексты кнопок-вариантов ответа, которые hh прикладывает
-- к сообщению; они нужны для режима выбора готового варианта.

alter table conversation_message
  add column if not exists author_id text,
  add column if not exists is_bot boolean,
  add column if not exists reply_options jsonb not null default '[]'::jsonb;

-- Частый запрос: выбрать сообщения ботов по пользователю и чату, чтобы найти
-- вопросы без ответа. Обычный индекс по (user_id, conversation_id, sent_at)
-- не помог бы — большинство сообщений не от ботов.
create index if not exists conversation_message_bot_idx
  on conversation_message (user_id, conversation_id, sent_at)
  where is_bot is true;
