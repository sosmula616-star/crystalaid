# CrystalAid, ядро: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Построить на готовом каркасе ядро учёта стаффа: конфиг сервера, базу, уровни и права, синхронизацию состава, журнал действий, авторизацию Activity и API.

**Architecture:** `apps/api` запускается в ролях `api` и `worker` с общим сервисным слоем. Бот (подпроект 3) отправляет события в Redis Stream и вызывает внутренний API; здесь его заменяют тестовые события и поддельный сервер Discord. Уровень и права проверяются на backend при каждом запросе.

**Tech Stack:** TypeScript, Node.js 26, pnpm 12, Fastify, Zod, Drizzle, PostgreSQL 18, Redis (ioredis), jose, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-01-crystalaid-staff-design.md`, разделы 3, 6, 7, 10. Функции разделов 4 и 5 здесь не реализуются, но схема из раздела 7 создаётся целиком.

## Global Constraints

- Продукт CrystalAid. Scope пакетов: `@crystalaid/*`.
- Уже есть: монорепо, `packages/config` с `loadEnv`, Vitest, lint, typecheck. TypeScript закреплён на `^6.0.3` из-за совместимости typescript-eslint.
- Локальные PostgreSQL и Redis работают, адреса в корневом `.env`: `DATABASE_URL`, `TEST_DATABASE_URL`, `REDIS_URL`, `TEST_REDIS_URL`. `.env` не читать вслух, не печатать и не коммитить.
- Только команды Redis 5: без `XAUTOCLAIM`, `SET ... GET`, ACL, Functions.
- Формат ошибки: `{ "error": { "code", "message", "requestId" } }`.
- Лимиты: `/auth/activity` — 10/мин на IP, изменения — 30/мин на пользователя, чтение — 120/мин на пользователя.
- JWT живёт 15 минут, содержит `userId` и `discordUserId`. Уровень и права в токен не входят.
- Секреты только в env, в логах маскируются.
- Новые зависимости сверх Tech Stack, `@fastify/rate-limit`, `pg`, `drizzle-kit`, `tsx` добавляются только с обоснованием в сообщении коммита.
- Сверять актуальный API библиотек с документацией перед использованием.
- Каждый коммит заканчивается строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Решения, которые уточняют спецификацию

- `guild_id` в таблицах — текстовый ID сервера Discord, отдельной таблицы серверов нет.
- `staff_members` хранит вычисленный `level`, синхронизация обновляет его сразу при изменении ролей.
- Просмотр состава не отдельное право: `GET /staff` доступен уровням `CURATOR` и `ADMIN`.

## Review Focus

1. Роль отобрали во время открытой сессии: следующий запрос со старым JWT получает `403 NOT_STAFF`. Тест в задаче 7.
2. Один и тот же ID роли стоит в нескольких списках конфига: иначе любой саппорт станет куратором. Запуск останавливается с понятной ошибкой. Тест в задаче 1.
3. Пустая или обрезанная сверка состава: состав не деактивируется массово. Тест в задаче 5.
4. Discord отвечает 429 или 5xx при входе: `503 DISCORD_UNAVAILABLE`, а не 500. Тест в задаче 6.
5. Повреждённое событие в очереди: уходит в `events:dead`, подтверждается, очередь продолжает работу. Тест в задаче 5.

---

### Task 1: Конфиг сервера и правки каркаса

**Files:**
- Create: `packages/config/src/server-config.ts`, `crystalaid.config.example.json`
- Modify: `packages/config/src/env.ts`, `.gitignore`
- Test: `packages/config/src/server-config.test.ts`, `packages/config/src/env.test.ts`

**Interfaces:**
- Produces: `loadServerConfig(path?: string): ServerConfig`, по умолчанию `crystalaid.config.json` в корне. `ServerConfig = { guildId; timezone; roles: { support: string[]; curator: string[]; admin: string[] }; channels: { ticketCategory; ticketPanel; reports; audit } }`.

- [ ] **Step 1: Написать падающие тесты**

```ts
it('accepts a valid config', () => { expect(parse(valid).timezone).toBe('Europe/Moscow'); });
it('rejects an unknown timezone', () => { expect(() => parse({ ...valid, timezone: 'Mars/Base' })).toThrow(/timezone/); });
it('rejects a non-snowflake role id', () => { expect(() => parse(withRoles({ support: ['123'] }))).toThrow(/roles\.support/); });
it('rejects an empty role list', () => { expect(() => parse(withRoles({ curator: [] }))).toThrow(/roles\.curator/); });
it('rejects a role id used in two lists', () => {
  expect(() => parse(withRoles({ support: [A], curator: [A] }))).toThrow(/same role/i);
});
it('names the file when it is missing', () => { expect(() => loadServerConfig('missing.json')).toThrow(/missing\.json/); });
```

В `env.test.ts`: `loadEnv({ ...valid, TRUST_PROXY_HOPS: '' })` выбрасывает ошибку с `TRUST_PROXY_HOPS`; тест утечки использует `JWT_SECRET: 'short-secret-xyz'` и проверяет, что этого значения нет в ошибке.

- [ ] **Step 2: Запустить `pnpm test packages/config`.** Expected: FAIL.
- [ ] **Step 3: Реализовать.** ID — `^\d{17,20}$`. Часовой пояс проверяется через `Intl.DateTimeFormat`. Заменить устаревший `z.string().url()` на `z.url()`. Добавить `crystalaid.config.json` в `.gitignore`.
- [ ] **Step 4: Запустить тесты, typecheck, lint.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add server config`

### Task 2: Домен: уровни, права, неделя

**Files:**
- Create: `packages/domain/package.json`, `packages/domain/src/{levels,permissions,week,index}.ts`
- Test: `packages/domain/src/*.test.ts`

**Interfaces:**
- Produces:
  - `type Level = 'NONE' | 'SUPPORT' | 'CURATOR' | 'ADMIN'`
  - `resolveLevel(memberRoleIds: string[], roles: ServerConfig['roles']): Level`
  - `PERMISSIONS`: 12 строк раздела 3.3 спецификации; `type Permission`
  - `DEFAULT_GRANTS: Record<'SUPPORT' | 'CURATOR', Permission[]>`
  - `hasPermission(level: Level, permission: Permission, grants: Permission[]): boolean`, где `grants` — права уровня из базы
  - `isSelfAction(actorUserId: string, targetUserId: string): boolean`
  - `weekBounds(at: Date, timeZone: string): { start: Date; end: Date }`

- [ ] **Step 1: Написать падающие тесты**

```ts
expect(resolveLevel([ADMIN_ROLE], roles)).toBe('ADMIN');
expect(resolveLevel([CURATOR_ROLE, SUPPORT_ROLE], roles)).toBe('CURATOR');
expect(resolveLevel([CURATOR_ROLE], roles)).toBe('NONE');
expect(resolveLevel([SUPPORT_ROLE], roles)).toBe('SUPPORT');
expect(resolveLevel([], roles)).toBe('NONE');
expect(resolveLevel([ADMIN_ROLE, SUPPORT_ROLE], roles)).toBe('ADMIN');
expect(PERMISSIONS).toHaveLength(12);
expect(DEFAULT_GRANTS.CURATOR).toContain('shifts.edit');
expect(DEFAULT_GRANTS.CURATOR).not.toContain('tokens.grant');
expect(DEFAULT_GRANTS.SUPPORT).toEqual([]);
expect(hasPermission('ADMIN', 'tokens.grant', [])).toBe(true);
expect(hasPermission('CURATOR', 'tokens.grant', [])).toBe(false);
expect(hasPermission('NONE', 'reports.view', ['reports.view'])).toBe(false);
expect(weekBounds(new Date('2026-11-01T20:59:59Z'), 'Europe/Moscow').start.toISOString()).toBe('2026-10-25T21:00:00.000Z');
expect(weekBounds(new Date('2026-11-01T21:00:00Z'), 'Europe/Moscow').start.toISOString()).toBe('2026-11-01T21:00:00.000Z');
expect(weekBounds(new Date('2026-10-27T12:00:00Z'), 'Europe/Berlin').end.toISOString()).toBe('2026-11-01T23:00:00.000Z');
```

Последний случай проверяет неделю без перехода на зимнее время внутри неё, плюс отдельный тест на неделю с переходом в `Europe/Berlin`: 26 октября 2026 00:00 начинается в `2026-10-25T23:00:00.000Z`, а неделя, содержащая 25 октября, заканчивается в ту же точку.

- [ ] **Step 2: Запустить `pnpm test packages/domain`.** Expected: FAIL.
- [ ] **Step 3: Реализовать чистые функции без зависимостей.** Смещение часового пояса вычислять через `Intl.DateTimeFormat`, без библиотек дат.
- [ ] **Step 4: Запустить тесты.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add levels, permissions, and week rules`

### Task 3: Контракты

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/src/{errors,events,api,index}.ts`
- Test: `packages/contracts/src/events.test.ts`

**Interfaces:**
- Consumes: `Level`, `Permission`.
- Produces:
  - `ErrorCode`: `UNAUTHORIZED`, `TOKEN_EXPIRED`, `FORBIDDEN`, `NOT_STAFF`, `NOT_FOUND`, `VALIDATION_ERROR`, `RATE_LIMITED`, `SELF_ACTION`, `GUILD_REQUIRED`, `INVALID_INSTANCE`, `DISCORD_UNAVAILABLE`, `INTERNAL`
  - `class AppError extends Error { constructor(code: ErrorCode, message: string, status: number) }`
  - `BotEvent`, объединение Zod по `type`: `member.updated { guildId, userId, username, avatar | null, roleIds, at }`, `member.removed { guildId, userId, at }`, `member.snapshot { guildId, snapshotId, members: Array<{ userId, username, avatar | null, roleIds }>, final: boolean, at }`
  - Схемы: `ActivityAuthRequest { code, instanceId }`, `ActivityAuthResponse { sessionToken, discordAccessToken, expiresIn }`, `MeResponse { user, level, position, status, tokenBalance, permissions }`, `StaffListResponse`, `PermissionsResponse`, `PermissionsUpdate`, `SettingsSchema` со значениями по умолчанию `ticketRate: 10`, `shiftHourRate: 5`, `normBonus: 50`, `weeklyNormHours: 20`, `weeklyNormTickets: 30`, `ticketWaitMinutes: 30`, `inactivityMinutes: 30`, `inactivityReplyMinutes: 10`, `warningDays: 30`, `ticketCategories: []`, `AuditListResponse`

- [ ] **Step 1: Написать падающие тесты:** `BotEvent.safeParse` принимает все 3 типа, отклоняет неизвестный `type` и событие без `guildId`; `SettingsSchema.parse({})` возвращает значения по умолчанию; отрицательная ставка отклоняется; `ActivityAuthRequest` отбрасывает лишнее поле `guildId`.
- [ ] **Step 2: Запустить тесты.** Expected: FAIL.
- [ ] **Step 3: Реализовать схемы.** ID Discord — `^\d{17,20}$`.
- [ ] **Step 4: Запустить тесты.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add shared contracts`

### Task 4: База данных

**Files:**
- Create: `packages/database/package.json`, `packages/database/drizzle.config.ts`, `packages/database/src/{schema,client,seed,testing,index}.ts`, `packages/database/migrations/*`
- Test: `packages/database/src/schema.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_GRANTS`, `SettingsSchema`.
- Produces: `createDb(url: string): Db`, все таблицы раздела 7, `seedDefaults(db, guildId: string): Promise<void>`, `withTestDb(fn: (db: Db) => Promise<void>): Promise<void>` (очищает таблицы до теста; транзакции не используются, потому что тесты гонок требуют отдельных соединений).

Типы: балансы и суммы — `bigint` в режиме `number`, время — `timestamptz`, `staff_daily.day` — `date`. `staff_members.level` ограничен значениями `Level`, `status` — `active` или `inactive`. `audit_log` хранит `actor_user_id`, `action`, `target_user_id`, `reason`, `data` (JSONB).

- [ ] **Step 1: Написать падающие тесты:** `token_balance = -1` нарушает ограничение; вторая запись `token_ledger` с тем же ключом даёт конфликт; вторая открытая смена, голосовая сессия и сессия в сети нарушают partial unique; второй открытый тикет той же категории нарушает partial unique, а после закрытия первого вставка проходит; вторая ведомость на ту же неделю даёт конфликт; `seedDefaults` дважды не создаёт дублей и записывает права по `DEFAULT_GRANTS` и значения `SettingsSchema`.
- [ ] **Step 2: Запустить тесты.** Expected: FAIL.
- [ ] **Step 3: Описать схему, сгенерировать миграцию, реализовать клиент и сид.** Добавить скрипт `db:migrate` в корень. Запрет `UPDATE` и `DELETE` для `audit_log` и `token_ledger` обеспечить триггером в миграции.
- [ ] **Step 4: Запустить миграцию на `TEST_DATABASE_URL` и тесты, включая проверку, что `UPDATE audit_log` отклоняется.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add database schema`

### Task 5: Состав, журнал и очередь событий

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/services/{staff,audit,permissions}.ts`, `apps/api/src/worker/{consumer,main}.ts`, `apps/api/src/main.ts`
- Test: `apps/api/src/services/*.test.ts`, `apps/api/src/worker/consumer.test.ts`

**Interfaces:**
- Consumes: `resolveLevel`, `hasPermission`, `BotEvent`, `ServerConfig`, `Db`.
- Produces:
  - `syncMember(deps: { db, config }, input: { userId: string; username: string; avatar: string | null; roleIds: string[]; at: Date }): Promise<StaffMember | null>`
  - `removeMember(deps, userId, at): Promise<void>`
  - `applySnapshot(deps: { db, redis, config }, event): Promise<void>`
  - `writeAudit(tx, entry: { guildId, actorUserId: string | null, action: string, targetUserId?: string, reason?: string, data?: unknown }): Promise<void>`
  - `getGrants(db, guildId, level): Promise<Permission[]>`
  - `updateGrants(db, actor, level: 'SUPPORT' | 'CURATOR', grants: Permission[]): Promise<void>`
  - `consumeBatch(deps: { db, redis, config, log }, consumer: string): Promise<number>`, stream `events:bot`, group `workers`
  - Запуск `node dist/main.js worker`; роль `api` подключается в задаче 6.

`syncMember` записывает `career_events` и `audit_log` при появлении, смене уровня и деактивации, `actor_user_id` при этом `null`. Для пользователя с `NONE` без записи в составе ничего не создаётся. `applySnapshot` собирает ID в Redis-множество `snapshot:{id}` со сроком 1 час; деактивация отсутствующих выполняется только при `final: true` и непустом множестве.

- [ ] **Step 1: Написать падающие тесты**
  - Новая роль саппорта создаёт активную запись `SUPPORT`; повтор ничего не меняет и не пишет журнал.
  - Куратор без роли саппорта переводится в `inactive`, журнал содержит причину `level_changed`.
  - Возврат роли восстанавливает запись с прежним балансом.
  - `updateGrants` пишет журнал; неизвестное право даёт `VALIDATION_ERROR`; актор ниже `ADMIN` получает `FORBIDDEN`.
  - Снимок из двух частей деактивирует только отсутствующих, и только после части с `final: true`.
  - Review Focus 3: пустой снимок с `final: true` не деактивирует никого и пишет предупреждение в лог.
  - Событие из stream обработано и подтверждено (`XPENDING` равен 0).
  - Review Focus 5: некорректный JSON и событие, не прошедшее схему, попадают в `events:dead`, подтверждаются, следующее событие обрабатывается.
  - Ошибка базы оставляет событие неподтверждённым; повторная обработка не создаёт дублей.
- [ ] **Step 2: Запустить тесты.** Expected: FAIL.
- [ ] **Step 3: Реализовать сервисы, consumer и точку входа с завершением по SIGTERM.** Зависшие сообщения забираются через `XPENDING` и `XCLAIM`.
- [ ] **Step 4: Запустить тесты.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add staff sync, audit log, and event consumer`

### Task 6: HTTP-основа и авторизация

**Files:**
- Create: `apps/api/src/http/{server,errors,auth,rateLimit,health}.ts`, `apps/api/src/discord/client.ts`, `apps/api/src/services/session.ts`, `apps/api/src/testing/fakeDiscord.ts`
- Modify: `apps/api/src/main.ts`
- Test: `apps/api/src/http/*.test.ts`

**Interfaces:**
- Consumes: `Env`, `ServerConfig`, `syncMember`, `AppError`, схемы задачи 3.
- Produces:
  - `buildServer(deps: { env, config, db, redis, discord }): Promise<FastifyInstance>`
  - `createDiscordClient(env): DiscordClient` с `exchangeCode(code)`, `getCurrentUser(token)`, `getActivityInstance(instanceId)`, `getMember(guildId, userId)`
  - `signSession(claims: { userId, discordUserId }, secret): Promise<string>`, `verifySession(token, secret)`
  - Декораторы Fastify: `requireStaff` (добавляет `request.actor: { userId, level, grants }`, читая их из базы на каждый запрос), `requirePermission(permission)`, `requireLevel(level)`, `requireService`

`fakeDiscord` — Fastify-сервер на случайном порту, подставляется через `DISCORD_API_URL`. Логгер Pino с `redact` для `authorization`, `code`, `access_token`, `client_secret`, `sessionToken`, `discordAccessToken`. Лимиты: `@fastify/rate-limit` с Redis и `skipOnError: true`. `trustProxy` равен `TRUST_PROXY_HOPS`. Сервисный токен сравнивается через `timingSafeEqual`.

- [ ] **Step 1: Написать падающие тесты**
  - Успешный вход саппорта возвращает сессию и создаёт запись состава.
  - Экземпляр 404, чужой `guild_id`, пользователя нет в `users`: `403 INVALID_INSTANCE`.
  - Запуск в личных сообщениях: `400 GUILD_REQUIRED`.
  - Пользователь без ролей ветки: `403 NOT_STAFF`.
  - Куратор без роли саппорта: `403 NOT_STAFF`.
  - Истёкший JWT: `401 TOKEN_EXPIRED`. Подделанный: `401 UNAUTHORIZED`.
  - 11-й вход с одного IP за минуту: `429 RATE_LIMITED`.
  - Необработанная ошибка: `500 INTERNAL` с `requestId`, без текста исключения.
  - Перехваченный лог не содержит `code`, токенов и client secret.
  - `/health`: 200 при рабочих сервисах, 503 без базы, 200 с `degraded: true` без Redis.
  - Review Focus 4: `fakeDiscord` отвечает 429 и 502: `503 DISCORD_UNAVAILABLE`.
- [ ] **Step 2: Запустить тесты.** Expected: FAIL.
- [ ] **Step 3: Реализовать сервер, клиент Discord, авторизацию по разделу 6 и роль `api` в `main.ts`**
- [ ] **Step 4: Запустить тесты.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add http foundation and activity auth`

### Task 7: Маршруты ядра

**Files:**
- Create: `apps/api/src/http/routes/{me,staff,permissions,settings,audit,internal}.ts`
- Test: `apps/api/src/http/routes/*.test.ts`

**Interfaces:**
- Consumes: сервисы задачи 5, декораторы задачи 6, схемы задачи 3.
- Produces:
  - `GET /me`
  - `GET /staff?status=&cursor=`, уровни `CURATOR` и `ADMIN`, страница 50 строк
  - `GET /permissions`, `PATCH /permissions`, только `ADMIN`
  - `GET /settings`, `PATCH /settings`, только `ADMIN`
  - `GET /audit?cursor=`, только `ADMIN`
  - `GET /internal/members/:discordUserId`, сервисный токен

- [ ] **Step 1: Написать падающие тесты**
  - Для каждого маршрута: без токена 401, ответ проходит схему Zod.
  - Саппорт на `/staff`, `/permissions`, `/settings`, `/audit`: `403 FORBIDDEN`.
  - Админ включает `tokens.grant` для куратора, `GET /me` куратора показывает право без повторного входа.
  - `PATCH /settings` с отрицательной ставкой: `400 VALIDATION_ERROR`; успешное изменение попадает в журнал.
  - Страницы `/staff` и `/audit` не дают дублей при переходе по курсору.
  - `/internal/*` без сервисного токена: 401.
  - 31-й изменяющий запрос за минуту: 429.
  - Review Focus 1: после `member.updated` без ролей ветки запрос со старым JWT получает `403 NOT_STAFF`.
- [ ] **Step 2: Запустить тесты.** Expected: FAIL.
- [ ] **Step 3: Реализовать маршруты**
- [ ] **Step 4: Запустить тесты.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add core api routes`

### Task 8: Сквозная проверка и документация

**Files:**
- Create: `apps/api/src/e2e/core.test.ts`, `docs/architecture.md`, `docs/api.md`, `docs/database.md`, `docs/security.md`, `docs/testing.md`, `docs/deployment.md`
- Modify: `README.md`, `.env.example`

- [ ] **Step 1: Написать сквозной тест:** запускает API и worker на настоящих базе и Redis; `member.snapshot` создаёт состав; куратор входит через `fakeDiscord`; `GET /staff` показывает состав; админ меняет права; `member.updated` снимает роль, и старая сессия получает `403 NOT_STAFF`; журнал содержит все изменения.
- [ ] **Step 2: Запустить тест, исправить проблемы интеграции.** Expected: PASS.
- [ ] **Step 3: Написать документацию.** Только реализованное: запуск, конфиг, env, маршруты, схема, модель угроз, требования к хостингу.
- [ ] **Step 4: Выполнить полную проверку:** `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm lint && pnpm test`, миграции на чистой базе, `git grep -nE "(BOT_TOKEN|CLIENT_SECRET|JWT_SECRET|SERVICE_TOKEN)=.+" -- ":!.env.example"`. Expected: команды успешны, поиск пуст.
- [ ] **Step 5: Закоммитить:** `test: add core e2e and docs`
