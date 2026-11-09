import type { HarnessId } from "@otbor/contract"
import { OtborRpcs, type OtborApi } from "@otbor/contract"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { hhStoragePath } from "./profile.ts"

/**
 * Где харнесс берёт cookies аккаунта hh.ru (Playwright storageState как
 * JSON-текст) и куда возвращает обновлённые.
 *
 * Профиль Chrome на диске больше не используется: он запирается одним
 * процессом, и аккаунт нельзя было открыть из двух мест. Состояние живёт в
 * облаке, каждая задача получает свой изолированный контекст.
 */
export interface LoadedSession {
  readonly state: string
  /** Версия, с которой состояние было прочитано; `null` у локального файла. */
  readonly version: number | null
}

export interface SessionStore {
  readonly load: (profile: string) => Promise<LoadedSession | null>
  /**
   * Возвращает обновлённые cookies. Облако отклоняет запись с устаревшей версией,
   * чтобы параллельная задача не затёрла более свежее состояние; это не ошибка.
   */
  readonly save: (profile: string, state: string, baseVersion: number | null) => Promise<void>
}

/** Локальный файл `storage-state.json`: для тестов и разовых запусков без облака. */
export const fileSessionStore = (
  env: Readonly<Record<string, string | undefined>> = process.env
): SessionStore => ({
  load: async (profile) => {
    try {
      return { state: await readFile(hhStoragePath(profile, env), "utf8"), version: null }
    } catch {
      return null
    }
  },
  save: async (profile, state) => {
    const path = hhStoragePath(profile, env)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, state, { mode: 0o600 })
  }
})

/** Cookies в облаке через те же RPC, что у остального харнесса (по токену харнесса). */
export const rpcSessionStore = (input: {
  readonly url: string
  readonly harnessId: HarnessId
  readonly token: string
}): SessionStore => {
  const protocol = RpcClient.layerProtocolHttp({ url: input.url }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer)
  )
  const call = <A>(use: (api: OtborApi) => Effect.Effect<A, unknown>): Promise<A> =>
    Effect.runPromise(
      Effect.scoped(Effect.flatMap(RpcClient.make(OtborRpcs), (api) => use(api as OtborApi))).pipe(
        Effect.provide(protocol)
      ) as Effect.Effect<A>
    )
  return {
    load: (profile) =>
      call((api) =>
        api.HarnessSessionGet({ harnessId: input.harnessId, token: input.token, sessionProfile: profile })
      ).then((result: { state: string | null; version: number | null }) =>
        result.state === null ? null : { state: result.state, version: result.version }
      ),
    save: (profile, state, baseVersion) =>
      call((api) =>
        api.HarnessSessionPut({
          harnessId: input.harnessId,
          token: input.token,
          sessionProfile: profile,
          state,
          baseVersion
        })
      ).then(() => undefined)
  }
}
