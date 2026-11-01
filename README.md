<p align="center">
  <img src="brand/banner.png" alt="CrystalAid" width="680">
</p>

# CrystalAid

Discord-бот и Discord Activity для учёта ветки стаффа: тикеты, смены и нормы, онлайн, кадры, отчёты, зарплата в токенах и внутренний магазин.

Проект в разработке. Готово ядро: HTTP API, вход через Activity, уровни и права, синхронизация состава из событий Discord, журнал аудита. Готова и дизайн-система с оболочкой Activity: токены и шесть тем, компоненты, навигация по уровням, Обзор и Настройки, адаптивная раскладка и браузерные проверки. Есть и бот (`apps/bot`): тикеты в личных сообщениях с проверкой «выберите картинку», расписание ПТ с напоминаниями, `/menu` и `/dev` (только на сервере). Остальные разделы Activity пока заглушки.

## Запуск

Нужны PostgreSQL, Redis 5+ с паролем, `.env` в корне (образец `.env.example`) и `crystalaid.config.json` (образец `crystalaid.config.example.json`). API, worker и `pnpm db:migrate` читают корневой `.env` сами; переменные из настоящего окружения сильнее файла. Локальные PostgreSQL и Redis поднимает `docker compose up -d` (пароли `POSTGRES_PASSWORD` и `REDIS_PASSWORD` берутся из `.env`, порты открыты только на `127.0.0.1`).

```
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm --dir apps/api run api
pnpm --dir apps/api run worker
pnpm --dir apps/bot run register   # команды /help, /menu, /dev
pnpm --dir apps/bot run start
```

Бот требует приложение Discord с интентом Server Members и приглашения на оба сервера; по шагам: [Развёртывание](docs/deployment.md#запуск-бота-с-нуля).

Сборка не нужна: сервисы запускаются через tsx. Тесты: `pnpm test` (из корня).

## Документация

- [Спецификация](docs/superpowers/specs/2026-11-01-crystalaid-staff-design.md)
- [Архитектура](docs/architecture.md)
- [API](docs/api.md)
- [База данных](docs/database.md)
- [Безопасность](docs/security.md)
- [Тесты](docs/testing.md)
- [Развёртывание](docs/deployment.md)
- [Интерфейс](docs/ui.md)
- [Поведение интерфейса](docs/ux.md)
- [Адаптивность](docs/responsive.md)

## Брендинг

Файлы лежат в [`brand/`](brand).

| Файл | Размер | Назначение |
|---|---|---|
| `logo.png` | 1254×1254 | Исходный логотип с прозрачным фоном |
| `logo-512.png` | 512×512 | Логотип для интерфейса |
| `avatar.png` | 1024×1024 | Иконка приложения и аватар бота |
| `banner.png` | 1360×480 | Баннер профиля бота |
| `activity-cover.png` | 1920×1080 | Обложка Activity |
| `favicon.png` | 64×64 | Значок вкладки |

Основные цвета: фон `#0B1220`, поверхность `#18233A`, текст `#EAF1FA`, акцент `#6FD3F7`.
