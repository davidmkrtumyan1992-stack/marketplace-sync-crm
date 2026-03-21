# SPECIFICATION.md — CloudERP CRM
# Полная техническая спецификация
# Версия: 1.0 | Дата: март 2026

---

## 1. БАЗА ДАННЫХ — Полная схема

### 1.1 companies
| Поле | Тип | Описание |
|------|-----|----------|
| id | serial PK | |
| name | text NOT NULL | Название ИП/ООО |
| inn | text | ИНН |
| organizationId | text NOT NULL | Изоляция данных |
| createdAt | timestamp | |

### 1.2 stores
| Поле | Тип | Описание |
|------|-----|----------|
| id | serial PK | |
| companyId | integer FK→companies | |
| marketplace | text | 'ozon' / 'wildberries' / 'yandex' |
| name | text NOT NULL | Отображаемое имя |
| apiKey | text | API ключ |
| clientId | text | Client ID (Ozon) |
| warehouseId | text | ID склада |
| isActive | boolean default true | |
| lastSync | timestamp | |

### 1.3 products
| Поле | Тип | Описание |
|------|-----|----------|
| id | serial PK | |
| name | text NOT NULL | |
| sku | text NOT NULL | Артикул |
| barcode | text | Штрихкод |
| category | text | |
| purchasePrice | decimal(10,2) | Себестоимость |
| sellingPrice | decimal(10,2) | Цена продажи |
| price | decimal(10,2) | = sellingPrice (дублируется) |
| dimensionLength | decimal(10,2) | Длина в см |
| dimensionWidth | decimal(10,2) | Ширина в см |
| dimensionHeight | decimal(10,2) | Высота в см |
| weight | decimal(10,3) | Вес в кг |
| marketplaceCommission | decimal(5,2) | Комиссия FBO % |
| marketplaceCommissionFbs | decimal(5,2) | Комиссия FBS % |
| centralStock | integer | Главный остаток |
| stockOzon / stockWb / stockYandex | integer | Остатки на МП |
| ozonId | text | ID на Ozon (legacy) |
| wbId | text | ID на WB |
| yandexId | text | ID на Яндекс |
| safetyStock | integer | Страховой остаток |
| companyId | integer FK→companies | |
| organizationId | text NOT NULL | |

### 1.4 product_marketplace_links ⚡ НОВАЯ
| Поле | Тип | Описание |
|------|-----|----------|
| id | serial PK | |
| productId | integer FK→products CASCADE | |
| storeId | integer FK→stores CASCADE | |
| marketplaceProductId | text | ID товара на конкретном МП |
| isActive | boolean default true | |
| lastSyncAt | timestamp | Последняя синхронизация |
| lastSyncStatus | text | 'success' / 'error' / 'pending' |
| lastSyncError | text | Текст ошибки |
| organizationId | text NOT NULL | |
| UNIQUE | (productId, storeId) | |

### 1.5 orders
| Поле | Тип | Описание |
|------|-----|----------|
| id | serial PK | |
| orderNumber | text NOT NULL | |
| customerId | integer FK→customers | |
| status | text | 'pending'/'shipped'/'completed'/'cancelled' |
| totalAmount | decimal(10,2) | |
| source | text | 'ozon'/'wildberries'/'yandex'/'manual' |
| externalId | text | ID на маркетплейсе |
| postingNumber | text | Номер отправления Ozon |
| ozonStatus | text | Статус на Ozon |
| yandexStatus | text | Статус на Яндекс |
| fulfillmentType | text | 'FBS' / 'FBO' |
| storeId | integer FK→stores CASCADE | |
| sourceStoreName | text | Денормализованное имя магазина |
| companyId | integer FK→companies | |
| organizationId | text NOT NULL | |

### 1.6 order_items
| Поле | Тип | Описание |
|------|-----|----------|
| id | serial PK | |
| orderId | integer FK→orders CASCADE | |
| productId | integer FK→products | |
| quantity | integer NOT NULL | |
| price | decimal(10,2) NOT NULL | Цена продажи |
| originalPrice | decimal(10,2) | Исходная цена |
| salePrice | decimal(10,2) | Цена со скидкой |

