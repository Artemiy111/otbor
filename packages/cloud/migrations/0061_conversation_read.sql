-- Локальное состояние «прочитано» у диалога.
--
-- `unread_count` пишет синк источника (Telegram перезаписывает его на каждом
-- проходе, у почты и чата hh он всегда 0), поэтому отметка оператора хранится
-- отдельно и синк её не трогает:
--   read_at         - до какого входящего сообщения оператор дочитал (его sent_at);
--                     входящие новее считаются непрочитанными;
--   marked_unread   - ручная отметка «непрочитано» без новых сообщений.
-- Непрочитанные считаются выражением в ConversationRepository.unreadExpr.

alter table conversation add column if not exists read_at timestamptz;
alter table conversation add column if not exists marked_unread boolean not null default false;

-- Существующие диалоги почты и чата hh раньше всегда показывали 0 непрочитанных:
-- считаем их прочитанными по последнее входящее, чтобы после миграции не
-- всплыла вся история. Telegram остаётся с read_at = null и значением источника.
update conversation c
set read_at = coalesce(
  (select max(m.sent_at) from conversation_message m
   where m.conversation_id = c.id and m.direction = 'in'),
  now()
)
where c.channel <> 'telegram' and c.read_at is null;
