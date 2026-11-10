/**
 * Откуда пришли на страницу вакансии: строка запроса списка («?view=apply&q=go»),
 * чтобы ссылка «Вакансии» вела назад к тем же фильтрам, а не к чистому списку.
 * Хранится в sessionStorage: переживает перезагрузку вкладки, но не живёт дольше неё.
 */
const KEY = "otbor.vacancies-return"

export const rememberVacanciesSearch = (search: string): void => {
  try {
    window.sessionStorage.setItem(KEY, search)
  } catch {
    // Без хранилища ссылка просто ведёт на чистый список.
  }
}

/** Путь списка вакансий с запомненными фильтрами. */
export const vacanciesReturnPath = (): string => {
  try {
    const search = window.sessionStorage.getItem(KEY) ?? ""
    return search.startsWith("?") && search.length > 1 ? `/vacancies${search}` : "/vacancies"
  } catch {
    return "/vacancies"
  }
}