### 1.7 tax_settings
| Поле | Тип | Описание |
|------|-----|----------|
| id | serial PK | |
| organizationId | text NOT NULL | |
| companyId | integer FK→companies | |
| taxSystem | text | 'usn_6' / 'usn_15' / 'custom' |
| taxRate | decimal(5,2) | Ставка % (любое значение) |
| defaultLogisticsCost | decimal(10,2) | |
| defaultMarketplaceCommission | decimal(5,2) | |

### 1.8 marketplace_settings
| Поле | Тип | Описание |
|------|-----|----------|
| id | serial PK | |
| organizationId | text NOT NULL | |
| storeId | integer FK→stores CASCADE | |
| marketplace | text | |
| apiKey | text NOT NULL | |
| clientId | text | |
| warehouseId | text | |
| isActive | boolean | |

---

## 2. API ЭНДПОИНТЫ

### 2.1 Компании и магазины
```
GET    /api/companies                     — список компаний
POST   /api/companies                     — создать компанию
PUT    /api/companies/:id                 — обновить
DELETE /api/companies/:id                 — удалить

GET    /api/stores                        — все магазины организации
GET    /api/companies/:companyId/stores   — магазины компании
POST   /api/stores                        — создать магазин + автоимпорт товаров
PUT    /api/stores/:id                    — обновить (sync stores + marketplace_settings)
DELETE /api/stores/:id                    — удалить (CASCADE: orders, sync_history, links)
```

### 2.2 Товары
```
GET    /api/products                      — список товаров (с companyId фильтром)
GET    /api/products/:id                  — один товар
POST   /api/products                      — создать
PUT    /api/products/:id                  — обновить (БЕЗ автосинхронизации с МП!)
DELETE /api/products/:id                  — удалить
GET    /api/products/barcode/:barcode     — поиск по штрихкоду

GET    /api/products/:id/stores           — магазины для товара с статусами ✓
POST   /api/products/:id/sync-price       — синхронизировать цену на выбранные МП ✓
POST   /api/products/enrich-from-ozon     — подтянуть габариты и комиссии с Ozon API
POST   /api/admin/migrate-product-links   — миграция ozonId в product_marketplace_links
```

### 2.3 Заказы
```
GET    /api/orders                        — список заказов
GET    /api/orders/:id                    — заказ с items
POST   /api/orders                        — создать вручную
PATCH  /api/orders/:id/status             — обновить статус
POST   /api/orders/direct                 — прямая продажа (офлайн)

POST   /api/marketplace/ozon/sync-orders      — sync заказов Ozon (FBS+FBO)
POST   /api/marketplace/yandex/sync-orders    — sync заказов Яндекс
POST   /api/marketplace/wildberries/sync-orders — ⏳ НЕ РЕАЛИЗОВАНО
```

### 2.4 Маркетплейсы
```
GET    /api/marketplace/settings          — настройки МП
POST   /api/marketplace/settings          — сохранить настройки
POST   /api/marketplace/sync              — синхронизировать всё

POST   /api/marketplace/sync/ozon         — Smart Sync: импорт + обогащение Ozon
POST   /api/marketplace/import/ozon       — импорт товаров Ozon
POST   /api/marketplace/import/wildberries — импорт товаров WB
POST   /api/marketplace/import/yandex     — импорт товаров Яндекс

POST   /api/marketplace/ozon/ship         — отгрузить заказ Ozon
POST   /api/marketplace/ozon/cancel       — отменить заказ Ozon
POST   /api/marketplace/ozon/label        — этикетка Ozon (58×40мм)

POST   /api/stores/check-connection       — проверить API ключ МП
```

### 2.5 Аналитика и финансы
```
GET    /api/kpi                           — KPI дашборда
GET    /api/analytics/sales               — данные продаж (?days=30&from=&to=&storeId=)
GET    /api/analytics/abc                 — ABC анализ товаров
GET    /api/analytics/low-stock           — товары с низким остатком

GET    /api/settings/tax                  — настройки налогов
POST   /api/settings/tax                  — сохранить налоги

GET    /api/expenses                      — расходы (?companyId=)
POST   /api/expenses                      — добавить расход
DELETE /api/expenses/:id                  — удалить

GET    /api/export/sales                  — Excel выгрузка продаж
GET    /api/export/pnl                    — Excel P&L (⚠️ БАГ: считает склад, а не продажи)
```

