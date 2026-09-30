// Межі модулів (ADR-0013). Номери правил — розділ «Напрями залежностей»
// у docs/specs/lab1-foundation/architecture.md.
const MODULES = "identity|catalog|sessions|queue";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "arch-1-entry-only",
      comment:
        "Правило 1: інший модуль (і platform) імпортується лише через його index.js.",
      severity: "error",
      from: { path: "^src/(modules/[^/]+|platform|main\\.js)" },
      to: {
        path: "^src/(modules/[^/]+|platform)/.+",
        pathNot: ["^src/(modules/[^/]+|platform)/index\\.js$", "^src/$1/"],
      },
    },
    {
      name: "arch-2-no-circular",
      comment: "Правило 2: жодних циклів.",
      severity: "error",
      from: { path: "^src/" },
      to: { circular: true },
    },
    {
      name: "arch-3-catalog-leaf",
      comment: "Правило 3: catalog не імпортує інші модулі.",
      severity: "error",
      from: { path: "^src/modules/catalog/" },
      to: { path: "^src/modules/(?!catalog/)" },
    },
    {
      name: "arch-3-identity-leaf",
      comment: "Правило 3: identity не імпортує інші модулі.",
      severity: "error",
      from: { path: "^src/modules/identity/" },
      to: { path: "^src/modules/(?!identity/)" },
    },
    {
      name: "arch-3-sessions-direction",
      comment: "Правило 3: sessions імпортує лише catalog та identity.",
      severity: "error",
      from: { path: "^src/modules/sessions/" },
      to: { path: "^src/modules/(?!(sessions|catalog|identity)/)" },
    },
    {
      name: "arch-4-domain-not-to-platform",
      comment: "Правило 4: домен не імпортує platform і main.js.",
      severity: "error",
      from: { path: "^src/modules/" },
      to: { path: "^src/(platform/|main\\.js$)" },
    },
    {
      name: "arch-5-platform-not-to-domain",
      comment: "Правило 5: platform не імпортує домен і main.js.",
      severity: "error",
      from: { path: "^src/platform/" },
      to: { path: "^src/(modules/|main\\.js$)" },
    },
    {
      name: "k9-known-modules-only",
      comment:
        "К9: доменні модулі — лише ті, що в architecture.md (" + MODULES + ").",
      severity: "error",
      from: {},
      to: { path: "^src/modules/(?!(" + MODULES + ")/)" },
    },
    {
      name: "k9-no-orphans",
      comment:
        "К9: у src/ немає файлів, які ніхто не імпортує (крім main.js), — непідключених модулів.",
      severity: "error",
      from: { orphan: true, path: "^src/", pathNot: "^src/main\\.js$" },
      to: {},
    },
    {
      name: "not-to-dev-dep",
      comment:
        "src/ не імпортує devDependencies: dist/ бере пакети з node_modules (ADR-0012, ADR-0013).",
      severity: "error",
      from: { path: "^src/" },
      to: { dependencyTypes: ["npm-dev"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    moduleSystems: ["es6"],
    tsPreCompilationDeps: false,
  },
};
