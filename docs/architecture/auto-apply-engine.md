# otbor: движок автоотклика — очередь и воркеры

Статус: черновик, дополнение к [auto-apply.md](./auto-apply.md). Дата: 31.10.2026.

Документ отвечает на вопрос: как организовывать движок автоотклика —
очереди, где их хранить и нужен ли RabbitMQ. Он не повторяет продуктовую
рамку и workflow-модель из `auto-apply.md`, а фиксирует границу между
**workflow приложения**, **доставкой работы исполнителю** и **событиями для UI**.

## Короткий ответ

1. **Да, движок — это очередь, но не один общий брокер.**
2. **Workflow приложения** (подготовка → approval → submit → reconcile) живёт
   в `effect/workflow`; его состояние и реплей — не задача RabbitMQ.
3. **Доставка работы** облачным воркерам и edge-харнесам — это lease/job
   конверт. На старте его storage — **Postgres**, не RabbitMQ.
4. **RabbitMQ не берём сейчас.** Он появится только при переходе к нескольким
   независимым сервисам/потокам событий, и тогда — через transactional outbox,
   а не вместо Postgres.
5. **Сериализация по аккаунту** — `AccountEntity` из `effect/cluster` плюс
   уникальная привязка харнеса; `SKIP LOCKED` для этого недостаточно.

## Три разных слоя, которые нельзя смешивать

| Слой | Задача | Носитель |
|---|---|---|
| Workflow приложения | «что должно произойти с откликом» | `effect/workflow` |
| Job/lease | «кто и когда выполнит шаг» | Postgres + RPC long-poll |
| События/UI | «показать прогресс и статусы» | Postgres read model + SSE/LISTEN/NOTIFY |

`effect/workflow` уже умеет durable-шаги, `DurableDeferred` для approval,
`DurableClock` для пауз и реплей activity. Не нужно эмулировать это таблицей
`jobs` со статусами `pending/running`, если workflow уже хранит execution
state.

Отдельный job-конверт нужен там, где работа уходит **за пределы workflow**:
на edge-харнес, в браузерный пул, в inference-пул или в долгий внешний вызов,
который нельзя держать в памяти процесса.

## Почему Postgres, а не RabbitMQ

Для `otbor` важны не тысячи jobs/sec, а другие свойства:

- **Транзакционная постановка.** Создать `application`/`application_attempt` и
  поставить работу в одной транзакции. С RabbitMQ понадобился бы outbox и
  отдельная гарантия доставки.
- **Идемпотентность.** Уникальный ключ `(application, stage, kitHash)` живёт
  рядом с доменными данными; повторный lease возвращает тот же результат.
- **Human-in-the-loop.** Approval — это `DurableDeferred` workflow, а не job,
  висящий в `running` с истёкшим lease.
- **Один аккаунт — один исполнитель.** Это ограничение на данные, а не на
  доставку сообщений; его проще выразить entity/уникальным индексом/`
  pg_try_advisory_lock`, чем топологией RabbitMQ.
- **Наблюдаемость.** Очередь, попытки, ошибки и стоимость читаются SQL-запросом
  и сразу попадают в UI; не нужен отдельный RabbitMQ UI.
- **Эксплуатация.** Одна БД, один backup, одна миграционная история.
- **Нагрузка.** Автоотклики — это десятки/сотни длинных задач в день, а не
  поток событий. Postgres с `SKIP LOCKED` выдерживает на порядки больше.

RabbitMQ даёт routing, fan-out, priorities и независимое масштабирование
consumers. Но за это платим вторым stateful-компонентом, dual-write,
дедупликацией и эксплуатацией. Для одного control plane это преждевременно.

## Модель работы

### 1. Workflow приложения

```
loadApplication → ensureKit → approval? → submit → reconcile → recordOutcome
```

- execution id = `application.id`;
- `approval` — `DurableDeferred`, UI его резолвит;
- `submit` — activity с idempotency key;
- `reconcile` — обязательный шаг, если ответ hh неоднозначный;
- падение воркера не теряет шаг: workflow реплеит activity.

