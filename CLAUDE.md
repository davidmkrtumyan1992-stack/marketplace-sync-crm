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
✓ WB FBS синхронизация заказов — autoSyncWbOrders каждые 2 мин (было 5), POST /api/marketplace/wildberries/sync-orders, wbStatus → internal status mapping, isCancelledOrder включает WB cancel/user_cancel/declined; syncWbSuppliesForOrg вызывается в автосинке
✓ WB FBS интерфейс управления поставками — WildberriesOrders.tsx: полный редизайн под стандарт WB Seller Cabinet; вкладки Новые (чекбоксы, OrderNumCell с временным бейджем «X ч Y мин назад»+МГТ, ProductCell 48px, WarehouseCell, меню ···) / На сборке (GET /api/wb/supplies?status=open, таблица поставок, меню ··· с Лист подбора PDF/Excel/Экран / Переименовать / Закрыть) / В доставке (GET /api/wb/supplies?status=closed, статус «Поставка в обработке», closed_at) / Архив (wb_status IN delivered/sold, wb_rid, синий «Отсортировано ›») / Отменённые (жёлтая плашка + ссылка /inventory, причина отмены); GET /api/wb/orders?status=new фильтрует последние 72 часа; status=archive включает sold + фоновая синхронизация с WB API если <100 записей; GET /api/wb/supplies (wb_supplies + orders_count); PATCH /api/wb/supplies/:id/rename; Excel-экспорт через xlsx; WB_COLOR=#7631ff
✓ WB чекбоксы + sticky bar для групповой печати QR — Assembly/Delivery вкладки имеют чекбоксы, fixed-bar (bottom-0 left-0 right-0 z-50) при выборе; handleBulkPrintQr: 58×40mm лейблы для каждой поставки
✓ Расширенное меню поставок (PDF/Excel/QR/детализация) — SupplyActionsMenu с пунктами Стикеры/QR/PDF/Excel/Детализация + Закрыть (только assembly); DeliverySupplyRow использует то же меню с showClose=false; handlePickingListPdf использует GET /api/wb/supplies/:id/picking-pdf (бэкенд HTML)
✓ Счётчики вкладок из /api/wb/counts — числовые бейджи на вкладках Новые/На сборке/В доставке/Архив/Отменённые; refetchInterval: 120000
✓ status_label в GET /api/wb/supplies: open→«Ждёт передачи в доставку», closed→«Поставка в обработке»
✓ SupplyDetailDialog — диалог с таблицей заказов поставки (GET /api/wb/orders?supplyId=...)
✓ Зеркальная синхронизация поставок WB — syncWbSuppliesForOrg разделяет ACTIVE и CLOSED блоки; после успешного ACTIVE-фетча (200 OK) закрывает устаревшие «open»-поставки в БД (SET status='closed', closed_at=NOW()) которые отсутствуют в ответе WB API — только для записей с store_id != null; кнопки ручного «Синхронизировать поставки» удалены из UI (вкладки На сборке и В доставке); лог: [wb-supply-sync] store {id}: {N} активных в WB, закрыто устаревших: {M}
✓ WB «На сборке» фильтр — GET /api/wb/supplies?status=open и GET /api/wb/counts assembly_count показывают только поставки с заказами wb_status IN ('new','waiting','confirm'); пустые поставки (0 заказов) и поставки с устаревшими статусами не отображаются; syncWbStaleOrdersAll — запускается через 15 с при старте: обновляет wb_status заказов за 60 дней у которых в БД стоит 'new'/'waiting' но в WB API уже другой статус, затем вызывает syncWbSuppliesForOrg для закрытия устаревших поставок
✓ syncWbStaleOrdersAll автоочистка >21 дня — Шаг А: UPDATE orders SET wb_status='delivered',status='completed' для заказов 'new' в открытых поставках старше 21 дня; Шаг Б: закрывает эти поставки (NOT EXISTS активных заказов); защита от накопления устаревших данных при сбоях WB API
✓ WB «В доставке» — защита от повторного открытия: ACTIVE upsert НЕ сбрасывает status в 'open' если поставка уже 'closed' (WHERE status='open' в UPDATE); GET /api/wb/supplies?status=closed фильтрует только текущий год (closed_at >= DATE_TRUNC('year',NOW())) и сортирует по closed_at DESC; delivery_count в /api/wb/counts тоже с фильтром года
✓ WB вкладка «Отменённые» — исправлены все три проблемы: (1) оранжевый блок заменён на синий информационный с кнопкой «Перейти в остатки» → /products; (2) wbStatusToInternal расширен: cancel_ignore + defect + cancelled → "cancelled"; (3) фильтр GET /api/wb/orders?status=cancelled включает defect; POST /api/wb/sync-cancelled — бэкфилл за 30 дней; startup авто-запуск бэкфилла если 0 cancelled WB заказов в БД
📋 Синхронизация цены Яндекс Маркет — планируется

## Жизненный цикл магазина

### Порядок удаления (DELETE /api/stores/:id)
1. **Первым** удаляются API ключи (`marketplace_settings`) — чтобы авто-синк не стартовал новые запросы
2. Открытые WB-поставки переводятся в `status='closed'` (сохранение истории)
3. Удаляются `product_marketplace_links`
4. Удаляется сам магазин — **CASCADE** автоматически удаляет:
   - `orders` + `order_items`
   - `wb_supplies`
   - `sync_history`
   - `product_store_exclusions`

### Архитектурные правила
- `store_id IS NULL` в `wb_supplies` или `orders` = **баг** → немедленно архивировать (закрыть поставки, удалить заказы)
- Нет захардкоженных `store_id` или `client_id` в коде — всё берётся из БД
- Авто-синк (WB и Ozon) проверяет существование магазина перед запросом: если магазин удалён — пропускает с логом `[auto-sync] Магазин {id} удалён — пропускаем`
- Все FK к `stores` имеют `{ onDelete: "cascade" }` — добавлять новые таблицы с этим же правилом

## Известные баги
| Баг | Файл | Приоритет | Статус |
|---|---|---|---|
| ~~P&L считал склад вместо продаж~~ | server/routes.ts | Высокий | ✅ Исправлен (Task #5) |
| ~~getDashboardKPI считал склад~~ | server/storage.ts | Высокий | ✅ Исправлен (Task #5) |
| ~~Дублирование заказов при race condition~~ | server/storage.ts, shared/schema.ts | Критический | ✅ Исправлен (Task #6) |
| ~~Старые заказы получают created_at=NOW()~~ | server/routes.ts | Критический | ✅ Исправлен (Task #7) |
| ~~Заказы с неизвестным SKU молча пропускались~~ | server/routes.ts, shared/schema.ts | Высокий | ✅ Исправлен (Task #7) |
| ~~FBO заказы используют каталожную цену вместо фактической~~ | server/routes.ts | Средний | ✅ Исправлен (Task #7) |