### 2.6 Прочее
```
GET    /api/user-role                     — роль пользователя
POST   /api/user-role                     — установить роль

GET    /api/stock-inflow                  — приходы товаров
POST   /api/stock-inflow                  — новый приход

GET    /api/inventory-sync/status         — статус синхронизации остатков
GET    /api/inventory-sync/logs           — логи синхронизации
GET/POST /api/inventory-sync/settings     — настройки синхронизации

GET    /api/audit-log                     — журнал изменений
GET    /api/sync-history                  — история синхронизаций
GET    /api/customers                     — клиенты CRM
```

---

## 3. БИЗНЕС-ЛОГИКА

### 3.1 Формулы Ozon Калькулятора (подтверждено на реальных товарах)
```
объём (л) = длина × ширина × высота / 1000  [габариты в см]

Логистика FBO:
  объём ≤ 1л    → 46₽
  1л < объём ≤ 3л → 46 + (объём - 1) × 10
  3л < объём ≤ 190л → 66 + (объём - 3) × 15
  объём > 190л  → 2871₽

Логистика FBS:
  объём ≤ 1л    → 80₽
  1л < объём ≤ 3л → 80 + (объём - 1) × 18
  3л < объём ≤ 190л → 116 + (объём - 3) × 23
  объём > 190л  → 4417₽

Постоянные:
  эквайринг     = цена × 0.01  (1%)
  последняя миля = 25₽ (фиксировано)
  обработка FBS = 30₽ (только FBS)
  обработка FBO = 0₽

Расчёт:
  commissionFBO = цена × (marketplaceCommission / 100)
  commissionFBS = цена × (marketplaceCommissionFbs / 100)
  tax = цена × (taxRate / 100)

  totalFBO = commissionFBO + эквайринг + logFBO + 25
  totalFBS = commissionFBS + эквайринг + logFBS + 30 + 25

  profitFBO = цена - totalFBO - purchasePrice - tax
  profitFBS = цена - totalFBS - purchasePrice - tax
  marginFBO = (profitFBO / цена) × 100
```

### 3.2 Налоговые системы
```
usn_6:  налог = выручка × 0.06
usn_15: налог = (выручка - расходы) × 0.15, минимум выручка × 0.01
custom: налог = выручка × (taxRate / 100)  ← любая ставка
```

### 3.3 Синхронизация цены на Ozon
```
Эндпоинт: POST https://api-seller.ozon.ru/v1/product/import/prices
Headers: Client-Id, Api-Key
Body: { prices: [{ offer_id: sku, price: "1000", old_price: "0", premium_price: "0", min_price: "0" }] }
Успех: result.items[0].errors.length === 0
```

### 3.4 Получение габаритов с Ozon
```
Эндпоинт: POST https://api-seller.ozon.ru/v3/product/info
Body: { product_id: Number(ozonId) }
Конвертация: размеры в мм → делить на 10 для см, вес в граммах → делить на 1000 для кг
```

### 3.5 Получение комиссии по категории Ozon
```
Эндпоинт: POST https://api-seller.ozon.ru/v1/category/commission
Body: { category_id: [Number(categoryId)], price: "1000" }
Ответ: result[0].fbo_percent, result[0].fbs_percent
```

### 3.6 Правила синхронизации остатков
```
При поступлении заказа:
  1. Уменьшить centralStock на quantity
  2. Если centralStock ≤ safetyStock → отправить 0 на все МП
  3. Иначе → отправить новый centralStock на все активные МП
  4. Исключить магазины из product_store_exclusions
  5. Логировать в stock_sync_log
```