Это уже описано в `auto-apply.md`; здесь важно, что **workflow не должен
зависеть от RabbitMQ**. Его состояние — часть домена.

### 2. Job/lease для исполнителей

Job-конверт нужен для:

- edge-харнеса (браузер с cookies, inference на машине пользователя);
- облачного браузерного пула;
- длинных внешних операций, где нужен отдельный lease и fencing.

Минимальная таблица:

```sql
create table harness_jobs (
  id uuid primary key default uuidv7(),
  user_id text not null,                    -- FK на auth."user", text
  hh_account_id uuid,
  application_id uuid,
  stage text not null,
  kind text not null,
  payload jsonb not null,
  status text not null default 'pending',
  priority int not null default 0,
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null default 3,
  idempotency_key text not null unique,
  lease_id uuid,
  lease_epoch int not null default 0,       -- fencing: растёт на каждом claim
  lease_until timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index harness_jobs_claim_idx
  on harness_jobs (status, run_at, priority)
  where status = 'pending';
```

Claim:

```sql
update harness_jobs
set status = 'leased',
    lease_id = uuidv7(),
    lease_epoch = lease_epoch + 1,
    lease_until = now() + interval '2 minutes',
    locked_by = $harness,
    attempts = attempts + 1
where id = (
  select id from harness_jobs
  where status = 'pending'
    and run_at <= now()
    and (hh_account_id is null or hh_account_id = any($accounts))
  order by priority desc, run_at asc
  for update skip locked
  limit 1
)
returning *;
```

- `LeaseNext` в `HarnessRpcs` — long-poll на 30 секунд;
- lease короткий, heartbeat продлевает;
- истёкший lease возвращает job в `pending` или в `dead` после `max_attempts`;
- `lease_id`/`epoch` — fencing: старый исполнитель не может завершить job,
  если lease уже перешёл другому.

### 3. События для UI

Не нужен отдельный брокер. Достаточно:

- read model в Postgres: `application`, `application_attempt`, `harness_jobs`;
- `LISTEN/NOTIFY` или периодический polling для SSE;
- UI подписывается на `application.id` и показывает этапы.

## Как должен работать воркер

### 0. Что поправить в этом драфте

Драфт верный по слоям, но в нём не хватает пяти вещей, без которых воркер
небезопасен:

1. **RLS.** Воркер читает очередь от `app` (ему нужны задачи всех
   пользователей), но письма и отклики пишет от `otbor` с выставленным
   `app.user_id`. Иначе RLS обходится ровно там, где больнее всего.
2. **Fencing.** `lease_id` сам по себе не защищает: старый воркер может
   завершить job после того, как lease ушёл другому. Нужен `lease_epoch`,
   который растёт на каждом claim, и проверка epoch на каждом write.
3. **Аренда аккаунта.** `SKIP LOCKED` распределяет работу, но не запрещает
   двум воркерам взять два job одного аккаунта. Нужна отдельная
   `account_lease`, а entity можно добавить позже.
4. **Submit не ретраится после клика.** `max_attempts=3` для submit опасен.
   До клика — можно, после клика — только reconcile.
5. **Shutdown и wakeup.** Не описано, что делать с in-flight job при SIGTERM
   и как будить long-poll при появлении работы.

Плюс мелочи (решено): id везде UUIDv7, см. [ids.md](./ids.md). Поле называется
`hh_account_id`, а не `account_id`, потому что `account` — это таблица Better
Auth. В `harness_jobs` было `account_id text`; теперь `hh_account_id uuid`, как
и `application_id`.

### 1. Роли, а не процессы

На старте один бинарь:

```
otbor worker --roles=workflow,scheduler,jobs,inference,harness
```

| Роль | Что делает | Где живёт |
|---|---|---|
| `workflow` | исполняет `ApplicationWorkflow`, activity, approval | облако |
| `scheduler` | ставит workflow/job по `schedule` | облако |
| `jobs` | claim `harness_jobs`, облачный браузер | облако |
| `inference` | LLM-вызовы, бюджет, кэш | облако или edge |
| `harness` | long-poll для edge-харнесов | облако |

