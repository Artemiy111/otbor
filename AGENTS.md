# otbor

## Origin

`otbor` is a **full rewrite** of the previous `hh-extracter` project. The old
project exists only as a local reference checkout; there is no upstream
repository and nothing is imported from it at runtime. It is the behavioural
reference for the hh adapters, the search crawler, the proxy engine and the
corpus schema, but new code must not copy its old transport or storage
assumptions blindly.

- Local reference checkout: [hh-extracter](file:///Users/art/Code/hh-extracter)

The crawler lives in `packages/crawler`. It fetches hh search and vacancy pages
and emits `VacancyDraft` values. It never writes SQL. Persistence stays in
`packages/cloud` (`CorpusService` / `VacancyRepository`), so the same drafts can
come from a local CLI, a future edge harness or a fixture test.

Proxy settings are local secrets, not product data. They live outside the repo
(`~/.otbor/proxy/config.json`, mode `0600`) or in `OTBOR_PROXY_*` environment
variables. A subscription URL is never logged, stored in Postgres or committed.
mihomo is optional: an already running HTTP proxy can be used with
`OTBOR_PROXY_URL`, and the crawler must work without Docker in that mode.

## Learning more about Effect

This repository uses the Effect Typescript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
**completely**, and follow the links in the file when required.

If you need to learn more about particular Effect apis and concepts that the
guide doesn't cover, search through the source code in `node_modules/effect/src`.

## Repository conventions

- Bun is the runtime and package manager. Workspaces live under `packages/*`
  and `apps/*`.
- Effect v4 lives in a single `effect` package. Import modules from subpaths:
  `effect/rpc`, `effect/cli`, `effect/http`, `effect/sql/SqlClient`.
- `packages/contract` is browser-safe and depends only on `effect`. It owns
  every schema that crosses a boundary, the branded IDs, and the single
  `RpcGroup`.
- `packages/domain` is pure TypeScript plus `effect/Schema`. No database, no
  HTTP, no filesystem. It owns the deterministic gate, lexicon matching,
  policy decisions and priority.
- `packages/hh` parses hh.ru pages. It only depends on `contract` and `domain`
  types. No browser APIs.
- `packages/cloud` owns Postgres, repositories, services, RPC handlers, the
  worker and the HTTP server. Nobody imports it except applications.
- `packages/cli` is the operator CLI. It consumes the same `RpcGroup` as the
  web app, so there is no second API surface.
- Services use `Context.Service` with a `static readonly layer`.
- Domain errors are `Schema.TaggedError`, never thrown exceptions.
- Drizzle is the default persistence layer. Query builders are Effect values
  (`drizzle-orm/effect-postgres`); do not wrap them in `Effect.tryPromise`.
- Persistence schemas are derived with `drizzle-orm/effect-schema`.
- Migrations are hand-written SQL applied by `effect/sql/Migrator`, because
  RLS, triggers, partial indexes and `uuidv7()` are part of the schema.
- ACP is driven through the official `@agentclientprotocol/sdk` (v1 stable),
  never hand-rolled JSON-RPC. Protocol work lives in `packages/acp`; the agent
  process is owned by `packages/harness`.
- Never run `opencode acp` inside the repository checkout: a nested agent can
  discover the project config. Use `OTBOR_ACP_CWD` outside the repo (default
  `/tmp/otbor-acp`) and honor `OTBOR_ACP_CHILD=1`.
- Inference is a queue job with `stage = "inference"` and `kind = "inference"`.
  The prompt lives in `payload`, the answer in `HarnessJob.result`; the cloud
  never calls a model directly.
- Use `Effect.fn` in services and `Effect.fnUntraced` in hot paths.
- The operator CLI is also a binary: `packages/cli/bin/otbor` is the executable,
  and `bun run link` (or `cd packages/cli && bun link`) installs `otbor` into
  `~/.bun/bin`. Do not tell operators to type `bun packages/cli/src/main.ts`.
- No `console.log` in server code. Use `Effect.log*`; logs go to the terminal
  and to `logs/app-YYYY-MM-DD.log`.
- Crawl schedules are user-owned rows. The worker claims due schedules with
  `FOR UPDATE SKIP LOCKED`, advances `next_run_at` in the same transaction and
  runs a full search crawl through `CrawlRunner` (up to 100 pages; it stops at the
  last page hh.ru reports). `ScheduleRunNow` only
  accepts the request and forks the crawl, so the RPC never waits for hh.ru.
- Web list tables use the shared `apps/web/src/shared/ui/data-table` wrapper
  (TanStack Table) instead of raw shadcn `Table` markup.
- IDs are UUIDv7, generated in Postgres (`uuidv7()` on Postgres 18) and are the
  same value inside and outside the system. Vendor IDs live in
  `external_id` + `source`, never in a primary key.
- Submit is at-most-once per application: an intent row is written before the
  click, ambiguity goes to reconcile, never to a second submit. One account may
  apply to the same vacancy with different resumes.
- The harness is untrusted. It may fill and click, but it cannot decide what
  counts as success. The cloud reconciles every result.

## Agent skills

### Issue tracker

Задачи живут в GitHub Issues репозитория `Artemiy111/otbor` (через `gh` CLI). См. `docs/agents/issue-tracker.md`.

### Triage labels

Словарь по умолчанию: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. См. `docs/agents/triage-labels.md`.

### Domain docs

Single-context: один `GLOSSARY.md` и `docs/adr/` в корне репозитория. См. `docs/agents/domain.md`.
