# Єдиний інтерфейс команд (ADR-0014). Склад цілей — standards/checks.md.
.PHONY: check verify mutation test-mutation format lint typecheck typecheck-probe boundaries test test-unit test-integration test-e2e db-ready coverage coverage-clean scenarios test-db build smoke commits hygiene report-scenarios report-scenarios-pg report-failures report-queries report-unit report-db report-e2e report-coverage db-up db-down db-destroy db-migrate db-seed

# Маркер встановлених пакетів: npm ci, якщо node_modules відсутній або
# package-lock.json новіший за нього (sf-4).
DEPS := node_modules/.package-lock.json

$(DEPS): package-lock.json
	npm ci
	@mkdir -p node_modules && touch $@

# Покриття src/ (ADR-0039): unit- та інтеграційні прогони пишуть дані V8 в одну
# теку, ціль coverage зводить їх в один звіт. Порогу тут немає.
C8 := node_modules/.bin/c8
COVERAGE_TMP := coverage/src/tmp
C8_SRC := $(C8) --include "src/**" --temp-directory $(COVERAGE_TMP) --clean=false --reporter none

# Брама: запускають pre-push і CI. Файли під git не змінює.
check: format lint typecheck typecheck-probe boundaries test smoke commits hygiene
	@echo "make check: OK"

# CHK-01: формат коду (лише JS, JSON, YAML — Markdown не форматуємо).
format: $(DEPS)
	npm run --silent format:check

# CHK-02: лінт.
lint: $(DEPS)
	npm run --silent lint

# CHK-03: статичний аналіз типів (JSDoc + tsc --checkJs strict).
typecheck: $(DEPS)
	npm run --silent typecheck

# CHK-13: регресія перевірки JSDoc — tsc ловить помилку в кожній конструкції
# проби (ADR-0020).
typecheck-probe: $(DEPS)
	npm run --silent typecheck:probe

# CHK-04: межі модулів і not-to-dev-dep (dependency-cruiser, ADR-0013).
boundaries: $(DEPS)
	npm run --silent boundaries

# CHK-14: юніт-тести src/ (node:test, ADR-0010). CHK-19: Vitest-тести
# transitions.js під c8 — нижче 80 % гілок чи функцій ціль падає (ADR-0038,
# ADR-0039, sf-1 лаби 3).
test-unit: $(DEPS)
	$(C8_SRC) npm run --silent test
	npm run --silent test:transitions

# Одна команда для всіх рівнів (spec лаби 3, критерій 16): БД і міграції,
# unit, інтеграційні, E2E, звіт покриття src/.
test: coverage-clean db-ready test-unit test-integration test-e2e coverage

# Інтеграційні тести — наявні сценарна сюїта (memory і pg) і tests/db
# (spec лаби 3, критерії 7–8), під c8 для звіту покриття.
test-integration: db-ready
	$(C8_SRC) $(MAKE) --no-print-directory scenarios test-db

# CHK-22: E2E — зібраний dist/ окремим процесом на PostgreSQL, S1–S13 через
# HTTP (spec лаби 3, критерії 9–10). У звіт покриття src/ не входить: це бандл.
test-e2e: db-ready build
	npm run --silent test:e2e

# БД для тестів (критерій 17): якщо DATABASE_URL задано в середовищі (CI —
# контейнер), локальний кластер не запускаємо; інакше make db-up. Далі —
# міграції в базу з DATABASE_URL. Тести беруть окрему БД із шаблону (ADR-0033).
db-ready: $(DEPS)
ifdef DATABASE_URL
	@echo "db-ready: DATABASE_URL задано в середовищі — локальний кластер не запускаю"
else
	node scripts/db.js up
endif
	node --env-file-if-exists=.env scripts/migrate.js

# Звіт покриття src/ за unit та integration (критерій 11).
coverage: $(DEPS)
	$(C8) report --include "src/**" --temp-directory $(COVERAGE_TMP) --report-dir coverage/src --reporter text

coverage-clean:
	rm -rf coverage/src

# CHK-15: сценарна сюїта S1–S13 і каталог помилок через HTTP (К7, К8) — та
# сама на обох сховищах (К10): статика й PostgreSQL.
scenarios: $(DEPS)
	STORAGE=memory npm run --silent scenarios
	STORAGE=pg npm run --silent scenarios

# CHK-17: тести на PostgreSQL (К10–К17): окрема БД на прогін із шаблону
# (ADR-0033). Без запущеного кластера — зупинка з підказкою make db-up.
test-db: $(DEPS)
	npm run --silent test:db

# CHK-05: збірка — tsc-перевірка + бандл esbuild у dist/ з вшитим sha.
# Пише лише в dist/, який ігнорує git.
build: typecheck
	npm run --silent build

# CHK-06: smoke-тест зібраного dist/ (/health, /version, випадок unknown).
smoke: build
	npm run --silent smoke

# CHK-07, CHK-08: історія комітів main..HEAD (трейлер Prompt, формат повідомлень).
commits: $(DEPS)
	npm run --silent commits

# CHK-09: гігієна відстежуваних файлів (standards/repo-hygiene.md).
hygiene: $(DEPS)
	npm run --silent hygiene

# CHK-20: мутаційне тестування transitions.js (Stryker + Vitest, ADR-0040) і
# звіт із класифікацією вижилих → reports/<лаба>/mutation.txt. Не входить у
# check: запускається окремо (spec лаби 3, критерій 13).
mutation: $(DEPS)
	npm run --silent mutation
	node scripts/report-mutation.js

test-mutation: mutation

# Докази для здачі: make check + звіти в reports/<лаба>/ (CHK-11, CHK-16) + дата
# й sha у reports/<лаба>/verify.txt (CHK-12). Запускає автор перед здачею; на неї
# посилається DEFENSE.
verify: $(DEPS)
	node scripts/verify.js

# CHK-16 (К9): звіт прогону сценарної сюїти на статиці → reports/<лаба>/scenarios-memory.txt.
report-scenarios: $(DEPS)
	node scripts/report-tests.js scenarios-memory

# CHK-18: звіти етапу БД → reports/<лаба>/: та сама сюїта на PostgreSQL (К10),
# збої джерела (К14), кількість запитів без N+1 (К16).
report-scenarios-pg: $(DEPS)
	node scripts/report-tests.js scenarios-pg

report-failures: $(DEPS)
	node scripts/report-tests.js failures

report-queries: $(DEPS)
	node --env-file-if-exists=.env scripts/report-queries.js

# Звіти лаби 3 (критерій 18) → reports/<лаба>/: unit (К4–К6), integration на
# PostgreSQL (К7–К8), E2E (К9–К10), покриття src/ і transitions.js (К11–К12).
# Мутації (К13–К14) — make mutation. Усе разом — make verify.
report-unit: $(DEPS)
	node scripts/report-tests.js unit

report-db: db-ready
	node scripts/report-tests.js db

report-e2e: db-ready build
	node scripts/report-tests.js e2e

report-coverage: test
	node scripts/report-coverage.js

# Локальний кластер PostgreSQL 17 у .pgdata/ на 127.0.0.1:55432 (ADR-0033).
# Роль, пароль і БД — з DATABASE_URL у .env. db-destroy видаляє всі дані.
db-up:
	node scripts/db.js up

db-down:
	node scripts/db.js down

db-destroy:
	node scripts/db.js destroy

# Міграції (ADR-0026) і seed-дані (data.md) у базу з DATABASE_URL.
db-migrate: $(DEPS)
	node --env-file-if-exists=.env scripts/migrate.js

db-seed: $(DEPS)
	node --env-file-if-exists=.env scripts/seed.js
