# Єдиний інтерфейс команд (ADR-0014). Склад цілей — standards/checks.md.
.PHONY: check verify format lint

# Маркер встановлених пакетів: npm ci, якщо node_modules відсутній або
# package-lock.json новіший за нього (sf-4).
DEPS := node_modules/.package-lock.json

$(DEPS): package-lock.json
	npm ci
	@mkdir -p node_modules && touch $@

# Брама: запускають pre-push і CI. Файли під git не змінює.
check: format lint
	@echo "make check: OK"

# CHK-01: формат коду (лише JS, JSON, YAML — Markdown не форматуємо).
format: $(DEPS)
	npm run --silent format:check

# CHK-02: лінт.
lint: $(DEPS)
	npm run --silent lint
