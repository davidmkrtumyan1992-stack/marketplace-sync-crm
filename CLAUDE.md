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
| Focus cosmetics — ЯМ | 99063023 (Campaign), Business: 131115754 | ✓ подключён (FBS sync) |
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

### Синхронизация заказов WB — Золотой стандарт:
- Единственный активный WB магазин: **store_id=45** (Бушуева - WB, ИП Бабушева А.Ю., WB seller ID 250056193)
- `marketplace_settings` id=4 (store_id=NULL) — **ОТКЛЮЧЁН** (is_active=false). Это был API ключ от удалённого аккаунта. НЕ включать!
- `autoSyncWbOrders` — каждые 2 мин, окно: вчера 21:00 UTC до сегодня 21:00 UTC + `/api/v3/orders/new`
- `syncWbSuppliesForOrg` — вызывается после каждого autoSyncWbOrders; Phase 4: 30-дневный бэкфилл создаёт заказы в поставках которых нет в БД; для ЗАКРЫТЫХ поставок (WB API /api/v3/supplies/{id}/orders возвращает []) — date-fallback: UPDATE orders WHERE wb_supply_id IS NULL AND created_at между -7/+3 днями от даты создания поставки
- **Защита от реактивации**: если `orders.status='cancelled'` И новый wbStatus не 'cancelled' — autoSyncWbOrders ПРОПУСКАЕТ обновление (continue). Не трогать!
- Призрачные заказы от старых/удалённых аккаунтов: отключить API ключ в marketplace_settings, удалить заказы через SQL

### WB FBS — маппинг статусов и фильтры вкладок (ЭТАЛОН — НЕ ИЗМЕНЯТЬ):

**wbStatusToInternal** (routes.ts, ~line 3951) — единственный источник истины:
```
new / waiting                                                     → pending   (Новые)
confirm / complete / indelivery / delivering / ready_for_pickup   → shipped   (На сборке / В пути)
delivered / receive / sold                                        → completed (Выполнен)
cancel / canceled / user_cancel / canceled_by_client /
  declined / declined_by_client / cancel_ignore / defect / cancelled → cancelled
(всё остальное)                                                   → pending
```

**Эталонные SQL-фильтры вкладок** (GET /api/wb/orders, GET /api/wb/supplies, GET /api/wb/counts):

**Новые** — заказы без поставки, последние 7 дней:
```sql
wb_status IN ('new','waiting') AND wb_supply_id IS NULL AND created_at >= NOW() - INTERVAL '7 days'
```

**На сборке** — открытые поставки: пустые (0 заказов) ИЛИ с активными заказами (не ушедшими дальше confirm):
```sql
ws.status = 'open'
AND (
  NOT EXISTS (SELECT 1 FROM orders o WHERE o.wb_supply_id = ws.supply_id AND o.source = 'wildberries' AND o.organization_id = ws.organization_id)
  OR (
    EXISTS     (SELECT 1 FROM orders o WHERE o.wb_status IN ('new','waiting','confirm') AND o.wb_supply_id = ws.supply_id AND o.source = 'wildberries')
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.wb_status IN ('indelivery','delivering','shipped','ready_for_pickup','sold','complete','delivered','receive') AND o.wb_supply_id = ws.supply_id AND o.source = 'wildberries')
  )
)
```
Пустая поставка (status=open, 0 заказов в orders) — всегда показывается в «На сборке». Это нужно для поставок, созданных через CRM или WB до добавления заказов.

**В доставке** ⚠️ КРИТИЧНО — фильтр по дате закрытия + обязательное наличие заказов внутри + хотя бы один незавершённый заказ:
```sql
ws.status = 'closed'
AND COALESCE(ws.closed_at, ws.created_at) >= NOW() - INTERVAL '20 days'
AND EXISTS (SELECT 1 FROM orders o WHERE o.wb_supply_id = ws.supply_id AND o.organization_id = ws.organization_id)
AND EXISTS (
  SELECT 1 FROM orders o WHERE o.wb_supply_id = ws.supply_id AND o.organization_id = ws.organization_id
  AND o.wb_status NOT IN ('delivered','receive','sold','cancelled','canceled','user_cancel',
    'canceled_by_client','declined','declined_by_client','cancel_ignore','defect','cancelled',
    'returned','sorted','waiting_for_cancel')
)
```
WB убирает поставку из «В доставке» когда все заказы доставлены/отменены.
Второй EXISTS — NOT IN финальных статусов (не фильтрация по конкретному wb_status).
Если поставка без заказов внутри — её не показываем, даже если дата подходит.
**Phase 1 sync**: если supply в WB ACTIVE API имеет `closedAt` → статус 'closed' (уже отсканирована).
Если `closedAt` null → статус 'open' (ещё собирается). Phase 3 ACTIVE+CLOSED → skip (Phase 1 приоритетен).
EXISTS без wb_status — проверка на наличие хотя бы одного заказа в БД. Phantom поставки (0 заказов
в таблице orders) исключаются — это не нарушение правила выше, поскольку не фильтрует по wb_status.
Старые поставки (2025, ранний март) имеют closed_at из своего реального времени → исключаются автоматически.

**Архив** — заказы с финальными статусами:
```sql
wb_status IN ('delivered','sold','receive','returned','sorted','waiting_for_cancel','ready_for_pickup')
```

**Отменённые** — все варианты отмены WB API:
```sql
wb_status IN ('cancel','canceled','user_cancel','canceled_by_client','declined','cancelled','cancel_ignore','defect','declined_by_client')
OR status = 'cancelled'
```

