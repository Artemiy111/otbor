# otbor

Control plane для автоотклика на hh.ru плюс локальный edge-харнес. Проект —
полный рерайт `hh-extracter`; старый проект существует только как локальный
reference checkout и не является runtime-зависимостью.

## Что внутри

| Пакет | Роль |
| --- | --- |
| `packages/contract` | Схемы, брендированные ID, один `RpcGroup` для CLI, web и харнеса |
| `packages/domain` | Детерминированный gate, лексикон, решение, приоритет |
| `packages/hh` | Разбор страниц hh.ru в нормализованные `VacancyDraft` |
| `packages/crawler` | Поисковая выдача, гидратация, прокси, ACP не касается |
| `packages/cloud` | Postgres, RLS, репозитории, сервисы, RPC, очередь, worker |
| `packages/acp` | Effect-адаптер над официальным `@agentclientprotocol/sdk` |
| `packages/harness` | Edge-воркер: lease/heartbeat/complete и ACP inference |
| `packages/cli` | Операторский CLI `otbor` |
| `apps/web` | Vue 3 + Tailwind + shadcn-vue + FSD + Pinia Colada поверх той же RPC-группы |

## Быстрый старт

```bash
bun install
bun run link          # otbor -> ~/.bun/bin/otbor
otbor doctor          # что не настроено и как починить
otbor up              # Postgres, миграции, server + worker + web
```

`otbor up` поднимает Postgres через docker compose (если он не отвечает),
применяет миграции и запускает server (RPC на 127.0.0.1:3001), worker и web
(127.0.0.1:5173) с общим логом. Ctrl+C останавливает всё. Флаги:

- `--detach` (`-d`) — в фоне: pid в `~/.otbor/run`, вывод в `logs/<name>.log`;
- `--no-web`, `--harness` (ещё `harness run`), `--proxy` (сначала `proxy up`).

```bash
otbor status          # postgres, api, worker, web, harness
otbor down            # остановить фоновые сервисы; --db ещё и Postgres
```

На новой базе один раз нужен `otbor db seed`. `bun run dev` — то же, что
`otbor up`.

## MCP

`otbor mcp` — MCP-сервер на stdio поверх того же `RpcGroup`, что CLI и web.
Нужен запущенный API (`otbor up`).

Чтение: `vacancies_top`, `vacancy_get`, `decisions_list`, `fit_get`, пресеты,
работодатели, резюме, `applications_list`, `application_get`,
`application_form` (вопросы формы, подсказки, статус набора), диалоги,
контакты, расписания, очередь.

Запись (Claude в чате ведёт отклик сам, инструменты атомарные):
`fit_save` (своя оценка fit), `application_prepare` (черновик + открытие формы
hh, идемпотентно), `kit_set` (письмо и ответы; локальная проверка показывает
все проблемы сразу), `application_skip` и `application_approve`.

Безопасность:

- Только `application_approve` реально отправляет отклик на hh.ru, один раз и
  необратимо. Нужен `confirm: true`; инструкции сервера требуют сначала
  показать письмо и ответы и получить согласие пользователя.
- Сервер проверяет набор ещё раз (`AnswersInvalid`), а дневной лимит отправок
  на hh-аккаунт (`OTBOR_DAILY_APPLY_LIMIT`, по умолчанию 200 за 24 часа; лимит аккаунта из `apply_filter.daily_limit`
  имеет приоритет,
  `LimitExceeded`) держит облако, а не MCP.
- `OTBOR_MCP_READONLY=1` регистрирует только инструменты чтения.

В репозитории лежит `.mcp.json`, поэтому Claude Code видит сервер `otbor`
сразу. Для OpenCode:

```jsonc
{ "mcp": { "otbor": { "type": "local", "command": ["otbor", "mcp"], "enabled": true } } }
```

## Корпус, краулер и прокси

```bash
otbor crawl 'https://hh.ru/search/vacancy?text=devops&area=1' --pages 1 --hydrate
otbor hydrate --limit 50 --delay 1000
```

Прокси задаётся один раз:

```bash
otbor proxy set http://127.0.0.1:7897 --endpoint
# или подписка + mihomo
otbor proxy set 'https://sub.example.com/token'
otbor proxy up
otbor proxy test
```

Настройки лежат в `~/.otbor/proxy/config.json` (0600). Поддерживаются только
`OTBOR_PROXY_*`; секреты подписки не попадают в БД, логи или git.

## Расписания обхода