### 3.7 Правила синхронизации заказов Ozon (временные зоны)
```
Все запросы к Ozon API используют московское время (UTC+3):
  
  since = начало московского дня = предыдущий день 21:00:00 UTC
  to = конец московского дня = текущий день 21:00:00 UTC
  
  Пример для 20 марта МСК:
    since=2026-03-19T21:00:00Z (= 2026-03-20 00:00:00 МСК)
    to=2026-03-20T21:00:00Z (= 2026-03-21 00:00:00 МСК)
  
  Ограничения:
    FBO limit: 1000 (не 50!)
    FBS limit: 1000
  
  Надёжность API:
    - Все запросы к Ozon API используют fetchWithRetry (3 попытки, 3 сек пауза)
    - Retry срабатывает на HTTP 429, 502, 504 и сетевые ошибки
    - Пагинация: максимум 10 страниц × 1000 постингов = 10 000 заказов на магазин
    - Пагинация применяется к FBO и FBS в ручном синке, фоновом синке и ресинке
  
  Применяется в:
    POST /api/marketplace/ozon/sync-orders (ручной синк)
    autoSyncOzonStatuses() (фоновый воркер каждые 5 минут)
```

---

## 4. КОМПОНЕНТЫ ФРОНТЕНДА

### 4.1 Карточка товара (ProductModal/Drawer)
**Вкладки:** Информация | Аналитика

**Вкладка Информация содержит:**
- Фото товара, артикул (readonly), Ozon ID
- Поля: Название, Штрихкод, Цена продажи, Категория
- Блок «Габариты товара»: Длина(см), Ширина(см), Высота(см), Вес(кг)
- Блок «Комиссии маркетплейса»: FBO%, FBS%
- Закупочная цена
- Кнопка «Сохранить» — только локальное сохранение в БД, НЕ закрывает карточку

**После сохранения если изменилась цена:**
- Показать SyncPriceDialog с выбором магазинов

**Вкладка Аналитика содержит:**
- 3 KPI карточки: Прибыль FBO, Прибыль FBS, Маржа FBO
- Таблица затрат FBO/FBS (по формулам раздела 3.1)
- Симулятор цены (слайдер + поле ввода)
- Кнопка «Применить цену» — только PUT /api/products/:id, без синхронизации

### 4.2 SyncPriceDialog (компонент выбора магазинов)
**Показывается:** после сохранения если изменилась цена
**Данные:** GET /api/products/:id/stores
**Для каждого магазина показывает:**
- Чекбокс (активен если isConnected && hasProduct)
- Цветная точка (синяя=Ozon, фиолетовая=WB, жёлтая=Яндекс)
- Название магазина
- Статус: «✓ Готов» / «○ Товара нет на МП» / «⚠️ Не подключён»
- Дата последней синхронизации

**После синхронизации:**
- Показать результат по каждому магазину: ✓ Успех / ✗ Ошибка
- Запомнить выбор в localStorage (ключ: `sync-store-selection-{productId}`)

### 4.3 Ozon Калькулятор (OzonCalculatorDialog)
**Открывается:** кнопка «Ozon Калькулятор» на странице Товары
**Поля ввода:**
- Поиск товара (из CRM, автозаполняет форму)
- Категория (select, автоставит FBO% и FBS%)
- Цена продажи (обязательное)
- Себестоимость
- Комиссия FBO% / FBS% (редактируемые)
- Переключатель Габариты/Объём
- Длина, Ширина, Высота (в режиме Габариты)
- Объём в л (в режиме Объём)

**Результат (таблица FBO/FBS):**
| Параметр | FBO | FBS |
| Цена товара | X₽ 100% | X₽ 100% |
| Вознаграждение Ozon | -X₽ X% | -X₽ X% |
| Эквайринг (1%) | -X₽ | -X₽ |
| Обработка отправления | — | -30₽ |
| Логистика | -X₽ | -X₽ |
| Последняя миля | -25₽ | -25₽ |
| Себестоимость | -X₽ | -X₽ |
| Налог (X%) | -X₽ | -X₽ |
| Чистая прибыль | **X₽** (зел/красн) | **X₽** |
| Маржинальность | X% | X% |

### 4.4 Dashboard — автообновление данных
**refetchInterval:** 300000 мс (5 минут) для всех запросов:
- `/api/kpi` — КПИ карточки (остаток, капитализация, прибыль)
- `/api/analytics/sales` — график и разбивка продаж по маркетплейсам
- `/api/analytics/low-stock` — товары с низким остатком
- `/api/inventory-sync/status` — статус синхронизации

