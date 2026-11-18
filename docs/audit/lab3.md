# Аудит лаби 3

Чернетку склав ШІ як аналіз (`standards/ai-workflow.md`, «Роль ШІ»); вибір
топ-3 погоджує автор. Доказова база — тести в `make test` і ручні баги з
журналу нижче.

## Метод

Мутації Stryker охоплюють лише `transitions.js`, і всі 5 вижилих там
еквівалентні ([`reports/lab3/mutation.txt`](../../reports/lab3/mutation.txt),
критерій 14). Тому слабкі тести в решті коду шукали вручну:

1. 40 правдоподібних багів поза `transitions.js`: сервіси `queue` і
   `sessions`, обидва репозиторії `queue`, `unit-of-work.js`. Кожен баг —
   заміна одного фрагмента коду (журнал нижче).
2. Кожен баг окремо — прогін unit, сценарної сюїти на memory і pg та
   `tests/db`; для вижилих — ще й E2E.
3. До посилення вижили **11 з 40**, E2E жодного з них не зловив. Після —
   **0**.

Усі 11 вижилих — у модулі `queue`, де c8 і до посилення показував 100 %
рядків. Рядок виконався — ще не означає, що тест перевірив його результат.

Відтворення: внести заміну з журналу й запустити `make test`.

## Топ-3 слабкі місця

### 1. Активні статуси: «здає» не перевірявся (сценарні тести)

- **Баг, який пропускали** (6 вижилих, на обох сховищах):
  - `teacherBusy` без `submitting`: викладач викликає наступного, поки ще
    приймає попереднього — два студенти одночасно, порушення I4;
  - `countActive` рахує лише `waiting`: викликаний і той, хто здає, не
    займають місць, і після кожного виклику ліміт (I2) перевищується;
  - `summaries`: `calledStudentId` лише для `called` — під час прийому S9
    показує, що у викладача нікого.
- **Чому тести були зелені.** «Активний» — це `waiting`, `called` або
  `submitting` (I1), але кожен тест брав лише один статус із трьох:
  - I4 (`errors.test.js`, `queue.test.js`) — лише з викликаним;
  - I2 — коли всі записи `waiting`;
  - `calledStudentId` — лише до виклику.
- **Посилення.** `tests/scenarios/active-statuses.test.js`, на memory і pg:
  - I2: після виклику й після старту третій студент → 409
    `QUEUE_LIMIT_REACHED`;
  - I4 і S9: під час прийому `call-next` → 409 `TEACHER_BUSY`, у стані
    черг `calledStudentId` — той, хто здає.
- **Результат.** Новий файл ловить усі 6 багів (на memory і pg).

### 2. «Лише 5 останніх здач» — назва тесту без перевірки (unit)

- **Баг, який пропускали** (2 вижилих):
  - `ETA_SAMPLE` ігнорується: середнє за всіма здачами заняття;
  - `repo-memory.js` сортує здачі від старих: у вибірку йдуть п'ять
    найстаріших.
- **Чому тести були зелені.** Тест `S11: вибірка — лише 5 останніх здач,
  неявки не входять` (`queue-student.test.js`) мав одну здачу, сусідній —
  дві. П'ять останніх із двох — це всі, тож вікно вибірки не перевірялося.
