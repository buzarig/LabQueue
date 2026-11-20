// ESLint (flat config): логіка коду. Формат — справа Prettier (ADR-0008).
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["dist/", "coverage/"] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
  },
  // К6, ADR-0031: один глобальний обробник помилок. try/catch дозволений лише
  // там, де живуть транзакції, ретраї й переклад SQLSTATE.
  {
    files: ["src/**/*.js"],
    ignores: ["src/platform/**", "src/modules/*/repo-pg.js"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TryStatement",
          message:
            "try/catch лише в src/platform/ і repo-pg.js; решту помилок обробляє глобальний обробник (ADR-0031, К6)",
        },
      ],
    },
  },
  // К4, ADR-0031/0032: драйвер БД лише в шарі даних; sql.unsafe — ніде.
  {
    files: ["src/**/*.js"],
    ignores: ["src/platform/db/**", "src/modules/*/repo-pg.js"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "postgres",
              message:
                "драйвер БД імпортують лише repo-pg.js і src/platform/db/ (ADR-0031, К4)",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.js"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "sql",
          property: "unsafe",
          message: "sql.unsafe обходить параметри tagged templates (ADR-0032)",
        },
      ],
    },
  },
];
