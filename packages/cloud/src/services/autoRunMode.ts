/**
 * Режим строки фильтра, которая ведёт заявку, и режим, в котором раннер
 * заявку создал (`application.auto_run`).
 *
 * `auto`-заявка идёт только пока строка `auto`: дальше возможна отправка, а её
 * разрешает только этот режим. `drafts`-заявка готовится (форма, письмо, кит;
 * никогда не отправка) пока строка `drafts` ИЛИ `auto`: после переключения
 * аккаунта с `drafts` на `auto` черновики не должны зависать без кита.
 * `off` останавливает всё.
 */
export type GoverningMode = "off" | "drafts" | "auto"

export const runnerMayAdvance = (mode: GoverningMode, autoRun: "drafts" | "auto"): boolean =>
  autoRun === "auto" ? mode === "auto" : mode !== "off"
