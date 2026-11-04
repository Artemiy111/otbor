# otbor: переработка БД

Статус: черновик, не ADR. Дата: 31.10.2026.

Рамка: отсев пока простой, без ролей, тем, сфер и `era`. Ключевые слова
читаем в заголовке и теле вакансии. Сложность держим низкой. Всё, что
относится к авторизации (Better Auth), не трогаем.

Сейчас в `packages/db/src/schema.ts` 71 таблица и 21 миграция. Целевое ядро
около 43 таблиц: ядро отсева и отклика примерно 30, почта и Telegram ещё 13.
Почта и Telegram остаются и живут отдельным модулем, чтобы ядро от них не
зависело.

---

## 1. Правила

1. **Auth не трогаем.** `user`, `session`, `account`, `verification`,
   `apikey` остаются как есть, вместе с полями и миграциями Better Auth.
2. **Ключевые слова вместо ролей.** Нет `topics`, `vacancy_topics`,
   `topic_keywords`, нет ИИ-классификации сферы и роли. Есть словарь и
   совпадения.
3. **Заголовок и тело раздельно.** Для каждого совпадения видно, где оно
   найдено: в заголовке, в теле или в навыках hh, и сколько раз.
4. **`era`/`frontier` не храним.** У `keywords` убираются `era`, `era_score`,
   `era_note`, `era_source`, `era_rated_at`.
5. **Сферы не храним как классификацию.** Отрасли работодателя, если
   понадобятся, лежат в `employer.raw`/`industries` как сырые данные, а не
   как поле отсева.
6. **Postgres, а не SQLite.** Времена `timestamptz`, структуры `jsonb`,
   состояния `CHECK` или enum. Никаких ISO-строк вместо дат.
7. **Один агрегат приложения.** `application` + `application_kit` +
   `application_attempt`, без `drafts`/`tasks`/`applications` втроём.
8. **Auth-таблицы не переименовываем.** Переименование `applicant_profiles`
   в `hh_account` безопасно: это не Better Auth, а аккаунт hh.
9. **RLS везде, кроме auth.** Личные таблицы, включая дочерние, несут
   `user_id` и политику; общие только читаются рантаймом. Подробности в
   разделе 5.
10. **ID — UUIDv7, один на всё.** В БД `uuid`, наружу то же значение без
    префиксов; тип ловится брендом. Auth остаётся `text`, внешние id вендоров
    живут в `external_id`. Подробности в разделе 4 и в [ids.md](./ids.md).

---

## 2. Что не трогаем

| Таблица | Почему |
|---|---|
| `user` | Better Auth |
| `session` | Better Auth |
| `account` | Better Auth, провайдеры входа |
| `verification` | Better Auth |
| `apikey` | Better Auth plugin |
| `secrets` | наш сейф, не auth: шифрует cookies, пароли почты, Telegram |

Важно: `account` у Better Auth и аккаунт hh это разные вещи. Сейчас аккаунт
hh называется `applicant_profiles`, а в `applications`, `resumes`, `streams`
поле называется `profile_id`. Это главный источник путаницы. В новой схеме
аккаунт hh называется `hh_account`, а поле везде `hh_account_id`.

---

## 3. Инвентарь: что оставить, слить, выбросить

### Auth и сейф

| Таблица | Вердикт |
|---|---|
| `user`, `session`, `account`, `verification`, `apikey` | оставить без изменений |
| `secrets` | оставить |

### Корпус

| Таблица | Вердикт |
|---|---|
| `companies` | слить в `employer` |
| `employer_ratings` | слить в `employer` |
| `employer_profiles` | слить в `employer` (`raw jsonb` хранит остальное) |
| `vacancies` | оставить, почистить колонки (ниже) |
| `vacancy_snapshots` | оставить |
| `vacancy_response_samples` | оставить: скорость откликов нужна для приоритета |
| `vacancy_skills` | оставить: навыки hh не смешиваются со словарём |

### Словарь и совпадения

| Таблица | Вердикт |
|---|---|
| `keywords` | оставить, убрать `era*` |
| `keyword_aliases` | оставить, добавить `typo` |
| `vacancy_keywords` | переделать: строка на каждую встреченную форму, с местом и счётчиком |
| `vacancy_keyword_aliases` | слить в `vacancy_keyword` (`alias_id`, `matched_form`) |
| `topics` | выбросить |
| `topic_keywords` | выбросить |
| `vacancy_topics` | выбросить |

