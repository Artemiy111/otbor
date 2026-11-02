# otbor: ACP и inference

Статус: черновик. Дата: 02.11.2026.

Документ описывает, как запускать ACP-агент локально и как проходит inference
через очередь. Агент живёт на машине-исполнителе, не в облаке: сервер лишь
хранит задание и результат.

## Что такое ACP здесь

ACP (Agent Client Protocol, v1) — JSON-RPC поверх stdio. `packages/acp`
адаптирует официальный `@agentclientprotocol/sdk` к Effect: запускает
`<bin> acp` дочерним процессом, создаёт сессию, отдаёт `session/new` и
`session/prompt`, а поток обновлений — как `Stream`.

Агент, который не говорит на ACP, этим адаптером не поддерживается.

| Агент | ACP | Поддержка |
|---|---|---|
| opencode | да (`opencode acp`) | да |
| Codex | нет | нет |

Codex не предоставляет ACP-сервер, поэтому `otbor acp` и inference-харнес на
нём не работают. Оборачивать `codex exec` в псевдо-ACP не нужно: это другая
семантика сессии, прав и стриминга.

## Запуск opencode acp

`opencode acp` — не интерактивная команда, а ACP-сервер на stdin/stdout.
Вручную его не запускают: клиентом выступает `otbor`.

```bash
bun run link                      # один раз: ставит otbor в ~/.bun/bin
opencode --version                # агент установлен и авторизован
otbor acp session                 # старт агента + session/new
```

`session` печатает имя и версию агента, `sessionId`, текущие `model`,
`effort`, `mode` и таблицу всех `configOptions`, которые прислал агент.

Прямой промпт, без сервера и базы:

```bash
otbor acp prompt "Ответь одним словом: pong"
otbor acp prompt "Сократи до одного предложения" --system "Ты редактор."
otbor acp prompt "Ответь JSON" --json
```

- `--system` дописывается к тексту промпта через пустую строку: ACP-сессия
  получает один текст, отдельного system-канала в протоколе нет.
- `--json` печатает агент, `sessionId`, `model`, `effort`, `mode` и `answer`.
- Один клиент выполняет промпты по очереди; на каждый промпт действует
  таймаут.

Адаптер отклоняет запросы разрешений (`session/requestPermission`): генерация
текста не должна получать доступ к файлам и shell.

## Переменные окружения

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `OTBOR_ACP_BIN` | `opencode` | Бинарник агента; запускается как `<bin> acp` |
| `OTBOR_ACP_CWD` | `<tmp>/otbor-acp` | Рабочая директория агента (создаётся) |
| `OTBOR_ACP_TIMEOUT_SECONDS` | `120` | Таймаут одного ACP-промпта, секунды |

`OTBOR_ACP_CWD` намеренно указывает вне репозитория: вложенный opencode не
должен находить конфигурацию MCP этого проекта. Если нужен доступ к другому
дереву, задайте путь явно.

## Inference-харнес

Inference — это обычная job в очереди: `kind = inference`, `stage =
inference`, payload `InferencePayload`:

```json
{ "prompt": "...", "system": "...", "model": "...", "jsonSchema": {} }
```

Все поля кроме `prompt` необязательны.

1. Зарегистрировать устройство. Токен показывается один раз и сохраняется в
   локальный конфиг CLI:

```bash
otbor harness register --name inference-mac --kind inference --save
```

2. Запустить воркер из CLI:

```bash
otbor harness run
otbor harness run --once
```

`otbor harness run` сам делает long-poll, heartbeat и complete. Ручные
`otbor harness lease/heartbeat/complete` остаются для отладки протокола.

3. Воркер выполняет `payload.prompt` через ACP-клиент и отчитывается
   `HarnessComplete` с `exit.tag = "prepared"`. Результат кладётся в
   `exit.artifacts` и сохраняется в `HarnessJob.result`:

```json
{
  "text": "ответ агента",
  "model": "opencode-go/deepseek-v4.1-flash",
  "usage": { "used": 1234, "size": 200000 },
  "providerResponse": {},
  "durationMs": 4200
}
```

Без `artifacts` job завершится как `done`, но без результата. Ошибка агента —
не `prepared`: retryable-теги возвращают job в очередь, терминальные переводят
её в `failed`/`needs_human` (решение принимает облако, не харнес).

Токен нужен на каждый `lease`, `heartbeat` и `complete`. `--token` важнее
`OTBOR_HARNESS_TOKEN`.

## Inference через CLI

Команды ходят в тот же RPC, что и будущий веб-клиент, поэтому нужен
запущенный сервер (`bun run server`) и `OTBOR_API_URL` (по умолчанию
`http://127.0.0.1:3001/rpc`).

```bash
otbor inference run "Сформулируй вопрос по вакансии" \
  --system "Ты карьерный консультант" \
  --model opencode-go/deepseek-v4.1-flash \
  --timeout 180
```

- Промпт можно передать аргументом или на stdin:
  `cat prompt.txt | otbor inference run --model ...`.
- `run` ставит job через `InferenceEnqueue` и опрашивает `InferenceGet` раз в
  секунду до `done`, `failed`, `dead`, `needs_human`, `cancelled` или
  `needs_reconcile`. На `done` печатается только текст ответа; иначе — id,
  статус и текст результата, если он есть, и код возврата 1.
- `--no-wait` печатает id и выходит (с `--json` — весь job); результат потом
  забирают через `get`.
- `--json` печатает job (в режиме ожидания — `{ job, timedOut }`).
- `--account` привязывает job к hh-аккаунту; без него облако берёт аккаунт по
  умолчанию.

```bash
otbor inference get <id>
otbor inference get <id> --json
```

`get` показывает статус, попытки, payload (prompt/system/model) и результат.

Если ни один харнес с `kind = inference` не подключён, job останется
`pending`, а `run` завершится по таймауту с кодом 1 и тем же id — его можно
забрать позже через `get`.

## Ограничения

- ACP-клиент не даёт агенту инструментов: запросы разрешений отклоняются.
- Системная инструкция — часть текста промпта, а не отдельное поле протокола.
- `jsonSchema` в payload пока только передаётся харнесу; валидация ответа —
  его ответственность.
- Codex не поддерживается (нет ACP).