Расписание — это поисковый URL hh.ru и интервал в минутах. Воркер
(`bun run worker`) каждые `WORKER_SCHEDULE_SECONDS` секунд (по умолчанию 60)
забирает созревшие расписания и прогоняет полный обход тем же `CrawlRunner`,
что и ручной обход: worker проходит все страницы выдачи до последней, которую
отдаёт hh.ru, но не больше 100 страниц за запуск. Ошибка одного расписания
пишется в `last_error` и не останавливает остальные.

```bash
otbor schedule list
otbor schedule upsert \
  --target 'https://hh.ru/search/vacancy?text=devops&search_field=name&area=1&order_by=publication_time' \
  --interval 360
otbor schedule run-now --id <id>
otbor schedule remove --id <id>
```

`run-now` только принимает заявку: сам обход идёт в отдельном fiber, поэтому
RPC возвращается до загрузки страницы hh.ru.

## Анализ вакансий (SystemOne)

Локальная модель (`clef-flash-4bit` под omlx) вытаскивает из вакансии факты:
роль, уровень, тип компании, требования к отклику, красные флаги. Каждый факт
хранится с уверенностью; ниже порога 0.8 он читается как «неизвестно».
Сервер читается из окружения: `OTBOR_SYSTEMONE_URL`
(по умолчанию `http://127.0.0.1:1111`), `OTBOR_SYSTEMONE_API_KEY` (секрет, не
логируется), `OTBOR_SYSTEMONE_MODEL` (по умолчанию `clef-flash-4bit`),
`OTBOR_SYSTEMONE_TIMEOUT_MS` (по умолчанию 60000).

```bash
otbor analysis run [--limit 20] [--delay 0] [--json]   # один ограниченный проход
otbor analysis stats                                   # проанализировано / всего
otbor analysis show <id|префикс|hh-URL>                # факты с уверенностью
otbor schedule upsert --kind analysis --target global --interval 30
```

Проход последовательный; если SystemOne недоступен или отклонил ключ, он
останавливается с понятной ошибкой (`stoppedBy`), а не помечает все вакансии
сбойными. Расписание `analysis` принимает опции `limit` (50, максимум 500) и
`delayMs`. Подробности: `docs/architecture/vacancy-analysis.md`.

## Очередь и harness

Регистрация устройства выдаёт токен один раз и сохраняет локальную
конфигурацию CLI:

```bash
otbor harness register \
  --name local \
  --kind browser \
  --kind inference \
  --account <hh-account-id> \
  --save
```

Токен и harness id лежат в `~/.otbor/harness.json` (0600). Дальше воркер
запускается из того же CLI, без shell-обёрток:

```bash
otbor harness run                 # долгоживущий цикл
otbor harness run --once          # один lease и выход
otbor harness run --once --wait 2 # один короткий long-poll
```

`otbor harness run` забирает `inference`-задания, запускает `opencode acp`,
шлёт heartbeat и возвращает текст, модель, usage и `providerResponse` в
`HarnessJob.result`. Browser-исполнитель пока отвечает `blocked`.

## ACP и inference

```bash
otbor acp session                 # какой агент, модель и configOptions
otbor acp prompt 'Reply with exactly: ok'

otbor inference run 'Напиши одно предложение о вакансии'
otbor inference get <job-id>
```

ACP работает через `opencode acp` (ACP v1). Codex ACP не предоставляет, поэтому
в текущем адаптере не поддерживается. Модель по умолчанию берётся из конфигурации
OpenCode; `inference run --model` применяется через
`session/set_config_option` (если агент его поддерживает). `OTBOR_ACP_BIN`,
`OTBOR_ACP_CWD` и `OTBOR_ACP_TIMEOUT_SECONDS` переопределяют процесс.

## Письма, ответы и резюме

Письменные задачи идут через ту же очередь: облако собирает промпт, а текст
возвращает inference-харнес. Письмо и ответы на тест пишет один промпт, общий
для веба, автопилота и CLI.

```bash
otbor write draft <application-id> --length short
otbor write draft <application-id> --save

otbor write resume ./resume.txt --target-role "Platform Engineer"
cat resume.txt | otbor write resume --target-role "SRE"
```

`write draft --save` заменяет письмо в существующем kit заявки через
`ApplicationsSetKit`, ответы и `formHash` остаются прежними. Без kit ничего не
создаётся. Подробности: [docs/writing.md](docs/writing.md).

## Проверки

```bash
bun test
bun run typecheck
bun run test:integration   # временная БД на otbor-postgres:55432
bun run --cwd apps/web build
```

Интеграционные тесты создают одноразовую БД и не трогают демо-базу `otbor`.
