# База данных

PostgreSQL. Схема: `packages/database/src/schema.ts` (Drizzle). Миграции: `packages/database/migrations/` (0000 схема, 0001 запрет изменения журналов, 0002 `staff_members.last_event_at`, 0003 тикеты и ПТ, 0004 варианты проверки, 0005 `tickets.last_activity_at`). Применяются командой `pnpm db:migrate`.

## Таблицы, которые использует ядро

| Таблица | Назначение |
|---|---|
| `users` | глобальная личность: `discord_id` (уникален), имя, аватар |
| `staff_members` | запись стаффа в гильдии: `level` (NONE, SUPPORT, CURATOR, ADMIN; у неактивной записи `NONE`, прежний уровень хранится в `career_events`), `status` (active, inactive), должность, `token_balance` (не меньше 0), `last_event_at`; пара гильдия и пользователь уникальна |
| `role_permissions` | права уровней SUPPORT и CURATOR по гильдии; ADMIN имеет всё без записей |
| `settings` | настройки гильдии одной JSON-строкой |
| `audit_log` | журнал действий, только добавление |
| `career_events` | кадровая история (вступил, вернулся, смена уровня, снятие доступа) |
| `token_ledger` | журнал токенов, только добавление; уникальный `idempotency_key` |

## Тикеты и ПТ (бот)

| Таблица | Назначение |
|---|---|
| `tickets` | тикет; `status` open, claimed, closed; `claimed_by`, `offered_at` (когда предлагали в последний раз), `last_activity_at` (последнее сообщение, принятие или возврат в очередь: через 24 часа без движения планировщик закрывает тикет), `closed_by` (пусто при автозакрытии), `rating` |
| `ticket_challenges` | проверка саппорта на тикет: `answer` (никогда не уходит клиенту), `options` (4 картинки в показанном порядке), `attempted_at`; непотраченная проверка при повторном предложении не меняется |
| `ticket_messages` | сообщения переписки; вложения в тексте как ссылки на копию в канале лога |
| `pt_slots` | часы ПТ; `reminded_at` ставится только после подтверждения доставки |

Возврат тикета в очередь, автозакрытие, отмена и ошибки доставки пишутся в `audit_log`: `ticket.released`, `ticket.expired`, `ticket.cancelled`, `delivery_failed`.

## Таблицы для следующих частей

Создаются миграцией, ядро в них не пишет: `ticket_events`, `staff_daily`, `presence_sessions`, `voice_sessions`, `shifts`, `absences`, `warnings`, `staff_notes`, `payroll_periods`, `payroll_lines`, `shop_items`, `shop_orders`.

## Только добавление

На `audit_log` и `token_ledger` стоят триггеры, отклоняющие `UPDATE` и `DELETE`. Исправление это новая строка. Триггеры строковые, `TRUNCATE` их не вызывает; так очищается только тестовая база.

## Начальные данные

При запуске API вызывает `ensureSeeded`: если для гильдии нет строки `settings`, вставляются настройки и права по умолчанию (`seedDefaults`). Это происходит один раз при первом запуске; позже права, снятые администратором, не возвращаются. Права меняются через `PATCH /permissions`.
