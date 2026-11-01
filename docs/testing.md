# Тесты

Нужны запущенные PostgreSQL и Redis и корневой `.env` с `TEST_DATABASE_URL` и `TEST_REDIS_URL`. Они должны отличаться от `DATABASE_URL` и `REDIS_URL`; тесты это проверяют. Перед каждым тестом тестовая база очищается, из Redis удаляются только свои ключи.

```
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
```

`pnpm test` запускает `vitest run`. Vitest нужно запускать из корня репозитория: там лежат конфигурация и глобальная настройка, которая загружает корневой `.env` и применяет миграции к тестовой базе. Один файл: `pnpm exec vitest run apps/api/src/e2e/core.test.ts`.

`pnpm build` собирает Activity и требует `VITE_DISCORD_CLIENT_ID`. Сервисы запускаются через tsx, их сборка не нужна.

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

### Границы браузерных тестов

- Повтор после сбоя загрузки раздела проверяется только на dev-сервере (режим `mock`, модуль раздела блокируется и затем разрешается). Производственная сборка не содержит подставного режима, поэтому войти в неё без настоящего Discord нельзя, и тот же сценарий на хэшированных файлах сборки не воспроизвести. Это ограничение принято сознательно: на настоящих файлах сборки повтор проверяется вручную в Discord.
- Проверка сборки (`bundle.spec.ts`) собирает проект в режиме `production` с `NODE_ENV=production`, ищет в файлах маркеры dev-кода (витрина, подставной SDK, переключатель `VITE_DEV_MOCK`) и убеждается, что сама проверка видит маркер в образце файла (положительный контроль). Внешние адреса допустимы только как строки внутри библиотек, ни один не запрашивается во время работы: домены Discord из SDK; `www.w3.org` (имена пространств имён XML в React и SVG); `json-schema.org` (поля `$schema` в zod); `react.dev` (текст сообщений об ошибках React); `github.com` (комментарий в uuid); `localhost` (значение по умолчанию в SDK). Загрузки по внешнему `src`, `href`, `@import` и `url()` тест не допускает вовсе.
