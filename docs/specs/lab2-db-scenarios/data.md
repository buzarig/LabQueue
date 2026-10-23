# Дані, контракт і помилки LabQueue — лаба 2

Обов'язковий додаток до spec.md. Правила домену, інваріанти I1–I11, стани й сценарії S1–S13 лежать в architecture.md лаби 1. Тут тільки те, як їх реалізовано: HTTP, дані, запити, помилки, збої.

## Ідентичність і загальні правила HTTP

- Хто робить запит — заголовок X-User-Id. Модуль identity шукає користувача по ньому і дає роль та групу. Немає заголовка або id невідомий — 401 UNAUTHENTICATED.
- Формат помилки для всіх не-2xx відповідей однаковий: {"error": {"code": "QUEUE_LIMIT_REACHED", "message": "…"}}. Поле code стабільне і береться з каталогу нижче, message — для людини, українською.
- Кожен POST вимагає Idempotency-Key (рядок 1–100 символів). Без нього — 400 VALIDATION_FAILED. Деталі в розділі «Ідемпотентність».
- Тіла запитів і відповідей — JSON, валідуються схемами Fastify. Невідомі поля в тілі — 400 VALIDATION_FAILED.
- Кожен запит має processId (ADR-0030): береться із заголовка X-Request-Id, якщо клієнт його передав, інакше генерується UUID. Відповідь повертає його в X-Request-Id, а логи на всіх рівнях містять processId і id користувача.
- Час береться з годинника, який main.js передає модулям. Тести підставляють керований годинник.

## Статуси в API і БД

architecture.md — API і БД:

- очікує / викликаний / здає — waiting / called / submitting
- зараховано / доопрацювання — passed / rework
- вийшов / вибув / не встиг — left / dropped / missed
- заплановане / запис відкрито / запис закрито / завершене — planned / open / closed / finished

## Seed-дані

Довідники й користувачі не мають CRUD (spec, «Не робимо»). Ті самі дані вантажить адаптер у пам'яті і make db-seed у PostgreSQL. Кожен модуль тримає свій seed у src/modules/<модуль>/seed.json.

- catalog — групи kn-21, kn-22; предмети nodejs (лаби 1–3), db (лаби 1–2)
- identity — викладачі t-1, t-2; студенти s-1…s-4 у kn-21, s-5 у kn-22

Id seed-сутностей — читабельні рядки, так зручно для X-User-Id у демо. Id занять і записів генерує застосунок через crypto.randomUUID(), однаково для обох адаптерів.

## HTTP-контракт

Модуль — це чий Fastify-плагін обслуговує маршрут. S4 і S9 обслуговує queue, бо йому потрібні записи черги, а sessions → queue заборонено (ADR-0005).

Таблиця нижче — контракт. Тут без неї ніяк, тому лишаю таблицею.

| Сц. | Роль | Метод і шлях | Тіло | Успіх | Модуль |
|---|---|---|---|---|---|
| S1 | teacher | POST /sessions | subjectId, groupId, startsAt, room, queueLimit, labIds[] | 201 заняття | sessions |
| S2 | teacher | POST /sessions/:id/open | — | 200 заняття | sessions |
| S3 | teacher | POST /sessions/:id/close | — | 200 заняття | sessions |
| S4 | teacher | POST /sessions/:id/finish | — | 200 заняття + кількість missed | queue |
| S5 | teacher | POST /sessions/:id/queue/call-next | — | 200 запис | queue |
| S6 | teacher | POST /entries/:id/start | — | 200 запис | queue |
| S7 | teacher | POST /entries/:id/result | outcome: passed або rework, score? | 200 запис | queue |
| S8 | teacher | POST /entries/:id/no-show | — | 200 запис + noShowCount | queue |
| S9 | student | GET /sessions | — | 200 заняття групи + waitingCount, calledStudentId | queue |
| S10 | student | POST /sessions/:id/queue | labId | 201 запис | queue |
| S11 | student | GET /sessions/:id/queue/me | — | 200 status, position, etaMinutes | queue |
| S12 | student | POST /entries/:id/leave | — | 200 запис | queue |
| S13 | student | GET /me/history | — | 200 записи passed/rework з датою, предметом, лабою, балом | queue |

S11: position і etaMinutes мають сенс лише в waiting, для called і submitting вони null. Немає активного запису — 404 NO_ACTIVE_ENTRY. etaMinutes = ⌈position × середнє (finished_at − called_at)⌉ за останніми 5 записами passed/rework цього заняття, без них — position × 10 (sf-19 лаби 1).

Технічні: GET /health без змін (К8 лаби 1). GET /ready віддає 200 {"status":"ready"}, якщо select 1 у БД вклався в 1 с, інакше 503 {"status":"unavailable"}. На адаптері в пам'яті завжди 200.

