import {
  clearProxyFile,
  engineHealthy,
  engineVersion,
  loadProxyConfig,
  maskSubscription,
  probeThroughProxy,
  proxyFilePath,
  proxyLabel,
  proxyState,
  readProxyFile,
  resolveProxyConfig,
  startEngine,
  stopEngine,
  waitForNodes,
  writeProxyFile,
  type ProxyConfig,
  type ProxyFileConfig,
  type ProxyRotate
} from "@otbor/crawler"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"

const fail = (message: string): never => {
  throw new Error(message)
}

const configOrFail = (): ProxyConfig => {
  const config = loadProxyConfig()
  if (config === null) {
    return fail(
      "Прокси не настроен. Выполните `otbor proxy set <ссылка>` " +
        "или задайте OTBOR_PROXY_URL."
    )
  }
  return config
}

const printStatus = (config: ProxyConfig): Effect.Effect<void> =>
  Effect.gen(function*() {
    const reachable = config.controller === null
      ? false
      : yield* Effect.tryPromise(() => engineHealthy(config)).pipe(
          Effect.match({ onFailure: () => false, onSuccess: (value) => value })
        )
    const version = reachable
      ? yield* Effect.tryPromise(() => engineVersion(config)).pipe(
          Effect.match({ onFailure: () => null, onSuccess: (value) => value })
        )
      : null
    const state = reachable
      ? yield* Effect.tryPromise(() => proxyState(config)).pipe(
          Effect.match({ onFailure: () => null, onSuccess: (value) => value })
        )
      : null

    yield* Console.log(`source:      ${config.source} (${config.origin})`)
    yield* Console.log(`proxy:       ${config.url}`)
    yield* Console.log(`label:       ${proxyLabel(config)}`)
    if (config.subscriptionUrl !== null) {
      yield* Console.log(`subscription: ${maskSubscription(config.subscriptionUrl)}`)
    }
    yield* Console.log(`controller:  ${config.controller ?? "-"}`)
    yield* Console.log(
      `engine:      ${
        config.source === "endpoint"
          ? "external"
          : reachable
            ? `ok${version === null ? "" : ` ${version}`}`
            : "down"
      }`
    )
    yield* Console.log(`group:       ${config.group}`)
    yield* Console.log(`node:        ${state?.current ?? "-"}`)
    yield* Console.log(`nodes:       ${state?.all.length ?? 0}`)
    yield* Console.log(`rotate:      ${config.rotate} (max ${config.maxRotations})`)
    yield* Console.log(`settings:    ${proxyFilePath()}`)
  })