### Пресеты и обход

| Таблица | Вердикт |
|---|---|
| `presets` | оставить, добавить `kind = explore | apply`, `filter_json` → `jsonb` |
| `search_queries` | оставить |
| `profile_vacancies` | выбросить: «сохранённое» это состояние приложения, а не отдельная связь |
| `search_runs` | оставить |
| `vacancy_search_hits` | оставить |
| `crawl_schedules` | слить в `schedule` |
| `source_schedules` | слить в `schedule` (`kind = search | source`) |
| `schedule_runs` | оставить |

### Скрытие

| Таблица | Вердикт |
|---|---|
| `hidden_targets` | оставить |
| `hidden_rules` | оставить |
| `hidden_rule_targets` | оставить или свернуть в `targets jsonb` у правила |

### Соискатель

| Таблица | Вердикт |
|---|---|
| `applicant_profiles` | переименовать в `hh_account` |
| `resumes` | оставить |
| `resume_snapshots` | оставить |
| `resume_enrichments` | слить с `resume_experience_enrichments` в `resume_enrichment` |
| `resume_experience_enrichments` | слить в `resume_enrichment` |
| `resume_stats` | оставить, если статистика hh нужна в v1, иначе отложить |
| `resume_analyses` | отложить: без тем и ролей анализ резюме пока не к чему привязать |
| `profile_salary_expectations` | оставить |
| `profile_answer_facts` | оставить |
| `test_sessions` | оставить |
| `test_questions` | свернуть в `test_session.page jsonb` |
| `test_answers` | свернуть в `test_session.answers jsonb` |

### ИИ

| Таблица | Вердикт |
|---|---|
| `vacancy_ai_judgements` | оставить как `fit`, если ИИ-ранжирование включаем |
| `vacancy_ai_classifications` | выбросить |
| `vacancy_ai_keywords` | выбросить |
| `vacancy_ai_classification_jobs` | выбросить |
| `vacancy_ai_jobs` | выбросить: очередь даёт workflow/durable queue |

### Отклик

| Таблица | Вердикт |
|---|---|
| `applications` | слить в `application` |
| `application_drafts` | слить в `application` (`state = draft`) |
| `application_tasks` | выбросить: состоянием владеет durable workflow |
| `auto_response_rules` | выбросить: легаси, заменено `streams` |
| `streams` | оставить |
| `hh_account_sessions` | оставить как `hh_account_session` (cookies шифрованно) |
| `event_outbox` | выбросить, пока нет consumer |
| `cover_letters` | слить в `application_kit` |
| `llm_runs` | оставить как `inference_run` (стоимость и аудит) |
| `extractions` | выбросить: это лог, а не данные |

### Почта и Telegram (отдельный модуль)

| Таблица | Вердикт |
|---|---|
| `people`, `person_identities` | оставить |
| `conversations`, `conversation_vacancies`, `conversation_messages` | оставить |
| `telegram_accounts`, `resume_telegram_accounts` | оставить |
| `mail_accounts`, `mail_folders`, `mail_messages`, `mail_senders`, `mail_actions`, `resume_mail_accounts` | оставить |

Это 13 таблиц, которые к отсеву не относятся. Остаются отдельным модулем:
ядро отклика не импортирует их таблицы, а получает события через сервис.
Так почта и Telegram могут меняться, не задевая воронку.

---

## 4. Целевая схема ядра

### Идентификаторы

Внутри БД — `uuid` с UUIDv7, дефолт `uuidv7()` (Postgres 18). Это же значение
уходит наружу, в RPC, CLI и URL. Префиксов нет: тип сущности ловится брендом
в контракте (`VacancyId`, `ApplicationId`, `HarnessJobId`), а не строкой
`vac_...`. Полные правила в [ids.md](./ids.md).

Почему v7:

- вставки идут в конец индекса, без фрагментации, как у `bigint`;
- id генерируется в приложении и на edge-харнесе без координации с БД;
- не раскрывает количество записей, в отличие от `bigint identity`;
- один формат на все таблицы, без «тут text, там uuid».