## Схема БД

Кожен модуль — окрема схема PostgreSQL, модуль читає й пише лише свою (правило 6 лаби 1). Зовнішні ключі — тільки всередині модуля. Посилання на чужі дані — колонка з id без FK, цілісність перевіряє модуль-власник через API під час запису (S1 питає catalog, S10 — sessions).

Схему лишаю кодом, інакше ніяк:

```sql
-- identity
create table identity.users (
  id text primary key,
  name text not null,
  role text not null check (role in ('student', 'teacher')),
  group_id text,
  check ((role = 'student') = (group_id is not null))
);

-- catalog
create table catalog.groups   (id text primary key, name text not null);
create table catalog.subjects (id text primary key, name text not null);
create table catalog.labs (
  id text primary key,
  subject_id text not null references catalog.subjects,
  number int not null check (number > 0),
  title text not null,
  unique (subject_id, number)
);

-- sessions
create table sessions.sessions (
  id uuid primary key,
  subject_id text not null,
  group_id text not null,
  teacher_id text not null,
  starts_at timestamptz not null,
  room text not null,
  queue_limit int not null check (queue_limit > 0),
  state text not null default 'planned'
    check (state in ('planned', 'open', 'closed', 'finished'))
);
create index on sessions.sessions (group_id, starts_at);
create table sessions.session_labs (
  session_id uuid references sessions.sessions,
  lab_id text not null,
  primary key (session_id, lab_id)
);

-- queue
create table queue.entries (
  id uuid primary key,
  session_id uuid not null,
  teacher_id text not null,
  student_id text not null,
  lab_id text not null,
  status text not null check (status in ('waiting', 'called', 'submitting',
    'passed', 'rework', 'left', 'dropped', 'missed')),
  seq int not null,
  enqueued_at timestamptz not null,
  called_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  score int check (score between 0 and 100),
  check ((score is not null) = (status = 'passed')),
  unique (session_id, seq)
);
create unique index entries_one_active
  on queue.entries (session_id, student_id)
  where status in ('waiting', 'called', 'submitting');
create unique index entries_one_call_per_teacher
  on queue.entries (teacher_id)
  where status in ('called', 'submitting');
create index on queue.entries (session_id, status, seq);
create index on queue.entries (student_id, finished_at desc)
  where status in ('passed', 'rework');
create table queue.no_shows (
  session_id uuid not null,
  student_id text not null,
  count int not null check (count between 1 and 2),
  primary key (session_id, student_id)
);

-- platform
create table platform.idempotency_keys (
  user_id text not null,
  key text not null,
  request_hash text not null,
  result_status int,
  result_body jsonb,
  created_at timestamptz not null,
  primary key (user_id, key)
);
```

Навіщо teacher_id у queue.entries: це копія з заняття, зроблена під час запису в чергу. Викладач заняття не змінюється, тому копія з оригіналом не розійдеться. Зате I4 можна повісити обмеженням у БД, і S5 не робить зайвий запит до sessions.

I2 (ліміт) і I6 не виражаються обмеженнями, їх тримає серіалізація (нижче). Унікальні індекси — друга лінія (ADR-0002): якщо код помилиться, БД поверне 23505, і запит закінчиться 409, а не зіпсованими даними.

## Транзакції й серіалізація

Одна команда — одна транзакція (read committed). Межу транзакції позначає сервіс викликом unitOfWork(fn) (ADR-0030). Сам BEGIN/COMMIT живе в шарі даних, platform/db, тому сервіс SQL не бачить і нічого не протягує.

tx не передається параметрами. За ADR-0030 він лежить у контексті (ALS), і репозиторій бере його звідти сам. Роут лише кличе сервіс, сервіс кличе unitOfWork, усередині репозиторій дістає tx з контексту.

SQL лише в репозиторіях. Драйвер postgres.js імпортується тільки в repo-pg.js і в platform/db (там живе unitOfWork), ADR-0031 це дозволяє. no-restricted-imports ловить імпорт драйвера деінде. Роут і сервіс про драйвер не знають нічого.

Блокування за викладачем (ADR-0002): перша дія змінювальної команди після визначення заняття — select pg_advisory_xact_lock(hashtextextended('teacher:' || ${teacherId}, 0)). Знімається з кінцем транзакції. Блокувати рядок викладача не можна: таблиця identity.users для queue і sessions чужа.

У пам'яті: м'ютекс за тим самим ключем і знімок стану. Якщо команда кидає помилку, стан відкочується.

## Запити сценаріїв

N — кількість записів, занять чи історії. Жоден сценарій не робить запит у циклі за N, дані інших модулів беруться пакетно (…ByIds(ids)). Параметри — у нотації tagged templates postgres.js (`${id}`), SQL-ін'єкція неможлива за побудовою (ADR-0032).

