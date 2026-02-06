# CloudERP - Inventory & Sales Management System

## Overview

CloudERP is a production-ready multi-company cloud ERP/CRM system designed for e-commerce businesses selling on Russian marketplaces (Ozon, Wildberries, and Yandex Market). The system serves as a "Single Source of Truth" for inventory management, order processing, and financial analytics across multiple sales channels.

Key capabilities:
- Multi-company architecture: multiple companies (ИП) under one account, each with own marketplace stores
- Multi-channel inventory tracking with "split-stock" distribution across local warehouse, Ozon, Wildberries, and Yandex Market
- Smart barcode intake: USB scanner support for receiving goods with automatic product lookup
- Russian tax calculation engine (7% default rate) with expense tracking
- Dashboard with aggregate KPIs across all companies + per-company/store breakdowns
- CRM for customer management
- Marketplace API integration placeholders for Ozon, Wildberries, and Yandex Market
- Expense management with internal/external classification
- Full audit logging for inventory changes

The UI is fully localized in Russian with proper typographic conventions (angle quotes «», space-separated numbers).

## Design System

### Color Palette (Teal Theme)
- **Primary**: #0FC2C0 (bright teal) - hsl(175 98% 41%)
- **Accent**: #0CABA8 (medium teal) - hsl(175 85% 35%)
- **Dark**: #008F8C (deep teal) - hsl(180 85% 28%)
- **Sidebar**: #023535 (very dark teal) - hsl(180 50% 10%)
- **Darkest**: #015958 (deep dark teal) - hsl(180 60% 18%)

### Theme Toggle
- Light/Dark mode switch available in header (sun/moon icon)
- Theme persisted in localStorage
- CSS variables adapt for both modes

### UI Components
- **Sidebar Stats**: Premium stat cards with gradient backgrounds, large icons, and animated counters
- **KPI Cards**: Glass-morphism effect with subtle gradients and hover elevation
- **Charts**: Bar and Pie charts with teal color scheme and value counters
- **Buttons**: Premium gradient buttons with glow effects
- **Badges**: Teal badges with semi-transparent backgrounds

### CSS Classes
- `.premium-button` - Gradient button with shadow
- `.stat-card-premium` - Dark stat card with glow
- `.kpi-card` - Light card with gradient
- `.teal-badge` - Teal badge styling
- `.counter-badge` - Teal counter pill
- `.icon-box` - Icon container with gradient
- `.glass-card` - Glass effect card
- `.hover-elevate` - Elevation on hover

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state caching and synchronization
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens for a professional SaaS aesthetic
- **Charts**: Recharts for dashboard visualizations (pie charts, analytics)
- **Forms**: React Hook Form with Zod validation
- **Build Tool**: Vite with custom plugins for Replit integration

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **API Design**: RESTful endpoints defined in `shared/routes.ts` with Zod schema validation
- **Authentication**: Replit Auth (OpenID Connect) with Passport.js
- **Session Management**: PostgreSQL-backed sessions via connect-pg-simple
- **Database ORM**: Drizzle ORM with PostgreSQL dialect

### Data Storage
- **Database**: PostgreSQL (required, connection via DATABASE_URL environment variable)
- **Schema Location**: `shared/schema.ts` defines all tables using Drizzle's pgTable
- **Key Tables**:
  - `companies` - Multi-company entities (ИП) with INN and tax system
  - `stores` - Marketplace connections per company (ozon/wildberries/yandex)
  - `products` - Inventory with multi-location stock tracking (local, Ozon, WB, Yandex) + barcode field
  - `orders` and `orderItems` - Order management with marketplace source tracking
  - `customers` - CRM data
  - `stockInflow` - Inventory receipt records with distribution splits (including Yandex)
  - `expenses` - Expense tracking with internal/external classification
  - `userRoles` - RBAC (owner/accountant/administrator)
  - `taxSettings` - Russian tax configuration (7% default)
  - `marketplaceSettings` - API credentials for Ozon/Wildberries/Yandex
  - `auditLog` - Change tracking for compliance
  - `users` and `sessions` - Authentication (managed by Replit Auth)

### Authentication Flow
- Uses Replit's OpenID Connect authentication
- Session stored in PostgreSQL `sessions` table
- User data synced to `users` table on login
- Protected routes check `isAuthenticated` middleware
- Organization isolation via `organizationId` field (set to user's ID)

### Code Organization
```
client/src/           # React frontend
  components/         # Reusable UI components
  hooks/              # Custom hooks for API calls
  pages/              # Route components
  lib/                # Utilities (formatting, query client)
server/               # Express backend
  routes.ts           # API endpoint definitions
  storage.ts          # Database operations interface
  db.ts               # Drizzle database connection
  replit_integrations/auth/  # Authentication setup
shared/               # Shared between client/server
  schema.ts           # Database schema and types
  routes.ts           # API contract definitions with Zod
  models/auth.ts      # User/session table definitions
```

### Key Design Decisions

1. **Shared Type Safety**: API contracts defined once in `shared/routes.ts` with Zod schemas, used for both frontend validation and backend parsing

2. **Multi-tenant by User**: Each user operates as their own organization; `organizationId` field ensures data isolation

3. **Split-Stock Model**: Products track inventory separately for each location (`stockLocal`, `stockOzon`, `stockWb`, `stockYandex`) with `stockQuantity` as the computed total

4. **Russian Localization**: Custom formatting utilities in `client/src/lib/format.ts` handle number/currency display with proper Russian conventions

5. **Marketplace Abstraction**: Settings stored per-marketplace with API key fields; actual sync logic is stubbed for future implementation

## External Dependencies

### Database
- **PostgreSQL**: Required for all data storage including sessions
- Connection configured via `DATABASE_URL` environment variable
- Schema managed via Drizzle Kit (`npm run db:push`)

### Authentication
- **Replit Auth**: OpenID Connect provider at `https://replit.com/oidc`
- Requires `REPL_ID` and `SESSION_SECRET` environment variables
- Handles user identity and session management

### Frontend Libraries
- **@tanstack/react-query**: Server state management
- **@tanstack/react-table**: Data table functionality
- **recharts**: Dashboard charts
- **date-fns**: Date formatting with Russian locale support
- **react-hook-form + @hookform/resolvers**: Form handling with Zod integration

### UI Framework
- **shadcn/ui**: Pre-built accessible components
- **Radix UI**: Underlying primitive components
- **Tailwind CSS**: Utility-first styling
- **class-variance-authority**: Component variant management

### Pages
- **Dashboard** (`/`) - Aggregate KPIs + per-company/store breakdown cards
- **Products** (`/products`) - Product CRUD with barcode, 4-channel stock distribution
- **Orders** (`/orders`) - Order management with Ozon/WB/Yandex/Manual sources
- **Customers** (`/customers`) - CRM data
- **Intake** (`/intake`) - Smart barcode scanning intake with batch receipt
- **Reports** (`/reports`) - P&L with expenses, expense management, audit log
- **Settings** (`/settings`) - Tax and marketplace configuration

### Planned Integrations (Not Yet Implemented)
- **Ozon API**: Marketplace sync for inventory and orders
- **Wildberries API**: Marketplace sync for inventory and orders
- **Yandex Market API**: Marketplace sync for inventory and orders
- Settings schema includes fields for API keys and client IDs