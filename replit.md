# CloudERP - Inventory & Sales Management System

## Overview

CloudERP is a production-ready multi-company cloud ERP/CRM system for e-commerce businesses operating on Russian marketplaces (Ozon, Wildberries, Yandex Market). It serves as a "Single Source of Truth" for inventory management, order processing, and financial analytics across multiple sales channels.

Key capabilities include:
- Multi-company and multi-level Role-Based Access Control (RBAC) architecture.
- Centralized `centralStock` warehouse model with virtual mirroring to storefronts and per-product store exclusions.
- Smart barcode intake system optimized for tablets.
- Russian tax calculation engine and comprehensive expense tracking.
- Dynamic dashboard with KPIs, low-stock alerts, sales charts, and pending order indicators.
- Advanced analytics including ABC analysis for product categorization.
- CRM for customer management and full audit logging for inventory changes.
- Marketplace synchronization infrastructure with detailed history logging for Ozon, Wildberries, and Yandex Market.
- Ozon dual-mode FBS/FBO order management: webhook-based and polling-based order sync for both FBS and FBO, ship/cancel actions via Ozon API, FBS label printing, posting number tracking, Ozon status display, fulfillment type badges and filtering.
- Ozon FBO inventory tracking: file-only FBO stock management via Excel/CSV report uploads (no API sync), persistent last-updated timestamp, display in products table.
- Multi-format Ozon report parser for FBO inventory: smart header detection, supports «Управление остатками», «Уцененные товары», and «Ведомость по товарам» report formats with automatic column mapping and "Уценка" badge for discounted items.
- Bulk multi-file upload for Ozon reports with sequential processing, per-file report type detection, and consolidated result summary.
- Excel export functionality for products and P&L reports.
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