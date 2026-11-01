# CrystalAid, дизайн-система и каркас Activity: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать библиотеку компонентов CrystalAid и рабочий каркас Activity со входом, навигацией по ролям и адаптивной раскладкой.

**Architecture:** `packages/design-system` содержит токены, темы и компоненты. `packages/i18n` содержит словари. `apps/activity` использует их, обращается только к API ядра и не содержит бизнес-логики.

**Tech Stack:** React, Vite, TypeScript, CSS Modules, Radix Primitives, Discord Embedded App SDK, lucide-react, Vitest, Testing Library, axe-core, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-01-crystalaid-design-system-design.md`, основная спецификация `docs/superpowers/specs/2026-11-01-crystalaid-staff-design.md`, разделы 5 и 9.

## Global Constraints

- Репозиторий `D:\Lounge`, ветка `feat/design-system`. Scope пакетов `@crystalaid/*`.
- Цвета, отступы, радиусы, шрифты и длительности берутся только из токенов.
- Шкала отступов: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80. Радиусы: 4, 6, 8, 10, 12, 16, 20.
- Статусы: success `#5BD6A0`, warning `#F5C451`, danger `#F47174`.
- Минимальная область касания 40 px. Hover никогда не единственный способ получить функцию.
- Внешних адресов в сборке нет: шрифт и иконки входят в приложение.
- Никаких `height: 100vh`: использовать `dvh`. Никакого текста без ключа i18n в `apps/activity`.
- Сессия хранится только в памяти. Доступ проверяет backend, клиент лишь скрывает недоступное.
- Подставной режим и `/kit` не попадают в продакшен-сборку.
- Сверять актуальный API библиотек с документацией перед использованием.
- Новые зависимости — только из раздела 2 спецификации, иначе с обоснованием в сообщении коммита.

## Review Focus

1. Хранилище браузера недоступно внутри Activity: выбор темы и языка не ломает запуск. Тест в задаче 1.
2. Несколько запросов одновременно получают `401 TOKEN_EXPIRED`: выполняется один повторный вход, а все запросы завершаются. Тест в задаче 5.
3. Имя в 40 символов и большие числа не ломают панель и таблицы. Тесты в задачах 4 и 8.
4. Раздел падает при загрузке или рендере: панель и навигация остаются рабочими. Тест в задаче 6.
5. Окно Activity меняет размер на ходу, в том числе при переходе в окно поверх чата: раскладка перестраивается без перезагрузки и потери раздела. Тест в задаче 8.

---

### Task 1: i18n, токены и темы

**Files:**
- Create: `packages/i18n/{package.json,src/index.ts,src/ru.ts,src/en.ts}`, `packages/design-system/{package.json,src/tokens.css,src/themes.css,src/themes.ts,src/storage.ts,src/index.ts}`
- Modify: `eslint.config.js`
- Test: `packages/i18n/src/index.test.ts`, `packages/design-system/src/themes.test.ts`, `packages/design-system/src/storage.test.ts`

**Interfaces:**
- Produces:
  - `createTranslator(locale: 'ru' | 'en'): (key: MessageKey, params?: Record<string, string | number>) => string`, `resolveLocale(discordLocale?: string): 'ru' | 'en'`
  - `THEMES`: массив `{ id, nameKey, free, tokens }` для `crystal`, `indigo`, `amber`, `emerald`, `graphite`, `raspberry`
  - `applyTheme(id: string): ThemeId` — ставит `data-theme`, неизвестное значение заменяет на `crystal`
  - `readStored(key): string | null`, `writeStored(key, value): void` — не бросают ошибок

- [ ] **Step 1: Написать падающие тесты**

```ts
expect(createTranslator('ru')('nav.overview')).toBe('Обзор');
expect(createTranslator('en')('nav.overview')).toBe('Overview');
expect(resolveLocale('ru')).toBe('ru');
expect(resolveLocale('de')).toBe('en');
expect(THEMES.map((t) => t.id)).toEqual(['crystal','indigo','amber','emerald','graphite','raspberry']);
expect(THEMES.filter((t) => t.free).map((t) => t.id)).toEqual(['crystal']);
expect(applyTheme('nope')).toBe('crystal');
```

Для каждой темы тест считает контраст WCAG и требует не ниже 4,5:1 для `foreground`, `muted`, `primary`, `success`, `warning`, `danger` на `background`, `surface`, `surface-elevated`, и для `on-primary` на `primary`. Review Focus 1: при `localStorage`, бросающем ошибку, `readStored` возвращает `null`, а `writeStored` ничего не бросает.

- [ ] **Step 2: Запустить `pnpm test packages/i18n packages/design-system`.** Expected: FAIL.
- [ ] **Step 3: Реализовать.** Значения тем — из раздела 9 основной спецификации, `surface-hover` — на один шаг светлее `surface-elevated`. Добавить lint-правило или скрипт, запрещающий шестнадцатеричные цвета в `*.module.css`. Несовпадение ключей `ru` и `en` должно быть ошибкой типов.
- [ ] **Step 4: Запустить тесты, typecheck, lint.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add i18n, tokens, and themes`

### Task 2: Базовые компоненты

**Files:**
- Create: `packages/design-system/src/components/{Button,IconButton,Avatar,Badge,Card,StatCard,ProgressBar,Skeleton,EmptyState,ErrorState}/*`, `packages/design-system/src/testing.ts`
- Test: `*.test.tsx` рядом с компонентами

**Interfaces:**
- Produces:
  - `Button` props `variant: 'primary' | 'secondary' | 'ghost' | 'danger'`, `size: 'sm' | 'md'`, `loading`, стандартные атрибуты кнопки
  - `IconButton` с обязательным `label`
  - `Avatar` props `src`, `name`, показывает инициалы при отсутствии или ошибке картинки
  - `Badge` props `tone: 'neutral' | 'primary' | 'success' | 'warning' | 'danger'`
  - `Card`, `StatCard` props `label`, `value`, `hint`
  - `ProgressBar` props `value`, `max`, `label`
  - `Skeleton`, `EmptyState` props `title`, `description`, `action`, `ErrorState` props `title`, `description`, `onRetry`, `retryLabel`
  - `expectNoA11yViolations(container): Promise<void>` в `testing.ts`

- [ ] **Step 1: Написать падающие тесты:** `Button` с `loading` блокирует клик и сообщает `aria-busy`; `Button` disabled не вызывает обработчик; `IconButton` доступен по имени `label`; `Avatar` без `src` показывает инициалы, при ошибке картинки тоже; `ProgressBar` отдаёт `role="progressbar"` с `aria-valuenow` и ограничивает значения выше `max`; `ErrorState` вызывает `onRetry`; `expectNoA11yViolations` проходит для каждого компонента.
- [ ] **Step 2: Запустить тесты.** Expected: FAIL.
- [ ] **Step 3: Реализовать на CSS Modules и токенах.** Фокус виден через `:focus-visible`. Длинный текст обрезается или переносится и не расширяет родителя.
- [ ] **Step 4: Запустить тесты.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add base components`

### Task 3: Формы и окна на Radix

**Files:**
- Create: `packages/design-system/src/components/{Input,Select,Checkbox,Toggle,Tabs,Tooltip,Dropdown,Modal,Drawer,Toast}/*`
- Test: `*.test.tsx` рядом с компонентами

**Interfaces:**
- Produces:
  - `Input` props `label`, `error`, `hint`, связывает их через `aria-describedby`
  - `Select` props `label`, `value`, `onChange`, `options: { value, label }[]`
  - `Checkbox`, `Toggle` props `label`, `checked`, `onChange`, `disabled`
  - `Tabs` props `items: { id, label, content }[]`, `value`, `onChange`
  - `Tooltip` props `content`, `children`
  - `Dropdown` props `trigger`, `items: { id, label, onSelect, disabled? }[]`
  - `Modal`, `Drawer` props `open`, `onOpenChange`, `title`, `description`, `children`
  - `ToastProvider`, `useToast(): { show(input: { title, description?, tone? }): void }`

- [ ] **Step 1: Написать падающие тесты:** `Input` с `error` даёт `aria-invalid` и связанный текст; Modal и Drawer держат фокус внутри, закрываются по Escape и возвращают фокус на кнопку открытия; Dropdown работает со стрелками и Enter; Tabs переключаются стрелками; Select выбирается с клавиатуры; `useToast` показывает сообщение с ролью status; axe для открытого Modal, Drawer и Dropdown.
- [ ] **Step 2: Запустить тесты.** Expected: FAIL.
- [ ] **Step 3: Установить только нужные пакеты Radix и реализовать.** Drawer на узком контейнере занимает ширину экрана, учитывая `safe-area-inset`.
- [ ] **Step 4: Запустить тесты.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add form and overlay components`

### Task 4: Таблица

**Files:**
- Create: `packages/design-system/src/components/Table/*`
- Test: `packages/design-system/src/components/Table/Table.test.tsx`

**Interfaces:**
- Produces: `Table<T>` props `columns: { id, header, render(row), priority: 'primary' | 'secondary' }[]`, `rows`, `rowKey(row)`, `empty`, `caption`.

Широкий контейнер показывает настоящую `<table>`. Контейнер уже 720 px через container query показывает строки карточками: первичные колонки видны, вторичные — под кнопкой раскрытия. Разметка одна, скрытие только через CSS не должно оставлять дублирующий текст для скринридера.

- [ ] **Step 1: Написать падающие тесты:** заголовки и подпись доступны; пустой список показывает `empty`; раскрытие строки открывает вторичные колонки и сообщает `aria-expanded`; Review Focus 3: значение из 40 символов и число 1000000000 не меняют ширину контейнера (проверяется классами переноса и в браузере в задаче 8).
- [ ] **Step 2: Запустить тесты.** Expected: FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить тесты.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add responsive table`

### Task 5: Основа Activity, клиент API и вход

**Files:**
- Create: `apps/activity/{package.json,index.html,vite.config.ts,tsconfig.json}`, `apps/activity/src/{main.tsx,App.tsx}`, `apps/activity/src/api/client.ts`, `apps/activity/src/auth/{session.ts,discord.ts,AuthGate.tsx}`
- Test: `apps/activity/src/api/client.test.ts`, `apps/activity/src/auth/session.test.ts`, `apps/activity/src/auth/AuthGate.test.tsx`

**Interfaces:**
- Consumes: схемы `@crystalaid/contracts`, компоненты, `createTranslator`.
- Produces:
  - `createApiClient(deps: { getToken(): string | null; refresh(): Promise<void>; fetch?: typeof fetch; baseUrl?: string }): ApiClient` с `get<T>(path, schema)`, `post<T>(path, body, schema)`, `patch<T>(path, body, schema)`
  - `class ApiError extends Error { code: string; status: number; requestId?: string }`
  - `createSession(deps: { sdk: DiscordPort; login(code, instanceId): Promise<ActivityAuthResponse> })`: `start()`, `refresh()`, `token()`
  - `DiscordPort`: `ready()`, `authorize()`, `authenticate(token)`, `instanceId`, `locale`, `onLayoutMode(cb)`
  - `AuthGate` — экран входа и экраны раздела 4.2 спецификации, передаёт `MeResponse` дочерним компонентам

- [ ] **Step 1: Написать падающие тесты**
  - Ошибка API превращается в `ApiError` с `code`, ответ не по схеме — в `ApiError` с кодом `INTERNAL`.
  - Запрос с `401 TOKEN_EXPIRED` повторяется один раз после `refresh`; второй отказ выбрасывает ошибку.
  - Review Focus 2: 5 параллельных запросов с `401 TOKEN_EXPIRED` вызывают `refresh` один раз и все завершаются успешно.
  - `session.start()` вызывает `ready`, `authorize`, `login`, `authenticate` в этом порядке; токен не пишется в хранилище.
  - `AuthGate` показывает свой экран для `NOT_STAFF` с текстом сервера, `GUILD_REQUIRED`, `INVALID_INSTANCE`, `DISCORD_UNAVAILABLE`, а «Повторить» запускает вход заново.
- [ ] **Step 2: Запустить тесты.** Expected: FAIL.
- [ ] **Step 3: Реализовать.** Базовый путь `/api`, в Vite proxy на API ядра. Шрифт Inter подключается из пакета.
- [ ] **Step 4: Запустить тесты и `pnpm --dir apps/activity run build`.** Expected: PASS, сборка создана.
- [ ] **Step 5: Закоммитить:** `feat: add activity foundation and sign-in`

### Task 6: Каркас и навигация

**Files:**
- Create: `apps/activity/src/shell/{sections.ts,Shell.tsx,TopBar.tsx,SideNav.tsx,BottomNav.tsx,MoreDrawer.tsx,SectionBoundary.tsx,useLayoutMode.ts}`, `apps/activity/src/sections/Placeholder.tsx`
- Test: `apps/activity/src/shell/*.test.ts(x)`

**Interfaces:**
- Consumes: `MeResponse`, `DiscordPort.onLayoutMode`, компоненты.
- Produces:
  - `SECTIONS`: `{ id, labelKey, icon, minLevel, permission?, load(): Promise<{ default: ComponentType }> }[]`
  - `visibleSections(level: Level, permissions: Permission[]): Section[]`
  - `useLayoutMode(discordMode): 'compact' | 'narrow' | 'medium' | 'wide' | 'ultrawide'`
  - `Shell` props `me`, `onRetryAuth`

- [ ] **Step 1: Написать падающие тесты:** `visibleSections('SUPPORT', [])` возвращает 6 разделов; `CURATOR` добавляет Состав, Смены состава, Все тикеты, Отчёты; `ADMIN` добавляет ещё 5; `NONE` — пустой список; `useLayoutMode` возвращает `compact` для режима поверх чата при любой ширине и границы 320, 720, 1280, 1920; нижняя панель показывает 4 раздела и «Ещё», остальное в Drawer; активный раздел отмечен `aria-current="page"`; Review Focus 4: раздел с ошибкой рендера и с ошибкой `load` показывает ErrorState, навигация работает, повтор загружает снова.
- [ ] **Step 2: Запустить тесты.** Expected: FAIL.
- [ ] **Step 3: Реализовать.** Переключение раздела хранится в состоянии `Shell`. Раскладка через container queries, `useLayoutMode` определяет только какие элементы рендерить.
- [ ] **Step 4: Запустить тесты.** Expected: PASS.
- [ ] **Step 5: Закоммитить:** `feat: add activity shell and navigation`

### Task 7: Обзор, Настройки, подставной режим и витрина

**Files:**
- Create: `apps/activity/src/sections/{Overview.tsx,Settings.tsx}`, `apps/activity/src/dev/{mock.ts,Kit.tsx}`
- Modify: `apps/activity/src/main.tsx`, `apps/activity/src/shell/sections.ts`
- Test: `apps/activity/src/sections/*.test.tsx`

**Interfaces:**
- Consumes: `MeResponse`, `readStored`, `writeStored`, `applyTheme`, `resolveLocale`.
- Produces: `VITE_DEV_MOCK=1` запускает подставной `DiscordPort` и API. Параметры адреса `?level=SUPPORT|CURATOR|ADMIN`, `?name=long` и `?error=NOT_STAFF` управляют сценарием. `/kit` показывает все компоненты, состояния и темы.

- [ ] **Step 1: Написать падающие тесты:** Обзор показывает имя, уровень, баланс из `/me` и подсказку, что смены появятся позже, без выдуманных чисел; Настройки меняют язык, выбор сохраняется и применяется; скелетон показывается до готовности; темы кроме Кристалла отмечены как недоступные.
- [ ] **Step 2: Запустить тесты.** Expected: FAIL.
- [ ] **Step 3: Реализовать.** Подключать `dev/*` только через `if (import.meta.env.DEV) await import(...)`.
- [ ] **Step 4: Запустить тесты, `VITE_DEV_MOCK=1 pnpm --dir apps/activity run dev` и открыть `/` и `/kit`.** Expected: страницы открываются без ошибок консоли.
- [ ] **Step 5: Закоммитить:** `feat: add overview, settings, and dev kit`

### Task 8: Адаптивная проверка и документация

**Files:**
- Create: `apps/activity/playwright.config.ts`, `apps/activity/e2e/{responsive,accessibility,bundle}.spec.ts`, `docs/ui.md`, `docs/responsive.md`, `docs/ux.md`
- Modify: `README.md`, `docs/deployment.md`, `docs/testing.md`

- [ ] **Step 1: Написать браузерные тесты**
  - На 15 размерах из раздела 6 спецификации, для уровней `SUPPORT` и `ADMIN`: `scrollWidth` страницы не больше `clientWidth`, навигация доступна, нет ошибок консоли.
  - Review Focus 3: `?name=long` не ломает ни один размер.
  - Масштаб текста 200% на 390×844 и 1280×720: основные действия доступны.
  - Review Focus 5: изменение размера окна с 1280 до 390 и обратно сохраняет текущий раздел; событие режима поверх чата включает компактный вид и выключает его.
  - axe на Обзоре, Настройках и экране `NOT_STAFF`.
  - Сборка: в файлах `dist` нет `/kit`, подставного режима и внешних адресов, кроме домена Discord из SDK.
- [ ] **Step 2: Запустить `pnpm --dir apps/activity exec playwright test`, исправить найденные проблемы.** Expected: PASS.
- [ ] **Step 3: Снять скриншоты Обзора и `/kit` на 390×844, 1440×900 и 3440×1440, просмотреть их глазами и исправить замеченное.**
- [ ] **Step 4: Написать документацию о реализованном и выполнить полную проверку:** `pnpm test`, `pnpm typecheck`, `pnpm lint`, сборка Activity. Expected: всё успешно.
- [ ] **Step 5: Закоммитить:** `test: add responsive checks and ui docs`
