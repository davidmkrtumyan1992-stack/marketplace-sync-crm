# CloudERP CRM — Конфигурация для AI-агентов

## Обзор проекта
Мультикомпанийная CRM/ERP система для продавцов на российских маркетплейсах (Ozon, Wildberries, Яндекс Маркет). Управление товарами, заказами, складом и финансовой аналитикой из одного места.

## Стек технологий
- **Frontend**: React 18 + TypeScript, Wouter (роутинг), TanStack Query (стейт), shadcn/ui + Radix UI, Tailwind CSS, Recharts
- **Backend**: Express.js + TypeScript, REST API
- **БД**: PostgreSQL + Drizzle ORM
- **Auth**: Replit Auth (OpenID Connect) + Passport.js
- **Build**: Vite (фронт), esbuild (бэк)

## Структура проекта
```
client/src/          — React фронтенд
  pages/             — страницы (Dashboard, Products, Orders, Settings...)
  components/        — переиспользуемые компоненты
  hooks/             — кастомные хуки
server/              — Express бэкенд
  routes.ts          — все API эндпоинты (~3400 строк)
  storage.ts         — методы работы с БД (~1030 строк)
  marketplace-import.ts — импорт товаров с маркетплейсов
  inventory-sync.ts  — синхронизация остатков
shared/
  schema.ts          — Drizzle схема БД (единый источник истины)
  routes.ts          — API контракты + Zod схемы
```

## Архитектура данных (ключевые таблицы)
```
organizations → companies → stores → marketplace_settings
                         ↓
                      products → product_marketplace_links → stores
                         ↓
                      orders → order_items
```

## Подключённые магазины (5 Ozon)
| Название в CRM | Client ID | Статус |
|---|---|---|
| Алена-Ozon | 3835567 | ✓ подключён |
| Ало косметикс — Ozon | 3364383 | ✓ подключён |
| Кирилл-Озон | 4052691 | ✓ подключён |
| Лаура — Ozon | 2311038 | ✓ подключён |
| Лаура texnicol | 2496152 | ✓ подключён |
| Яндекс Маркет | — | ⏳ не подключён |
| Wildberries | — | ⏳ не подключён |

## Правила — ОБЯЗАТЕЛЬНО соблюдать

### Общие
- Все денежные значения хранятся как `decimal` строки в БД, конвертировать через `Number()`
- Числа форматировать с пробелом как разделитель тысяч: «1 450 ₽»
- Все UI тексты на русском языке
- Использовать кавычки «» для строк в UI
- `organizationId` — изоляция данных между пользователями, ВСЕГДА фильтровать по нему

### Frontend
- НЕ использовать `localStorage` или `sessionStorage` — не работает в Replit sandbox
- Все цвета через CSS переменные (`var(--color-text-primary)`) — никаких хардкодных hex в dark mode
- После мутации данных вызывать `queryClient.invalidateQueries`
- Форма карточки товара НЕ должна закрываться после сохранения

### Backend
- Все новые эндпоинты оборачивать в `try/catch` с логированием
- Маркетплейс-эндпоинты: если один МП недоступен — не падать, возвращать partial results
- `isAuthenticated` + `requireRole(...)` на все защищённые маршруты
- Никогда не бросать 4xx если один из маркетплейсов недоступен

### База данных
- Все изменения схемы через `shared/schema.ts` + `npm run db:push`
- Новые таблицы добавлять с `organizationId` полем
- FK с `{ onDelete: "cascade" }` для связанных данных

## Что НЕЛЬЗЯ трогать без явного указания
- Логику синхронизации заказов Ozon (работает стабильно)
- Логику синхронизации заказов Яндекс (работает стабильно)
- Систему аутентификации и сессий
- RBAC middleware (isAuthenticated, requireRole)

## Команды
```bash
npm run dev          # запуск dev сервера
npm run db:push      # применить изменения схемы БД
npm run build        # production сборка
```

## Статус разработки (актуально)
✓ Мультикомпания/магазин архитектура
✓ Sync заказов Ozon FBS+FBO
✓ Sync заказов Яндекс Маркет
✓ Ozon Калькулятор (точность ±1₽ от официального)
✓ Вкладка Аналитика в карточке товара
✓ Симулятор цены
✓ Своя ставка налога (любой %)
✓ Поля габаритов в карточке товара
✓ Кнопка Сохранить НЕ закрывает карточку
✓ Кнопка Сохранить НЕ синхронизирует с МП автоматически
✓ product_marketplace_links — таблица в БД
✓ GET /api/products/:id/stores — статус товара по магазинам
✓ POST /api/products/:id/sync-price — синхронизация цены на Ozon
✓ POST /api/admin/migrate-product-links — миграция ozonId
✓ SyncPriceDialog — диалог выбора магазинов после сохранения
📋 P&L по реальным продажам — запланировано
📋 WB sync-orders — после подключения WB
📋 Синхронизация цены Яндекс Маркет — планируется
