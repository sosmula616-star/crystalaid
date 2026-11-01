# API

Все ответы JSON. Ошибка всегда такой формы, `requestId` создаёт сервер:

```json
{ "error": { "code": "FORBIDDEN", "message": "Not allowed", "requestId": "..." } }
```

У ошибки может быть необязательное поле `reason`: машиночитаемая причина (`snake_case`). `message` всегда английский и предназначен для логов; клиент не показывает его, а сопоставляет `code` и `reason` со своими переводами и при неизвестной причине показывает общий текст. Сейчас `reason` есть только у `NOT_STAFF`: `support_role_missing` (куратору не хватает роли поддержки) и `not_in_branch` (все остальные случаи).

Коды: `UNAUTHORIZED`, `TOKEN_EXPIRED`, `FORBIDDEN`, `NOT_STAFF`, `NOT_FOUND`, `VALIDATION_ERROR`, `RATE_LIMITED`, `SELF_ACTION`, `GUILD_REQUIRED`, `INVALID_INSTANCE`, `DISCORD_UNAVAILABLE`, `INTERNAL`. Схемы запросов и ответов: `packages/contracts/src/api.ts`.

Сессия: заголовок `Authorization: Bearer <sessionToken>`.

## Маршруты

| Метод и путь | Доступ | Назначение |
|---|---|---|
| `GET /health` | без авторизации, без лимита | `ok`; `degraded` при недоступном Redis (200); PostgreSQL недоступен: 503 |
| `POST /auth/activity` | без токена, 10/мин на IP | тело `{ code, instanceId }`; ответ `{ sessionToken, discordAccessToken, expiresIn }` |
| `GET /me` | персонал | профиль, уровень, должность, статус, баланс, права |
| `GET /staff` | CURATOR и выше | список; `?status=active` или `inactive` (по умолчанию `active`), `?cursor=` |
| `GET /permissions` | ADMIN | права `SUPPORT` и `CURATOR` |
| `PATCH /permissions` | ADMIN | тело `{ level: "SUPPORT" или "CURATOR", grants: [...] }`; заменяет набор, пишет в журнал |
| `GET /settings` | ADMIN | настройки гильдии (значения по умолчанию, пока строки нет) |
| `PATCH /settings` | ADMIN | частичное обновление; неизвестные ключи дают 400; `inactivityMinutes`, `inactivityReplyMinutes`, `ticketWaitMinutes` не меньше 1; `ticketRate`, `shiftHourRate`, `normBonus` целые (журнал токенов целочисленный); если ничего не изменилось, записи и строки аудита нет; иначе в журнал пишутся `before` и `after` |
| `GET /audit` | ADMIN | журнал аудита, новые первыми; `?cursor=` |
| `GET /internal/members/:discordUserId` | токен службы | уровень, статус, баланс, имя; для бота. У неактивного участника `level` равен `NONE` |

Списки постраничные: 50 записей, `nextCursor` непрозрачный, `null` на последней странице. Неверный курсор даёт 400.

`/internal/*` принимает `Authorization: Bearer <SERVICE_TOKEN>` и не ограничивается лимитами.

## Маршруты бота (`/internal`)

Только с `Authorization: Bearer <SERVICE_TOKEN>`. Маршруты, которые действуют от лица человека, принимают `actorDiscordId` и проверяют его уровень на каждый запрос.

| Метод и путь | Доступ | Назначение |
|---|---|---|
| `POST /internal/tickets` | любой участник | создать тикет (вопрос до 300 символов); ответ с заданиями саппортам на ПТ |
| `POST /internal/tickets/:id/claim` | SUPPORT | ответ на проверку (`choiceIndex` 0 до 3); `result`: `claimed`, `wrong`, `already_taken`, `closed`, `busy` (у саппорта уже есть принятый тикет, попытка не тратится), `yours` (повторное нажатие на свой тикет); для `claimed` и `yours` приходит `description` |
| `POST /internal/tickets/:id/messages` | заявитель или принявший | сообщение; принявший должен быть активным персоналом не ниже SUPPORT |
| `POST /internal/tickets/:id/close` | принявший или ADMIN | закрыть; ответ с `transcript`, `messageCount`, `claimerDiscordId` |
| `POST /internal/tickets/:id/cancel` | заявитель | отменить ещё не принятый тикет; `result`: `cancelled`, `claimed`, `closed` |
| `POST /internal/tickets/:id/release` | ADMIN | вернуть принятый тикет в очередь (`open`), он предлагается снова; 409 `not_claimed`, если тикет не принят. Так же тикет возвращается сам, когда принявший теряет доступ или уходит с сервера (в журнале `ticket.released`) |
| `POST /internal/tickets/:id/rating` | заявитель | оценка 1 до 5, один раз |
| `GET /internal/tickets/active` | любой | активный тикет человека: принятый им в первую очередь, иначе его собственный |
| `GET /internal/tickets/open` | ADMIN | открытые тикеты для меню (25 последних и общее число) |
| `GET /internal/tickets/due` | планировщик | тикеты для (повторного) предложения: не больше 10 за раз, не больше 3 непринятых предложений на саппорта; нетронутая проверка возвращается прежней, поэтому кнопки старого предложения остаются рабочими |
| `POST /internal/tickets/expire` | планировщик | закрывает тикеты без движения 24 часа (не больше 20 за раз); отдаёт стенограммы и участников, чтобы бот сообщил обеим сторонам и записал лог |
| `GET`, `PUT`, `DELETE /internal/pt` | CURATOR с `shifts.edit` | расписание ПТ |
| `GET /internal/pt/reminders` | планировщик | напоминания в ближайшие 5 минут для активного персонала; ничего не отмечает |
| `POST /internal/pt/reminders/confirm` | планировщик | тело `{ slotId }`; отмечает напоминание отправленным, повтор ничего не меняет |
| `POST /internal/delivery-failures` | бот | тело `{ targetDiscordId, what, code }`; запись `delivery_failed` в журнал аудита |
| `GET /internal/delivery-failures` | ADMIN | последние 20 ошибок доставки |
| `GET`, `PATCH /internal/menu/settings`, `GET`, `PATCH /internal/permissions`, `GET /internal/menu/access`, `GET /internal/diagnostics`, `GET /internal/members/:discordUserId` | по уровню | меню и диагностика бота |

## Ошибки входа

| Код | Статус | Когда |
|---|---|---|
| `INVALID_INSTANCE` | 403 | экземпляр неизвестен, чужая гильдия, пользователя нет в экземпляре |
| `GUILD_REQUIRED` | 400 | Activity открыта вне сервера |
| `NOT_STAFF` | 403 | нет роли стаффа, не участник гильдии, доступ снят. Куратору без роли поддержки сообщение говорит, что роли поддержки не хватает, а `reason` равен `support_role_missing`; в остальных случаях `reason` равен `not_in_branch` |
| `DISCORD_UNAVAILABLE` | 503 | Discord ответил 429, 5xx или не ответил за 5 секунд |

Права и уровень берутся из базы на каждый запрос, поэтому снятие роли действует сразу: старый токен получает `403 NOT_STAFF`.

Уровень определяется по ролям: ADMIN даёт любая роль администратора; CURATOR требует роль куратора и роль поддержки одновременно; SUPPORT даёт роль поддержки.