Почему не «внутренний id плюс публичный с префиксом»: это две правды об одной
строке. ID из лога нельзя скопировать в `psql` без обрезки префикса, в
`jsonb`-payload одна форма, в URL другая, забытый decode даёт пустую выдачу
вместо падения. Защиту от путаницы даёт бренд в типах, а он работает в
компиляторе и второго представления не требует.

Исключения и границы:

- **Auth остаётся `text`.** `user.id`, `session.id` и остальные таблицы Better
  Auth не трогаем. В доменных таблицах `user_id text` это FK на auth, а не
  наш id.
- **Внешние id вендоров — не PK.** hh id, telegram chat id, RFC Message-ID
  лежат в `external_id text` рядом с `source`, уникальны парой
  `(source, external_id)`. В PK они не попадают никогда: вендор может
  переиспользовать id.
- **`idempotency_key` — не id.** Это бизнес-ключ вида
  `apply:<application_id>:<kit_hash>`, строка, и его уникальность важнее
  формата.
- **`bigint identity` — не сейчас.** Append-only журналы (`*_snapshot`,
  `application_attempt`) перейдут на него, только если упрёмся в размер
  индексов. По умолчанию везде UUIDv7.

Отдельной колонки `public_id` нет: она дублирует PK и требует ещё одного
уникального индекса. Если когда-нибудь понадобится сторонний API с другим
форматом id, это будет отдельное решение, а не запас на будущее.

```sql
-- Auth: user, session, account, verification, apikey — без изменений,
-- там id остаются text, как их генерирует Better Auth.

hh_account (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  label text,
  is_default boolean not null default false,
  first_name text, last_name text, email text, phone text, area_name text,
  created_at timestamptz not null, updated_at timestamptz not null
);

resume (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid not null references hh_account(id) on delete cascade,
  source text not null default 'hh',
  external_id text not null,
  hash text not null,              -- identity hh, не версия контента
  content_hash text,               -- версия содержимого
  title text not null,
  text text not null,
  about text not null default '',
  skills jsonb not null default '[]',
  experience jsonb not null default '[]',
  education jsonb not null default '[]',
  work_formats jsonb not null default '[]',
  salary_amount integer, salary_currency text,
  status text, is_active boolean not null default false,
  last_seen_at timestamptz not null,
  created_at timestamptz not null, updated_at timestamptz not null,
  unique (source, external_id)
);

resume_snapshot (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  resume_id uuid not null references resume(id) on delete cascade,
  content_hash text not null,
  captured_at timestamptz not null,
  raw jsonb not null,
  unique (resume_id, content_hash)
);

resume_enrichment (
  user_id text not null references "user"(id) on delete cascade,
  resume_id uuid primary key references resume(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null
);

employer (
  id uuid primary key default uuidv7(),
  source text not null,
  external_id text not null,
  name text not null,
  rating double precision,
  reviews_count integer,
  recommendations_percent integer,
  site_url text, logo_url text,
  raw jsonb,                       -- industries, badges и остальное сырьё
  created_at timestamptz not null, updated_at timestamptz not null,
  unique (source, external_id)
);

vacancy (
  id uuid primary key default uuidv7(),
  source text not null,
  external_id text not null,
  canonical_url text not null,
  title text not null,
  employer_id uuid references employer(id) on delete set null,
  area_id integer, area_name text,
  salary_from integer, salary_to integer, salary_currency text,
  salary_gross boolean, salary_negotiable boolean not null default false,
  experience_code text, employment_form text,
  work_formats jsonb not null default '[]',
  seniority text,                  -- простое поле, не роль
  published_at timestamptz, archived boolean not null default false,
  description_text text, description_html text,
  hydration_status text not null default 'full',
  card_snippet text,               -- текст карточки из выдачи, пока нет полного
  content_hash text not null,
  responses_total integer, responses_vacancy integer,
  signals jsonb not null default '{}',  -- salary_text, schedule, benefits, red_flags
  first_seen_at timestamptz not null, last_seen_at timestamptz not null,
  created_at timestamptz not null, updated_at timestamptz not null,
  unique (source, external_id)
);

vacancy_snapshot (
  id uuid primary key default uuidv7(),
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  content_hash text not null,
  captured_at timestamptz not null,
  adapter text,
  raw jsonb not null,
  description_text text,
  unique (vacancy_id, content_hash)
);

vacancy_skill (
  id uuid primary key default uuidv7(),
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  term text not null,
  normalized_term text not null,
  source text not null default 'hh',
  position integer,
  unique (vacancy_id, normalized_term, source)
);

vacancy_response_sample (
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  bucket text not null,
  captured_at timestamptz not null,
  total integer, vacancy integer,
  source text not null,
  primary key (vacancy_id, bucket)
);
```

