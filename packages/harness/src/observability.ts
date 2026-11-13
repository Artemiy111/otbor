import { Layer, Metric } from "effect"
import { FetchHttpClient } from "effect/http"
import { Otlp, OtlpSerialization } from "effect/observability"

/**
 * Экспорт логов, трейсов и метрик харнесса по OTLP/HTTP встроенными модулями
 * Effect. Слой читает стандартные переменные OpenTelemetry и отправляет сигнал,
 * только когда задан `OTEL_EXPORTER_OTLP_ENDPOINT` (или адрес для конкретного
 * сигнала) и `OTEL_{LOGS,TRACES,METRICS}_EXPORTER=otlp`. Без них слой пуст, и
 * харнесс работает как раньше: локальный стек (`bun run obs:up`) не обязателен.
 *
 * `loggerMergeWithExisting` оставляет терминальный логгер на месте: строки
 * `captcha: ...` по-прежнему видны в терминале и в `logs/harness.log`, а сверху
 * те же записи уходят в OTLP. Недоступный коллектор харнессу не мешает:
 * экспортёр отключает себя на минуту и пробует снова.
 *
 * Тот же слой есть у облака (`packages/cloud/src/observability.ts`); пакеты не
 * импортируют друг друга, поэтому маленький слой повторён здесь.
 */
export const telemetryLayer = (serviceName: string) =>
  Layer.mergeAll(
    Otlp.layerFromConfig({
      resource: {
        serviceName,
        attributes: { "service.namespace": "otbor" }
      },
      loggerMergeWithExisting: true
    }),
    // Счётчики запущенных, активных и упавших файберов рантайма.
    Layer.succeed(Metric.FiberRuntimeMetrics, Metric.FiberRuntimeMetricsImpl)
  ).pipe(
    Layer.provide(OtlpSerialization.layerJson),
    Layer.provide(FetchHttpClient.layer)
  )
