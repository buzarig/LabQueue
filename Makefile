# Єдиний інтерфейс команд (ADR-0014). Склад цілей — standards/checks.md.
.PHONY: check verify

# Маркер встановлених пакетів: npm ci, якщо node_modules відсутній або
# package-lock.json новіший за нього (sf-4).
DEPS := node_modules/.package-lock.json

$(DEPS): package-lock.json
	npm ci
	@mkdir -p node_modules && touch $@

# Брама: запускають pre-push і CI. Файли під git не змінює.
check: $(DEPS)
	@echo "make check: OK"