Тут таблицю запитів я взяв з того, що запропонував ШІ, і звірив зі схемою та сценаріями. Числа запитів нижче — з цієї пропозиції.

| Сц. | Запити (PostgreSQL) | Кількість |
|---|---|---|
| S1 | користувач; предмет, група, лаби where id = any(${ids}); блокування; insert заняття; insert session_labs одним insert … select unnest(${labIds}) | 6 |
| S2, S3 | користувач; заняття; блокування; заняття ще раз (стан міг змінитись до блокування); update стану | 5 |
| S4 | користувач; заняття; блокування; count(*) … status = 'submitting'; update waiting/called → missed одним запитом; update стану | 6 |
| S5 | користувач; заняття; блокування; чи є called/submitting з цим teacher_id; перший waiting за seq; update | 6 |
| S6, S7, S12 | користувач; запис; блокування за teacher_id запису; запис ще раз; update | 5 |
| S8 | як S6 + upsert no_shows … returning count + max(seq) | 7 |
| S9 | користувач; заняття групи; зведення черг одним group by session_id для всіх занять | 3 |
| S10 | користувач; заняття й session_labs; блокування; no_shows; активні записи (кількість і чи є свій); max(seq); insert | 8 |
| S11 | користувач; свій активний запис; ранг count(*) … seq < ${seq}; середнє за останніми 5 | 4 |
| S13 | користувач; записи історії; заняття any(${ids}); предмети й лаби any(${ids}) | 5 |

Кількості — без двох запитів ідемпотентності, які додає кожен POST (вставка ключа й запис результату, ADR-0035).

Звіт reports/lab2/queries.txt показує кількість запитів кожного сценарію при малих і великих N, числа мають збігатися (К12).

## Ідемпотентність

Область — пара (X-User-Id, Idempotency-Key), 24 години. Старші ключі вважаються відсутніми, фонове прибирання поза обсягом.

Атомарність: ключ вставляється на початку транзакції команди, а результат операції (result_status + result_body, який сформував сервіс) дописується в кінці тієї ж транзакції. Тому «зміна є, а ключа немає» неможливе, і повтор після обриву на COMMIT безпечний. Доменна відмова відкочує зміни до savepoint, а ключ із результатом-відмовою комітиться.

Повтор із тим самим запитом — збережений результат, жодних змін.

Той самий ключ, інший метод/шлях/тіло — 409 IDEMPOTENCY_KEY_REUSED.

Що лежить у колонках: result_status — HTTP-статус результату, result_body — значення, яке повернув сервіс, або для доменної відмови `{code, message}`. ADR-0035 описує це однією колонкою result; дві колонки — та сама інформація, роут однаково будує з неї відповідь і для першого запиту, і для повтору.

Що зберігається: 2xx і доменні відмови (403, 404, 409, 422). Не зберігаються 400 і 401 (запит не дійшов до домену) та 5xx (повтор має спробувати знову).

Одночасні запити з одним ключем: другий чекає на вставці ключа, доки перша транзакція не завершиться, і отримує її результат.

## Збої джерела

Ситуація — поведінка:

Конфлікт серіалізації 40001, дедлок 40P01 — транзакція повторюється цілком, ≤3 повтори з паузою 50 → 100 → 200 мс ± 25 %.

Обрив з'єднання (08xxx, 57P01, ECONNRESET) до відповіді — так само, ідемпотентність робить повтор безпечним.

Повтори вичерпано, БД недоступна (ECONNREFUSED), таймаут підключення 2 с — 503 SOURCE_UNAVAILABLE, Retry-After: 1.

Запит довший за statement_timeout 3 с — 503 SOURCE_UNAVAILABLE без повтору.

Порушення унікальності 23505 (друга лінія) — 409 CONFLICT, у лог як помилка коду.

Будь-яка інша помилка — 500 INTERNAL, деталі лише в лог.

Пул — до 10 з'єднань. Fail-fast (ADR-0034): без БД застосунок не стартує. На старті явна ініціалізація пула + select now(), якщо не вдалося, процес завершується з кодом 1. /health і /ready піднімаються лише після успішного підключення. Під час роботи, якщо БД зникла, доменні маршрути віддають 503 SOURCE_UNAVAILABLE.

## Каталог помилок

