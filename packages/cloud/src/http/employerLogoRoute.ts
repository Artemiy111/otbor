import { Cause, Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { Database } from "../db/Database.ts"
import * as EmployerLogoRepository from "../repositories/EmployerLogoRepository.ts"
import { LOGO_DOWNLOAD_LIMIT, shrinkLogo } from "../services/logoShrink.ts"

/** Логотип отдаётся с кэшем браузера: при смене адреса меняется и содержимое по тому же id, поэтому не навсегда. */
const CACHE = "public, max-age=86400"
const DOWNLOAD_TIMEOUT_MS = 10_000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Скачивает картинку с ограничением по времени и по размеру; null при любой неудаче. */
const download = (url: string) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        headers: { accept: "image/*" }
      })
      if (!response.ok) return null
      const length = Number(response.headers.get("content-length") ?? 0)
      if (length > LOGO_DOWNLOAD_LIMIT) return null
      const bytes = new Uint8Array(await response.arrayBuffer())
      return { bytes, contentType: response.headers.get("content-type") ?? "" }
    },
    catch: (error) => error
  })

const imageResponse = (contentType: string, bytes: Uint8Array) =>
  HttpServerResponse.uint8Array(bytes, { contentType, headers: { "cache-control": CACHE } })

/**
 * `GET /employer-logo/:id` — логотип работодателя из базы.
 *
 * Нет сохранённой копии (или адрес в `employer.logo_url` сменился): скачиваем,
 * ужимаем, записываем и отдаём. Не получилось скачать или это не картинка:
 * 302 на исходный адрес hh, чтобы страница не осталась без картинки.
 * Корпус общий, поэтому маршрут без пользователя и работает от владельца.
 */
export const EmployerLogoRoute = Layer.effectDiscard(
  Effect.gen(function*() {
    const router = yield* HttpRouter.HttpRouter
    const database = yield* Database

    yield* router.add(
      "GET",
      "/employer-logo/:id",
      Effect.gen(function*() {
        const id = (yield* HttpRouter.params).id ?? ""
        if (!UUID_RE.test(id)) return HttpServerResponse.empty({ status: 404 })

        const found = yield* database.asOwner((tx) => EmployerLogoRepository.lookup(tx, id))
        if (found === null || found.logoUrl === null) return HttpServerResponse.empty({ status: 404 })
        if (found.stored !== null) return imageResponse(found.stored.contentType, found.stored.bytes)

        const logoUrl = found.logoUrl
        const downloaded = yield* download(logoUrl).pipe(Effect.catch(() => Effect.succeed(null)))
        const shrunk = downloaded === null ? null : yield* Effect.promise(() => shrinkLogo(downloaded.bytes, downloaded.contentType))
        if (shrunk === null) return HttpServerResponse.redirect(logoUrl, { headers: { "cache-control": "no-store" } })

        yield* database
          .asOwner((tx) =>
            EmployerLogoRepository.save(tx, id, {
              sourceUrl: logoUrl,
              contentType: shrunk.contentType,
              bytes: shrunk.bytes,
              originalBytes: shrunk.originalBytes,
              width: shrunk.width,
              height: shrunk.height
            })
          )
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(`employer logo ${id} was not saved: ${Cause.pretty(cause)}`)
            )
          )
        return imageResponse(shrunk.contentType, shrunk.bytes)
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(`employer logo failed: ${Cause.pretty(cause)}`).pipe(
            Effect.as(HttpServerResponse.empty({ status: 500 }))
          )
        )
      )
    )
  })
)