Один процесс с fibers — нормально до первых сотен задач. Разделение на
процессы нужно, когда браузерный пул начнёт мешать API или когда появится
второй тип исполнителя.

### 2. Жизненный цикл

```
start
  recoverExpiredLeases()
  spawn scheduler
  spawn claimLoop(kind=browser)
  spawn claimLoop(kind=inference)
  spawn harnessGateway
SIGTERM
  stop claiming
  wait in-flight <= grace
  release or return jobs
  close browsers, reset user contexts, close pools
```

Правило: **никакой транзакции на время браузера или LLM**. Транзакция только
на claim, heartbeat, запись результата.

### 3. Claim

Короткая транзакция от `app`:

```sql
select id from harness_jobs
where status = 'pending' and run_at <= now() and kind = $kind
order by priority desc, run_at asc
for update skip locked
limit 1;
```

Затем в той же транзакции берём аренду аккаунта. Если аккаунт занят, job
остаётся `pending` с `run_at = now() + 5s`, а не висит в `leased`.

После claim:

```sql
update harness_jobs
set status = 'leased',
    lease_id = uuidv7(),
    lease_epoch = lease_epoch + 1,
    lease_until = now() + interval '2 minutes',
    locked_by = $worker,
    attempts = attempts + 1
where id = $id
returning *;
```

Дальше все доменные записи идут от `otbor`:

```sql
set local app.user_id = $user_id;
```

Это делается на каждую транзакцию, а не один раз на соединение: pool
переиспользует соединения, и забытый `SET` утечёт другому пользователю.

### 4. Аренда аккаунта

```sql
create table account_lease (
  hh_account_id uuid primary key references hh_account(id) on delete cascade,
  holder text not null,
  epoch int not null default 0,
  expires_at timestamptz not null
);
```

Claim:

```sql
insert into account_lease (hh_account_id, holder, epoch, expires_at)
values ($1, $2, 1, now() + interval '10 minutes')
on conflict (hh_account_id) do update
set holder = excluded.holder,
    epoch = account_lease.epoch + 1,
    expires_at = excluded.expires_at
where account_lease.expires_at < now()
returning epoch;
```

Нет строки — аккаунт занят, job не выдаём. Это и есть «один аккаунт — один
исполнитель» без entity. `AccountEntity` можно добавить сверху, но она не
должна быть единственной защитой.

### 5. Heartbeat и fencing

Раз в `lease_until / 3`:

```sql
update harness_jobs
set lease_until = now() + interval '2 minutes'
where id = $1 and lease_id = $2 and lease_epoch = $3
  and status in ('leased', 'running')
returning 1;
```

Ноль строк — lease потерян. Воркер немедленно прекращает работу: закрывает
браузерный контекст, не кликает, не пишет результат. Перед кликом по
«Откликнуться» проверка epoch обязательна отдельным коротким запросом.

`Complete` принимается только с текущими `lease_id` и `lease_epoch`. Старый
воркер, проснувшийся после истечения, получает отказ, а не записывает успех.

### 6. Состояния и ошибки

```
pending → leased → running → done
                            ├→ failed (retry, backoff)
                            ├→ dead (исчерпаны попытки / permanent)
                            ├→ needs_human (session, captcha, resume)
                            └→ needs_reconcile (ambiguous)
```

| Ошибка | Переход | Попытка сгорает |
|---|---|---|
| `transient` | `pending`, backoff | да |
| `rate_limited` | `pending`, не раньше `retry_after` | да |
| `auth_required` | `needs_human`, пауза аккаунта | нет |
| `form_changed` | пересобрать kit, `pending` один раз | да |
| `ambiguous` | `needs_reconcile` | нет |
| `permanent` | `dead` | нет |
| `harness_disconnected` | `pending` | нет |

Политики ретраев у workflow и у job разные. Workflow ретраит activity;
job ретраит доставку; бизнес-отказ hh — это результат, а не ретрай.

### 7. At-most-once submit

