-- hh keeps a separate response, and a separate chat, for every resume used on
-- a vacancy. The negotiations list names that chat (`chatId`), which is the
-- only way to address one response of several, for example to add a cover
-- letter to it. Nullable: rows that sync has not seen again yet have none.
alter table application add column if not exists hh_chat_id text;
