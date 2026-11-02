# Cloud integration tests

These tests exercise `packages/cloud` against a **real Postgres** instance: RLS,
harness/account binding, queue fencing, at-most-once submit and the account
lease. They are opt-in so plain `bun test` stays green without Docker.

## Run

```sh
bun run test:integration
```

That uses the local `docker-compose.yml` server
(`postgres://otbor:otbor@localhost:55432/postgres`). To point at another server:

```sh
OTBOR_TEST_DATABASE_URL=postgres://user:pass@host:5432/postgres bun test packages/cloud/test/integration
```

`OTBOR_TEST_DATABASE_URL` is a **server** address. Its database name is ignored:
each run creates a throwaway `otbor_it_<pid>_<random>` database on that server,
applies the real migrations from `packages/cloud/migrations`, and drops it in
`afterAll`. The demo `otbor` database is never opened for writes.

If `pg_roles` already contains `otbor_runtime`, migrations reuse it; otherwise
the first run creates it, exactly as `bun run db:migrate` does.

## What is covered

1. **RLS** — user A cannot select user B's `hh_account`, `harness`,
   `harness_account`, `application` or `harness_jobs` rows.
2. **Multi-account binding** — one harness serves two accounts; an account can
   belong to one harness only; rebinding moves the row; leases only return jobs
   of bound accounts.
3. **Queue fencing** — heartbeat extends the lease, a stale epoch/lease is
   rejected on completion, and an expired lease is recovered to `pending` or
   `dead` depending on attempts.
4. **At-most-once submit** — a second submit enqueue returns the same row;
   `clicked` parks the job in `needs_reconcile`, creates a reconcile job and
   leaves the application `submitting`; a successful reconcile marks it
   `submitted`.
5. **Account lease** — two holders cannot serve the same account at once; after
   the lease expires a different holder takes over and the epoch increments;
   rebinding or revoking a harness releases the old runtime lease.
6. **Inference** — enqueue attaches the default hh account, a token-authenticated
   harness leases and completes with artifacts, `inference_failed` retries to
   `dead`, `result` round-trips, another user cannot read the job, and migration
   0006 accepts the `inference` stage.

## Notes

- Setup inserts users, accounts and vacancies as the schema owner; assertions
  and service calls go through the real `Database.asUser` / `CurrentUser` layers.
- Timestamps are expired with SQL (`lease_until = now() - interval`) instead of
  sleeping.
- The `DATABASE_URL` environment variable is set to the throwaway database for
  the duration of the suite and removed in `afterAll`.
