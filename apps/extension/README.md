# @otbor/extension

Расширение для Chrome и Zen/Firefox (MV3). Без фреймворка: `bun build.ts`
собирает одни и те же исходники в `dist/chrome` и `dist/firefox`.

- **Страница вакансии** (`/vacancy/<id>`): состояние страницы (`HH-Lux-InitialState`)
  разбирается теми же парсерами, что и в CLI (`@otbor/hh`), вакансия уходит в
  `VacanciesUpsert`, затем считается решение (`VacanciesEvaluate`). Справа внизу
  панель: сопроводительное, тест, решение/fit, отклики, чёрный список.
- **Поиск** (`/search/vacancy`): карточки сохраняются как заглушки, рядом с каждой
  появляется плашка из базы (fit, письмо, тест, «откликнулись»).
- Все запросы идёт через background по тому же `RpcGroup`, что и веб и CLI; новый
  только `VacanciesLookup` (чтение).

## Установка

```bash
bun run extension:build
```

- Chrome: `chrome://extensions` → режим разработчика → «Загрузить распакованное» → `apps/extension/dist/chrome`.
- Zen/Firefox: `about:debugging#/runtime/this-firefox` → «Загрузить временное дополнение» →
  `apps/extension/dist/firefox/manifest.json`. В MV3 Firefox доступ к сайтам не выдаётся сам:
  `about:addons` → otbor → Разрешения → включить доступ к hh.ru и 127.0.0.1.

Адрес API (по умолчанию `http://127.0.0.1:3001/rpc`) и веба меняются в popup.
