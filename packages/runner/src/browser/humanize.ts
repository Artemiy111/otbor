import { Effect } from "effect"
import type { Locator, Page } from "playwright"

/**
 * Человеческая «разминка» перед откликом: чуть подвигать мышью, пролистать
 * страницу, подвести курсор к кнопке и только потом нажать.
 *
 * Всё делается на уже открытой странице отклика и не добавляет навигаций.
 * Суммарная добавка ограничена бюджетом (по умолчанию 5 секунд) на всю задачу:
 * каждый шаг получает остаток и обрывается по таймауту. Любой сбой разминки
 * молча игнорируется: она никогда не меняет исход отклика и не кликает ничего,
 * кроме самой кнопки отправки, которую нажимает вызывающий код.
 */

export interface HumanizerOptions {
  /** Сколько всего времени разминка может добавить к задаче. */
  readonly budgetMs?: number
  /** Источник случайности; в тестах подменяется детерминированным. */
  readonly random?: () => number
}

export interface Humanizer {
  /** Мышь и прокрутка на странице до заполнения формы. */
  readonly warmUp: (page: Page) => Effect.Effect<void>
  /**
   * Подводит курсор к кнопке и возвращает точку внутри неё (относительно
   * кнопки), в которую стоит кликнуть. `undefined` - кликать как обычно.
   */
  readonly approach: (page: Page, target: Locator) => Effect.Effect<{ readonly x: number; readonly y: number } | undefined>
  /** Сколько бюджета осталось. */
  readonly remainingMs: () => number
}

/** Доли бюджета: разминка в начале и подход к кнопке перед кликом. */
const WARM_UP_SHARE = 0.5
const APPROACH_SHARE = 0.35

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** Точка на квадратичной кривой Безье. */
const bezier = (
  from: { readonly x: number; readonly y: number },
  control: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  t: number
) => ({
  x: (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * control.x + t * t * to.x,
  y: (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * control.y + t * t * to.y
})

/** Выключенный гуманайзер: ничего не делает и ничего не стоит. */
export const noHumanizer: Humanizer = {
  warmUp: () => Effect.void,
  approach: () => Effect.succeed(undefined),
  remainingMs: () => 0
}

export const makeHumanizer = (options: HumanizerOptions = {}): Humanizer => {
  const total = Math.max(0, options.budgetMs ?? 5_000)
  const random = options.random ?? Math.random
  let spent = 0

  const between = (low: number, high: number) => low + random() * (high - low)
  const remaining = () => Math.max(0, total - spent)

  /** Пауза не длиннее остатка бюджета; списывает фактически потраченное. */
  const pause = (ms: number) => {
    const take = Math.min(Math.max(0, ms), remaining())
    if (take <= 0) return Effect.void
    spent += take
    return Effect.sleep(`${Math.round(take)} millis`)
  }

  /** Шаг, обёрнутый в таймаут по остатку бюджета; сбой игнорируется. */
  const guarded = <A>(step: Effect.Effect<A, unknown>, limitMs: number) => {
    const limit = Math.min(limitMs, remaining())
    if (limit <= 0) return Effect.void
    return step.pipe(
      Effect.timeoutOption(`${Math.round(limit)} millis`),
      Effect.asVoid,
      Effect.ignore,
      Effect.catchDefect(() => Effect.void)
    )
  }

  const attempt = <A>(use: () => Promise<A>) =>
    Effect.tryPromise({ try: use, catch: (cause) => cause })

  /** Ведёт мышь по кривой за `durationMs`; позицию `from` отслеживает вызывающий. */
  const glide = (
    page: Page,
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs: number
  ) =>
    Effect.gen(function*() {
      const points = Math.max(4, Math.round(durationMs / 18))
      const control = {
        x: (from.x + to.x) / 2 + between(-80, 80),
        y: (from.y + to.y) / 2 + between(-60, 60)
      }
      for (let i = 1; i <= points; i++) {
        // Ease-in-out: курсор разгоняется и замедляется у цели.
        const raw = i / points
        const t = raw * raw * (3 - 2 * raw)
        const at = bezier(from, control, to, t)
        yield* attempt(() => page.mouse.move(at.x, at.y))
        yield* pause(durationMs / points)
      }
      from.x = to.x
      from.y = to.y
    })

  const viewport = (page: Page) => page.viewportSize() ?? { width: 1280, height: 720 }

  const warmUp: Humanizer["warmUp"] = (page) => {
    const share = total * WARM_UP_SHARE
    return guarded(
      Effect.gen(function*() {
        const size = viewport(page)
        const cursor = { x: between(size.width * 0.2, size.width * 0.8), y: between(size.height * 0.2, size.height * 0.7) }
        yield* attempt(() => page.mouse.move(cursor.x, cursor.y))
        yield* pause(between(120, 300))
        // Пролистать вниз и частично назад: как будто пробегаешь глазами.
        const down = Math.round(between(180, 420))
        yield* attempt(() => page.mouse.wheel(0, down))
        yield* pause(between(200, 450))
        yield* glide(
          page,
          cursor,
          { x: clamp(cursor.x + between(-160, 160), 20, size.width - 20), y: clamp(cursor.y + between(-100, 120), 20, size.height - 20) },
          between(250, 450)
        )
        yield* attempt(() => page.mouse.wheel(0, -Math.round(down * between(0.3, 0.8))))
        yield* pause(between(150, 350))
      }),
      share
    )
  }

  const approach: Humanizer["approach"] = (page, target) => {
    const share = total * APPROACH_SHARE
    let point: { x: number; y: number } | undefined
    return guarded(
      Effect.gen(function*() {
        yield* attempt(() => target.scrollIntoViewIfNeeded({ timeout: 1_000 }))
        const box = yield* attempt(() => target.boundingBox())
        if (box === null || box.width < 4 || box.height < 4) return
        // Не в центр: где-то в средней части кнопки.
        const inside = { x: box.width * between(0.25, 0.75), y: box.height * between(0.3, 0.7) }
        const size = viewport(page)
        const from = { x: between(size.width * 0.3, size.width * 0.7), y: between(size.height * 0.3, size.height * 0.7) }
        yield* glide(page, from, { x: box.x + inside.x, y: box.y + inside.y }, between(350, 600))
        yield* pause(between(80, 220))
        point = inside
      }),
      share
    ).pipe(Effect.map(() => point))
  }

  return { warmUp, approach, remainingMs: remaining }
}
