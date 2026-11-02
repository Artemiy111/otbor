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
| `apps/web` | Локальный Vue-интерфейс поверх той же RPC-группы |

## Быстрый старт

```bash
bun install
bun run db:up
bun run db:migrate
bun run db:seed

bun run server       # RPC на 127.0.0.1:3001
bun run web          # UI на 127.0.0.1:5173
```

CLI устанавливается как бинарник:

```bash
bun run link          # otbor -> ~/.bun/bin/otbor
bun run link:harness  # otbor-harness -> ~/.bun/bin/otbor-harness
otbor --help
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

## Очередь и harness

Регистрация устройства выдаёт токен один раз:

```bash
otbor harness register \
  --name local \
  --kind browser \
  --kind inference \
  --account <hh-account-id>
```

Сохранить токен в `OTBOR_HARNESS_TOKEN` (или `~/.otbor/harness.env`) и запустить
воркер:

```bash
OTBOR_HARNESS_ID=<harness-id> \
OTBOR_HARNESS_TOKEN=<token> \
OTBOR_HARNESS_KINDS=inference \
otbor-harness
```

`otbor-harness` забирает `inference`-задания, запускает `opencode acp`, шлёт
heartbeat и возвращает текст, модель, usage и `providerResponse` в
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

## Проверки

```bash
bun test
bun run typecheck
bun run test:integration   # временная БД на otbor-postgres:55432
bun run --cwd apps/web build
```

Интеграционные тесты создают одноразовую БД и не трогают демо-базу `otbor`.