**Поведение:** данные обновляются в фоне каждые 5 минут, даже если вкладка не активна (если `refetchOnWindowFocus: "always"` установлен в глобальном конфиге)

### 3.8 Dashboard — двойные показатели выручки (Gross/Net)
**Раздел «Анализ продаж»** показывает два типа выручки:

| Показатель | Описание | Цвет |
|---|---|---|
| Заказано (Gross) | Все заказы за период, включая отменённые. Совпадает с «Заказано» в кабинете Ozon | Синий #3b82f6 |
| К получению (Net) | Только неотменённые заказы | Зелёный #22c55e |
| Отменено | Выручка по отменённым заказам | Красный #ef4444 |

**График:** LineChart с двумя линиями (Gross + Net). Два чекбокса над графиком управляют видимостью линий. Tooltip показывает все три значения.

**Donut chart:** переключается на `grossMarketplaceBreakdown` если активен только «Заказано» (чекбокс Gross on, Net off), иначе использует `marketplaceBreakdown` (только net).

**KPI-карточки под графиком** (3 штуки в ряд):
- **Заказано** — badge «как в Ozon», синий. Значение: `grossRevenue` из SalesResponse
- **К получению** — зелёный. Значение: `netRevenue`
- **Отменено** — красный, с процентом отмен под суммой. Значение: `cancelledRevenue`, `cancellationRate`%

**Определение отменённого заказа:**
```
(status='cancelled' AND (ozonStatus IS NULL OR ozonStatus='cancelled'))
OR yandexStatus IN ('CANCELLED','RETURNED')
```

**API:** `/api/analytics/sales` теперь возвращает доп. поля:
- `grossRevenue`, `netRevenue`, `cancelledRevenue`, `cancelledCount`, `cancellationRate`
- `grossMarketplaceBreakdown` — breakdown по gross
- Каждая точка `SalesDataPoint`: `grossRevenue`, `cancelledRevenue` (+ старый `revenue` = net)

### 4.6 Список товаров (страница Products)
**Колонки таблицы:**
- Фото, Название, SKU, Штрихкод
- Цена продажи
- Прибыль FBO (цвет по марже)
- Прибыль FBS
- Маржа % (бейдж: >30%=зелёный, 10-30%=жёлтый, <10%=красный)
- Остаток

---

## 5. МАРКЕТПЛЕЙСЫ — Интеграции

### 5.1 Ozon API
**Base URL:** `https://api-seller.ozon.ru`
**Auth:** Headers `Client-Id` + `Api-Key`

| Эндпоинт | Назначение | Статус |
|----------|-----------|--------|
| POST /v3/product/list | Список товаров | ✓ |
| POST /v3/product/info | Инфо о товаре (габариты) | ✓ |
| POST /v1/product/import/prices | Обновить цену | ✓ |
| POST /v1/product/import/stocks | Обновить остатки | ⚠️ заглушка |
| POST /v1/category/commission | Комиссия по категории | ✓ |
| POST /v4/posting/fbs/list | Заказы FBS | ✓ |
| POST /v2/posting/fbo/list | Заказы FBO | ✓ |
| POST /v3/posting/fbs/ship | Отгрузить FBS | ✓ |
| POST /v2/posting/fbs/cancel | Отменить FBS | ✓ |

### 5.2 Wildberries API
**Base URL:** `https://common-api.wildberries.ru`
**Auth:** Header `Authorization: Bearer {apiKey}`
**Статус:** ⏳ Не подключён (планируется)

| Эндпоинт | Назначение |
|----------|-----------|
| GET /api/v1/warehouses | Проверка подключения |
| PUT /api/v3/stocks/{warehouseId} | Обновить остатки |
| POST /api/v2/upload/task | Обновить цены |
| GET /api/v3/orders | Получить заказы |

### 5.3 Яндекс Маркет API
**Base URL:** `https://api.partner.market.yandex.ru`
**Auth:** Header `Authorization: OAuth {token}`
**Статус:** Заказы ✓, Остатки/Цены ⏳

