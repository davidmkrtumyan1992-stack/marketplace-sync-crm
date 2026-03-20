# CloudERP - Inventory & Sales Management System

## Overview

CloudERP is a production-ready multi-company cloud ERP/CRM system for e-commerce businesses operating on Russian marketplaces (Ozon, Wildberries, Yandex Market). It serves as a "Single Source of Truth" for inventory management, order processing, and financial analytics across multiple sales channels.

Key capabilities include:
- Multi-company and multi-level Role-Based Access Control (RBAC) architecture.
- Centralized `centralStock` warehouse model with virtual mirroring to storefronts and per-product store exclusions.
- Smart barcode intake system optimized for tablets.
- Russian tax calculation engine and comprehensive expense tracking.
- Dynamic dashboard with KPIs, low-stock alerts, sales charts, marketplace revenue donut chart, and pending order indicators. Dashboard Sales Analysis section has a 60/40 split layout: bar chart (left) + donut chart (right) showing revenue breakdown by marketplace (Ozon #005bff, Yandex #ffcc00, Wildberries #cb11ab). Donut chart legend shows marketplace name + amount in «X руб.» format (no percentages). Both charts share the same date range picker and update together. Revenue formula (getSalesData): includes all order statuses except cancelled (status=cancelled, ozonStatus=cancelled, yandexStatus=CANCELLED/RETURNED). SalesResponse includes marketplaceBreakdown field aggregating revenue per source.
- Advanced analytics including ABC analysis for product categorization.
- CRM for customer management and full audit logging for inventory changes.
- Marketplace synchronization infrastructure with detailed history logging for Ozon, Wildberries, and Yandex Market.
- Performance optimizations: PostgreSQL indexes on orders (organization_id, store_id, status, source, external_id, created_at, composite), products (organization_id, sku, ozon_id, wb_id, yandex_id, composite), marketplace_settings (organization_id, store_id), order_items (order_id, product_id). Branded splash screen with progress bar on app load that blocks UI until all data (orders, stores, products) is fully loaded. Global data prefetching at app root via `GlobalDataPreloader` component using `useQueries` ensures orders, stores, and products are fetched in parallel and cached in TanStack Query before any page renders — marketplace tab switching is instant (<100ms). Progress mapping: isLoading → 30%, isFetching → 70%, isSuccess → 100%. Background sync intervals reduced from 10min to 5min. On-login sync trigger via `POST /api/sync/trigger` (rate-limited to 1/min). TanStack Query `refetchOnWindowFocus: "always"` and `refetchOnReconnect: "always"` for automatic data refresh. Debounced product search (300ms). Dashboard sync status refetchInterval reduced from 15s to 60s. Manual sync buttons and "Auto-sync" labels removed from Orders UI — all sync happens via background workers only. Clean Orders UI with no sync controls, only marketplace tabs and order list.
- Yandex Market FBS order integration: polling-based order sync via `POST /api/marketplace/yandex/sync-orders` (discovers campaigns, fetches orders per campaign, deduplicates by externalId+storeId). Background auto-sync every 5 minutes. Yandex status mapping: NEW/PROCESSING/READY_TO_SHIP→pending, DELIVERY/PICKUP→shipped, DELIVERED→completed, CANCELLED/RETURNED→cancelled. `yandexStatus` field on orders table for raw Yandex status. Yandex store badges with yellow color scheme. Auto product import on new Yandex store creation using `fetchYandexProducts`. Dashboard KPI includes Yandex active orders and real stockYandex values. Per-store 403 error handling: partial sync success shown with per-store result lines in toasts. Golden Standard Yandex multi-store sync: `marketplace_settings.storeId` FK links settings directly to stores (ON DELETE CASCADE). Auto-provisioning creates marketplace_settings when stores are created via any endpoint (POST /api/stores, POST /api/marketplace/settings, PUT /api/stores/:id). Auto-repair in sync: if store has credentials but no marketplace_settings, one is created on-the-fly. Data sanitization strips non-ASCII chars and trims whitespace from API keys and Business IDs on all create/update endpoints. OAuth header fix for background auto-sync (was incorrectly using Bearer). UI shows AlertTriangle warning icon on unconfigured Yandex stores in Orders filter; branded toast «Магазин не настроен» when attempting to sync unconfigured store.
- Ozon dual-mode FBS/FBO order management: webhook-based and polling-based order sync for both FBS and FBO, ship/cancel actions via Ozon API, FBS label printing, posting number tracking, Ozon status display, fulfillment type badges and filtering.
- Multi-account Ozon integration: supports multiple Ozon stores per organization. Background worker, manual sync, resync, and order actions (ship/cancel/label) all resolve API credentials per-store using `storeId`. Orders are deduplicated per-store (same posting number from different stores = separate orders). Store name badges displayed in Orders UI with color-coded styling (teal/purple/orange/pink). Store toggle filter in Orders UI filters orders, status counts, and KPI totals by store. Denormalized `sourceStoreName` field on orders for fast display. Per-store sync results with error/skippedNoSku reporting in toast notifications. Sync button shows store names during loading. Product import endpoints (`/api/marketplace/sync/ozon` and `/api/marketplace/import/ozon`) iterate all active Ozon settings to import catalogs from every configured store. Smart Sync enrichment is scoped per-store (only enriches products fetched from that store's API, preventing cross-store API calls).
- Golden Standard store connection: Add Store form validates Ozon client_id (numeric only) and api_key (UUID format). New Ozon stores automatically trigger background product import on creation. ON DELETE CASCADE on store_id FKs (orders, sync_history, product_store_exclusions, stock_sync_log) and order_items.orderId/webhook_logs.orderId enables one-click store deletion. Sync status banner on Orders page for stores with zero orders. All monetary values on Orders page use «X руб.» format with Russian guillemets. Edit Store dialog with pre-populated fields, marketplace read-only display, and inline "Check Connection" button that validates API credentials against real marketplace APIs (Ozon `/v3/product/list`, Yandex `/campaigns` with OAuth, WB `/api/v1/warehouses`). PUT `/api/stores/:id` syncs both stores and marketplace_settings tables.
- Global Marketplace Partitioning in Orders: Top-level branded tabs (Ozon blue #005BFF / Yandex Market yellow #FFCC00 / Wildberries purple #CB11AB) with fully independent views per marketplace. Each tab has its own marketplace-scoped store filter, sync buttons, status sub-tabs, KPI summary, and order list. Ozon tab retains FBS/FBO/direct sub-tabs with all existing functionality. Yandex tab has 8 status sub-filters (Все/Новый/Ожидает отгрузки/Не отправлено/Ожидает курьера/Доставка в процессе/Доставлено/Отменено). Wildberries tab is a placeholder with status tabs and "coming soon" empty state. Store filters reset on tab switch. GET `/api/stores` endpoint returns all org stores for marketplace-scoped filtering.
- Ozon Calculator on Products page: standalone FBO/FBS profit calculator with product search, category-based commissions (12 Ozon categories with FBO/FBS %), dimension/volume tabs, acquiring 1%, last mile 25₽, FBS processing 30₽. Shared calculation utility in `client/src/lib/ozon-calc.ts`.
- Product Analytics Tab in product card modal: KPI cards (Profit FBO, Profit FBS, Margin FBO), detailed FBO/FBS cost breakdown table, price simulator with slider (50%-200% range) and "Apply Price" button that saves to DB and syncs to marketplace. Yellow warnings for missing dimensions and purchase price.
- Product list mini-KPI columns: Profit FBO, Profit FBS, Margin displayed inline per product row. Margin badge next to product name color-coded (green >30%, yellow 10-30%, red <10%). All calculations on frontend using shared `ozon-calc.ts` utility.
- Custom tax rate: three options in Settings — УСН 6%, УСН 15%, "Своя ставка" (custom rate 0-100%). taxRate field in DB stores effective rate.
- Excel export functionality for products and P&L reports. P&L export (`/api/export/pnl`) uses real sales from `order_items` for the selected period (default 30 days, supports `from`/`to` query params). Formula: revenue − cost − commission − logistics − expenses − tax = net profit.
- Real profit KPI on dashboard: «Чистая прибыль (30 дней)» card shows actual 30-day net profit from order_items (non-cancelled orders). `order_items` table now stores `purchase_price` at time of sale. DashboardKPI type: `realProfit` field (replaces old `expectedProfit` stock-based estimate).
- Ozon order sync timezone accuracy: Fixed critical bug where FBO limit was 50 (now 1000) and UTC/MSK timezone mismatch caused orders from 00:00–03:00 MSK to be incorrectly filtered. All sync requests now align to Moscow midnight: `since = previous day 21:00 UTC = 00:00 MSK`, ensuring orders are captured accurately across all 5 Ozon stores.
- Dashboard automatic refresh: All dashboard queries (`/api/kpi`, `/api/analytics/sales`, `/api/analytics/low-stock`, `/api/inventory-sync/status`) now auto-refresh every 5 minutes (`refetchInterval: 300000`) for real-time KPI and sales data.
The UI is fully localized in Russian.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript.
- **Routing**: Wouter.
- **State Management**: TanStack React Query.
- **UI Components**: shadcn/ui built on Radix UI, styled with Tailwind CSS.
- **Charts**: Recharts for data visualization.
- **Forms**: React Hook Form with Zod validation.
- **Build Tool**: Vite.

### Backend Architecture
- **Framework**: Express.js with TypeScript.
- **API Design**: RESTful endpoints defined in `shared/routes.ts` with Zod validation.
- **Authentication**: Replit Auth (OpenID Connect) via Passport.js, with PostgreSQL-backed sessions.
- **Database ORM**: Drizzle ORM with PostgreSQL dialect.

### Data Storage
- **Database**: PostgreSQL, connected via `DATABASE_URL`.
- **Schema**: Defined in `shared/schema.ts`, including tables for companies, stores, products (with `centralStock` and barcode), orders, customers, stock inflow, expenses, user roles, tax settings, marketplace settings, sync history, and audit logs.

### Authentication Flow
- Leverages Replit's OpenID Connect.
- Sessions stored in a PostgreSQL `sessions` table.
- User data synchronized to a `users` table.
- Role-Based Access Control (RBAC) enforced via middleware, with roles: Owner, Accountant, and Administrator.
- Data isolation is achieved through an `organizationId` field, tying data to the user's organization.

### Key Design Decisions
- **Shared Type Safety**: API contracts defined with Zod in `shared/routes.ts` ensure type safety across frontend and backend.
- **Multi-tenant by User**: Each user is treated as an independent organization, ensuring data isolation.
- **Centralized Warehouse Model**: A single `centralStock` field manages inventory, simplifying stock tracking.
- **Russian Localization**: Custom utilities handle proper Russian formatting for numbers and currency.
- **Marketplace Abstraction**: Generic settings and sync infrastructure are in place for easy integration with marketplace APIs.
- **Robust Marketplace Sync**: Includes product import, enrichment, and two-way synchronization with marketplaces like Ozon, where changes are pushed to the marketplace first and local save is conditional on marketplace acceptance, ensuring data integrity.

## External Dependencies

### Database
- **PostgreSQL**: Primary data store, configured via `DATABASE_URL`.
- **Drizzle Kit**: For schema management.

### Authentication
- **Replit Auth**: OpenID Connect provider for user authentication. Requires `REPL_ID` and `SESSION_SECRET`.

### Frontend Libraries
- **@tanstack/react-query**: For server state management.
- **@tanstack/react-table**: For data tables.
- **recharts**: For dashboard visualizations.
- **date-fns**: For date formatting and localization.
- **react-hook-form** and **@hookform/resolvers**: For form handling and validation.

### UI Framework
- **shadcn/ui**: Component library.
- **Radix UI**: Underlying UI primitives.
- **Tailwind CSS**: For styling.
- **class-variance-authority**: For managing component variants.

### Core Integrations
- **Ozon API (V3)**: For marketplace product import, enrichment, and two-way inventory/price synchronization.
- **Wildberries API**: Planned integration for marketplace sync.
- **Yandex Market API**: Planned integration for marketplace sync.