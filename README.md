# LabQueue

Електронна черга на здачу лабораторних робіт.

## Проблема

Зараз черга на здачу лабораторних живе в чаті групи. Хтось пише «я за Петром»,
хтось займає місце й не приходить. Незрозуміло, хто наступний. Викладач не
бачить, скільки людей ще чекає, а студент — чи встигне сьогодні.

## Ідея

LabQueue дає окрему чергу на кожне заняття:

- **одна прозора послідовність**: кожен бачить свою позицію й орієнтовний час
  очікування;
- **чесні правила пропуску**: за першу неявку студент переходить у кінець
  черги, за другу вибуває з неї;
- **керування для викладача**: відкрити й закрити запис, викликати
  наступного, зафіксувати результат;
- **історія здач**: студент бачить, що і коли здав.

## Стан проєкту

Навчальний прототип курсу з Node.js. Лаба 1 — фундамент: стандарти, конвеєр
перевірок, архітектура й каркас модулів без бізнес-логіки. Логіка черги
з'явиться з лаби 2.

**Для рев'ю почніть з [DEFENSE.md](DEFENSE.md).**

## Як запустити

Потрібні Node.js 24 (`.nvmrc`), npm і `make`. Пакети ставляться самі.

```sh
make check    # усі перевірки — та сама брама, що в pre-push і CI
make verify   # make check + звіти в reports/lab2/ + дата й sha (перед здачею)
```

| Команда | Що робить |
|---|---|
| `make check` | формат, лінт, типи, проба JSDoc, межі модулів, юніт-тести, сценарна сюїта, збірка, smoke-тест, історія комітів, гігієна ([standards/checks.md](standards/checks.md)) |
| `make verify` | `make check` + відтворення відмов hook-ів і порушень меж у тимчасовому клоні + прогін сценаріїв → `reports/lab2/`, підсумок — `reports/lab2/verify.txt` (звіти лаби 1 — `reports/lab1/`) |
| `make report-scenarios` | лише звіт сценарної сюїти на статиці → `reports/lab2/scenarios-memory.txt` (К9) |
| `make report-scenarios-pg`, `make report-failures`, `make report-queries` | звіти етапу БД: сюїта на PostgreSQL (К10), збої (К14), запити без N+1 (К16) → `reports/lab2/` |
| `make build` і `node --env-file=.env dist/main.js` | запуск застосунку на PostgreSQL (`STORAGE=pg` типово, `DATABASE_URL`); `STORAGE=memory` — статика без БД. Без БД застосунок не стартує (код 1). Технічні маршрути: `GET /health`, `GET /ready`, `GET /version`; порт — `PORT`, за замовчуванням 3000 |

Git-hooks ставляться під час `npm install`:
- **pre-commit** — формат і лінт staged-файлів;
- **commit-msg** — формат повідомлення й трейлер `Prompt:`;
- **pre-push** — `make check`.

CI ([.github/workflows/check.yml](.github/workflows/check.yml)) запускає
`make check` на кожен push і PR.

## Середовище

З лаби 2 потрібен PostgreSQL 17 — та сама версія, що в CI і Supabase. Проєкт
піднімає власний кластер у `.pgdata/` на `127.0.0.1:55432`, окремо від
будь-якого іншого PostgreSQL на машині
([ADR-0033](docs/adr/0033-izolovane-seredovyshche-pg17.md)).

1. **Бінарники.** `brew install postgresql@17`. Службу запускати не треба.
   Інший шлях до бінарників — змінна `PG_BIN`.
2. **`.env`.** `cp .env.example .env` і замініть `CHANGE_ME` своїм паролем.
   `.env` ігнорує git, пароль у репозиторій не потрапляє.
3. **Кластер.**

   | Команда | Що робить |
   |---|---|
   | `make db-up` | створює кластер, якщо його немає; запускає; створює роль і БД з `DATABASE_URL`. Повторний запуск безпечний |
   | `make db-down` | зупиняє кластер, дані лишаються |
   | `make db-destroy` | зупиняє й видаляє `.pgdata/` разом з усіма даними |

   Далі — `make db-migrate` (схема, [ADR-0026](docs/adr/0026-mihratsii-sql-i-vlasnyi-raner.md))
   і `make db-seed` (довідники й користувачі). Тести (`make check`) беруть ту
   саму роль і створюють окрему базу на кожен прогін.

   Лог сервера — `.pgdata/server.log`. Роль `labqueue` не суперкористувач;
   `CREATEDB` має, бо тести створюють окрему БД на кожен прогін.