### `signals`

Одна колонка вместо шести. Туда уезжает всё, что раньше было отдельными
`text`-колонками с JSON внутри:

```json
{
  "salaryText": { "from": 200000, "to": 250000, "currency": "RUB", "evidence": "…" },
  "schedule": { "days": "5/2", "start": "10:00", "end": "19:00" },
  "conditions": { "probation": true, "onCall": false },
  "benefits": ["dms", "education"],
  "redFlags": ["gambling"],
  "workFormatsText": ["REMOTE"],
  "workFormatsExcluded": ["OFFICE"],
  "legalStatuses": ["tk_rf"]
}
```

Индексируем только то, по чему реально фильтруем. Если понадобится
`salary_text.from`, добавить generated column, а не GIN на весь JSON.
`coverLetterInText`, `coverLetterInForm`, `hasTest`, `testRequired` остаются
колонками: по ним принимается решение, а не только отображается.

### Словарь и совпадения

```sql
keyword (
  id uuid primary key default uuidv7(),
  term text not null,
  normalized_term text not null unique,
  enabled boolean not null default true,
  notes text,
  created_by text not null default 'user',
  created_at timestamptz not null, updated_at timestamptz not null
);

keyword_alias (
  id uuid primary key default uuidv7(),
  keyword_id uuid not null references keyword(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  match_type text not null default 'word',
  typo boolean not null default false,
  unique (keyword_id, normalized_alias)
);

vacancy_keyword (
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  keyword_id uuid not null references keyword(id) on delete cascade,
  alias_id uuid references keyword_alias(id) on delete set null,
  matched_form text not null,        -- как написано в тексте
  in_title boolean not null default false,
  title_count integer not null default 0,
  in_body boolean not null default false,
  body_count integer not null default 0,
  in_skills boolean not null default false,
  created_at timestamptz not null,
  primary key (vacancy_id, keyword_id, matched_form)
);

create index on vacancy_keyword (keyword_id) where in_title;
create index on vacancy_keyword (keyword_id) where in_body;
```

Строка — это одна встреченная форма, а не пара «вакансия — термин».
Если в вакансии написано и `Kubernetes`, и `k8s`, будет две строки с разными
`matched_form`. Так видно, какие формы реально пишут работодатели, и не
теряется одна из них при выборе «доминирующей».

`matched_form` хранится в нормализованном виде (нижний регистр, `ё` → `е`),
поэтому `Kubernetes` и `kubernetes` — одна строка, а `k8s` — другая. Иначе
регистр расплодил бы дубли, которые ничего не значат. Подсветка и так ищет
без учёта регистра.

Сниппет совпадения не храним. Он дублирует текст вакансии и раздувает БД:
50 терминов × 100 символов × 100 тысяч вакансий это сотни мегабайт ради
подсветки, которую можно пересчитать из `description_text` по `matched_form`
в момент рендера. В БД остаются факт, форма, место и счётчик.

`alias_id` и `matched_form` решают разные задачи:

- `alias_id` — ссылка на строку `keyword_alias`, если совпал алиас.
  `null` означает, что встретился канонический термин. По нему считается,
  какую форму работодатели пишут чаще.
- `matched_form` — точная строка из текста, а не id. Она нужна для подсветки
  и переживает удаление алиаса: FK стоит `on delete set null`, текст остаётся.
  Она же входит в ключ, поэтому формы не схлопываются.

Хранить только id нельзя: при правке или удалении алиаса теряется историческая
форма. Хранить только текст тоже нельзя: не будет связи со словарём и
статистики по алиасам. Поэтому оба поля.

Наличие термина в заголовке — это `exists` по строкам с `in_title`.
Счётчик по термину — `sum(title_count)`, `sum(body_count)`. Отдельная
агрегирующая таблица не нужна: форм на термин в одной вакансии обычно 1–3.
Если список вакансий начнёт тормозить на `exists`, добавим
`vacancy_keyword_presence` (materialized view или таблицу-кэш), но не раньше.

