/** Tooltip body in the shadcn chart style; Unovis wants an HTML string. */
export interface TipRow {
  readonly label: string
  readonly value: string
  readonly color?: string
}

const escape = (text: string): string =>
  text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char)

export const tip = (title: string, rows: ReadonlyArray<TipRow>): string =>
  `<div class="grid min-w-32 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
    <div class="font-medium">${escape(title)}</div>
    ${rows
      .map(
        (row) => `<div class="flex items-center gap-2">
          ${row.color === undefined ? "" : `<span class="h-2.5 w-2.5 shrink-0 rounded-[2px]" style="background:${row.color}"></span>`}
          <span class="flex-1 text-muted-foreground">${escape(row.label)}</span>
          <span class="font-mono font-medium tabular-nums">${escape(row.value)}</span>
        </div>`
      )
      .join("")}
  </div>`

export const rub = (value: number): string =>
  `${new Intl.NumberFormat("ru-RU").format(Math.round(value))} ₽`

/** 185 000 → "185k", for axis ticks. */
export const thousands = (value: number): string =>
  value >= 1000 ? `${Math.round(value / 1000)}k` : String(Math.round(value))

export const SENIORITY_LABELS: Record<string, string> = {
  junior: "Junior",
  middle: "Middle",
  senior: "Senior",
  lead: "Lead",
  unknown: "Не указан"
}
export const SENIORITY_ORDER = ["junior", "middle", "senior", "lead", "unknown"] as const
export const seniorityLabel = (key: string): string => SENIORITY_LABELS[key] ?? key

export const WORK_FORMAT_LABELS: Record<string, string> = {
  remote: "Удалённо",
  hybrid: "Гибрид",
  office: "В офисе",
  unspecified: "Не указан"
}
