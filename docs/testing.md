# Тесты

Нужны запущенные PostgreSQL и Redis и корневой `.env` с `TEST_DATABASE_URL` и `TEST_REDIS_URL`. Они должны отличаться от `DATABASE_URL` и `REDIS_URL`; тесты это проверяют. Перед каждым тестом тестовая база очищается, из Redis удаляются только свои ключи.

```
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
```

`pnpm test` запускает `vitest run`. Vitest нужно запускать из корня репозитория: там лежат конфигурация и глобальная настройка, которая загружает корневой `.env` и применяет миграции к тестовой базе. Один файл: `pnpm exec vitest run apps/api/src/e2e/core.test.ts`.

`pnpm build` сейчас ничего не собирает: у пакетов нет скрипта `build`, сервисы запускаются через tsx.

Сквозной тест `apps/api/src/e2e/core.test.ts` гоняет настоящий потребитель событий (`consumeBatch`) и API на настоящих Redis и PostgreSQL. Discord подменяет `fakeDiscord`.

## Длинный путь на Windows

Если путь к репозиторию длиннее 260 символов, на Windows ломаются esbuild (он нужен tsx и drizzle-kit) и `pnpm --filter`. Признаки: `ENOENT` при запуске `esbuild.exe`, ошибка записи состояния задач у `pnpm --filter`. Решение: клонировать в короткий путь. Обход: скопировать `esbuild.exe` в короткую папку, задать `ESBUILD_BINARY_PATH` и вызывать `pnpm --dir <пакет> run <скрипт>` вместо `--filter`.
