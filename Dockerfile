# Образ staging (ADR-0043): Railway збирає його сам після зеленого CI
# (ADR-0042). Той самий образ виконує структурні міграції в Pre-deploy, seed і
# HTTP (ADR-0044). Налаштування сервісу Railway — README, «Staging».

# Стадія збірки: devDependencies лише тут, у кінцевий образ не потрапляють.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: husky (prepare) без git у контейнері не встановиться.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
# Railway передає sha коміту в збірку лише для оголошеного ARG; git тут
# немає, тож scripts/build.js бере sha зі змінної (ADR-0019, «Уточнення»).
ARG RAILWAY_GIT_COMMIT_SHA
RUN npm run build

# Кінцева стадія: dist/, prod-залежності, міграції, seed.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
# Слухати всі адреси: інакше health check Railway і інтернет не дістануться
# застосунку (ADR-0043). Порт — PORT, який задає Railway.
ENV HOST=::
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY scripts/migrate.js scripts/seed.js scripts/seed-on-start.js ./scripts/
COPY src/modules/catalog/seed.json ./src/modules/catalog/seed.json
COPY src/modules/identity/seed.json ./src/modules/identity/seed.json
USER node
# Seed — окремий крок перед HTTP, лише з SEED_ON_START=1 (критерій 11); якщо
# він упаде, HTTP не стартує. Структурні міграції — не тут, а в Pre-deploy.
CMD ["sh", "-c", "node scripts/seed-on-start.js && exec node dist/main.js"]
