# ADR-0040: Мутаційне тестування — Stryker з Vitest, лише `transitions.js`

- Статус: прийнято
- Дата: 2026-11-18
- Промпт: ai/lab3/003-vidpovidi-pro-testy.md, ai/lab3/005-vidpovidi-spec-mutatsii-audyt.md, ai/lab3/012-tak-adr-instrumenty.md

## Контекст і проблема

Курс вимагає мутаційного тестування (Stryker, PIT, mutmut або
cosmic-ray) і звіту з класифікацією вижилих мутантів. Spec лаби 3
(критерії 13, 14): Stryker з Vitest мутує лише `transitions.js`, прогін
відтворює `make mutation`, а мутаційні тести не входять у `make test`.

## Чинники рішення

- **JavaScript**: PIT (Java), mutmut і cosmic-ray (Python) не працюють із
  нашим кодом.
- **Окремо від `make check`**: мутації не сповільнюють кожен пуш (рішення
  автора, промпт 004).
- **Відтворюваність однією командою** і звіт у `reports/lab3/`.

## Розглянуті варіанти

1. **StrykerJS + `@stryker-mutator/vitest-runner`.**
2. **StrykerJS + `command`-раннер** поверх `node --test`.
3. **Власний скрипт мутацій**: заміна операторів і прогін тестів.

## Рішення

Обрано **варіант 1** (рішення автора, промпт 003).

- Пакети `@stryker-mutator/core` і `@stryker-mutator/vitest-runner`,
  основна версія **10** (`^10.1.1`; раннер вимагає ту саму версію ядра).
- Конфіг `stryker.config.json`:
  - `mutate: ["src/modules/queue/transitions.js"]`,
    `coverageAnalysis: "perTest"`;
  - `tsconfigFile` вказує на файл, якого немає. Інакше Stryker кличе JS API
    TypeScript, а в TypeScript 7 його немає
    ([ADR-0020](0020-versiia-typescript-dlia-checkjs.md)): падіння
    `ts.parseConfigFileTextToJson is not a function`;
  - `ignorePatterns` — `.pgdata` (сокет кластера не копіюється в пісочницю),
    `dist`, `reports`;
  - звіти: HTML і JSON у `reports/lab3/`, текст у консоль; пісочниця
    `.stryker-tmp/` — у `.gitignore`.
- `make mutation` — основна команда, `make test-mutation` — її псевдонім.
  Порогу `break` немає: курс вимагає класифікувати вижилих, а не досягти
  числа.

### Наслідки

- **Добре:**
  - Stryker проганяє лише тести, що покривають мутанта; ~90 мутантів
    `transitions.js` — секунди;
  - звіт показує кожного вижилого з рядком і заміною.
- **Погано / ціна:**
  - обхід `tsconfigFile` — залежність від поведінки Stryker: якщо вона
    зміниться, прогін упаде з тією ж помилкою;
  - мутуємо лише один файл: слабкі тести в решті коду мутації не покажуть,
    їх шукає аудит (критерій 15);
  - дві пакетні залежності з транзитивними знахідками `npm audit`
    (`minimatch`, `typed-rest-client`), лише в devDependencies.

## Плюси й мінуси варіантів

### Варіант 2: `command`-раннер

- Плюс: без Vitest.
- Мінус: без покриття на тест, уся команда на кожного мутанта, «no
  coverage» не розрізняється (ADR-0038) → відкинуто.

### Варіант 3: власний скрипт

- Плюс: жодних залежностей.
- Мінус: набір мутаторів і звіт довелося б писати й доводити самим; курс
  називає готові інструменти → відкинуто.

## Посилання

- [spec лаби 3](../specs/lab3-testing-mutation/spec.md): критерії 13, 14
- [ADR-0038](0038-vitest-dlia-transitions.md)
- [ADR-0039](0039-c8-pokryttia.md)
