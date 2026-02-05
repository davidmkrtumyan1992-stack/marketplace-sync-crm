# CloudERP - Inventory & Sales Management System

## Overview

CloudERP is a production-ready cloud ERP/CRM system designed for e-commerce businesses selling on Russian marketplaces (Ozon and Wildberries). The system serves as a "Single Source of Truth" for inventory management, order processing, and financial analytics across multiple sales channels.

Key capabilities:
- Multi-channel inventory tracking with "split-stock" distribution across local warehouse, Ozon, and Wildberries
- Russian tax calculation engine supporting УСН (simplified taxation) regimes
- Dashboard with KPI cards showing capitalization, expected revenue, and profit forecasts
- CRM for customer management
- Marketplace API integration placeholders for Ozon and Wildberries
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
  - `products` - Inventory with multi-location stock tracking (local, Ozon, WB)
  - `orders` and `orderItems` - Order management with marketplace source tracking
  - `customers` - CRM data
  - `stockInflow` - Inventory receipt records with distribution splits
  - `taxSettings` - Russian tax configuration (УСН 6% or 15%)
  - `marketplaceSettings` - API credentials for Ozon/Wildberries
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

3. **Split-Stock Model**: Products track inventory separately for each location (`stockLocal`, `stockOzon`, `stockWb`) with `stockQuantity` as the computed total

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

### Planned Integrations (Not Yet Implemented)
- **Ozon API**: Marketplace sync for inventory and orders
- **Wildberries API**: Marketplace sync for inventory and orders
- Settings schema includes fields for API keys and client IDs