import type { HarnessModel } from "./types";

/** Усилие по умолчанию, если провайдер его поддерживает. */
export const DEFAULT_EFFORT = "low";

/**
 * Подбирает усилие при смене модели: текущее значение сохраняется, если оно
 * допустимо, иначе берётся `low`, затем значение провайдера, затем первое.
 */
export function resolveHarnessEffort(
  model: Pick<HarnessModel, "efforts" | "defaultEffort"> | null | undefined,
  current: string,
): string {
  if (!model || model.efforts.length === 0) return "";
  if (model.efforts.includes(current)) return current;
  if (model.efforts.includes(DEFAULT_EFFORT)) return DEFAULT_EFFORT;
  if (
    model.defaultEffort !== undefined &&
    model.efforts.includes(model.defaultEffort)
  ) {
    return model.defaultEffort;
  }
  return model.efforts[0] ?? "";
}