1. Перед выдачей submit пишется `application_attempt` (`stage=submit`,
   `started_at`) — это intent.
2. Job получает `max_attempts = 1` после фазы клика.
3. Харнес сообщает `Clicked`. Если соединение упало после `Clicked`, облако
   **не возвращает** submit в `pending`, а ставит `needs_reconcile`.
4. Reconcile читает «Мои отклики». Нашёл — `submitted`; не нашёл — `failed`
   или `needs_human`, но не второй клик.
5. Повторный `Complete` с тем же `lease_epoch` идемпотентен и ничего не
   меняет.

### 8. Long-poll и пробуждение

`LeaseNext` держит запрос до 30 секунд. При постановке job:

```sql
select pg_notify('harness_jobs', $job_id);
```

Все ожидающие просыпаются, каждая проверяет свои аккаунты, лишние снова
засыпают. Плюс страховочный poll раз в 1–2 секунды: `NOTIFY` не переживает
обрыв соединения.

### 9. Планировщик

- `schedule` с `next_run_at`, `FOR UPDATE SKIP LOCKED`;
- `schedule_run` уникален по `(schedule_id, scheduled_for)`, чтобы рестарт не
  поставил job дважды;
- пропущенные тики не догоняются пачкой: выполнить один раз и поставить
  следующий `next_run_at` от `now()`;
- `DurableClock` — для пауз внутри workflow, не для календаря.

### 10. Остановка

SIGTERM:

1. перестать брать новые job;
2. дать текущим `grace` (LLM 30 с, submit до 2 минут);
3. submit, который уже кликнул, не убивать: дать закончить или оставить
   `needs_reconcile`;
4. вернуть незапущенные job в `pending`, снять `account_lease`;
5. закрыть браузеры и пулы.

### 11. Масштабирование и backpressure

- N воркеров, `SKIP LOCKED`, аренда аккаунта, аренда job;
- отдельные пулы соединений: `app` для claim, `otbor` для работы;
- лимит параллелизма по kind: браузер 1 на аккаунт, inference 2–4 на воркер;
- бюджет inference проверяется до claim, а не после;
- edge-job выдаётся только харнесу, привязанному к аккаунту в
  `harness_account`.

### 12. Наблюдаемость

- queue depth и возраст самого старого `pending` по kind;
- истёкшие lease, потери heartbeat, отказы `Complete`;
- `attempts`, `done`, `failed`, `dead`, `needs_human` по kind и аккаунту;
- p50/p95 времени стадии и стоимость inference;
- trace id = `application.id`; `job_id` и `lease_epoch` — атрибуты span.

### 13. Тесты, без которых это не работает

- убили воркер после claim → job вернулся в `pending`, второго отклика нет;
- потеряли heartbeat → воркер не кликает;
- `Complete` со старым epoch → отказ;
- `ambiguous` → submit не переехал в `pending`, reconcile отработал;
- два воркера на один аккаунт → второй job не выдаётся;
- RLS: job пользователя A не читает kit пользователя B;
- рестарт планировщика → один `schedule_run`, не два.

### 14. Порядок

1. Один процесс: scheduler + workflow + claim + облачный браузер.
2. `account_lease`, heartbeat, fencing.
3. Reconcile и `needs_human`.
4. Edge-харнес и long-poll.
5. Разделение ролей по процессам, если понадобится.

---

## Идемпотентность и at-most-once

Автоотклик — операция, которую нельзя повторить дважды.

- `jobId = hash(application.id, stage, kitHash)`; уникальный индекс.
- `application_attempt` уникален по `(application_id, attempt_no)`.
- Харнес хранит локально `jobId -> result`; повторный lease возвращает тот же
  результат, а не отправляет форму заново.
- Перед `submit` пишется intent; после — результат и `reconcile`.
- Если ответ неоднозначный (`timeout`, `ambiguous`), job не считается
  успешным: запускается `reconcile`, а не повторная отправка.

## Один аккаунт — один исполнитель

Это не задача очереди, а инвариант домена:

