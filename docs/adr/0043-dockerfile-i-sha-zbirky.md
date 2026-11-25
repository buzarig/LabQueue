# ADR-0043: Образ — власний Dockerfile на Node 24, sha з `RAILWAY_GIT_COMMIT_SHA`

- Статус: прийнято
- Дата: 2026-11-24
- Промпт: ai/lab4/001-vymohy-laby-4.md, ai/lab4/002-vidpovidi-zlyttia-hostyng-bd-tryger.md

## Контекст і проблема

Railway збирає образ сам ([ADR-0042](0042-cd-railway-wait-for-ci.md)). У
тому самому образі мають бути застосунок, структурні міграції для
Pre-deploy, фонові міграції й seed
([ADR-0044](0044-mihratsii-u-chotyry-kroky.md)). `GET /version` на staging
має повертати sha задеплоєного коміту (spec, критерій 5), а
`scripts/build.js` бере його з `git rev-parse`
([ADR-0019](0019-dzherelo-sha-dlia-version.md)) — у контексті збірки Railway
`.git` може не бути.

## Чинники рішення

- **Відтворюваність**: та сама версія Node, що в `.nvmrc` (24).
- **Той самий `dist/`**, що перевіряє smoke-тест
  ([ADR-0012](0012-esbuild-i-smoke-po-dist.md)).
- **Sha без git** у середовищі збірки.
- **Розмір і склад**: лише prod-залежності в кінцевому образі.

## Розглянуті варіанти

1. **Власний `Dockerfile`**: стадія збірки (`npm ci`, `npm run build`) і
   кінцева стадія з `dist/`, prod-залежностями, міграціями й скриптами.
2. **Railpack/Nixpacks від Railway** без Dockerfile.

## Рішення

Обрано **варіант 1**.

- Базовий образ — `node:24-slim`, обидві стадії.
- Збірка оголошує `ARG RAILWAY_GIT_COMMIT_SHA`. Railway передає його лише
  для деплоїв, запущених із GitHub, і лише якщо `ARG` оголошено.
- `scripts/build.js`: sha з `git rev-parse HEAD`; якщо git недоступний —
  зі змінної `RAILWAY_GIT_COMMIT_SHA`; інакше `unknown`. Це доповнює
  ADR-0019 (там змінна оточення була варіантом 3 «на випадок деплою»).
- Кінцева стадія: `npm ci --omit=dev`, `dist/`, `migrations/`,
  `scripts/` для міграцій і seed, seed-файли модулів.
- Адреса прослуховування — нова змінна `HOST`. Fastify типово слухає лише
  `localhost`, тож у контейнері застосунок недосяжний ні для health check
  Railway, ні з інтернету. Образ задає `HOST=::` (усі адреси IPv4 і IPv6),
  локально лишається `localhost`. Порт — `PORT`, який задає Railway.

### Наслідки

- **Добре:**
  - `/version` на staging повертає sha коміту, який зібрав Railway;
  - у кінцевому образі немає devDependencies (esbuild, тести).
- **Погано / ціна:**
  - Dockerfile локально не перевірити: Docker не встановлено, тож перша
    перевірка — збірка на Railway;
  - ручний «Deploy Latest» у Railway, за повідомленням спільноти, не
    передає build arg — тоді `/version` поверне `unknown`. Доказом слугує
    лише деплой з GitHub.

## Плюси й мінуси варіантів

### Варіант 2: Railpack/Nixpacks

- Плюс: без Dockerfile.
- Мінус: склад образу й команда збірки визначаються автоматично, sha в
  `dist/` однаково треба передати; менше контролю над тим, що потрапить в
  образ → відкинуто.

## Посилання

- [spec лаби 4](../specs/lab4-ci/spec.md): критерій 5
- [Railway: Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- [Railway: змінні](https://docs.railway.com/variables/reference)