- **Посилення.** Шість здач: найстаріша — 60 хв, далі п'ять по 10 хв. Після
  неявки s-3 на позиції 2 → ETA 20 хв. З багами вийшло б 37 (усі шість) і
  40 (п'ять найстаріших). Перевірку неявки збережено.
- **Результат.** Сам цей тест ловить обидва баги.

### 3. SQL у `repo-pg.js`: порядок і вибірки без перевірки (integration)

- **Баг, який пропускали** (3 вижилих, лише PostgreSQL):
  - `rankOf` рахує всі активні записи замість `waiting`: позиція більша на
    кількість тих, хто біля викладача;
  - `historyOf` — `order by finished_at asc`: історія від старої здачі;
  - `averageDurationMs` — `asc` у підзапиті: ETA за п'ятьма найстарішими.
- **Чому тести були зелені.**
  - Ті самі баги в `repo-memory.js` unit-тести ловлять, але unit-тести йдуть
    лише на статиці (`tests/unit/helpers/app.js`).
  - Сценарна сюїта на pg не мала рангу з викликаним, історії з кількох здач
    і більше п'яти здач.
  - `tests/db` рахує запити (К16 лаби 2), а не їхні результати.
- **Посилення.** `tests/scenarios/ordering.test.js`, на memory і pg:
  - ранг лише серед `waiting`, коли є `called` і `submitting`;
  - історія двох здач — від нової;
  - ETA з шістьма здачами.
- **Результат.**
  - На pg тест ловить усі 3 баги.
  - На статиці той самий файл ловить їхні аналоги в `repo-memory.js`:
    `eta-sample-all`, `eta-mem-oldest`, `rank-mem-all`, `history-mem-asc`.

## До і після

| | До | Після |
|---|---|---|
| Ручні баги: виявлено / вижило | 29 / 11 | 40 / 0 |
| Unit (`node:test`) | 85 | 85 (тест S11 переписано) |
| Сценарна сюїта, pass на кожному сховищі | 37 | 42 |

## Журнал ручних багів

«До» — `make test` до посилення, «після» — з новими тестами. Назва — для
відтворення, заміна — суть зміни.

| Назва | Файл | Заміна | До | Після |
|---|---|---|---|---|
| owner-entry | queue/service.js | `ownedEntryLocked` без перевірки викладача | виявлено | виявлено |
| owner-leave | queue/service.js | `leave` без перевірки власника | виявлено | виявлено |
| owner-session | queue/service.js | `ownedSession` без перевірки викладача | виявлено | виявлено |
| group-position | queue/service.js | позиція без перевірки групи | виявлено | виявлено |
| group-enqueue | queue/service.js | запис без перевірки групи | виявлено | виявлено |
| eta-floor | queue/service.js | `Math.ceil` → `Math.floor` | виявлено | виявлено |
| eta-no-position | queue/service.js | ETA без множення на позицію | виявлено | виявлено |
| eta-sample-all | queue/service.js | `ETA_SAMPLE` 5 → 1000 | **вижив** | виявлено (2, 3) |
| eta-sample-1 | queue/service.js | `ETA_SAMPLE` 5 → 1 | виявлено | виявлено |
| eta-mem-oldest | queue/repo-memory.js | вибірка ETA від старих | **вижив** | виявлено (2, 3) |
| eta-pg-oldest | queue/repo-pg.js | вибірка ETA `asc` | **вижив** | виявлено (3) |
| eta-pg-from-start | queue/repo-pg.js | тривалість від `started_at` | виявлено | виявлено |
| limit-gt | queue/service.js | `>=` → `>` у ліміті | виявлено | виявлено |
| lab-check | queue/service.js | без перевірки лаби заняття | виявлено | виявлено |
| enroll-state | queue/service.js | запис дозволено в `planned` | виявлено | виявлено |
| dropped-check | queue/service.js | вибулий записується знову | виявлено | виявлено |
| already-in-queue | queue/service.js | без перевірки I1 | виявлено | виявлено |
| busy-mem-submitting | queue/repo-memory.js | `teacherBusy` без `submitting` | **вижив** | виявлено (1) |
| busy-pg-submitting | queue/repo-pg.js | `teacherBusy` без `submitting` | **вижив** | виявлено (1) |
| busy-check | queue/service.js | без перевірки I4 | виявлено | виявлено |
| requeue-same-seq | queue/service.js | після неявки seq не змінюється | виявлено | виявлено |
| first-waiting-mem-desc | queue/repo-memory.js | виклик останнього замість першого | виявлено | виявлено |
| rank-mem-le | queue/repo-memory.js | `<` → `<=` у ранзі | виявлено | виявлено |
| rank-mem-all | queue/repo-memory.js | ранг серед усіх активних | виявлено | виявлено |
| rank-pg-all | queue/repo-pg.js | ранг серед усіх активних | **вижив** | виявлено (3) |
| summary-mem-called-only | queue/repo-memory.js | `calledStudentId` без `submitting` | **вижив** | виявлено (1) |
| summary-pg-called-only | queue/repo-pg.js | `calledStudentId` без `submitting` | **вижив** | виявлено (1) |
| summary-mem-waiting-active | queue/repo-memory.js | `waitingCount` рахує всі активні | виявлено | виявлено |
| history-mem-asc | queue/repo-memory.js | історія від старої | виявлено | виявлено |
| history-pg-asc | queue/repo-pg.js | історія `asc` | **вижив** | виявлено (3) |
| history-mem-passed-only | queue/repo-memory.js | історія без `rework` | виявлено | виявлено |
| count-active-mem-waiting | queue/repo-memory.js | ліміт рахує лише `waiting` | **вижив** | виявлено (1) |
| count-active-pg-waiting | queue/repo-pg.js | ліміт рахує лише `waiting` | **вижив** | виявлено (1) |
| noshow-pg-no-increment | queue/repo-pg.js | лічильник неявок не зростає | виявлено | виявлено |
| reopen | sessions/service.js | `closed` → `open` заборонено | виявлено | виявлено |
| lab-subject | sessions/service.js | лаба з іншого предмета | виявлено | виявлено |
| lab-sort | sessions/service.js | лаби без сортування | виявлено | виявлено |
| sess-owner | sessions/service.js | без перевірки викладача | виявлено | виявлено |
| idem-hash-ignored | platform/unit-of-work.js | ключ з іншим тілом не відхиляється | виявлено | виявлено |
| idem-domain-not-saved | platform/unit-of-work.js | доменна відмова не зберігається з ключем | виявлено | виявлено |

## Кандидати «зрізаних кутів» ШІ

1. **Коміт sf-1 без файла промпта.** Файл промпта 014 не був staged, і
   commit-msg відхилив коміт. Але вивід я фільтрував через `grep`, тож
   відмову не побачив і повідомив про коміт, якого не було. Виправлено
   повторним комітом; помилку ШІ визнав автору.
2. **Тип `build` для коміту `make test`.** Типу немає в
   `standards/commits.md`, CHK-08 відхилив коміт. Перекомічено з `test:`.
3. **Звіти Stryker у `reports/`.** ADR-0040 спершу спрямовував HTML і JSON
   Stryker у `reports/lab3/`, хоча вони недетерміновані (абсолютний шлях,
   тривалості). Помічено на першому прогоні, рішення уточнено в ADR-0040.
4. **Повтор вади з місця 2 у власному тесті.** Перша версія ETA-тесту в
   `ordering.test.js` мала п'ять здач, а не шість — тобто знову не
   перевіряла вікно вибірки. Помічено при перерахунку черги до першого
   прогону.
