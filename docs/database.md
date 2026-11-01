# База данных

PostgreSQL. Схема: `packages/database/src/schema.ts` (Drizzle). Миграции: `packages/database/migrations/` (0000 схема, 0001 запрет изменения журналов, 0002 `staff_members.last_event_at`). Применяются командой `pnpm db:migrate`.

## Таблицы, которые использует ядро

| Таблица | Назначение |
|---|---|
| `users` | глобальная личность: `discord_id` (уникален), имя, аватар |
| `staff_members` | запись стаффа в гильдии: `level` (NONE, SUPPORT, CURATOR, ADMIN), `status` (active, inactive), должность, `token_balance` (не меньше 0), `last_event_at`; пара гильдия и пользователь уникальна |
| `role_permissions` | права уровней SUPPORT и CURATOR по гильдии; ADMIN имеет всё без записей |
| `settings` | настройки гильдии одной JSON-строкой |
| `audit_log` | журнал действий, только добавление |
| `career_events` | кадровая история (вступил, вернулся, смена уровня, снятие доступа) |
| `token_ledger` | журнал токенов, только добавление; уникальный `idempotency_key` |

## Таблицы для следующих частей

Создаются миграцией, ядро в них не пишет: `tickets`, `ticket_events`, `ticket_messages`, `staff_daily`, `presence_sessions`, `voice_sessions`, `shifts`, `absences`, `warnings`, `staff_notes`, `payroll_periods`, `payroll_lines`, `shop_items`, `shop_orders`.

## Только добавление

На `audit_log` и `token_ledger` стоят триггеры, отклоняющие `UPDATE` и `DELETE`. Исправление это новая строка. Триггеры строковые, `TRUNCATE` их не вызывает; так очищается только тестовая база.

## Начальные данные

При запуске API вызывает `ensureSeeded`: если для гильдии нет строки `settings`, вставляются настройки и права по умолчанию (`seedDefaults`). Это происходит один раз при первом запуске; позже права, снятые администратором, не возвращаются. Права меняются через `PATCH /permissions`.
