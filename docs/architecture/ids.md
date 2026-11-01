# otbor: формат идентификаторов

Статус: решение. Дата: 31.10.2026.

База: **Postgres 18**. Используем встроенный `uuidv7()`, без расширений.

## Решение

1. **Один ID.** Внутренний и внешний идентификатор — одно и то же значение:
   UUIDv7. Двух представлений и маппинга нет.
2. **В БД** — `uuid default uuidv7()`, внешние ключи тоже `uuid`.
3. **В контракте** — брендированные схемы поверх UUIDv7: `VacancyId`,
   `ApplicationId`, `HarnessJobId`. Тип ловится компилятором, формат — схемой.
4. **Префиксов нет.** Ни в БД, ни в RPC, ни в URL.
5. **Внешние ID вендоров** — отдельные branded-строки, не PK:
   `hh_id`, `telegram_chat_id`, `rfc_message_id`.
6. **Better Auth** не трогаем: его `user.id`/`session.id` остаются `text`.
7. **`bigint identity`** — только для внутренних append-only таблиц и только
   по метрикам, не заранее.

## Почему один ID, а не «внутренний + публичный»

Разделение выглядит безопаснее, но в `otbor` не окупается.

Что оно даёт:

- нельзя передать `applicationId` туда, где ждут `vacancyId`;
- в логах и тикетах видно тип сущности без контекста;
- можно поменять формат публичного ID, не трогая PK.

Что стоит:

- **две правды об одной строке**: в `psql` один вид, в UI другой, и каждый
  раз надо переводить в голове;
- ID из лога нельзя скопировать в запрос — надо отрезать префикс;
- в `jsonb`-payload, job-конверте и MCP-аргументах одна форма, в URL другая;
- забытый decode даёт не падение, а пустую выдачу или `ValidationError`
  на ровном месте;
- каждый новый роут и инструмент — ещё одно место, где можно перепутать.

При этом главную защиту — «не передать чужой ID» — дают бренды, а не префикс.
Бренд работает в компиляторе и не требует второго представления.

Префикс оправдан там, где тип нельзя вывести из контекста: публичный API для
сторонних разработчиков, вебхуки, payload между сервисами, поддержка по
скриншотам. У нас один сервис, свои клиенты и общий контракт, поэтому префикс
не даёт ничего сверх бренда.

## Почему UUIDv7

- время-упорядоченный: вставки идут в конец индекса, без фрагментации UUIDv4;
- 16 байт и нативный тип `uuid` в Postgres;
- генерируется в приложении, в воркере и на edge без координации;
- не раскрывает количество записей, в отличие от `bigint identity`;
- хорошо ложится на Drizzle и Effect Schema.

Postgres 18 даёт `uuidv7()` прямо в БД:

```sql
create table vacancies (
  id uuid primary key default uuidv7(),
  ...
);
```

Приложение тоже может генерировать UUIDv7 (Bun: `Bun.randomUUIDv7()`) — это
нужно для тестов, офлайн-сценариев и edge-воркеров. Оба пути дают один формат.

## Effect Schema

`UuidV7` — проверка формата, бренд — про тип сущности:

```ts
export const UuidV7 = Schema.String.pipe(Schema.check(Schema.isUUID(7)))

export const VacancyId = UuidV7.pipe(Schema.brand("VacancyId"))
export const ApplicationId = UuidV7.pipe(Schema.brand("ApplicationId"))
export const HarnessJobId = UuidV7.pipe(Schema.brand("HarnessJobId"))
```

Внутри сервисов и репозиториев — брендированные типы. На границе (RPC, CLI,
MCP, HTTP) схема декодирует строку один раз, и дальше по коду идёт уже
`ApplicationId`, а не `string`.

Важно понимать, что даёт что:

- **бренд** — ошибку компиляции, если перепутать два ID;
- **`isUUID(7)`** — отказ на входе, если пришла не та строка;
- **бренд не защищает от подмены** двух валидных UUID одного типа. Это
  принимается: оба сценария — баг в коде, а не атака, и его видно на тестах.

