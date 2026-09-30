# Єдиний інтерфейс команд (ADR-0014). Склад цілей — standards/checks.md.
.PHONY: check verify format lint typecheck boundaries build

# Маркер встановлених пакетів: npm ci, якщо node_modules відсутній або
# package-lock.json новіший за нього (sf-4).
DEPS := node_modules/.package-lock.json

$(DEPS): package-lock.json
	npm ci
	@mkdir -p node_modules && touch $@

# Брама: запускають pre-push і CI. Файли під git не змінює.
check: format lint typecheck boundaries build
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

# CHK-04: межі модулів і not-to-dev-dep (dependency-cruiser, ADR-0013).
boundaries: $(DEPS)
	npm run --silent boundaries

# CHK-05: збірка — tsc-перевірка + бандл esbuild у dist/ з вшитим sha.
# Пише лише в dist/, який ігнорує git.
build: typecheck
	npm run --silent build
