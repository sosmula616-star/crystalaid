# Интерфейс

Дизайн-система живёт в `packages/design-system`, Activity в `apps/activity`. Спецификация: `docs/superpowers/specs/2026-11-01-crystalaid-design-system-design.md`.

## Токены и темы

- `tokens.css`: отступы (4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80), радиусы (4–20), шрифт, длительности, слои (`--layer-overlay` < `dialog` < `popper` < `toast`). Цвета, отступы и длительности берутся только из токенов; шестнадцатеричные цвета вне `tokens.css` и `themes.css` запрещает `pnpm lint`.
- `themes.css`: шесть тем `crystal`, `indigo`, `amber`, `emerald`, `graphite`, `raspberry`. Тема ставится атрибутом на `<html>` через `applyTheme`, выбор хранится в `localStorage` (с запасом на случай отказа хранилища).
- `base.css`: у `html` и `body` нет полей браузера, фон и цвет текста из темы.
- Размеры шрифта в токенах заданы в `rem`, у `html` размер `100%`: текст следует настройкам браузера и пользователя.
- При `prefers-reduced-motion: reduce` длительности равны 0, анимации выключены. У `Button` в состоянии загрузки остаётся неподвижное кольцо и `aria-busy`.

## Компоненты

Avatar, Badge, Button, Card, Checkbox, Drawer, Dropdown, EmptyState, ErrorState, IconButton, Input, Modal, ProgressBar, Select, Skeleton, StatCard, Table, Tabs, Toast (`ToastProvider`, `useToast`), Toggle, Tooltip. Окна, меню и подсказки построены на Radix. Цель нажатия не меньше 40 px; подсказка не единственный путь к действию.

Таблица на узком контейнере (до 720 px) превращается в карточки: главные колонки видны, остальные раскрываются кнопкой. Роли `table`, `row`, `cell` заданы явно, чтобы разметка сохранила семантику.

Уведомления лежат выше окон. Пока открыто модальное окно, Radix скрывает остальную страницу от вспомогательных технологий, в том числе область уведомлений; сами уведомления озвучиваются отдельным объявлением Radix, закрыть их мышью можно.

## Activity

- `src/auth`: вход через Discord SDK, сессия только в памяти, экран ошибки входа (`NOT_STAFF` и другие коды).
- `src/shell`: оболочка с навигацией по уровню и правам (`sections.ts`), ленивые разделы с границей ошибок и повтором, режим «поверх чата».
- `src/sections`: Обзор и Настройки; остальные разделы показывают заглушку.
- Тексты в `packages/i18n` (ru, en); в `apps/activity` нет текста, написанного прямо в коде, кроме витрины.

## Разработка без Discord

`pnpm --dir apps/activity run dev:mock` запускает Activity с подставным SDK и ответами API (`src/dev/mock.ts`). Параметры адреса: `?level=SUPPORT|CURATOR|ADMIN`, `?name=long`, `?error=NOT_STAFF` (или другой код входа), `?pip=1|0`, `?locale=en-US`. `window.__crystalaidLayout(mode)` отправляет режим окна вручную (1 — поверх чата, 0 — обычный).

Витрина `/kit` показывает все компоненты, состояния и темы. Подставной режим и витрина работают только при `import.meta.env.DEV` и в сборку не попадают; это проверяет `e2e/bundle.spec.ts`.