### Пресеты и обход

```sql
preset (
  id uuid primary key default uuidv7(),
  user_id text references "user"(id) on delete cascade,
  kind text not null default 'apply',      -- explore | apply
  title text not null,
  filter jsonb not null default '{"all":[]}',
  system boolean not null default false,
  created_at timestamptz not null, updated_at timestamptz not null
);

search_query (
  id uuid primary key default uuidv7(),
  url text not null,
  normalized_url text not null unique,
  title text, text_query text,
  created_at timestamptz not null, updated_at timestamptz not null
);

search_run (
  id uuid primary key default uuidv7(),
  query_id uuid not null references search_query(id) on delete cascade,
  status text not null,
  next_page integer,
  pages_done integer not null default 0,
  found integer not null default 0,
  error text,
  started_at timestamptz not null, finished_at timestamptz
);

vacancy_search_hit (
  query_id uuid not null references search_query(id) on delete cascade,
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  position integer,
  found_at timestamptz not null,
  primary key (query_id, vacancy_id)
);

schedule (
  id uuid primary key default uuidv7(),
  user_id text references "user"(id) on delete cascade,  -- null = системное
  kind text not null,                -- search | source
  target_id text not null,           -- uuid query_id или 'hh'
  interval_minutes integer not null,
  options jsonb not null default '{}',
  enabled boolean not null default true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz not null, updated_at timestamptz not null
);

schedule_run (
  id uuid primary key default uuidv7(),
  user_id text references "user"(id) on delete cascade,  -- null = системный
  schedule_id uuid not null references schedule(id) on delete cascade,
  status text not null,
  error text,
  duration_ms integer,
  steps jsonb not null default '[]',
  started_at timestamptz not null, finished_at timestamptz
);
```

### Скрытие

```sql
hidden_target (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid not null references hh_account(id) on delete cascade,
  type text not null,                -- vacancy | employer
  external_id text not null,
  name text,
  created_at timestamptz not null,
  unique (hh_account_id, type, external_id)
);

hidden_rule (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid not null references hh_account(id) on delete cascade,
  type text not null,                -- employer_name
  pattern text not null,
  source text not null default 'user',
  created_at timestamptz not null
);
```

### Отклик

```sql
stream (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid not null references hh_account(id) on delete cascade,
  name text,
  preset_id uuid references preset(id) on delete set null,
  search_query_id uuid references search_query(id) on delete set null,
  mode text not null default 'drafts',      -- drafts | auto
  letter_policy text not null default 'required',
  tests_policy text not null default 'human',
  enabled boolean not null default false,
  created_at timestamptz not null, updated_at timestamptz not null
);

application (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid not null references hh_account(id) on delete cascade,
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  resume_id uuid references resume(id) on delete set null,
  stream_id uuid references stream(id) on delete set null,
  state text not null,               -- draft | queued | submitting | submitted
                                     -- | skipped | needs_human | failed
  decision jsonb not null default '{}',
  created_at timestamptz not null, updated_at timestamptz not null
);

application_kit (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  application_id uuid not null references application(id) on delete cascade,
  form_hash text not null,
  letter text,
  answers jsonb not null default '[]',
  model text, prompt_hash text, cost_usd double precision,
  created_at timestamptz not null
);

application_attempt (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  application_id uuid not null references application(id) on delete cascade,
  seq integer not null,
  stage text not null,               -- prepare | submit | reconcile
  harness_id uuid,
  exit jsonb,
  artifacts jsonb,
  started_at timestamptz not null,
  finished_at timestamptz,
  unique (application_id, seq)
);

hh_account_session (
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid primary key references hh_account(id) on delete cascade,
  sealed bytea,                      -- cookies, шифрованно
  state text not null default 'expired',
  proxy_node text,
  last_ok_at timestamptz,
  last_error text,
  updated_at timestamptz not null
);
```

### Необязательное: ИИ-fit

