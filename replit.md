# CloudERP - Inventory & Sales Management System

## Overview
CloudERP is a production-ready multi-company cloud ERP/CRM system designed for e-commerce businesses operating on Russian marketplaces (Ozon, Wildberries, Yandex Market). It functions as a "Single Source of Truth" for inventory management, order processing, and financial analytics across various sales channels.

Key capabilities include:
- Multi-company architecture with multi-level Role-Based Access Control (RBAC).
- Centralized `centralStock` warehouse model with virtual mirroring to storefronts and per-product store exclusions.
- Smart barcode intake system.
- Russian tax calculation engine and comprehensive expense tracking.
- Dynamic dashboard with KPIs, low-stock alerts, sales charts, marketplace revenue breakdown, and pending order indicators.
- Advanced analytics including ABC analysis for product categorization.
- CRM for customer management and full audit logging for inventory changes.
- Robust marketplace synchronization infrastructure with detailed history logging for Ozon, Wildberries, and Yandex Market.
- Performance optimizations including PostgreSQL indexing, global data prefetching, and debounced search.
- Yandex Market FBS order integration with polling-based sync, status mapping, and multi-store support.
- Ozon dual-mode FBS/FBO order management with webhook/polling sync, label printing, and multi-account integration.
- Global marketplace partitioning in the Orders UI with independent views and filters per marketplace.
- Ozon Calculator for FBO/FBS profit analysis, including product analytics, cost breakdowns, and price simulation.
- Custom tax rate settings.
- Excel export functionality for products and P&L reports, with real profit calculation based on `order_items`.
- Enhanced Ozon API reliability with retry mechanisms and pagination for order syncing.
- Wildberries FBS supply management: fully redesigned «Mirror» UI matching WB Seller Cabinet — tabbed interface (New/Assembly/Delivery/Archive/Cancelled), rich order/supply columns, time-ago badges, 48px product photos, dropdown ··· menus, supply rename, picking-list export (PDF/Excel), sticker printing (58×40mm), 72h filter for new orders, archive auto-sync from WB API, and supply closing. Assembly/Delivery tabs have checkboxes with sticky bulk QR-print bar; extended ··· menus (stickers, QR, PDF picking-list, Excel picking-list, supply detail dialog) unified for both tabs; numeric tab count badges from /api/wb/counts; WB auto-sync every 2 min with automatic supply sync.
- UI is fully localized in Russian.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript.
- **Routing**: Wouter.
- **State Management**: TanStack React Query.
- **UI Components**: shadcn/ui built on Radix UI, styled with Tailwind CSS.
- **Charts**: Recharts.
- **Forms**: React Hook Form with Zod validation.
- **Build Tool**: Vite.

### Backend Architecture
- **Framework**: Express.js with TypeScript.
- **API Design**: RESTful endpoints defined with Zod validation.
- **Authentication**: Replit Auth (OpenID Connect) via Passport.js, with PostgreSQL-backed sessions.
- **Database ORM**: Drizzle ORM with PostgreSQL dialect.

### Data Storage
- **Database**: PostgreSQL.
- **Schema**: Includes tables for companies, stores, products (with `centralStock` and barcode), orders, customers, stock inflow, expenses, user roles, tax settings, marketplace settings, sync history, and audit logs.

### Authentication Flow
- Leverages Replit's OpenID Connect.
- Sessions stored in a PostgreSQL `sessions` table.
- User data synchronized to a `users` table.
- Role-Based Access Control (RBAC) enforced via middleware (Owner, Accountant, Administrator roles).
- Data isolation achieved through an `organizationId` field for multi-tenancy.

### Key Design Decisions
- **Shared Type Safety**: API contracts defined with Zod ensure type safety across frontend and backend.
- **Multi-tenant by User**: Each user operates as an independent organization for data isolation.
- **Centralized Warehouse Model**: A single `centralStock` field for simplified inventory tracking.
- **Russian Localization**: Custom utilities for proper Russian formatting.
- **Marketplace Abstraction**: Generic settings and sync infrastructure support easy integration with various marketplace APIs.
- **Robust Marketplace Sync**: Includes product import, enrichment, and two-way synchronization with marketplaces, prioritizing marketplace acceptance for data integrity.
- **Dashboard Sales Analysis**: 60/40 split layout with dual-line LineChart (Gross/Net revenue) and donut chart (marketplace revenue breakdown).
- **Performance Optimizations**: Global data prefetching with TanStack Query for instant page rendering, aggressive refetching, and background sync intervals.
- **Golden Standard Store Connection**: Automated marketplace_settings provisioning, ON DELETE CASCADE for data integrity, and real-time credential validation.
- **Ozon Order Sync Timezone Accuracy**: All sync requests aligned to Moscow midnight to prevent data loss.

## External Dependencies

### Database
- **PostgreSQL**: Primary data store.

### Authentication
- **Replit Auth**: OpenID Connect provider for user authentication.

### Frontend Libraries
- **@tanstack/react-query**: Server state management.
- **@tanstack/react-table**: Data tables.
- **recharts**: Data visualizations.
- **date-fns**: Date formatting and localization.
- **react-hook-form** and **@hookform/resolvers**: Form handling and validation.

### UI Framework
- **shadcn/ui**: Component library.
- **Radix UI**: Underlying UI primitives.
- **Tailwind CSS**: Styling.

### Core Integrations
- **Ozon API (V3)**: Marketplace product import, enrichment, and synchronization.
- **Wildberries API**: Planned integration for marketplace sync.
- **Yandex Market API**: Planned integration for marketplace sync.