| Эндпоинт | Назначение |
|----------|-----------|
| GET /campaigns | Список кампаний (магазинов) |
| GET /campaigns/{id}/orders | Заказы |
| PUT /campaigns/{id}/offer-prices/updates | Обновить цену |
| PUT /campaigns/{id}/offers/stocks | Обновить остатки |

---

## 6. СТАТУС ЗАДАЧ

### ✅ Завершено
- Мультикомпания/мультимагазин архитектура
- RBAC: owner/accountant/administrator
- Sync заказов Ozon (FBS + FBO, дедупликация, мультистор)
- Sync заказов Яндекс Маркет (мульти-кампания)
- Импорт товаров с Ozon/WB/Яндекс
- Калькулятор Ozon (точность ±1₽)
- Вкладка Аналитика в карточке товара
- Симулятор цены (локальное сохранение)
- Поля габаритов/комиссий в карточке товара
- Автообогащение с Ozon при открытии карточки
- Своя ставка налога (любой %)
- ABC анализ товаров
- Экспорт Excel (товары, P&L)
- Мини-KPI в списке товаров (прибыль/маржа)
- Бейджи маржинальности на товарах
- Кнопка ручной синхронизации заказов в разделе Заказы
- Цены в order_items берутся из financial_data Ozon (реальные цены покупателя)
- Заказы создаются даже если SKU не найден в CRM

### ⚡ В процессе (следующие задачи по порядку)
1. Таблица product_marketplace_links в БД
2. Эндпоинты: /api/products/:id/stores и /api/products/:id/sync-price
3. Компонент SyncPriceDialog
4. Диалог синхронизации при сохранении товара
5. Миграция существующих ozonId

### 📋 Запланировано (в порядке приоритета)
6. Исправить P&L — считать из orderItems (реальные продажи), а не из склада
7. Добавить purchasePrice в orderItems
8. Реализовать sendStockToMarketplace (сейчас заглушка!)
9. WB sync-orders (после подключения WB)
10. Мастер создания товара на маркетплейсах

---

## 7. ИЗВЕСТНЫЕ БАГИ

| Баг | Файл | Приоритет | Статус |
|-----|------|-----------|--------|
| P&L считает склад вместо продаж | server/routes.ts ~1742 | Высокий | В работе |
| getDashboardKPI считает склад | server/storage.ts ~659 | Высокий | Открыт |
| sendStockToMarketplace — заглушка | server/inventory-sync.ts ~108 | Критический | Открыт |
| orderItems нет purchasePrice | shared/schema.ts | Средний | Открыт |
| Конфликт статусов заказов (cancelled vs ozon_status) | server/routes.ts | Высокий | ✅ Исправлен |
| Логика фильтрации в getSalesData (cancelled + активный ozonStatus) | server/storage.ts | Высокий | ✅ Исправлен |
| Дублирование заказов при синхронизации | server/routes.ts | Высокий | ✅ Исправлен |
| Маппинг sent_by_seller → shipped отсутствовал | server/routes.ts | Средний | ✅ Исправлен |
| FBO limit 50 обрезал заказы крупных магазинов | server/routes.ts ~2695 | Критический | ✅ Исправлен (limit: 1000) |
| UTC vs МСК сдвиг: заказы 00:00-03:00 МСК терялись | server/routes.ts ~2556, ~3559 | Критический | ✅ Исправлен (since = предыдущий день 21:00 UTC) |
| Dashboard не обновлялся автоматически | client/src/pages/Dashboard.tsx | Средний | ✅ Исправлен (refetchInterval: 300000) |

---

## 8. ФОРМАТ ПРОМТОВ ДЛЯ REPLIT AGENT

При каждом промте в Replit Agent указывать:
```
Контекст: [ссылка на раздел SPECIFICATION.md]
Задача: [конкретное действие]
Не трогать: [что нельзя изменять]
Проверить: [как убедиться что работает]
```

Пример:
```
Контекст: SPECIFICATION.md раздел 2.2 (эндпоинт /api/products/:id/stores)
Задача: Реализовать эндпоинт GET /api/products/:id/stores согласно спецификации
Не трогать: существующие эндпоинты Ozon sync-orders
Проверить: открыть карточку товара → должен появиться список магазинов
```