4. **pgAdmin (необов'язково).** Register → Server: host `127.0.0.1`, port
   `55432`, user `labqueue`, пароль з `.env`.

## Документи

| Що | Де |
|---|---|
| Захист лаби | [DEFENSE.md](DEFENSE.md) |
| Spec і журнал змін | лаба 1: [spec.md](docs/specs/lab1-foundation/spec.md), [spec-fix.md](docs/specs/lab1-foundation/spec-fix.md); лаба 2: [spec.md](docs/specs/lab2-db-scenarios/spec.md), [spec-fix.md](docs/specs/lab2-db-scenarios/spec-fix.md) |
| Архітектура й домен | [architecture.md](docs/specs/lab1-foundation/architecture.md) |
| Контракт, схема БД, запити, помилки | [data.md](docs/specs/lab2-db-scenarios/data.md) |
| Стандарти | [standards/](standards/) |
| Рішення (ADR) | [docs/adr/](docs/adr/) |
| Аудит | [лаба 1](docs/audit/lab1.md), [лаба 2](docs/audit/lab2.md) |
| Промпти роботи з ШІ | [ai/lab1/](ai/lab1/), [ai/lab2/](ai/lab2/) |
| Звіти | [reports/lab1/](reports/lab1/), [reports/lab2/](reports/lab2/) |

## Залежності

Кожен пакет — з одним рядком «навіщо» ([standards/dependencies.md](standards/dependencies.md)).

| Пакет | Тип | Навіщо |
|---|---|---|
| `fastify` | prod | HTTP-сервер, `/health` і `/version`, плагіни під межі модулів ([ADR-0009](docs/adr/0009-fastify.md)) |
| `prettier` | dev | форматування JS, JSON, YAML; CHK-01 ([ADR-0008](docs/adr/0008-eslint-i-prettier.md)) |
| `eslint` | dev | лінт коду; CHK-02 ([ADR-0008](docs/adr/0008-eslint-i-prettier.md)) |
| `@eslint/js` | dev | рекомендовані правила ESLint для JavaScript ([ADR-0008](docs/adr/0008-eslint-i-prettier.md)) |
| `globals` | dev | глобальні змінні Node.js для ESLint ([ADR-0008](docs/adr/0008-eslint-i-prettier.md)) |
| `typescript` | dev | `tsc --noEmit --checkJs` — перевірка JSDoc-типів; CHK-03 ([ADR-0007](docs/adr/0007-javascript-esm-jsdoc-checkjs.md)) |
| `@types/node` | dev | типи API Node.js 24 для перевірки типів ([ADR-0007](docs/adr/0007-javascript-esm-jsdoc-checkjs.md)) |
| `dependency-cruiser` | dev | межі модулів, цикли, напрями залежностей, not-to-dev-dep; CHK-04 ([ADR-0013](docs/adr/0013-dependency-cruiser.md)) |
| `esbuild` | dev | збірка `src/` у `dist/` і вшивання sha для `/version`; CHK-05 ([ADR-0012](docs/adr/0012-esbuild-i-smoke-po-dist.md), [ADR-0019](docs/adr/0019-dzherelo-sha-dlia-version.md)) |
| `husky` | dev | встановлює git-hooks під час `npm install`: pre-commit, commit-msg, pre-push ([ADR-0011](docs/adr/0011-husky-i-lint-staged.md)) |
| `postgres` | prod | драйвер PostgreSQL із tagged templates: репозиторії, `unitOfWork`, міграції ([ADR-0032](docs/adr/0032-postgresql-postgres-js.md)) |
| `lint-staged` | dev | pre-commit перевіряє формат і лінт лише staged-файлів ([ADR-0011](docs/adr/0011-husky-i-lint-staged.md)) |
