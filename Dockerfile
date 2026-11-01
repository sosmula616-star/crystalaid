FROM node:26-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends redis-server \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN npm install -g pnpm@12.16.1

# Manifests first, so the install layer is cached until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/activity/package.json apps/activity/
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY packages/design-system/package.json packages/design-system/
COPY packages/domain/package.json packages/domain/
COPY packages/i18n/package.json packages/i18n/
# Dev dependencies stay: the build needs vite and tsc, and tsx runs the API and the migrations.
RUN pnpm install --frozen-lockfile

COPY . .

# The Discord client id is not known at build time: the API injects DISCORD_CLIENT_ID into
# index.html at runtime, so the build gets a placeholder and the guard in vite.config.ts is relaxed.
RUN VITE_DISCORD_CLIENT_ID=runtime-placeholder CRYSTALAID_RUNTIME_CLIENT_ID=1 pnpm --dir apps/activity run build

ENV PORT=3000
EXPOSE 3000

CMD ["node", "scripts/start-activity.mjs"]
