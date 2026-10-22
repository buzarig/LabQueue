ADR 0006–0019 і зміни стандартів прийнято. Реалізуємо конвеєр строго за
standards/checks.md і ADR — це перший коміт «коду» за К4.

Встановлювати пакети через npm дозволяю — лише ті, що обґрунтовані в ADR.
Якщо знадобиться пакет, якого немає в ADR, — спершу спитай.

- package.json (ESM, engines Node 24), lockfile, .nvmrc, .editorconfig;
  у README для кожної залежності — рядок «навіщо» з посиланням на ADR.
- ESLint + Prettier, tsc --noEmit --checkJs (strict), dependency-cruiser
  з правилами з ADR-0013 (включно з not-to-dev-dep); доменних модулів
  ще немає — лише src/platform і src/main.js.
- Мінімальний застосунок за К8: GET /health → 200 {"status":"ok"};
  GET /version → {"sha":"<sha>"} або {"sha":"unknown"}; PORT, типово 3000;
  sha вшивається збіркою (ADR-0019).
- Збірка esbuild у dist/, smoke-тест на node:test запускає саме dist/ і
  перевіряє обидва ендпоінти, включно з випадком unknown.
- husky + lint-staged підключаються через prepare під час npm install:
  pre-commit, commit-msg (CHK-07/08), pre-push (make check).
- Makefile: make check (зі сам-встановленням залежностей за checks.md),
  make verify; GitHub Actions запускає make check на push і PR.
- Демонстрації за К7: коміт з порушенням стилю → відмова, пуш зі зламаним
  smoke-тестом → відмова; реальний вивід у reports/lab1/, відтворення
  через make (в тимчасовому клоні, робоче репо не бруднимо).

Роби кількома логічними комітами з трейлером Prompt. Якщо щось із checks.md
реалізувати не вдалося або довелося відступити від ADR — скажи прямо до
коміту, не вирішуй сам.