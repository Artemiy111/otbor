/**
 * Сырые тексты ошибок приходят от сервера на английском и бывают длинными.
 * Здесь они превращаются в короткую русскую причину; незнакомое остаётся
 * пустым, и вызывающий код пишет общую формулировку.
 */
export const plainError = (raw: string | null | undefined): string | null => {
  if (raw === null || raw === undefined) return null
  const text = raw.trim().toLowerCase()
  if (text === "" || text === "none" || text === "null") return null
  if (text.includes("captcha")) return "hh попросил капчу"
  if (text.includes("econnreset") || text.includes("network") || text.includes("socket") || text.includes("fetch")) {
    return "сбой сети"
  }
  if (text.includes("timeout") || text.includes("timed out") || text.includes("etimedout")) {
    return "истекло время ожидания"
  }
  if (text.includes("429") || text.includes("rate")) return "hh ограничил частоту запросов"
  if (text.includes("403") || text.includes("forbidden")) return "hh закрыл доступ"
  if (text.includes("resume") && text.includes("select")) return "резюме не нашлось в форме hh"
  if (text.includes("session") || text.includes("login") || text.includes("auth")) return "вход в hh не подтверждён"
  return null
}