```sql
fit (
  id uuid primary key default uuidv7(),
  user_id text not null references "user"(id) on delete cascade,
  hh_account_id uuid not null references hh_account(id) on delete cascade,
  resume_id uuid not null references resume(id) on delete cascade,
  vacancy_id uuid not null references vacancy(id) on delete cascade,
  content_hash text not null,
  resume_hash text not null,
  prompt_hash text not null,
  model text not null,
  verdict text not null,             -- fit | maybe | reject
  score integer not null,
  reasons jsonb not null default '[]',
  cost_usd double precision,
  created_at timestamptz not null,
  unique (vacancy_id, resume_id, content_hash, resume_hash, prompt_hash, model)
);
```

Одна таблица вместо `judgements` + `jobs` + `classifications` + `ai_keywords`.
Очередь и ретраи даёт workflow, а не отдельная таблица.

---

## 5. RLS

RLS остаётся на всех таблицах приложения. Auth-таблицы — исключение: Better
Auth обращается к ним до того, как известен пользователь, и его запросы не
проходят через `app.user_id`.

Две роли:

- `app` — владелец схемы: миграции, ingest, workflow engine, системные проходы.
- `otbor` — рантайм без `BYPASSRLS`; каждый запрос начинается с
  `set local app.user_id = '<id>'`.

Политики:

```sql
-- личная таблица
alter table application enable row level security;
create policy application_owner on application
  using (user_id = nullif(current_setting('app.user_id', true), ''))
  with check (user_id = nullif(current_setting('app.user_id', true), ''));

-- общая таблица: читать всем, писать только владельцу
alter table vacancy enable row level security;
create policy vacancy_read on vacancy for select using (true);
```

`nullif(..., '')` важен: если контекст не выставлен, политика не должна
пропускать всё. Пустая строка превращается в null, и не видно ни одной строки.
Fail closed.

Дочерние таблицы тоже получают `user_id`, а не `exists` join к родителю:
RLS с join медленный, и его легко случайно ослабить. Согласованность держит
составной внешний ключ:

```sql
alter table application add constraint application_id_user unique (id, user_id);
alter table application_attempt
  add constraint attempt_application_user
  foreign key (application_id, user_id) references application (id, user_id);
```

Общие таблицы без `user_id`: `employer`, `vacancy`, `vacancy_snapshot`,
`vacancy_skill`, `vacancy_response_sample`, `keyword`, `keyword_alias`,
`vacancy_keyword`, `search_query`, `search_run`, `vacancy_search_hit`.
В них рантайм только читает; пишет ingest от `app`.

Смешанные таблицы (`preset.user_id`, `schedule.user_id`, `schedule_run.user_id`):
`null` — системная строка, читают все, пишет владелец; иначе обычная личная
политика.

Индексы: `user_id` первым в индексах личных таблиц. Иначе RLS-предикат
превращает каждый запрос в seq scan.

Проверки в CI:

```sql
select relname from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and not c.relrowsecurity
  and relname not in ('user','session','account','verification','apikey');
```

и тест на каждую личную таблицу: пользователь A не видит строку B, и вставка
с чужим `user_id` падает.

Воркер: очередь он читает от `app` (нужны задачи всех пользователей), но
каждую задачу обрабатывает на соединении `otbor` с выставленным `app.user_id`.
Иначе RLS обходится ровно там, где пишутся письма и отправляются отклики.

---

## 6. Как считаются ключевые слова

1. Текст вакансии нормализуется один раз: заголовок и тело отдельно.
2. Для каждого термина словаря и его алиасов ищутся вхождения с границами
   слов. Опечатки (`Kubernetis`) считаются тому же термину и помечаются.
3. Пишется строка `vacancy_keyword` на каждую встреченную форму:
   - `matched_form`: точная строка, которая встретилась;
   - `alias_id`: ссылка на алиас, если совпал он, `null` — канонический термин;
   - `in_title`, `title_count`;
   - `in_body`, `body_count`;
   - `in_skills` (навыки hh).
4. Отсев и пресет работают по `in_title`/`in_body` и не зависят от форм:
   - `titleKeywords` — есть строка с `in_title`;
   - `bodyKeywords` — есть строка с `in_body`;
   - `anyKeywords` — любой из списка;
   - `excludeKeywords` — стоп-слова.
5. Никакой `era`, `topic`, `sector` в этом пути нет.

Почему одна таблица: сейчас `vacancy_keywords` и `vacancy_keyword_aliases`
дублируют друг друга, а «где найдено» не хранится вообще. Без `in_title`
нельзя отличить «DevOps в заголовке» от «DevOps упомянут в блоке про
команду».