| Код | HTTP | Умова | Сценарії |
|---|---|---|---|
| VALIDATION_FAILED | 400 | тіло, параметри чи Idempotency-Key не за схемою | усі |
| UNAUTHENTICATED | 401 | немає X-User-Id або id невідомий | усі |
| FORBIDDEN_ROLE | 403 | дія не для цієї ролі | усі |
| NOT_SESSION_OWNER | 403 | заняття веде інший викладач (I8) | S2–S8 |
| NOT_IN_GROUP | 403 | студент не з групи заняття (I6, I11) | S10, S11 |
| NOT_ENTRY_OWNER | 403 | студент виходить із чужого запису (I11) | S12 |
| SESSION_NOT_FOUND / ENTRY_NOT_FOUND | 404 | немає такого id | S2–S8, S10–S12 |
| NO_ACTIVE_ENTRY | 404 | у студента немає активного запису на занятті | S11 |
| UNKNOWN_REFERENCE | 422 | невідомі предмет, група чи лаба; лаба не з предмета заняття | S1 |
| SESSION_STATE_CONFLICT | 409 | перехід заняття не за діаграмою (I10) | S2–S4 |
| ENROLLMENT_CLOSED | 409 | заняття не в стані open (I6) | S10 |
| LAB_NOT_ACCEPTED | 409 | лаби немає серед session_labs (I6) | S10 |
| QUEUE_LIMIT_REACHED | 409 | активних записів уже queue_limit (I2) | S10 |
| ALREADY_IN_QUEUE | 409 | у студента вже є активний запис (I1) | S10 |
| DROPPED_FROM_SESSION | 409 | студент на занятті «вибув» (I6, I7) | S10 |
| TEACHER_BUSY | 409 | у викладача вже є called/submitting (I4) | S5 |
| QUEUE_EMPTY | 409 | немає записів waiting | S5 |
| ENTRY_STATE_CONFLICT | 409 | перехід запису не за діаграмою (I5) | S6–S8, S12 |
| SUBMITTING_IN_PROGRESS | 409 | є запис submitting (I10, sf-18 лаби 1) | S4 |
| SCORE_MISMATCH | 422 | passed без балу або rework з балом (I9) | S7 |
| IDEMPOTENCY_KEY_REUSED | 409 | ключ уже використано з іншим запитом | усі POST |
| CONFLICT | 409 | спрацювала друга лінія (23505) | змінювальні |
| SOURCE_UNAVAILABLE | 503 | БД недоступна чи повтори вичерпано | усі |
| INTERNAL | 500 | непередбачена помилка | усі |

Порядок перевірок у команді: 401 → 400 → 404 → 403 → 409/422. Навіщо так: чужий студент не має дізнаватися з 409, що відбувається в чужому занятті.

## Міграції

migrations/NNN-назва.sql, застосовуються по порядку власним ранером scripts/migrate.js (make db-migrate).

Кожна міграція в своїй транзакції під pg_advisory_lock, щоб два одночасні запуски не застосували її двічі. Застосовані пишуться в public.schema_migrations (name, applied_at).

Лише вперед, без down-міграцій. Змінювати застосовану міграцію не можна, тільки нова.

make db-seed вантажить seed-дані upsert-ом, повторний запуск нічого не змінює.

## Тести й середовище

Кластер (ADR-0033). Локально PG17 на 127.0.0.1:55432. Цільова версія — PostgreSQL 17, її перевіряє CI і на ній Supabase. Код не використовує можливостей, яких немає в 17, розбіжність ловить CI.

Роль і БД (ADR-0033). Застосунок ходить під роллю labqueue без прав суперкористувача. Є одна змінна DATABASE_URL, окремих TEST_DATABASE_URL немає. Міграції застосовуються один раз до шаблону labqueue_tmpl. БД кожного прогону створює тестовий раннер копією цього шаблону і видаляє після прогону.

Змінні (ADR-0033). DATABASE_URL — застосунок, make db-migrate, make db-seed і тести. Береться з оточення або з .env (вбудований --env-file-if-exists Node, без залежностей). Шаблон без секретів — .env.example, .env ігнорує git.

Старт (ADR-0034). main.js на старті явно ініціалізує пул і робить select now(). Не вдалося — код 1, без /health і /ready. На адаптері в пам'яті цей крок пропускається.

Драйвер (ADR-0031, ADR-0032). Драйвер postgres.js, імпортується лише в repo-pg.js і в platform/db (там живе unitOfWork). Решта коду бачить репозиторій і tx, а не драйвер. no-restricted-imports це ловить.

БД недоступна під час make check — зупиняється з підказкою: чи запущений кластер на 127.0.0.1:55432 і чи заповнений .env (README, «Середовище»).

Сценарна сюїта tests/scenarios/ — одна для обох адаптерів, запускається двічі (STORAGE=memory, STORAGE=pg). Перед кожним тестом порожні таблиці й seed.

CI: service-контейнер postgres:17 з тією ж роллю й тією ж змінною DATABASE_URL.

Supabase: ручне демо, DATABASE_URL на session pooler через postgres.js. У репозиторії рядка підключення немає.