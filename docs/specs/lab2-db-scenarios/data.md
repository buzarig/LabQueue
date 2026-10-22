# Дані, контракт і помилки LabQueue — лаба 2

Обов'язковий додаток до [spec.md](spec.md). Правила домену, інваріанти I1–I11,
стани й сценарії S1–S13 — в
[architecture.md](../lab1-foundation/architecture.md) лаби 1; тут лише те, як
їх реалізовано: HTTP, дані, запити, помилки, збої.

## Ідентичність і загальні правила HTTP

- **Хто робить запит:** заголовок `X-User-Id`. `identity` шукає користувача у
  своїх даних і дає роль та групу. Заголовка немає або id невідомий → 401
  `UNAUTHENTICATED`.
- **Формат помилки** для всіх не-2xx відповідей:
  `{"error": {"code": "QUEUE_LIMIT_REACHED", "message": "…"}}`. `code` —
  стабільний, з каталогу нижче; `message` — для людини, українською.
- **Ідемпотентність:** кожен `POST` вимагає `Idempotency-Key` (рядок 1–100
  символів); без нього → 400 `VALIDATION_FAILED`. Деталі — «Ідемпотентність»
  нижче.
- **Тіла запитів і відповідей** — JSON, валідуються JSON-схемами Fastify.
  Невідомі поля в тілі запиту → 400 `VALIDATION_FAILED`.
- **Час** береться з годинника, який `main.js` передає модулям. Тести
  підставляють керований годинник.

## Статуси в API і БД

| architecture.md | API і БД |
|---|---|
| очікує / викликаний / здає | `waiting` / `called` / `submitting` |
| зараховано / доопрацювання | `passed` / `rework` |
| вийшов / вибув / не встиг | `left` / `dropped` / `missed` |
| заплановане / запис відкрито / запис закрито / завершене | `planned` / `open` / `closed` / `finished` |

## Seed-дані

Довідники й користувачі не мають CRUD (spec, «Не робимо»). Ті самі дані
вантажить адаптер у пам'яті й `make db-seed` у PostgreSQL. Кожен модуль
тримає свій seed у `src/modules/<модуль>/seed.json`.

| Модуль | Дані |
|---|---|
| `catalog` | групи `kn-21`, `kn-22`; предмети `nodejs` (лаби 1–3), `db` (лаби 1–2) |
| `identity` | викладачі `t-1`, `t-2`; студенти `s-1`…`s-4` у `kn-21`, `s-5` у `kn-22` |

Id seed-сутностей — читабельні рядки (зручно для `X-User-Id` у демо). Id
занять і записів генерує застосунок (`crypto.randomUUID()`), однаково для
обох адаптерів.

## HTTP-контракт

«Модуль» — чий Fastify-плагін обслуговує маршрут. S4 і S9 обслуговує `queue`,
бо йому потрібні записи черги, а `sessions → queue` заборонено
([ADR-0005](../../adr/0005-koordynatsiia-zavershennia-zaniattia.md)).

| Сц. | Роль | Метод і шлях | Тіло | Успіх | Модуль |
|---|---|---|---|---|---|
| S1 | teacher | `POST /sessions` | `subjectId, groupId, startsAt, room, queueLimit, labIds[]` | 201 заняття | `sessions` |
| S2 | teacher | `POST /sessions/:id/open` | — | 200 заняття | `sessions` |
| S3 | teacher | `POST /sessions/:id/close` | — | 200 заняття | `sessions` |
| S4 | teacher | `POST /sessions/:id/finish` | — | 200 заняття + кількість `missed` | `queue` |
| S5 | teacher | `POST /sessions/:id/queue/call-next` | — | 200 запис | `queue` |
| S6 | teacher | `POST /entries/:id/start` | — | 200 запис | `queue` |
| S7 | teacher | `POST /entries/:id/result` | `outcome: passed\|rework, score?` | 200 запис | `queue` |
| S8 | teacher | `POST /entries/:id/no-show` | — | 200 запис + `noShowCount` | `queue` |
| S9 | student | `GET /sessions` | — | 200 заняття групи + `waitingCount`, `calledStudentId` | `queue` |
| S10 | student | `POST /sessions/:id/queue` | `labId` | 201 запис | `queue` |
| S11 | student | `GET /sessions/:id/queue/me` | — | 200 `status, position, etaMinutes` | `queue` |
| S12 | student | `POST /entries/:id/leave` | — | 200 запис | `queue` |
| S13 | student | `GET /me/history` | — | 200 записи `passed`/`rework` з датою, предметом, лабою, балом | `queue` |

