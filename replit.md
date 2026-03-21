# CloudERP - Inventory & Sales Management System

## Overview

CloudERP is a production-ready multi-company cloud ERP/CRM system designed for e-commerce businesses operating on Russian marketplaces (Ozon, Wildberries, Yandex Market). It functions as a "Single Source of Truth" for inventory management, order processing, and financial analytics across various sales channels. The system supports multi-company and multi-level Role-Based Access Control (RBAC). Key features include a centralized `centralStock` model, smart barcode intake, a Russian tax calculation engine, comprehensive expense tracking, and dynamic dashboards with KPIs, sales charts, and low-stock alerts. It also provides advanced analytics like ABC analysis, CRM for customer management, and full audit logging. The platform is designed for robust marketplace synchronization, offering detailed history logging for Ozon, Wildberries, and Yandex Market, alongside performance optimizations for data loading and refreshing. The system handles Yandex Market FBS order integration, Ozon dual-mode FBS/FBO order management with multi-account support, and global marketplace partitioning in the Orders UI. Additional functionalities include an Ozon profit calculator, product analytics with price simulation, and Excel export for products and P&L reports with real profit KPI tracking.

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
- **Localization**: Fully localized in Russian with custom utilities for number and currency formatting.
- **UI/UX**: Branded splash screen, distinct color schemes for marketplaces (Ozon blue, Yandex Market yellow, Wildberries purple), and clear UI for order management.

### Backend Architecture
- **Framework**: Express.js with TypeScript.
- **API Design**: RESTful endpoints defined in `shared/routes.ts` with Zod validation.
- **Authentication**: Replit Auth (OpenID Connect) via Passport.js, with PostgreSQL-backed sessions.
- **Database ORM**: Drizzle ORM with PostgreSQL dialect.

### Data Storage
- **Database**: PostgreSQL.
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
- **Marketplace Abstraction**: Generic settings and sync infrastructure are in place for easy integration with marketplace APIs.
- **Robust Marketplace Sync**: Includes product import, enrichment, and two-way synchronization with marketplaces, where changes are pushed to the marketplace first and local save is conditional on marketplace acceptance, ensuring data integrity. `fetchWithRetry` helper for Ozon API calls and pagination for large data sets.
- **Performance Optimizations**: PostgreSQL indexes, global data prefetching with TanStack Query, background sync intervals, and automatic data refresh on window focus/reconnect.
- **Timezone Accuracy**: All date and time operations, especially for marketplace sync and sales data computation, are aligned to Moscow time (MSK) to ensure accuracy.

## External Dependencies

### Database
- **PostgreSQL**: Primary data store.
- **Drizzle Kit**: Schema management.

### Authentication
- **Replit Auth**: OpenID Connect provider for user authentication.

### Frontend Libraries
- **@tanstack/react-query**: Server state management.
- **@tanstack/react-table**: Data tables.
- **recharts**: Dashboard visualizations.
- **date-fns**: Date formatting and localization.
- **react-hook-form**: Form handling.
- **@hookform/resolvers**: Validation for forms.

### UI Framework
- **shadcn/ui**: Component library.
- **Radix UI**: Underlying UI primitives.
- **Tailwind CSS**: Styling.
- **class-variance-authority**: Component variants.

### Core Integrations
- **Ozon API (V3)**: Product import, enrichment, two-way inventory/price synchronization, order management (FBS/FBO), label printing, and status display.
- **Wildberries API**: Planned integration for marketplace sync.
- **Yandex Market API**: Integration for FBS order sync, product import, and status management.