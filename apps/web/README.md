# @otbor/web

Operator UI for the local single-user mode. It uses Vue 3 + Vite, Tailwind CSS
v4, shadcn-vue components and `@lucide/vue`. It speaks the same `effect/rpc`
`OtborRpcs` group, over the same `RPC_PATH` and NDJSON serialization, as
`@otbor/cli`. There is no second API surface and no login screen. Interface text
is Russian; raw contract tokens (`needs_human`, `submitted`, ...) stay visible
only where they help debugging.

## Run

```sh
# terminal 1: cloud RPC + worker as usual
bun run server

# terminal 2: UI with a same-origin /rpc proxy to 127.0.0.1:3001
bun run web
```

Open http://127.0.0.1:5173. The UI is hash-routed, so a static build needs no
server-side fallback:

| Hash | Screen |
| --- | --- |
| `/health` | `SystemHealth` |
| `/vacancies` | corpus list: search, gate, salary, company, area, date |
| `/vacancies/:id` | vacancy detail, skills, lexicon matches, description, links |
| `/companies` | employers with rating, industries and vacancy count |
| `/companies/:id` | employer profile and its vacancies |
| `/keywords` | lexicon terms, aliases and enabled state |
| `/decisions` | stored decisions with verdict/gate/priority |
| `/applications` | application list |
| `/applications/:id` | kit, attempts, linked decision |
| `/queue` | queue stats and harness jobs |
| `/inference` | enqueue one ACP inference job and poll its result |
| `/presets` | saved explore/apply filters |

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
  widgets/    app shell and sidebar, page header, stat card
  features/   filters, refresh, inference enqueue mutation
  entities/   RPC calls and query keys per domain object
  shared/     RPC client, shadcn-vue UI primitives, formatting helpers
```

The sidebar is built from the shadcn-vue `Sidebar` primitives (collapsible icon
rail, grouped sections, mobile sheet) with hh branding. Detail routes map back
to their list section, so `/vacancies/:id` keeps «Вакансии» active.

Server state is owned by Pinia + `@pinia/colada`: `useQuery` for reads and
`useMutation` for `InferenceEnqueue`, with entity-scoped query keys and cache
invalidation for the queue and inference queries. Company, keyword and preset
entities use the same pattern.

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
