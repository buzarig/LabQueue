**Питання:** ADR-0031 і правило dependency-cruiser `layer-known-roles` дозволяють у модулі лише такі файли: index, routes, service, repo, repo-memory, repo-pg, model, errors. Файл `transitions.js` зламає `make check`. Як оформлюємо нову роль?
**Відповідь:** ADR-0037 окремим комітом (Recommended)

**Питання:** У S4 (завершення заняття) переходи waiting/called → missed робить репозиторій: SQL у repo-pg.js і фільтр у repo-memory.js, а не service.js. Що виносимо в transitions.js?
**Відповідь:** Правило — в transitions.js (Recommended)
