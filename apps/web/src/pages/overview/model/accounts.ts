import type { Overview } from "@otbor/contract"
import type { StatusTone } from "@/shared/lib/status"

type Account = Overview["accounts"][number]
type Mode = "off" | "drafts" | "auto"

export interface ModeChip {
  readonly id: string
  readonly label: string
  readonly tone: StatusTone
}

const MODE_LABEL: Record<Mode, string> = { off: "выключено", drafts: "только черновики", auto: "автоотправка" }
const MODE_TONE: Record<Mode, StatusTone> = { off: "neutral", drafts: "info", auto: "success" }

/**
 * Чипы режимов автоотклика. Строки по резюме важнее строки аккаунта; если у всех
 * резюме один режим, показываем один чип без названий.
 */
export const modeChips = (account: Account): ReadonlyArray<ModeChip> => {
  const perResume = account.autoModes.filter((row) => row.resumeId !== null)
  const rows = perResume.length > 0 ? perResume : account.autoModes
  if (rows.length === 0) return [{ id: "off", label: `Автоотклики ${MODE_LABEL.off}`, tone: "neutral" }]
  const modes = new Set(rows.map((row) => row.autoMode))
  if (modes.size === 1) {
    const mode = rows[0]!.autoMode
    return [{ id: mode, label: mode === "auto" ? "Автоотправка" : mode === "drafts" ? "Только черновики" : "Автоотклики выключены", tone: MODE_TONE[mode] }]
  }
  return rows.map((row) => ({
    id: row.resumeId ?? "account",
    label: `${row.resumeTitle ?? "Весь аккаунт"}: ${MODE_LABEL[row.autoMode]}`,
    tone: MODE_TONE[row.autoMode]
  }))
}

export const sessionText = (session: Account["session"]): { readonly text: string; readonly tone: StatusTone } =>
  session === "ok"
    ? { text: "вход выполнен", tone: "success" }
    : session === "expired"
      ? { text: "вход истёк", tone: "danger" }
      : session === "blocked"
        ? { text: "hh заблокировал вход", tone: "danger" }
        : { text: "вход не выполнялся", tone: "neutral" }
