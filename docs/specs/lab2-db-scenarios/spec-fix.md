# spec-fix: журнал змін spec лаби 2

`spec.md` завжди містить актуальну версію. Цей файл — журнал змін прийнятого
тексту `spec.md`, `data.md` і правил домену в
[architecture.md](../lab1-foundation/architecture.md) лаби 1, зроблених у
лабі 2. Для кожного пункту записано, що було, що стало, чому і за яким
промптом. Змінене місце позначене `(sf-N)`; для architecture.md — `(sf-N лаби 2)`.
Формат — [standards/spec-format.md](../../../standards/spec-format.md).

## sf-1. Локальний PostgreSQL ≥17, окрема роль, дві БД і змінні з `.env`

- **Було:** `data.md`, «Тести й середовище»: `DATABASE_URL`, типово
  `postgres://localhost:5432/labqueue_test`; `make check` сам створює тестову
  БД; підказка `brew services start postgresql@17`.
- **Стало:** цільова версія 17 перевіряється в CI, локально — будь-яка ≥17.
  Роль `labqueue` без суперправ, БД `labqueue_dev` і `labqueue_test`
  створюються один раз за README. Змінні `DATABASE_URL` і
  `TEST_DATABASE_URL` беруться з оточення або `.env`. `make check` БД не
  створює, а підказка веде в README.
- **Чому:** в автора вже встановлений і запущений PostgreSQL 18 (EDB) з
  pgAdmin, тож brew-17 конфліктував би за порт 5432. Без пароля типовий
  рядок підключення не працює, а роль без суперправ не може створювати БД.
  ADR-0021 згадує `brew` як приклад локального сервера; рішення ADR (цільова
  17, тести на локальному PostgreSQL) не змінюється.
- **Промпт:** [017](../../../ai/lab2/017-faza-nalashtovuiemo-postgres.md),
  [018](../../../ai/lab2/018-vidpovid-versiia-faza.md).
