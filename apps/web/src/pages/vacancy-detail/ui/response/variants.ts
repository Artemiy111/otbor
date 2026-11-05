export const RESPONSE_VARIANTS = [
  { id: "chips", label: "Чипы", hint: "Чип на каждое резюме, текущее подсвечено" },
  { id: "rows", label: "Список", hint: "Строка на каждое резюме: статус, дата, письмо" },
  { id: "compact", label: "Строка", hint: "Только текущее резюме, остальные в выпадающем списке" }
] as const

export type ResponseVariant = (typeof RESPONSE_VARIANTS)[number]["id"]
