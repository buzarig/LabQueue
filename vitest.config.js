// Vitest — лише для тестів transitions.js, які мутує Stryker (ADR-0038).
// Решта тестів — node:test у tests/unit/ (ADR-0010).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/vitest/**/*.test.js"],
    // c8 (ADR-0039) бачить покриття Vitest лише в потоках: на «forks» — 0 %.
    pool: "threads",
    // Нативний import замість модульного раннера Vite. Інакше c8 рахує
    // згенерований Vite код як 14 непокритих гілок на рядках із JSDoc
    // (69,56 % при 100 % справжніх). Наш код — чистий ESM, перетворення не
    // потрібне.
    experimental: { viteModuleRunner: false, nodeLoader: false },
  },
});
