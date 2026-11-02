# @otbor/harness

The edge worker. It long-polls `HarnessLeaseNext`, executes inference jobs
through ACP, heartbeats while the agent works, and reports one typed
`HarnessExit` with `HarnessComplete`. It is a client of the same `OtborRpcs`
group as the operator CLI and uses the same HTTP NDJSON transport.

## Install and run

```sh
bun run link:harness     # installs otbor-harness into ~/.bun/bin
otbor-harness
```

Or directly from the repository:

```sh
bun run harness
```

## Configuration

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `OTBOR_API_URL` | no | `http://127.0.0.1:3001/rpc` | Cloud RPC endpoint |
| `OTBOR_HARNESS_ID` | yes | — | Harness id from `otbor harness register` |
| `OTBOR_HARNESS_TOKEN` | yes | — | Device token shown once at registration |
| `OTBOR_HARNESS_KINDS` | no | `inference` | Comma separated `inference` / `browser` |
| `OTBOR_HARNESS_ACCOUNTS` | no | registered accounts | Comma separated `hh_account` ids |
| `OTBOR_HARNESS_WAIT_SECONDS` | no | `30` | Lease long-poll, `0..30` |
| `OTBOR_HARNESS_ONCE` | no | `false` | Read one lease, then exit |

The ACP agent itself is configured by the `@otbor/acp` package:
`OTBOR_ACP_BIN` (default `opencode`), `OTBOR_ACP_CWD` and
`OTBOR_ACP_TIMEOUT_SECONDS`.

## Behaviour

- Inference: decode the job payload as `InferencePayload`, apply `payload.model`
  through `session/set_config_option` when the agent supports it, run one ACP
  prompt, and complete as `prepared` with `{ text, model, usage,
  providerResponse, durationMs }` artifacts. ACP failures and an unavailable
  agent complete as `inference_failed`.
- Heartbeat every 30 seconds while the prompt runs. A `ok: false` answer (or a
  heartbeat transport error) stops the prompt and skips completion: the lease
  may belong to another performer.
- Browser jobs complete as `blocked` with an explicit message. The browser
  executor is a separate workstream; this package does not pretend to click.

## Known limitations

- If the agent rejects the requested model, the harness logs a warning and uses
  the session default; the artifacts record the model that actually answered.
- A payload `jsonSchema` is appended to the prompt as an instruction. The
  harness does not validate the answer against it.
- Results are not cached by job id locally; a re-leased job runs the prompt
  again. The cloud's lease and retry rules still make that safe.
