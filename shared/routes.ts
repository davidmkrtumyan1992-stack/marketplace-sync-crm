import { z } from 'zod';
import { 
  insertProductSchema, 
  insertCustomerSchema, 
  insertOrderSchema, 
  insertMarketplaceSettingsSchema,
  insertTaxSettingsSchema,
  insertStockInflowSchema,
  insertCompanySchema,
  insertStoreSchema,
  insertExpenseSchema,
  insertUserRoleSchema,
  insertInventorySyncSettingsSchema,
  insertProductStoreExclusionSchema,
} from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  companies: {
    list: { method: 'GET' as const, path: '/api/companies' },
    create: { method: 'POST' as const, path: '/api/companies', input: insertCompanySchema },
    update: { method: 'PUT' as const, path: '/api/companies/:id', input: insertCompanySchema.partial() },
    delete: { method: 'DELETE' as const, path: '/api/companies/:id' },
  },
  stores: {
    list: { method: 'GET' as const, path: '/api/stores' },
    byCompany: { method: 'GET' as const, path: '/api/companies/:companyId/stores' },
    create: { method: 'POST' as const, path: '/api/stores', input: insertStoreSchema },
    update: { method: 'PUT' as const, path: '/api/stores/:id', input: insertStoreSchema.partial() },
    delete: { method: 'DELETE' as const, path: '/api/stores/:id' },
  },
  userRoles: {
    get: { method: 'GET' as const, path: '/api/user-role' },
    set: { method: 'POST' as const, path: '/api/user-role', input: insertUserRoleSchema },
  },
  expenses: {
    list: { method: 'GET' as const, path: '/api/expenses' },
    create: { method: 'POST' as const, path: '/api/expenses', input: insertExpenseSchema },
    delete: { method: 'DELETE' as const, path: '/api/expenses/:id' },
  },
  products: {
    list: { method: 'GET' as const, path: '/api/products' },
    get: { method: 'GET' as const, path: '/api/products/:id' },
    create: { method: 'POST' as const, path: '/api/products', input: insertProductSchema },
    update: { method: 'PUT' as const, path: '/api/products/:id', input: insertProductSchema.partial() },
    delete: { method: 'DELETE' as const, path: '/api/products/:id' },
    sync: { method: 'POST' as const, path: '/api/products/:id/sync' },
    lookupBarcode: { method: 'GET' as const, path: '/api/products/barcode/:barcode' },
  },
  customers: {
    list: { method: 'GET' as const, path: '/api/customers' },
    get: { method: 'GET' as const, path: '/api/customers/:id' },
    create: { method: 'POST' as const, path: '/api/customers', input: insertCustomerSchema },
    update: { method: 'PUT' as const, path: '/api/customers/:id', input: insertCustomerSchema.partial() },
  },
  orders: {
    list: { method: 'GET' as const, path: '/api/orders' },
    get: { method: 'GET' as const, path: '/api/orders/:id' },
    create: {
      method: 'POST' as const,
      path: '/api/orders',
      input: z.object({
        ...insertOrderSchema.shape,
        items: z.array(z.object({
          productId: z.number(),
          quantity: z.number(),
          price: z.number(),
        }))
      }),
    },
    updateStatus: {
      method: 'PATCH' as const,
      path: '/api/orders/:id/status',
      input: z.object({ status: z.string() }),
    },
    createDirect: {
      method: 'POST' as const,
      path: '/api/orders/direct',
      input: z.object({
        customerId: z.number().nullable().optional(),
        newCustomer: z.object({
          name: z.string(),
          phone: z.string().optional(),
          notes: z.string().optional(),
        }).optional(),
        companyId: z.number().optional(),
        items: z.array(z.object({
          productId: z.number(),
          quantity: z.number().min(1),
          originalPrice: z.number(),
          salePrice: z.number(),
        })),
        notes: z.string().optional(),
      }),
    },
  },
  marketplace: {
    list: { method: 'GET' as const, path: '/api/marketplace/settings' },
    save: { method: 'POST' as const, path: '/api/marketplace/settings', input: insertMarketplaceSettingsSchema },
    syncAll: { method: 'POST' as const, path: '/api/marketplace/sync' },
  },
  taxSettings: {
    get: { method: 'GET' as const, path: '/api/settings/tax' },
    save: { method: 'POST' as const, path: '/api/settings/tax', input: insertTaxSettingsSchema },
  },
  kpi: {
    get: { method: 'GET' as const, path: '/api/kpi' },
  },
  auditLog: {
    list: { method: 'GET' as const, path: '/api/audit-log' },
  },
  stockInflow: {
    list: { method: 'GET' as const, path: '/api/stock-inflow' },
    create: { method: 'POST' as const, path: '/api/stock-inflow', input: insertStockInflowSchema },
  },
  syncHistory: {
    list: { method: 'GET' as const, path: '/api/sync-history' },
  },
  analytics: {
    abc: { method: 'GET' as const, path: '/api/analytics/abc' },
    sales: { method: 'GET' as const, path: '/api/analytics/sales' },
    lowStock: { method: 'GET' as const, path: '/api/analytics/low-stock' },
  },
  storeExclusions: {
    list: { method: 'GET' as const, path: '/api/products/:productId/store-exclusions' },
    set: { 
      method: 'POST' as const, 
      path: '/api/products/:productId/store-exclusions',
      input: z.object({
        excludedStoreIds: z.array(z.number()),
      }),
    },
  },
  inventorySync: {
    status: { method: 'GET' as const, path: '/api/inventory-sync/status' },
    logs: { method: 'GET' as const, path: '/api/inventory-sync/logs' },
    settings: { method: 'GET' as const, path: '/api/inventory-sync/settings' },
    saveSettings: { method: 'POST' as const, path: '/api/inventory-sync/settings', input: insertInventorySyncSettingsSchema },
    updateProductSafetyStock: { 
      method: 'PATCH' as const, 
      path: '/api/inventory-sync/product/:id/safety-stock',
      input: z.object({ safetyStock: z.number().min(0) })
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
