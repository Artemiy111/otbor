# @otbor/web

Minimal operator UI for the local single-user mode. It uses Vue 3 + Vite and
speaks the same `effect/rpc` `OtborRpcs` group, over the same `RPC_PATH` and
NDJSON serialization, as `@otbor/cli`. There is no second API surface and no
login screen.

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
