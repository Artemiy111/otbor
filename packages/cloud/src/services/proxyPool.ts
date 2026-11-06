import {
  assignWorkerNodes,
  waitForNodes,
  workerProxyConfig,
  type ProxyConfig
} from "@otbor/crawler"
import { Effect, Semaphore } from "effect"

/**
 * Parallel hh.ru workers, each with its own exit IP.
 *
 * mihomo exposes one loopback listener and one selector group per worker.
 * A worker takes a slot, runs on `workerProxyConfig(config, slot)` and, when
 * hh.ru blocks it, rotates only its own group. Requests carry no cookies, so
 * a worker is just "port + node".
 *
 * The pool is process-wide on purpose: schedules of different kinds run side
 * by side in the worker process and must share the same slots, otherwise two
 * runners could land on one IP.
 */

interface Pool {
  readonly size: number
  readonly permits: Semaphore.Semaphore
  readonly free: Array<number>
}

let pool: Pool | null = null
let nodes: Promise<ReadonlyArray<string>> | null = null

const poolFor = (size: number): Pool => {
  if (pool === null || pool.size !== size) {
    pool = {
      size,
      permits: Semaphore.makeUnsafe(size),
      free: Array.from({ length: size }, (_, index) => size - 1 - index)
    }
  }
  return pool
}

/** Forget the node assignment, e.g. after the subscription or engine changed. */
export const resetProxyWorkers = (): void => {
  nodes = null
}

/** How many loops may run in parallel for this config. */
export const proxyWorkerCount = (config: ProxyConfig | null): number =>
  config !== null && config.source === "subscription" ? config.workers : 1

const ensureNodes = (config: ProxyConfig): Effect.Effect<void> =>
  Effect.tryPromise({
    try: () => {
      nodes ??= waitForNodes(config).then(() => assignWorkerNodes(config, config.workers))
      return nodes
    },
    catch: (error) => error
  }).pipe(
    Effect.catch((error) => {
      nodes = null
      return Effect.logWarning(`proxy workers: node assignment failed: ${String(error)}`)
    }),
    Effect.asVoid
  )

/**
 * Runs `use` on one worker's proxy config. Without a subscription there is a
 * single exit, so the config is passed through unchanged.
 */
export const withProxyWorker = <A, E, R>(
  config: ProxyConfig | null,
  use: (worker: ProxyConfig | null, slot: number) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => {
  if (config === null || config.source !== "subscription") return use(config, 0)
  const current = poolFor(config.workers)
  return current.permits.withPermits(1)(
    Effect.acquireUseRelease(
      Effect.sync(() => current.free.pop() ?? 0),
      (slot) =>
        ensureNodes(config).pipe(
          Effect.andThen(use(workerProxyConfig(config, slot), slot))
        ),
      (slot) => Effect.sync(() => void current.free.push(slot))
    )
  )
}
