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
| Wildberries | — | ✓ подключён (FBS sync) |

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

### Синхронизация заказов Ozon — Золотой стандарт:
- since = предыдущий день 21:00:00 UTC (= 00:00:00 МСК текущего дня)
- to = текущий день 21:00:00 UTC (= 00:00:00 МСК следующего дня)
- FBO limit: 1000 (НЕ 50!)
- FBS limit: 1000
- FBO цены берутся из financial_data (НЕ из каталога товара)
- Все fetch к api-seller.ozon.ru через fetchWithRetry (3 попытки)
- Пагинация максимум 10 страниц на магазин

### Логика дашборда — Двойные показатели:
- grossRevenue = ВСЕ заказы включая cancelled (= "Заказано" в Ozon)
- netRevenue = только не отменённые (= реальная выручка)
- getSalesData в storage.ts возвращает ОБА показателя
- График показывает две линии: синяя (gross) + зелёная (net)
- Логика универсальна для ВСЕХ маркетплейсов — не переписывать!

### Даты в БД:
- created_at хранится в UTC
- Для отображения всегда конвертировать:
  DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Moscow')
- НЕ использовать DATE(created_at) без конвертации!

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
✓ P&L по реальным продажам — из order_items, 30 дней, realProfit в KPI
✓ Исправлено дублирование заказов — UNIQUE constraint (posting_number, store_id) + onConflictDoNothing в createOrder
✓ Исправлено расхождение данных CRM vs Ozon — три исправления (Task #7)
✓ Исправлен критический баг FBO limit (50 → 1000) в sync-orders
✓ Исправлено смещение часовых поясов UTC vs МСК: синхронизация теперь строго с 00:00 МСК (21:00 UTC предыдущего дня)
✓ Данные в CRM приведены в полное соответствие с личным кабинетом Ozon (проверено на 5 магазинах)
✓ Внедрено автообновление Dashboard каждые 5 минут (refetchInterval: 300000)
✓ fetchWithRetry — retry логика для всех 26 вызовов к Ozon API
✓ Пагинация с предохранителем 10 страниц для FBO/FBS sync
✓ Двойные показатели выручки на дашборде: Gross (Заказано) / Net (К получению) / Отменено — LineChart с двумя линиями, чекбоксы, 3 KPI-карточки, доnut переключается между gross/net breakdown
✓ WB FBS синхронизация заказов — autoSyncWbOrders каждые 5 мин, POST /api/marketplace/wildberries/sync-orders, wbStatus → internal status mapping, isCancelledOrder включает WB cancel/user_cancel/declined
✓ WB FBS интерфейс управления поставками — WildberriesOrders.tsx: полный редизайн под стандарт WB Seller Cabinet; вкладки Новые (чекбоксы, OrderNumCell с временным бейджем «X ч Y мин назад»+МГТ, ProductCell 48px, WarehouseCell, меню ···) / На сборке (GET /api/wb/supplies?status=open, таблица поставок, меню ··· с Лист подбора PDF/Excel/Экран / Переименовать / Закрыть) / В доставке (GET /api/wb/supplies?status=closed, статус «Поставка в обработке», closed_at) / Архив (wb_status IN delivered/sold, wb_rid, синий «Отсортировано ›») / Отменённые (жёлтая плашка + ссылка /inventory, причина отмены); GET /api/wb/orders?status=new фильтрует последние 72 часа; status=archive включает sold + фоновая синхронизация с WB API если <100 записей; GET /api/wb/supplies (wb_supplies + orders_count); PATCH /api/wb/supplies/:id/rename; Excel-экспорт через xlsx; WB_COLOR=#7631ff
📋 Синхронизация цены Яндекс Маркет — планируется

## Известные баги
| Баг | Файл | Приоритет | Статус |
|---|---|---|---|
| ~~P&L считал склад вместо продаж~~ | server/routes.ts | Высокий | ✅ Исправлен (Task #5) |
| ~~getDashboardKPI считал склад~~ | server/storage.ts | Высокий | ✅ Исправлен (Task #5) |
| ~~Дублирование заказов при race condition~~ | server/storage.ts, shared/schema.ts | Критический | ✅ Исправлен (Task #6) |
| ~~Старые заказы получают created_at=NOW()~~ | server/routes.ts | Критический | ✅ Исправлен (Task #7) |
| ~~Заказы с неизвестным SKU молча пропускались~~ | server/routes.ts, shared/schema.ts | Высокий | ✅ Исправлен (Task #7) |
| ~~FBO заказы используют каталожную цену вместо фактической~~ | server/routes.ts | Средний | ✅ Исправлен (Task #7) |