**S11:** `position` і `etaMinutes` є лише в `waiting`; для `called` і
`submitting` вони `null`. Немає активного запису → 404 `NO_ACTIVE_ENTRY`.
`etaMinutes = ⌈position × середнє (finished_at − called_at)⌉` за останніми 5
записами `passed`/`rework` заняття, без них — `position × 10` (sf-19 лаби 1).

**Технічні:** `GET /health` — без змін (К8 лаби 1). `GET /ready` → 200
`{"status":"ready"}`, якщо `select 1` у БД виконався за 1 с, інакше 503
`{"status":"unavailable"}`. На адаптері в пам'яті завжди 200.

## Схема БД

Кожен модуль — окрема схема PostgreSQL; модуль читає й пише лише свою
(правило 6 лаби 1). **Зовнішні ключі — лише всередині модуля.** Посилання на
чужі дані — колонка з id без FK; цілісність перевіряє модуль-власник через
API під час запису (S1 питає `catalog`, S10 — `sessions`).

```sql
-- identity
create table identity.users (
  id text primary key,
  name text not null,
  role text not null check (role in ('student', 'teacher')),
  group_id text,                                   -- catalog.groups.id
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
  subject_id text not null,                        -- catalog.subjects.id
  group_id text not null,                          -- catalog.groups.id
  teacher_id text not null,                        -- identity.users.id
  starts_at timestamptz not null,
  room text not null,
  queue_limit int not null check (queue_limit > 0),
  state text not null default 'planned'
    check (state in ('planned', 'open', 'closed', 'finished'))
);
create index on sessions.sessions (group_id, starts_at);
create table sessions.session_labs (
  session_id uuid references sessions.sessions,
  lab_id text not null,                            -- catalog.labs.id
  primary key (session_id, lab_id)
);

-- queue
create table queue.entries (
  id uuid primary key,
  session_id uuid not null,                        -- sessions.sessions.id
  teacher_id text not null,                        -- копія sessions.teacher_id, незмінна
  student_id text not null,                        -- identity.users.id
  lab_id text not null,                            -- catalog.labs.id
  status text not null check (status in ('waiting', 'called', 'submitting',
    'passed', 'rework', 'left', 'dropped', 'missed')),
  seq int not null,                                -- ADR-0001
  enqueued_at timestamptz not null,
  called_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  score int check (score between 0 and 100),
  check ((score is not null) = (status = 'passed')),            -- I9
  unique (session_id, seq)                                       -- I3
);
create unique index entries_one_active                           -- I1
  on queue.entries (session_id, student_id)
  where status in ('waiting', 'called', 'submitting');
create unique index entries_one_call_per_teacher                 -- I4
  on queue.entries (teacher_id)
  where status in ('called', 'submitting');
create index on queue.entries (session_id, status, seq);
create index on queue.entries (student_id, finished_at desc)
  where status in ('passed', 'rework');
create table queue.no_shows (
  session_id uuid not null,
  student_id text not null,
  count int not null check (count between 1 and 2),              -- I7
  primary key (session_id, student_id)
);

-- platform (технічні дані, не домен)
create table platform.idempotency_keys (
  user_id text not null,
  key text not null,
  request_hash text not null,          -- sha256(метод, шлях, тіло)
  status_code int,                     -- заповнюються в кінці тієї ж транзакції
  response jsonb,
  created_at timestamptz not null,
  primary key (user_id, key)
);
```

**`teacher_id` у `queue.entries`** — копія з заняття під час запису в чергу.
Викладач заняття не змінюється, тож копія не розходиться з оригіналом. Вона
дає I4 обмеження в БД і прибирає з S5 запит до `sessions`.

I2 (ліміт) і I6 не виражаються обмеженнями — їх тримає серіалізація
(нижче). Унікальні індекси — друга лінія
([ADR-0002](../../adr/0002-zakhyst-vid-honky-zapysiv.md)): якщо код
помилиться, БД поверне `23505`, і запит закінчиться 409, а не зіпсованими
даними.

## Транзакції й серіалізація

