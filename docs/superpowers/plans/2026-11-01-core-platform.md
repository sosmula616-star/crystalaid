# CrystalAid, ядро платформы: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать проверенное тестами ядро: монорепо, базу, правила XP, авторизацию Activity, API и worker. Клиентов и бота в этом подпроекте нет.

**Architecture:** Модульный монолит на pnpm workspaces. `apps/api` запускается в ролях `api` и `worker` с одним сервисным слоем. События поступают через Redis Stream, начисления идемпотентны благодаря уникальным ключам журналов.

**Tech Stack:** TypeScript, Node.js LTS, pnpm, Fastify, Zod, Drizzle, PostgreSQL, Redis (ioredis), jose, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-01-discord-activity-platform-design.md`, разделы 3, 4, 5, 8, 9.

## Global Constraints

- Название продукта: CrystalAid. Scope пакетов: `@crystalaid/*`.
- Все данные прогресса содержат `guild_id`. `guildId` от клиента никогда не используется: только из JWT или из сервисного запроса бота.
- Клиент не передаёт XP, время и суммы.
- Формат ошибки: `{ "error": { "code", "message", "requestId" } }`.
- Сутки считаются по UTC.
- JWT живёт 15 минут. Лимиты: `/auth/activity` — 10/мин на IP, изменяющие запросы — 30/мин на пользователя, чтение — 120/мин на пользователя.
- Секреты только в env, в логах маскируются. `.env` не коммитится.
- Новые зависимости сверх Tech Stack, `@fastify/rate-limit`, `pg`, `drizzle-kit`, `tsx` и линтера добавляются только с обоснованием в сообщении коммита.
- Перед установкой библиотек сверять их актуальный API через документацию.
- Каждый коммит заканчивается строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Prerequisites

Без этого выполнение не начинается: Node.js LTS, pnpm, а также PostgreSQL и Redis (локально через Docker или в облаке). `TEST_DATABASE_URL` и `TEST_REDIS_URL` указывают на отдельные тестовые экземпляры.

## Решения, которые уточняют спецификацию

- **«Заглушил себя»** означает отключённый звук (`selfDeaf` или `serverDeaf`). Отключённый только микрофон не лишает XP: слушатель тоже участвует.
- `member_xp_daily` получает столбец `voice_minutes` для лимита 480 минут.
- `guilds` получает столбец `removed_at` для удаления через 30 дней.
- API получает `DELETE /me` для удаления профиля из раздела 5.2.
- Логика разблокировки достижений и периодические награды относятся к подпроекту 4. Здесь `/achievements` отдаёт каталог и полученные, а награды поддерживают только разовый тип с требованием уровня.

## Review Focus

1. Голосовая сессия пересекает полночь UTC: лимит 480 минут считается отдельно для каждых суток. Тест в задаче 6.
2. Событие приходит от неизвестного сервера или участника: записи создаются, событие не падает. Тест в задаче 6.
3. Повреждённое событие в очереди: оно уходит в `events:dead`, подтверждается, а очередь продолжает работу. Тест в задаче 7.
4. Discord отвечает 429 или 5xx при входе: клиент получает `503 DISCORD_UNAVAILABLE`, а не 500. Тест в задаче 8.
5. Очень большой XP (1e12): уровень вычисляется быстро и правильно, числа не теряют точность. Тест в задаче 2.

---

### Task 1: Каркас монорепо и конфигурация

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `vitest.config.ts`, `.env.example`, `docker-compose.yml`
- Create: `packages/config/src/env.ts`
- Test: `packages/config/src/env.test.ts`

**Interfaces:**
- Produces: `loadEnv(source?: Record<string, string | undefined>): Env`, где `Env` содержит `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_API_URL` (по умолчанию `https://discord.com/api/v10`), `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` (минимум 32 символа), `SERVICE_TOKEN` (минимум 32 символа), `TRUST_PROXY_HOPS` (по умолчанию 1), `PORT` (по умолчанию 3001).

- [ ] **Step 1: Создать ветку `feat/core-platform` от `main`.** Каждый завершённый таск отправляется в `origin`.
- [ ] **Step 2: Создать корневые файлы.** Скрипты: `build`, `typecheck`, `lint`, `test`. `docker-compose.yml` поднимает `postgres` и `redis` с `appendonly yes`. `.gitignore` уже существует и покрывает `.env`, `node_modules`, `dist`, `.superpowers`.
- [ ] **Step 3: Написать падающий тест**

```ts
it('rejects a short JWT secret', () => {
  expect(() => loadEnv({ ...valid, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
});
it('does not include secret values in the error', () => {
  try { loadEnv({ ...valid, SERVICE_TOKEN: undefined }); }
  catch (e) { expect(String(e)).not.toContain(valid.DISCORD_BOT_TOKEN); }
});
it('applies defaults', () => {
  expect(loadEnv(valid).DISCORD_API_URL).toBe('https://discord.com/api/v10');
});
```

- [ ] **Step 4: Запустить `pnpm test packages/config`.** Expected: FAIL, `loadEnv` не определён.
- [ ] **Step 5: Реализовать `loadEnv` на Zod**
- [ ] **Step 6: Запустить `pnpm test`, `pnpm typecheck`, `pnpm lint`.** Expected: PASS.
- [ ] **Step 7: Закоммитить:** `chore: scaffold monorepo and env config`

### Task 2: Правила игры

**Files:**
- Create: `packages/game-rules/src/{levels,daily,voice,keys,settings,index}.ts`
- Test: `packages/game-rules/src/*.test.ts`

**Interfaces:**
- Produces:
  - `xpToNext(level: number): number`
  - `levelForXp(totalXp: number): { level: number; xpIntoLevel: number; xpForNext: number }`
  - `levelUpCoins(level: number): number`
  - `dailyReward(streak: number): { xp: number; coins: number }`
  - `nextStreak(current: number, lastDaily: string | null, today: string): { streak: number; alreadyClaimed: boolean }`, даты в формате `YYYY-MM-DD`
  - `isVoiceMinuteEligible(input: { humansInChannel: number; isAfk: boolean; isExcluded: boolean; selfDeaf: boolean; serverDeaf: boolean; minutesToday: number }, settings: GuildRules): boolean`
  - `GuildRules` и `DEFAULT_RULES = { voiceXpPerMinute: 4, voiceDailyMinuteCap: 480, messageXp: 10, afkChannelId: null, excludedChannelIds: [], announceChannelId: null }`
  - `keys.voice(guild, user, at: Date)`, `keys.message(guild, user, at)`, `keys.daily(guild, user, at)`, `keys.reward(guild, user, rewardKey, period)`, `keys.buy(guild, user, itemKey)`

- [ ] **Step 1: Написать падающие тесты**

```ts
expect(xpToNext(0)).toBe(100);
expect(xpToNext(24)).toBe(4180);
expect(levelForXp(0)).toEqual({ level: 0, xpIntoLevel: 0, xpForNext: 100 });
expect(levelForXp(99).level).toBe(0);
expect(levelForXp(100)).toEqual({ level: 1, xpIntoLevel: 0, xpForNext: 155 });
expect(levelUpCoins(24)).toBe(290);
expect(dailyReward(1)).toEqual({ xp: 55, coins: 110 });
expect(dailyReward(30)).toEqual(dailyReward(99));
expect(dailyReward(30)).toEqual({ xp: 200, coins: 400 });
expect(nextStreak(5, '2026-11-01', '2026-11-02')).toEqual({ streak: 6, alreadyClaimed: false });
expect(nextStreak(5, '2026-11-01', '2026-11-03')).toEqual({ streak: 1, alreadyClaimed: false });
expect(nextStreak(5, '2026-11-02', '2026-11-02')).toEqual({ streak: 5, alreadyClaimed: true });
expect(nextStreak(0, null, '2026-11-02').streak).toBe(1);
expect(keys.voice('g', 'u', new Date('2026-11-01T23:59:30Z'))).toBe('voice:g:u:202611012359');
expect(keys.daily('g', 'u', new Date('2026-11-01T00:00:01Z'))).toBe('daily:g:u:20261101');
```

Плюс таблица для `isVoiceMinuteEligible`: одиночка, AFK, исключённый канал, `selfDeaf`, `serverDeaf`, лимит 480. Отключённый микрофон во входные данные не входит и на результат не влияет. Плюс Review Focus 5: `levelForXp(1e12)` выполняется менее чем за 50 мс, а сумма `xpToNext` до найденного уровня не превышает `1e12`.

- [ ] **Step 2: Запустить `pnpm test packages/game-rules`.** Expected: FAIL.
- [ ] **Step 3: Реализовать чистые функции без зависимостей**
- [ ] **Step 4: Запустить тесты.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add game rules`

### Task 3: Контракты

**Files:**
- Create: `packages/contracts/src/{errors,events,api,index}.ts`
- Test: `packages/contracts/src/events.test.ts`

**Interfaces:**
- Produces:
  - `ErrorCode`: `UNAUTHORIZED`, `TOKEN_EXPIRED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `RATE_LIMITED`, `COOLDOWN_ACTIVE`, `INSUFFICIENT_COINS`, `ALREADY_OWNED`, `REQUIREMENT_NOT_MET`, `GUILD_REQUIRED`, `BOT_NOT_INSTALLED`, `INVALID_INSTANCE`, `DISCORD_UNAVAILABLE`, `INTERNAL`
  - `class AppError extends Error { constructor(code: ErrorCode, message: string, status: number) }`
  - `BotEvent` — дискриминированное объединение Zod по `type`: `message.created { guildId, userId, channelId, at, isBot }`, `voice.state { guildId, userId, channelId | null, selfDeaf, serverDeaf, at }`, `voice.snapshot { guildId, channels: [{ channelId, users: [{ userId, isBot, selfDeaf, serverDeaf }] }], at }`, `guild.joined { guildId, name, icon | null, at }`, `guild.removed { guildId, at }`. Здесь `guildId`, `userId`, `channelId` — идентификаторы Discord.
  - Схемы запросов и ответов: `ActivityAuthRequest { code, instanceId }`, `ActivityAuthResponse { sessionToken, discordAccessToken, expiresIn }`, `MeResponse`, `LeaderboardResponse`, `DailyResponse`, `RewardsResponse`, `AchievementsResponse`, `ShopResponse`, `PurchaseResponse`, `GuildSettings`

- [ ] **Step 1: Написать падающий тест:** `BotEvent.safeParse` принимает все 5 типов, отклоняет неизвестный `type` и событие без `guildId`. `message.created` с лишним полем `content` разбирается без этого поля.
- [ ] **Step 2: Запустить тест.** Expected: FAIL.
- [ ] **Step 3: Реализовать схемы.** Идентификаторы Discord — строки по `^\d{17,20}$`.
- [ ] **Step 4: Запустить тест.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add shared contracts`

### Task 4: База данных

**Files:**
- Create: `packages/database/src/{schema,client,index}.ts`, `packages/database/drizzle.config.ts`, `packages/database/migrations/*`
- Create: `packages/database/src/seed.ts`, `packages/database/src/testing.ts`
- Test: `packages/database/src/schema.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_RULES`.
- Produces: `createDb(url): Db`, таблицы всех строк раздела 5.2, `seedCatalog(db): Promise<void>`, `withTestDb(fn)` для интеграционных тестов (транзакции не используются: тесты гонок требуют настоящих соединений, поэтому схема очищается между тестами).

Типы: `xp`, суммы и монеты — `bigint` в режиме `number`. Временные метки — `timestamptz`. `member_xp_daily` содержит `voice_minutes`, `guilds` содержит `removed_at`, `guild_members` содержит `CHECK (coins >= 0)`.

- [ ] **Step 1: Написать падающие тесты:** вторая вставка с тем же `idempotency_key` в `xp_ledger` даёт конфликт; `coins = -1` нарушает ограничение; вторая открытая сессия в `voice_sessions` для той же пары нарушает partial unique; после `seedCatalog` есть шесть тем с ценами 0, 1500, 1500, 2500, 2500, 5000 и награды `level-5`, `level-10`, `level-25`; повторный `seedCatalog` не создаёт дублей.
- [ ] **Step 2: Запустить тесты.** Expected: FAIL.
- [ ] **Step 3: Описать схему, сгенерировать миграцию, реализовать клиент и сид**
- [ ] **Step 4: Запустить тесты и применить миграцию на пустой базе.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add database schema and seed`

### Task 5: Сервис прогресса и экономика

**Files:**
- Create: `apps/api/src/services/{progress,daily,rewards,shop,members}.ts`
- Test: `apps/api/src/services/*.test.ts`

**Interfaces:**
- Consumes: `levelForXp`, `levelUpCoins`, `dailyReward`, `nextStreak`, `keys`, `AppError`, `Db`.
- Produces:
  - `ensureMember(db, ref: { discordGuildId, discordUserId, username?, avatar? }): Promise<{ guildId; userId }>`
  - `grantXp(db, input: { guildId, userId, amount, source: 'voice' | 'message' | 'daily' | 'challenge' | 'reward', idempotencyKey, at, voiceMinutes?: number }): Promise<{ applied: boolean; xp: number; level: number; leveledUp: boolean }>`
  - `grantCoins(tx, input: { guildId, userId, amount, reason, idempotencyKey }): Promise<boolean>`
  - `claimDaily(db, member, now): Promise<DailyResponse>`
  - `claimReward(db, member, rewardKey): Promise<void>`
  - `purchaseItem(db, member, itemKey): Promise<PurchaseResponse>`
  - `deleteUserProfile(db, userId): Promise<void>`

`grantXp`: одна транзакция по разделу 5.2. Бонус за каждый новый уровень начисляется в `coin_ledger` с ключом `level:{guild}:{user}:{level}`, в том числе если одним начислением взято несколько уровней.

- [ ] **Step 1: Написать падающие тесты**
  - `grantXp` с тем же ключом дважды: второй `applied: false`, XP не изменился.
  - 100 XP с уровня 0: уровень 1, монет +60.
  - Начисление через два уровня выдаёт монеты за оба.
  - 20 параллельных `grantXp` с разными ключами: итоговый XP равен сумме.
  - `member_xp_daily` суммирует XP и `voice_minutes` по дню события.
  - Параллельные `claimDaily` ×10: одно начисление, остальные `COOLDOWN_ACTIVE`.
  - Параллельные `purchaseItem` при балансе на одну покупку: одно списание, инвентарь без дублей, ни одного отрицательного баланса. Повторная покупка: `ALREADY_OWNED`. Нехватка монет: `INSUFFICIENT_COINS`.
  - `claimReward`: при низком уровне `REQUIREMENT_NOT_MET`, повтор не даёт второго начисления.
  - XP сервера A не меняет запись сервера B.
  - `deleteUserProfile` обезличивает журналы (`user_id` заменяется на служебную запись `deleted`) и удаляет участие.
- [ ] **Step 2: Запустить тесты.** Expected: FAIL.
- [ ] **Step 3: Реализовать сервисы.** Строка участника блокируется через `FOR UPDATE`.
- [ ] **Step 4: Запустить тесты.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add progress and economy services`

### Task 6: Обработка событий и голосовые сессии

**Files:**
- Create: `apps/api/src/worker/{handleEvent,voiceTick,reconcile}.ts`, `apps/api/src/services/guilds.ts`
- Test: `apps/api/src/worker/*.test.ts`

**Interfaces:**
- Consumes: `BotEvent`, `grantXp`, `ensureMember`, `isVoiceMinuteEligible`, `keys`.
- Produces:
  - `handleEvent(deps: { db, redis, log }, event: BotEvent): Promise<void>`
  - `voiceTick(deps, now: Date): Promise<{ credited: number }>`
  - `reconcileSnapshot(deps, event): Promise<void>`
  - `getGuildRules(db, guildId): Promise<GuildRules>`

Правила: `voice_sessions` хранит текущие `channel_id`, `self_deaf`, `server_deaf`, `is_bot`. `voice.state` обновляет запись, закрывает сессию при `channelId: null` и пишет строку в `activities`. Бот поддерживает в Redis ключ `bot:alive` со сроком 90 секунд; без этого ключа `voiceTick` ничего не начисляет, поэтому минуты простоя бота не считаются подтверждёнными. `voiceTick` группирует открытые сессии по каналу и считает людей без ботов. Снимок приводит сессии сервера к фактическому состоянию и закрывает отсутствующие.

- [ ] **Step 1: Написать падающие тесты**
  - Сообщение даёт 10 XP; второе в ту же минуту не даёт; следующее в другую минуту даёт; сообщение бота и сообщение в исключённом канале не дают.
  - Двое людей в канале дают по 4 XP за тик; один человек и бот не дают.
  - Без ключа `bot:alive` тик не начисляет XP и не закрывает сессии.
  - Повторный `voiceTick` за ту же минуту и два параллельных тика не дают двойного начисления.
  - Тик продолжает сессию после перехода между каналами.
  - Снимок закрывает отсутствующую сессию и не начисляет за неё; следующий тик начисляет оставшимся.
  - `guild.removed` ставит `removed_at`, повторный `guild.joined` очищает его.
  - Review Focus 1: лимит 480 минут исчерпан 1 ноября в 23:59, в 00:00 2 ноября начисление снова идёт.
  - Review Focus 2: событие от незнакомых сервера и пользователя создаёт записи и начисляет XP.
- [ ] **Step 2: Запустить тесты.** Expected: FAIL.
- [ ] **Step 3: Реализовать обработчики**
- [ ] **Step 4: Запустить тесты.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add event handling and voice sessions`

### Task 7: Роль worker

**Files:**
- Create: `apps/api/src/worker/{consumer,jobs,main}.ts`, `apps/api/src/main.ts`
- Test: `apps/api/src/worker/consumer.test.ts`, `apps/api/src/worker/jobs.test.ts`

**Interfaces:**
- Consumes: `handleEvent`, `voiceTick`, `BotEvent`.
- Produces:
  - `consumeBatch(deps: { redis, db, log }, consumer: string): Promise<number>`, stream `events:bot`, group `workers`
  - `detectFlags(deps, now): Promise<number>`
  - `purgeRemovedGuilds(deps, now): Promise<number>`
  - Запуск: `node dist/main.js api` или `node dist/main.js worker`

Планировщик: `voiceTick` раз в минуту, `detectFlags` и `purgeRemovedGuilds` раз в сутки. Перед запуском работы берётся блокировка Redis `SET NX EX`, поэтому несколько worker не запускают её одновременно. Идемпотентность остаётся основной защитой.

- [ ] **Step 1: Написать падающие тесты**
  - Событие из stream обработано и подтверждено (`XPENDING` равен 0).
  - Review Focus 3: некорректный JSON и событие, не прошедшее схему, попадают в `events:dead` и подтверждаются, а следующее событие обрабатывается.
  - Ошибка базы оставляет событие неподтверждённым; повторная обработка успешна и не начисляет дважды.
  - `detectFlags` создаёт один флаг за лимит 7 суток подряд и не дублирует его при повторе; создаёт флаг для пары, набравшей голосовое время только друг с другом.
  - `purgeRemovedGuilds` удаляет сервер с `removed_at` старше 30 дней и не трогает более новый.
- [ ] **Step 2: Запустить тесты.** Expected: FAIL.
- [ ] **Step 3: Реализовать consumer, задачи и точку входа с корректным завершением по SIGTERM**
- [ ] **Step 4: Запустить тесты.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add worker role`

### Task 8: HTTP-основа и авторизация

**Files:**
- Create: `apps/api/src/http/{server,errors,auth,rateLimit,health}.ts`, `apps/api/src/discord/client.ts`, `apps/api/src/services/{session,roles}.ts`
- Create: `apps/api/src/testing/fakeDiscord.ts`
- Test: `apps/api/src/http/*.test.ts`, `apps/api/src/services/roles.test.ts`

**Interfaces:**
- Consumes: `Env`, `AppError`, `ensureMember`, `ActivityAuthRequest`.
- Produces:
  - `buildServer(deps: { env, db, redis, discord }): Promise<FastifyInstance>`
  - `createDiscordClient(env): DiscordClient` с `exchangeCode(code)`, `getCurrentUser(token)`, `getActivityInstance(instanceId)`, `getMember(guildId, userId)`, `getGuild(guildId)`
  - `signSession(claims: { userId, guildId, discordUserId, discordGuildId }, secret): Promise<string>`, `verifySession(token, secret): Promise<claims>`
  - `resolveRole(input: { isOwner: boolean; permissions: bigint }): 'USER' | 'MODERATOR' | 'ADMIN' | 'OWNER'`
  - Fastify-декораторы `requireMember`, `requireRole(role)`, `requireService`

`fakeDiscord` — Fastify-сервер на случайном порту, который подставляется через `DISCORD_API_URL`. Логгер: Pino, `redact` для `authorization`, `code`, `access_token`, `client_secret`, `sessionToken`, `discordAccessToken`. Лимиты: `@fastify/rate-limit` с хранилищем Redis и `skipOnError: true`. `trustProxy` равен `TRUST_PROXY_HOPS`. Сервисный токен сравнивается через `timingSafeEqual`.

- [ ] **Step 1: Написать падающие тесты**
  - Успешный вход возвращает сессию, создаёт записи, а JWT содержит `guildId` из экземпляра.
  - Экземпляр 404: `403 INVALID_INSTANCE`. Пользователя нет в `users`: `403 INVALID_INSTANCE`.
  - `location.kind: "pc"`: `400 GUILD_REQUIRED`.
  - Бота нет на сервере (`getGuild` 404): `403 BOT_NOT_INSTALLED`.
  - `guildId` в теле запроса игнорируется схемой.
  - Истёкший JWT: `401 TOKEN_EXPIRED`. Подделанный: `401 UNAUTHORIZED`.
  - 11-й вход с одного IP за минуту: `429 RATE_LIMITED`.
  - Необработанная ошибка: `500 INTERNAL` с `requestId`, без текста исключения.
  - Перехваченный вывод логов не содержит значений `code`, токенов и client secret.
  - `/health` возвращает 200 и 503 при недоступной базе; при недоступном Redis — 200 с `degraded: true`.
  - Таблица `resolveRole`: владелец, Administrator, Manage Guild, Moderate Members, без прав.
  - Review Focus 4: `fakeDiscord` отвечает 429 и 502: `503 DISCORD_UNAVAILABLE`.
- [ ] **Step 2: Запустить тесты.** Expected: FAIL.
- [ ] **Step 3: Реализовать сервер, клиент Discord и авторизацию по разделу 5.1**
- [ ] **Step 4: Запустить тесты.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add http foundation and activity auth`

### Task 9: Маршруты API

**Files:**
- Create: `apps/api/src/http/routes/{me,leaderboard,daily,rewards,achievements,shop,guildSettings,internal}.ts`, `apps/api/src/services/leaderboard.ts`
- Test: `apps/api/src/http/routes/*.test.ts`

**Interfaces:**
- Consumes: сервисы задачи 5, `requireMember`, `requireRole`, `requireService`, `getGuildRules`, схемы задачи 3.
- Produces:
  - Маршруты участника из таблицы раздела 5.3 и `DELETE /me`
  - `POST /internal/daily`, `GET /internal/profile`, `GET /internal/leaderboard`, принимающие `discordGuildId` и `discordUserId` от бота
  - `getLeaderboard(db, guildId, period, cursor?): Promise<LeaderboardResponse>`, страница по 50 строк

Порядок рейтинга: XP по убыванию, затем `user_id`. Периоды `daily`, `weekly`, `monthly` суммируют `member_xp_daily` за текущие сутки, неделю с понедельника и календарный месяц UTC, `all` читает `guild_members`. Курсор непрозрачный и кодирует `(xp, user_id)`. `PATCH /guild/settings` принимает: `voiceXpPerMinute` 1–20, `messageXp` 1–50, `voiceDailyMinuteCap` 60–1440, каналы как идентификаторы Discord.

- [ ] **Step 1: Написать падающие тесты**
  - Для каждого маршрута: без токена 401, ответ проходит свою схему Zod.
  - `/leaderboard` возвращает только данные сервера из JWT; пустой сервер даёт пустой список; все строки страницы и переход по курсору не дают дублей при равном XP.
  - `/guild/settings`: участник получает 403, `ADMIN` меняет настройки, значение вне лимита даёт `400 VALIDATION_ERROR`, следующий тик использует новые значения.
  - `/internal/*`: без сервисного токена 401, с токеном работает; `POST /internal/daily` и `POST /daily` используют одну серию.
  - 31-й изменяющий запрос пользователя за минуту: 429.
  - `DELETE /me` удаляет профиль, последующий запрос со старым JWT даёт 401.
- [ ] **Step 2: Запустить тесты.** Expected: FAIL.
- [ ] **Step 3: Реализовать маршруты и индексы запросов рейтинга**
- [ ] **Step 4: Запустить тесты.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add api routes`

### Task 10: Сквозная проверка и документация

**Files:**
- Create: `apps/api/src/e2e/core.test.ts`
- Create: `README.md`, `docs/architecture.md`, `docs/api.md`, `docs/database.md`, `docs/security.md`, `docs/testing.md`, `docs/deployment.md`

**Interfaces:**
- Consumes: всё выше.

- [ ] **Step 1: Написать падающий сквозной тест:** запускает API и worker на настоящих базе и Redis; вход через `fakeDiscord`; в stream уходят сообщения и голосовые события; после тиков `/me` показывает уровень 1, участник есть в `/leaderboard?period=daily`, `/daily` и покупка темы работают, повтор покупки не списывает монеты.
- [ ] **Step 2: Запустить тест, исправить найденные проблемы интеграции.** Expected: PASS.
- [ ] **Step 3: Написать документацию.** Только то, что реализовано: запуск, env, маршруты, схема, модель угроз.
- [ ] **Step 4: Пройти раздел 9 спецификации.** Запустить `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm lint && pnpm test`, применить миграции на чистой базе, найти секреты через `git grep -nE "(BOT_TOKEN|CLIENT_SECRET|JWT_SECRET|SERVICE_TOKEN)=.+" -- ":!.env.example"`. Expected: все команды успешны, поиск пуст.
- [ ] **Step 5: Закоммитить:** `test: add core e2e and docs`
