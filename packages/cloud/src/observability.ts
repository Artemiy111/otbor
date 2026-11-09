import { Duration, Effect, Layer, Metric } from "effect"
import { FetchHttpClient } from "effect/http"
import { Otlp, OtlpSerialization } from "effect/observability"

/**
 * Экспорт логов, трейсов и метрик по OTLP/HTTP встроенными модулями Effect.
 *
 * Слой читает стандартные переменные OpenTelemetry. Сигнал уходит наружу,
 * только когда задан `OTEL_EXPORTER_OTLP_ENDPOINT` (или адрес для конкретного
 * сигнала) и `OTEL_{LOGS,TRACES,METRICS}_EXPORTER=otlp`. Без них слой пуст, и
 * процесс работает как раньше: локальный стек (`bun run obs:up`) не обязателен.
 *
 * OTLP-логгер добавляется к уже установленным логгерам, поэтому слой
 * подключается поверх терминального и файлового, а не вместо них.
 *
 * Недоступный коллектор приложению не мешает: экспортёр отключает себя на
 * минуту и пробует снова.
 */
export const telemetryLayer = (serviceName: string) =>
  Layer.mergeAll(
    Otlp.layerFromConfig({
      resource: {
        serviceName,
        attributes: { "service.namespace": "otbor" }
      }
    }),
    // Счётчики запущенных, активных и упавших файберов рантайма.
    Layer.succeed(Metric.FiberRuntimeMetrics, Metric.FiberRuntimeMetricsImpl)
  ).pipe(
    Layer.provide(OtlpSerialization.layerJson),
    Layer.provide(FetchHttpClient.layer)
  )

const rpcRequests = Metric.counter("otbor_rpc_requests", {
  description: "Число вызовов RPC по методу и исходу",
  incremental: true
})

const rpcDuration = Metric.timer("otbor_rpc_duration", {
  description: "Длительность вызова RPC",
  boundaries: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000]
})

/** Учитывает один завершённый вызов RPC в счётчике и гистограмме длительности. */
export const recordRpc = (method: string, outcome: "ok" | "failed", millis: number): Effect.Effect<void> => {
  const attributes = { method, outcome }
  return Effect.andThen(
    Metric.update(Metric.withAttributes(rpcRequests, attributes), 1),
    Metric.update(Metric.withAttributes(rpcDuration, attributes), Duration.millis(millis))
  )
}