### Синхронизация заказов Яндекс Маркет — Золотой стандарт:
- Активный магазин: **Focus cosmetics**, campaign_id=99063023, Business ID=131115754, marketplace_settings.marketplace='yandex'
- `warehouseId` в marketplace_settings = Campaign ID (99063023) — НЕ Business ID (131115754)! Это разные числа
- `fromDate` формат: **DD-MM-YYYY** (например `16-04-2026`) — НЕ ISO! Критичная особенность ЯМ API
- `autoSyncYandexOrders` фильтрует кампании по warehouseId (точное совпадение campaign.id → exactMatch; иначе filter по business.id)
- Заказы создаются ВСЕГДА даже если items.length=0 (SKU не нашлись в БД) — totalAmount берётся из yOrder.itemsTotal || yOrder.buyerTotal
- Авто-синк каждые 5 минут (YANDEX_SYNC_INTERVAL), первый запуск через 15 сек, окно **30 дней**
- Ручной синк: POST /api/marketplace/yandex/sync-orders, окно 30 дней
- Авторизация: ACMA-ключ → `Api-Key: ACMA:...`; OAuth → `Authorization: OAuth {token}`
- **НЕ трогать Ozon/WB при правке ЯМ и наоборот**

### Маппинг статусов ЯМ FBS — Золотой стандарт (вкладки Orders.tsx):
```
yandex_status            → Вкладка CRM       → internal status
──────────────────────────────────────────────────────────────────
NEW                      → Новые             → pending
PROCESSING / RESERVED    → Ожидают сборки    → pending
READY_TO_SHIP            → Отправления       → pending
PICKUP                   → Ожидают курьера   → shipped
DELIVERY                 → Доставляются      → shipped
DELIVERED                → Доставлены        → completed
CANCELLED/RETURNED/UNPAID→ Отменены          → cancelled
(нет данных)             → Не отгружены      → 0 (нет ship-by date в API)
```
Порядок вкладок: Новые / Ожидают сборки / Отправления / Не отгружены / Ожидают курьера / Доставляются / Доставлены / Отменены / Все

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
✓ Sync заказов Яндекс Маркет (Focus cosmetics, campaign 99063023, Business 131115754, FBS) — fromDate DD-MM-YYYY, campaign filter by warehouseId, заказы создаются даже без SKU-совпадения
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
✓ WB «В доставке» — ЭТАЛОН ЗАФИКСИРОВАН: ACTIVE upsert НЕ сбрасывает status в 'open' если поставка уже 'closed'; GET /api/wb/supplies?status=closed и delivery_count в /api/wb/counts используют ТОЛЬКО временной фильтр: COALESCE(closed_at, created_at) >= NOW() - INTERVAL '20 days' — БЕЗ EXISTS по статусам заказов; сортировка closed_at DESC NULLS LAST; старые поставки 2025 года отсечены навсегда через реальный closed_at
✓ WB Архив: syncWbArchiveStatuses — каждый час (+ через 30с при старте) запрашивает WB API за последние 30 дней, обновляет wb_status+status для СУЩЕСТВУЮЩИХ заказов которые изменили статус; НЕ создаёт новые записи; решает проблему «заказы 8-21 марта есть в БД но статус не обновлён» (autoSyncWbOrders берёт только вчерашний день); архивный фильтр расширен: added 'sorted','waiting_for_cancel'; archive_count тоже расширен
✓ WB вкладка «Отменённые» — исправлены все три проблемы: (1) оранжевый блок заменён на синий информационный с кнопкой «Перейти в остатки» → /products; (2) wbStatusToInternal расширен: cancel_ignore + defect + cancelled → "cancelled"; (3) фильтр GET /api/wb/orders?status=cancelled включает defect; POST /api/wb/sync-cancelled — бэкфилл за 30 дней; startup авто-запуск бэкфилла если 0 cancelled WB заказов в БД
✓ WB призрачные заказы — исправлено: отключён marketplace_settings id=4 (null-store, старый аккаунт); autoSyncWbOrders не реактивирует cancelled заказы (защита по status='cancelled'); wbStatusToInternal добавлен declined_by_client→cancelled; Phase 4 backfill в syncWbSuppliesForOrg создаёт пропущенные заказы поставок за 30 дней + исправляет store_id=NULL
✓ WB Phase 4 fallback для закрытых поставок — WB API возвращает [] для closed/processed supply; fallback: UPDATE orders SET wb_supply_id WHERE wb_supply_id IS NULL AND created_at IN [-7d, +3d] от даты создания поставки; решено: поставка WB-GI-229135903 не отображалась в «В доставке» из-за 0 заказов в БД (коммит d048423)
✓ WB FBS управление поставками (коммиты 82b6670–5afac0e, апрель 2026) — «Создать пустую поставку» (CreateEmptySupplyDialog); «+ Новая поставка» + «Добавить к созданной» в sticky bar «Новые»; DELETE /api/wb/supplies/:id (non-fatal WB API); POST /api/wb/supplies/:id/add-orders; SupplyDetailDialog empty state; SupplyActionsMenu «Переименовать»+«Удалить»; SQL-фильтр «На сборке» включает пустые open-поставки; POST /api/wb/supplies автодетект storeId когда не передан; assembly_count считает пустые поставки
✓ ЯМ product import — POST /businesses/{discoveredBusinessId}/offer-mappings: Business ID берётся из GET /campaigns ответа (131115754), а не из warehouseId (99063023 = Campaign ID); убран нестандартный Business-Id header; OAuth header исправлен Bearer→OAuth; status-фильтр заказов удалён (API не поддерживает multi-value status=)
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
