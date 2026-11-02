# @otbor/web

Operator UI for the local single-user mode. It uses Vue 3 + Vite, Tailwind CSS
v4 and shadcn-vue-style components. It speaks the same `effect/rpc` `OtborRpcs`
group, over the same `RPC_PATH` and NDJSON serialization, as `@otbor/cli`. There
is no second API surface and no login screen.

## Run

```sh
# terminal 1: cloud RPC + worker as usual
bun run server

# terminal 2: UI with a same-origin /rpc proxy to 127.0.0.1:3001
bun run web
```

Open http://127.0.0.1:5173. The UI is hash-routed:

| Hash | Screen |
| --- | --- |
| `#/health` | `SystemHealth` |
| `#/vacancies` | corpus list, gate from `TitlesPreview` |
| `#/vacancies/:id` | vacancy detail, keywords, description |
| `#/decisions` | stored decisions with verdict/gate/priority |
| `#/applications` | application list |
| `#/applications/:id` | kit, attempts, linked decision |
| `#/queue` | queue stats and harness jobs |
| `#/inference` | enqueue one ACP inference job and poll its result |

Inference is the only write. Every other screen is read-only; it consumes the
same RPC methods as before.

## Structure

`src` follows Feature-Sliced Design. Imports point downward only
(`app → pages → widgets → features → entities → shared`), and every slice
exposes an `index.ts`.

```
src/
  app/        entry, hash router, layout styles
  pages/      one route per page
  widgets/    app shell (sidebar/header), page header, stat card
  features/   filters, refresh, inference enqueue mutation
  entities/   RPC calls and query keys per domain object
  shared/     RPC client, shadcn-vue UI primitives, formatting helpers
```

Server state is owned by Pinia + `@pinia/colada`: `useQuery` for reads and
`useMutation` for `InferenceEnqueue`, with entity-scoped query keys and cache
invalidation for the queue and inference queries.

## Configuration

`OTBOR_API_URL` is the only browser-facing variable. It is read from the root
`.env` (or the process environment) at build time:

- empty: the bundle uses the contract's relative `/rpc` path; `vite dev` and
  `vite preview` proxy it to `http://127.0.0.1:3001`;
- `http://host:3001/rpc`: the bundle calls that URL directly. Serve the built
  files from the same origin as the API, or put a reverse proxy in front.

No `OTBOR_PROXY_*` value is exposed to the browser.

## Checks

```sh
bun run --cwd apps/web typecheck
bun run --cwd apps/web build
```
