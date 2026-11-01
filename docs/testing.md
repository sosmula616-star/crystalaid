# Тесты

Нужны запущенные PostgreSQL и Redis и корневой `.env` с `TEST_DATABASE_URL` и `TEST_REDIS_URL`. Они должны отличаться от `DATABASE_URL` и `REDIS_URL`; тесты это проверяют. Перед каждым тестом тестовая база очищается, из Redis удаляются только свои ключи.

```
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
```

`pnpm test` запускает `vitest run`. Vitest нужно запускать из корня репозитория: там лежат конфигурация и глобальная настройка, которая загружает корневой `.env` и применяет миграции к тестовой базе. Один файл: `pnpm exec vitest run apps/api/src/e2e/core.test.ts`.

`pnpm build` ничего не собирает: у пакетов нет скрипта `build`, сервисы запускаются через tsx, сборка не нужна.

Дымовой тест `apps/api/src/smoke.test.ts` запускает настоящие функции входа `runApi` и `runWorker` в одном процессе на свободном порту с временной конфигурацией, обращается к `/health`, применяет событие и останавливает оба.

Сквозной тест `apps/api/src/e2e/core.test.ts` гоняет настоящий потребитель событий (`consumeBatch`) и API на настоящих Redis и PostgreSQL. Discord подменяет `fakeDiscord`.

## Длинный путь на Windows

Если путь к репозиторию длиннее 260 символов, на Windows ломаются esbuild (он нужен tsx и drizzle-kit) и `pnpm --filter`. Признаки: `ENOENT` при запуске `esbuild.exe`, ошибка записи состояния задач у `pnpm --filter`. Решение: клонировать в короткий путь. Обход: скопировать `esbuild.exe` в короткую папку, задать `ESBUILD_BINARY_PATH` и вызывать `pnpm --dir <пакет> run <скрипт>` вместо `--filter`.

## Браузерные тесты Activity

Playwright (только Chromium) проверяет раскладку, доступность и сборку Activity. Базы данных и Redis не нужны.

```
pnpm install --frozen-lockfile
pnpm --dir apps/activity exec playwright install chromium   # один раз
pnpm --dir apps/activity run test:e2e
```

Playwright сам запускает `vite --mode mock --host 127.0.0.1 --port 4173` и останавливает его. Тесты лежат в `apps/activity/e2e` (`*.spec.ts`), Vitest их не берёт. Снимки экрана пишутся в `apps/activity/e2e/screenshots` (в git не попадают). Подробности: [responsive.md](responsive.md).
