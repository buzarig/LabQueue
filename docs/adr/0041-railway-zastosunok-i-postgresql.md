# ADR-0041: Staging на Railway — застосунок і PostgreSQL 17

- Статус: прийнято
- Дата: 2026-11-24
- Промпт: ai/lab4/002-vidpovidi-zlyttia-hostyng-bd-tryger.md, ai/lab4/009-vidpovidi-konfih-railway-sf1.md, ai/lab4/013-tak-adr.md

## Контекст і проблема

Spec лаби 4 (критерії 4–6) вимагає публічний staging, який оновлюється з
`main` без SSH з GitHub Actions. Нова версія не повинна отримувати трафік,
доки не готова. Потрібні хостинг застосунку в контейнері й PostgreSQL 17 —
та сама версія, що в CI і локально
([ADR-0033](0033-izolovane-seredovyshche-pg17.md)).

## Чинники рішення

- **Без SSH і без доступу CI до БД**: платформа сама запускає новий
  контейнер.
- **Перемикання трафіку за health check**: стара версія працює, доки нова
  не відповіла.
- **Крок перед деплоєм** у тому самому образі — для структурних міграцій
  ([ADR-0044](0044-mihratsii-u-chotyry-kroky.md)).
- **Вартість** для навчального проєкту і **PostgreSQL 17**.

## Розглянуті варіанти

1. **Railway**: сервіс із Dockerfile і PostgreSQL у тому самому проєкті.
2. **Render**: Docker web service, zero-downtime deploy за health check.
3. **Fly.io**: стратегія `bluegreen`, деплой через `flyctl`.
4. **Google Cloud Run**: ревізії, трафік після startup probe.

## Рішення

Обрано **варіант 1** (рішення автора, промпт 002).

- Застосунок — сервіс Railway, який збирається з `Dockerfile`
  ([ADR-0043](0043-dockerfile-i-sha-zbirky.md)).
- БД — PostgreSQL 17 у тому самому проєкті Railway з образу
  `ghcr.io/railwayapp-templates/postgres-ssl:17`: стандартна БД Railway не дає
  вибрати версію. Застосунок отримує `DATABASE_URL` змінною сервісу. Версію
  підтверджує `SHOW server_version` (spec, критерій 4).
- Налаштування сервісу задаються в панелі Railway і описані в README
  («Staging»), рішення автора (промпт 009). `railway.json` не
  використовуємо: Railway позначив його застарілим, нові сервіси його не
  підключають, а з 2026-12-01 він не читається. Infrastructure as Code
  (`.railway/railway.ts`) відкинуто нижче.

### Наслідки

- **Добре:**
  - застосунок і БД в одному проєкті, БД доступна лише з приватної мережі
    Railway;
  - Pre-deploy, health check і «Wait for CI» є з коробки (ADR-0042, 0044,
    0045).
- **Погано / ціна:**
  - безкоштовно лише пробний кредит, далі план Hobby (5 $ на місяць);
  - налаштування сервісу не в git: зміну в панелі видно лише в README, якщо
    її туди записати;
  - образ БД — шаблон Railway, а не офіційний `postgres:17`, як у CI.

## Плюси й мінуси варіантів

### Варіант 2: Render

- Плюс: є безкоштовний web service, zero-downtime deploy за health check.
- Мінус: безкоштовна БД видаляється через 30 днів, сервіс засинає без
  трафіку → автор обрав Railway.

### Варіант 3: Fly.io

- Плюс: явна стратегія `bluegreen`.
- Мінус: потрібна платіжна картка, деплой — `flyctl` з токеном у Actions
  → відкинуто.

### Варіант 4: Google Cloud Run

- Плюс: найнадійніше перемикання ревізій.
- Мінус: GCP-акаунт із білінгом, Workload Identity, окрема Cloud SQL —
  забагато для staging навчального проєкту → відкинуто.

### Налаштування через `.railway/railway.ts`

- Плюс: налаштування в git, `railway config plan` показує розбіжності.
- Мінус: новий пакет `railway` і перший TypeScript-файл у JS-проєкті,
  технологія з серпня 2026, застосовується вручну, а «Wait for CI» однаково
  лише в панелі → відкинуто (промпт 009).

## Посилання

- [spec лаби 4](../specs/lab4-ci/spec.md): критерії 4–6
- [Railway: Config as Code](https://docs.railway.com/reference/config-as-code)
- [Railway: Infrastructure as Code](https://railway.com/guides/railway-infrastructure-as-code)