Почему не агрегировать формы в одну строку: работодатель может написать
`Kubernetes` в заголовке и `k8s` в теле. Агрегат заставил бы выбрать одну
форму и потерять вторую. Лишние строки стоят копейки, потерянная форма —
это дырка в статистике словаря, которую потом не восстановить.

---

## 7. Пресеты: два вида

- `kind = explore` — широкий, для аналитики и просмотра. Может содержать
  десятки параметров.
- `kind = apply` — узкий, для отклика. Минимум: `titleKeywords`,
  `bodyKeywords`, `salaryFrom`, `remote`, `excludeApplied`, `tests`.

Один и тот же пресет не должен делать и то, и другое. Это была одна из
причин, почему первичный отбор пропускал кладовщиков: широкий фильтр
использовался как фильтр отклика.

Пример `apply`:

```json
{
  "titleKeywords": ["devops", "девопс", "sre", "platform"],
  "bodyKeywords": ["kubernetes", "terraform", "ansible", "ci/cd"],
  "salaryFrom": 250000,
  "remote": true,
  "excludeApplied": true,
  "tests": "human"
}
```

---

## 8. Что удаляется и почему

| Удаляем | Причина |
|---|---|
| `topics`, `topic_keywords`, `vacancy_topics` | роль/стек/сфера смешаны в одну сущность; отсев теперь по словам |
| `vacancy_ai_classifications` | роль и сфера не нужны; сфера это свойство работодателя |
| `vacancy_ai_keywords` | вторая версия слов не нужна, словарь один |
| `vacancy_ai_classification_jobs`, `vacancy_ai_jobs` | очередь даёт workflow |
| `keyword.era*` | era/frontier пока не делим |
| `vacancy.primary_topic` | темы нет |
| `vacancy.industries` | это red flags, а не отрасли; переносится в `signals.redFlags` |
| `profile_vacancies` | сохранённость это состояние приложения |
| `application_tasks` | состояние в workflow, не в таблице |
| `auto_response_rules` | легаси, заменено `streams` |
| `event_outbox` | писать некому, consumer нет |
| `extractions` | лог, а не данные |
| `vacancy.keySkills` (JSON-колонка) | дублирует `vacancy_skill` |
| `vacancy.salaryText`, `scheduleText`, `conditionsText`, `benefits`, `legalStatuses`, `workFormatsText` | переезжают в `signals jsonb`, чтобы не держать 6 колонок ради одного экрана |

---

## 9. Переезд

1. **Auth не мигрирует.** Если БД та же, таблицы Better Auth остаются на
   месте. Если новая, переносятся дампом как есть.
2. **Корпус переносится:** `vacancies`, `vacancy_snapshots`,
   `vacancy_skills`, `vacancy_response_samples`.
3. **Словарь переносится:** `keywords` без `era*`, `keyword_aliases` с
   `typo`.
4. **Совпадения пересчитываются** из текста, а не переносятся: так проще,
   чем склеивать две старые таблицы, и сразу появляется `in_title`.
5. **Работодатели** сливаются из `companies` + `employer_ratings` +
   `employer_profiles`; industries остаются в `raw`, пока не нужны.
6. **Резюме** переносятся, enrichments сливаются в одну таблицу.
7. **Пресеты** переносятся; `filter_json` конвертируется в `jsonb`, старые
   правила автоотклика не переносятся.
8. **Скрытия** переносятся.
9. **Почта и Telegram** переносятся как отдельный модуль: 13 таблиц и их
   креды в сейфе.
10. **Отклики, драфты, задачи** не переносятся: история старая, состояние
    новое.
11. **Старые id не переиспользуются.** В новой схеме PK — UUIDv7, а старый
    `hh:138836540` остаётся в `vacancy.external_id`. Если понадобится
    сопоставление с архивом, добавляется `legacy_id_map(old_id, entity,
    new_id)`.

---

## 10. Открытые вопросы

1. Нужна ли статистика резюме hh в v1 (`resume_stats`)?
2. Нужны ли тесты/анкеты в v1 (`test_sessions`)?
3. ИИ-fit включаем сразу или после того, как гейт по словам заработает?