- `AccountEntity` из `effect/cluster` — единственная активация на `hh_account_id`;
- `harness_account` — уникальная привязка аккаунта к харнесу;
- для облачного браузера — `pg_try_advisory_lock(hashtext('hh:' || hh_account_id))`;
- внутри аккаунта отправки строго последовательны, между аккаунтами — параллельны.

`SKIP LOCKED` только распределяет работу, но не запрещает двум воркерам взять
два job одного аккаунта. Поэтому entity/lock обязательны.

## Ретраи и ошибки

Классификация ошибок:

| Класс | Что делать |
|---|---|
| `transient` | retry с exponential backoff + jitter |
| `rate_limited` | retry после `retry_after`, не раньше |
| `auth_required` | пауза аккаунта, уведомление, не жечь попытки |
| `form_changed` | остановить, обновить kit, повторить |
| `permanent` | `dead`, ручной разбор |
| `ambiguous` | reconcile, не повторный submit |

У workflow и у job-конверта **разные** retry-политики:

- activity workflow ретраится по своей политике;
- lease job ретраится по доставке (воркер умер, харнес отключился);
- бизнес-отказ hh — это результат, а не retry.

## Планировщик

- `schedules` в Postgres: cron/interval, `next_run_at`, `enabled`;
- отдельный fiber раз в минуту ставит workflow/job;
- не полагаться на in-memory cron: рестарт не должен терять расписание;
- `DurableClock` использовать для пауз внутри workflow (cooldown, повтор),
  а не для календарного расписания.

## Наблюдаемость

Метрики и read model:

- queue depth, age oldest pending, lease expirations;
- attempts, success/fail/dead по `kind` и `hh_account_id`;
- стоимость inference по `application_attempt.cost`;
- trace id = `application.id`; job/lease id — атрибуты span.

Всё это SQL-запросы к Postgres. Отдельный RabbitMQ management не нужен.

## Когда всё-таки RabbitMQ

Брать, если появится хотя бы одно:

- несколько независимых сервисов/языков и общий поток событий;
- throughput в тысячи jobs/sec;
- сложный routing/fan-out между командами;
- consumers масштабируются отдельно от API и БД;
- event streaming, а не только jobs.

Тогда:

```
Postgres (source of truth + outbox)
        │  outbox relay
        ▼
RabbitMQ (delivery/fan-out)
        │
        ▼
consumers (idempotent)
```

Не «RabbitMQ вместо Postgres», а «Postgres + outbox → RabbitMQ».

## Альтернативы

- **pg-boss / pgmq** — готовые Postgres-очереди. Можно, но для наших
  lease/fencing/approval-сценариев всё равно нужен свой конверт; лучше
  контролировать таблицу и SQL самим.
- **Redis/BullMQ** — ещё один stateful-компонент и Promise/Node-API; для
  Effect-приложения и текущего масштаба не оправдано.
- **Effect cluster** — нужен для entity/сериализации по аккаунту и
  распределения workflow; не заменяет job-конверт для edge.
- **Kafka** — только если появится аналитический event stream, не для
  автооткликов.

## Что делать первым

1. `ApplicationWorkflow` на `effect/workflow` с шагами из `auto-apply.md`.
2. `AccountEntity` на одну активацию по аккаунту.
3. `harness_jobs` + `LeaseNext` long-poll для edge-харнеса.
4. Идемпотентность `(application, stage, kitHash)` и `application_attempt`.
5. Read model и SSE для UI.
6. RabbitMQ не подключать, пока не упрёмся в масштаб или декомпозицию.

## Открытые вопросы

- Нужен ли edge-харнес в MVP или сначала только облачный браузерный пул?
- Хранить ли `harness_jobs` в той же БД, что и `application`, или в отдельной
  схеме (при одном Postgres это всё равно одна транзакция)?
- Делать ли `LeaseNext` через RPC long-poll или через `LISTEN/NOTIFY` +
  короткий poll?
- Нужен ли отдельный read model для очереди или достаточно SQL-вьюх?
- Когда вводить outbox: сразу, чтобы не переделывать, или только при появлении
  второго consumer-сервиса?