- **Одна команда — одна транзакція** (`read committed`). Транзакцію відкриває
  обробник маршруту через механізм, який `main.js` передає модулям; модулі
  передають `tx` у API одне одного. Домен не знає, PostgreSQL це чи пам'ять.
- **Блокування за викладачем** (ADR-0002): перша дія змінювальної команди
  після визначення заняття —
  `select pg_advisory_xact_lock(hashtextextended('teacher:' || $1, 0))`.
  Знімається з кінцем транзакції. Блокування рядка викладача неможливе:
  таблиця `identity.users` чужа для `queue` і `sessions`.
- **У пам'яті:** м'ютекс за тим самим ключем і знімок стану: якщо команда
  кидає помилку, стан відкочується.

## Запити сценаріїв

`N` — кількість записів, занять чи історії. Жоден сценарій не робить запит
у циклі за `N`: дані інших модулів беруться пакетно (`…ByIds(ids)`).

| Сц. | Запити (PostgreSQL) | Кількість |
|---|---|---|
| S1 | користувач; предмет, група, лаби `where id = any($1)`; блокування; insert заняття; insert `session_labs` одним `insert … select unnest($1)` | 6 |
| S2, S3 | користувач; заняття; блокування; заняття ще раз (стан міг змінитись до блокування); update стану | 5 |
| S4 | користувач; заняття; блокування; `count(*) … status = 'submitting'`; update `waiting`/`called` → `missed` одним запитом; update стану | 6 |
| S5 | користувач; заняття; блокування; чи є `called`/`submitting` з цим `teacher_id`; перший `waiting` за `seq`; update | 6 |
| S6, S7, S12 | користувач; запис; блокування за `teacher_id` запису; запис ще раз; update | 5 |
| S8 | як S6 + upsert `no_shows … returning count` + `max(seq)` | 7 |
| S9 | користувач; заняття групи; зведення черг одним `group by session_id` для всіх занять | 3 |
| S10 | користувач; заняття й `session_labs`; блокування; `no_shows`; активні записи (кількість і чи є свій); `max(seq)`; insert | 8 |
| S11 | користувач; свій активний запис; ранг `count(*) … seq < $seq`; середнє за останніми 5 | 4 |
| S13 | користувач; записи історії; заняття `any($1)`; предмети й лаби `any($1)` | 5 |

Звіт `reports/lab2/queries.txt` показує кількість запитів кожного сценарію при
малих і великих `N`; числа мають збігатися (К12).

## Ідемпотентність

- **Область:** пара (`X-User-Id`, `Idempotency-Key`), 24 години. Старші ключі
  вважаються відсутніми; фонове прибирання поза обсягом.
- **Атомарність:** ключ вставляється на початку транзакції команди, а
  відповідь дописується в кінці тієї ж транзакції. Тому «зміна є, а ключа
  немає» неможливе, і повтор після обриву на `COMMIT` безпечний. Доменна
  відмова відкочує зміни до savepoint, а ключ із відповіддю-відмовою
  комітиться.
- **Повтор із тим самим запитом** → збережені статус і тіло, жодних змін.
- **Той самий ключ, інший метод/шлях/тіло** → 409 `IDEMPOTENCY_KEY_REUSED`.
- **Що зберігається:** 2xx і доменні відмови (403, 404, 409, 422). Не
  зберігаються 400 і 401 (запит не дійшов до домену) та 5xx (повтор має
  спробувати знову).
- **Одночасні запити з одним ключем:** другий чекає на вставці ключа, доки
  перша транзакція не завершиться, і отримує її відповідь.

## Збої джерела

| Ситуація | Поведінка |
|---|---|
| Конфлікт серіалізації `40001`, дедлок `40P01` | транзакція повторюється цілком, ≤3 повтори з паузою 50 → 100 → 200 мс ± 25 % |
| Обрив з'єднання (`08xxx`, `57P01`, `ECONNRESET`) до відповіді | так само; ідемпотентність робить повтор безпечним |
| Повтори вичерпано, БД недоступна (`ECONNREFUSED`), таймаут підключення 2 с | 503 `SOURCE_UNAVAILABLE`, `Retry-After: 1` |
| Запит довший за `statement_timeout` 3 с | 503 `SOURCE_UNAVAILABLE` без повтору |
| Порушення унікальності `23505` (друга лінія) | 409 `CONFLICT`, у лог — як помилка коду |
| Будь-яка інша помилка | 500 `INTERNAL`, деталі лише в лог |

