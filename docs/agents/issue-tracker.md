# Трекер задач: GitHub

Задачи и спецификации этого репозитория живут в GitHub Issues (`Artemiy111/otbor`). Для всех операций используй `gh` CLI.

## Соглашения

- **Создать задачу**: `gh issue create --title "..." --body "..."`. Для многострочного тела используй heredoc.
- **Прочитать задачу**: `gh issue view <number> --json number,title,body,labels,comments`.
- **Список задач**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` с нужными фильтрами `--label` и `--state`.
- **Сделать задачу подзадачей родителя**: `gh issue create --parent <parent> ...` или потом `gh issue edit <parent> --add-sub-issue <child>` (`gh` 2.94+). На старом `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, как в пункте **Блокировки**). Если подзадач нет, в начало тела дочерней задачи добавь `Part of #<parent>`.
- **Блокировки**: нативные зависимости GitHub, это канонический вариант, виден в UI. Добавить связь: `gh issue create --blocked-by <n>,<n> ...` или `gh issue edit <child> --add-blocked-by <blocker>` (`gh` 2.94+). На старом `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, где `<blocker-db-id>` это числовой **database id** блокирующей задачи (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, не `#number` и не `node_id`). Если зависимости недоступны, в начало тела дочерней задачи пиши строку `Blocked by: #<n>, #<n>`. Задача разблокирована, когда все блокирующие закрыты.
- **Посчитать открытые блокировки**: `gh api repos/<owner>/<repo>/issues/<n> --jq .issue_dependencies_summary.blocked_by` (только открытые; 0 значит можно начинать). `gh issue view <n> --json blockedBy` показывает и закрытые, поэтому фильтруй: `--jq '[.blockedBy.nodes[] | select(.state == "OPEN")] | length'`.
- **Комментарий**: `gh issue comment <number> --body "..."`
- **Добавить / снять метку**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Закрыть**: сначала объяснение через `gh issue comment <number> --body "..."`, затем `gh issue close <number>`. У уже закрытой задачи `gh issue close --comment` теряет комментарий и всё равно завершается с кодом 0.

Репозиторий определяется по `git remote -v`; внутри клона `gh` делает это сам.

Задачи создавай только в репозитории пользователя. Никогда не создавай их в `mattpocock/skills` (откуда взяты эти навыки), если он не принадлежит пользователю. В форке `gh` может по умолчанию целиться в upstream, поэтому перед первым `gh issue create` за сессию проверь цель через `gh repo view --json nameWithOwner` и, если это не репозиторий пользователя, подтверди с ним.

## Pull request'ы как поверхность для триажа

**PR как источник запросов: нет.** _(Поставь `yes`, если внешние PR считаются запросами на фичи; этот флаг читает `/triage`.)_

При `yes` PR проходят те же метки и состояния, что и задачи, через аналоги `gh pr`:

- **Прочитать PR**: `gh pr view <number>`, затем `gh pr view <number> --comments` (вне TTY `--comments` печатает только комментарии, без тела), и `gh pr diff <number>` для диффа.
- **Список внешних PR для триажа**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Комментарий / метка / закрытие**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

У задач и PR в GitHub общая нумерация, так что голый `#42` может быть и тем и другим: проверь `gh pr view 42`, при неудаче `gh issue view 42`.

## Когда навык говорит «опубликуй в трекер задач»

Создай GitHub issue.

## Когда навык говорит «получи нужный тикет»

Читай его как в пункте **Прочитать задачу** выше.

## Операции wayfinding

Используются `/wayfinder`. **Карта** это одна задача, **дочерние** задачи это тикеты.

- **Карта**: одна задача с меткой `wayfinder:map`, в теле Notes / Decisions-so-far / Fog. `gh issue create --label wayfinder:map`.
- **Дочерний тикет**: задача, привязанная к карте как GitHub sub-issue (см. **Сделать задачу подзадачей родителя**). Если sub-issues не включены, добавь дочернюю в список задач в теле карты, а в начало её тела пиши `Part of #<map>`. Метки: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). После взятия в работу тикет назначается ведущему разработчику.
- **Блокировки**: см. **Блокировки** в разделе «Соглашения».
- **Запрос фронтира**: список открытых дочерних задач карты (`gh issue list --state open`, в пределах sub-issues / списка задач карты), отбрось те, у которых есть открытый блокер (см. **Посчитать открытые блокировки** или открытая задача в строке `Blocked by`) или исполнитель; побеждает первая в порядке карты.
- **Взять в работу**: `gh issue edit <n> --add-assignee @me`, первая запись сессии.
- **Завершить**: `gh issue comment <n> --body "<ответ>"`, затем `gh issue close <n>`, затем добавь указатель на контекст (gist + ссылка) в Decisions-so-far карты.