const set = Command.make(
  "set",
  {
    url: Argument.String("url").pipe(
      Argument.withDescription("Subscription URL, or endpoint with --endpoint"),
      Argument.optional
    ),
    endpoint: Flag.Boolean("endpoint").pipe(
      Flag.withDescription("The URL is a ready HTTP proxy, not a subscription"),
      Flag.withDefault(false)
    ),
    rotate: Flag.String("rotate").pipe(
      Flag.withDescription("off | captcha"),
      Flag.optional
    ),
    maxRotations: Flag.Int("max-rotations").pipe(
      Flag.withDescription("IP switches per run, 0–20"),
      Flag.optional
    ),
    port: Flag.Int("port").pipe(
      Flag.withDescription("Local mihomo mixed port"),
      Flag.optional
    ),
    controllerPort: Flag.Int("controller-port").pipe(
      Flag.withDescription("Local mihomo controller port"),
      Flag.optional
    ),
    controller: Flag.String("controller").pipe(
      Flag.withDescription("Already running mihomo controller URL"),
      Flag.optional
    ),
    secret: Flag.String("secret").pipe(
      Flag.withDescription("mihomo controller secret"),
      Flag.optional
    ),
    clear: Flag.Boolean("clear").pipe(
      Flag.withDescription("Remove saved proxy settings"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function*({
    url,
    endpoint,
    rotate,
    maxRotations,
    port,
    controllerPort,
    controller,
    secret,
    clear
  }) {
    if (clear) {
      const removed = clearProxyFile()
      const envConfig = loadProxyConfig(process.env, null)
      yield* Console.log(
        removed ? `Настройки удалены: ${proxyFilePath()}` : "Сохранённых настроек не было."
      )
      if (envConfig !== null) {
        yield* Console.log(
          "Внимание: OTBOR_PROXY_* в окружении всё ещё задают прокси и имеют приоритет."
        )
      }
      return
    }

    const existing = readProxyFile() ?? {}
    const file: ProxyFileConfig = { ...existing }
    const value = Option.getOrUndefined(url)?.trim()

    if (value !== undefined && value !== "") {
      if (endpoint) {
        file.url = value
        delete file.subscriptionUrl
        delete file.port
        delete file.controllerPort
      } else {
        file.subscriptionUrl = value
        delete file.url
      }
    }

    if (file.url === undefined && file.subscriptionUrl === undefined) {
      return fail(
        "Сохранённых настроек нет: нужна ссылка подписки или --endpoint."
      )
    }

    const rotateValue = Option.getOrUndefined(rotate)
    if (rotateValue !== undefined) {
      if (rotateValue !== "off" && rotateValue !== "captcha") {
        return fail(`Ротация: ожидается off или captcha (получено «${rotateValue}»).`)
      }
      file.rotate = rotateValue as ProxyRotate
    }
    assignNumber(file, "maxRotations", maxRotations, "max-rotations", 0, 20)
    assignNumber(file, "port", port, "port", 1, 65535)
    assignNumber(file, "controllerPort", controllerPort, "controller-port", 1, 65535)

    const controllerValue = Option.getOrUndefined(controller)
    if (controllerValue !== undefined) file.controller = controllerValue
    const secretValue = Option.getOrUndefined(secret)
    if (secretValue !== undefined) file.secret = secretValue

    let config: ProxyConfig | null
    try {
      config = resolveProxyConfig({}, file)
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
    if (config === null) return fail("Не удалось разобрать настройки прокси.")

    const path = writeProxyFile(file)
    yield* Console.log(`Сохранено: ${path}`)
    yield* Console.log(`  ${config.source === "subscription" ? `подписка ${maskSubscription(config.subscriptionUrl)}` : `прокси ${config.url}`}`)
    yield* Console.log(
      `  локально: ${config.url}${config.controller === null ? "" : ` · контроллер: ${config.controller}`}`
    )
    yield* Console.log(`  ротация: ${config.rotate} (до ${config.maxRotations})`)
  })
).pipe(Command.withDescription("Save a proxy subscription or a ready HTTP proxy"))

const status = Command.make(
  "status",
  {
    json: Flag.Boolean("json").pipe(Flag.withDefault(false))
  },
  Effect.fn(function*({ json }) {
    const config = configOrFail()
    if (!json) {
      yield* printStatus(config)
      return
    }
    const reachable = config.controller === null
      ? false
      : yield* Effect.tryPromise(() => engineHealthy(config)).pipe(
          Effect.match({ onFailure: () => false, onSuccess: (value) => value })
        )
    const state = reachable
      ? yield* Effect.tryPromise(() => proxyState(config)).pipe(
          Effect.match({ onFailure: () => null, onSuccess: (value) => value })
        )
      : null
    yield* Console.log(
      JSON.stringify(
        {
          source: config.source,
          origin: config.origin,
          url: config.url,
          label: proxyLabel(config),
          subscription: maskSubscription(config.subscriptionUrl),
          controller: config.controller,
          reachable,
          group: config.group,
          currentNode: state?.current ?? null,
          nodes: state?.all.length ?? 0,
          rotate: config.rotate,
          maxRotations: config.maxRotations,
          settings: proxyFilePath()
        },
        null,
        2
      )
    )
  })
).pipe(Command.withDescription("Show proxy settings and mihomo state"))

const up = Command.make(
  "up",
  {},
  Effect.fn(function*() {
    const config = configOrFail()
    if (config.source === "endpoint") {
      yield* Console.log(`Прокси задан готовым адресом (${proxyLabel(config)}), запускать нечего.`)
      return
    }
    const ready = yield* Effect.tryPromise({
      try: async () => {
        await startEngine(config, { timeoutMs: 60_000 })
        return waitForNodes(config)
      },
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    })
    if (!ready) {
      yield* Console.error("mihomo запущен, но список нод пуст. Проверьте подписку.")
      process.exitCode = 1
      return
    }
    yield* printStatus(config)
  })
).pipe(Command.withDescription("Write mihomo config and start the proxy container"))

const down = Command.make(
  "down",
  {},
  Effect.fn(function*() {
    yield* Effect.tryPromise({
      try: () => stopEngine(),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    })
    yield* Console.log("mihomo остановлен.")
  })
).pipe(Command.withDescription("Stop the proxy container"))

const test = Command.make(
  "test",
  {},
  Effect.fn(function*() {
    const config = configOrFail()
    const delay = yield* Effect.tryPromise(() => probeThroughProxy(config)).pipe(
      Effect.match({ onFailure: () => null, onSuccess: (value) => value })
    )
    if (delay === null) {
      yield* Console.log(`Прокси не ответил на hh.ru: ${proxyLabel(config)}`)
      process.exitCode = 1
      return
    }
    yield* Console.log(`hh.ru через ${proxyLabel(config)}: ok (${delay} ms)`)
  })
).pipe(Command.withDescription("Probe hh.ru through the configured proxy"))

export const proxyCommand = Command.make("proxy").pipe(
  Command.withSubcommands([set, status, up, down, test]),
  Command.withDescription("Proxy settings for hh.ru crawling")
)

const assignNumber = (
  file: ProxyFileConfig,
  key: "maxRotations" | "port" | "controllerPort",
  value: Option.Option<number>,
  flag: string,
  min: number,
  max: number
): void => {
  const number = Option.getOrUndefined(value)
  if (number === undefined) return
  if (!Number.isInteger(number) || number < min || number > max) {
    fail(`--${flag}: ожидается целое ${min}–${max} (получено ${number}).`)
  }
  file[key] = number
}