Пул: до 10 з'єднань. Під час старту застосунок не падає без БД: `/health`
відповідає, `/ready` дає 503, доменні маршрути — 503.

## Каталог помилок

| Код | HTTP | Умова | Сценарії |
|---|---|---|---|
| `VALIDATION_FAILED` | 400 | тіло, параметри чи `Idempotency-Key` не за схемою | усі |
| `UNAUTHENTICATED` | 401 | немає `X-User-Id` або id невідомий | усі |
| `FORBIDDEN_ROLE` | 403 | дія не для цієї ролі | усі |
| `NOT_SESSION_OWNER` | 403 | заняття веде інший викладач (I8) | S2–S8 |
| `NOT_IN_GROUP` | 403 | студент не з групи заняття (I6, I11) | S10, S11 |
| `NOT_ENTRY_OWNER` | 403 | студент виходить із чужого запису (I11) | S12 |
| `SESSION_NOT_FOUND` / `ENTRY_NOT_FOUND` | 404 | немає такого id | S2–S8, S10–S12 |
| `NO_ACTIVE_ENTRY` | 404 | у студента немає активного запису на занятті | S11 |
| `UNKNOWN_REFERENCE` | 422 | невідомі предмет, група чи лаба; лаба не з предмета заняття | S1 |
| `SESSION_STATE_CONFLICT` | 409 | перехід заняття не за діаграмою (I10) | S2–S4 |
| `ENROLLMENT_CLOSED` | 409 | заняття не в стані `open` (I6) | S10 |
| `LAB_NOT_ACCEPTED` | 409 | лаби немає серед `session_labs` (I6) | S10 |
| `QUEUE_LIMIT_REACHED` | 409 | активних записів уже `queue_limit` (I2) | S10 |
| `ALREADY_IN_QUEUE` | 409 | у студента вже є активний запис (I1) | S10 |
| `DROPPED_FROM_SESSION` | 409 | студент на занятті «вибув» (I6, I7) | S10 |
| `TEACHER_BUSY` | 409 | у викладача вже є `called`/`submitting` (I4) | S5 |
| `QUEUE_EMPTY` | 409 | немає записів `waiting` | S5 |
| `ENTRY_STATE_CONFLICT` | 409 | перехід запису не за діаграмою (I5) | S6–S8, S12 |
| `SUBMITTING_IN_PROGRESS` | 409 | є запис `submitting` (I10, sf-18 лаби 1) | S4 |
| `SCORE_MISMATCH` | 422 | `passed` без балу або `rework` з балом (I9) | S7 |
| `IDEMPOTENCY_KEY_REUSED` | 409 | ключ уже використано з іншим запитом | усі POST |
| `CONFLICT` | 409 | спрацювала друга лінія (`23505`) | змінювальні |
| `SOURCE_UNAVAILABLE` | 503 | БД недоступна чи повтори вичерпано | усі |
| `INTERNAL` | 500 | непередбачена помилка | усі |

Порядок перевірок у команді: 401 → 400 → 404 → 403 → 409/422. Навіщо:
чужий студент не дізнається з 409, що відбувається в чужому занятті.

## Міграції

- `migrations/NNN-назва.sql`, застосовуються по порядку власним ранером
  `scripts/migrate.js` (`make db-migrate`).
- Кожна міграція — у своїй транзакції під `pg_advisory_lock`, щоб два
  одночасні запуски не застосували її двічі. Застосовані записуються в
  `public.schema_migrations (name, applied_at)`.
- Лише вперед, без down-міграцій. Змінювати застосовану міграцію не можна —
  тільки нова.
- `make db-seed` вантажить seed-дані upsert-ом, повторний запуск нічого не
  змінює.

## Тести й середовище

- `DATABASE_URL`, типово `postgres://localhost:5432/labqueue_test`.
  `make check` створює тестову БД, якщо її немає, і застосовує міграції.
  PostgreSQL не запущений → зупинка з підказкою
  `brew services start postgresql@17`.
- Сценарна сюїта `tests/scenarios/` — одна для обох адаптерів, запускається
  двічі (`STORAGE=memory`, `STORAGE=pg`). Перед кожним тестом — порожні
  таблиці й seed.
- CI: service-контейнер `postgres:17`.
- Supabase: ручне демо, `DATABASE_URL` на session pooler через `pg`. У
  репозиторії рядка підключення немає.