## Drizzle

```ts
export const vacancies = pgTable("vacancies", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  hhId: text("hh_id").notNull(),
  // ...
})
```

Для join-таблиц:

```ts
export const vacancyKeywords = pgTable("vacancy_keyword", {
  vacancyId: uuid("vacancy_id")
    .notNull()
    .references(() => vacancies.id, { onDelete: "cascade" }),
  keywordId: uuid("keyword_id")
    .notNull()
    .references(() => keywords.id, { onDelete: "cascade" }),
  matchedForm: text("matched_form").notNull(),   // форма входит в ключ
  aliasId: uuid("alias_id").references(() => keywordAliases.id, {
    onDelete: "set null",
  }),
}, (t) => [
  primaryKey({ columns: [t.vacancyId, t.keywordId, t.matchedForm] })
])
```

Схемы строк выводятся через `drizzle-orm/effect-schema`; бренд навешивается
на уровне контракта, а не в схеме таблицы.

## Внешние ID вендоров

Никогда не использовать ID вендора как PK:

- hh может изменить/переиспользовать ID;
- Telegram chat id бывает отрицательным и большим;
- RFC Message-ID — строка, а не UUID.

Схема:

```
vacancy.id           uuid PK
vacancy.source       'hh'
vacancy.external_id  '138836540'
unique (source, external_id)
```

Branded-типы:

```ts
export const HhVacancyId = Schema.String.pipe(Schema.brand("HhVacancyId"))
export const TelegramChatId = Schema.String.pipe(Schema.brand("TelegramChatId"))
export const RfcMessageId = Schema.String.pipe(Schema.brand("RfcMessageId"))
```

Хранить их как `text`, не парсить в `number` без необходимости.

## Очередь и workflow

- `harness_job.id` — UUIDv7;
- `lease_id` — UUIDv7, для fencing;
- `application_id` — UUIDv7 FK;
- `application_attempt.id` — UUIDv7;
- `idempotency_key` — стабильная строка:
  `apply:<applicationId>:<kitHash>`.

`idempotency_key` — не ID сущности, а бизнес-ключ. Его уникальность важнее
формата.

## Где ID появляется наружу

- **URL** — `/applications/<uuid>`; тип задаёт роут.
- **MCP-инструменты** — имя инструмента: `application_approve`,
  `vacancy_get`; аргумент — обычный UUID.
- **CLI** — аргумент UUID, тип из имени команды.
- **Логи и спаны** — `application.id` как атрибут, а не как строка в
  сообщении. Тогда тип виден в трейсе и не требует префикса.
- **Ошибки** — «application not found: <uuid>», без догадок о типе.

## Better Auth

Better Auth генерирует свои `user.id` и `session.id` (обычно `text`).
Не менять их на UUID и не перекраивать auth-таблицы. В домене:

```sql
user_id text not null
```

## Правила

1. Один ID — UUIDv7, внутри и снаружи.
2. Бренд на каждую сущность, один формат `isUUID(7)`.
3. Никаких последовательных публичных ID.
4. Внешние ID вендоров — только `external_id` + `source`.
5. ID не является авторизацией: доступ проверяется по `user_id`/RLS.
6. Не хранить секреты и cookies в ID/payload.
7. `bigint` — только для внутренних журналов, если понадобится.
8. Префикс в БД не попадает ни при каких условиях.

## Миграция

Старые ID вида `hh:138836540` не переиспользуем. В новой схеме:

- `vacancy.id` — UUIDv7;
- `vacancy.external_id` — старый hh id;
- при необходимости — таблица `legacy_id_map(old_id, entity, new_id)`.

Это позволяет импортировать данные из `hh-extracter` без изменения контракта.

## Открытые вопросы

- Использовать ли компактный base32 вместо UUID-строки в URL? По умолчанию —
  стандартный UUID, удобнее для инструментов.
- Нужна ли колонка `public_id`? По умолчанию — нет, это вторая правда.
- Когда вводить `bigint` для `application_attempt`/`job_attempt`? Только по
  метрикам, не заранее.
