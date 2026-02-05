import { z } from 'zod';
import { 
  insertProductSchema, 
  insertCustomerSchema, 
  insertOrderSchema, 
  insertMarketplaceSettingsSchema,
  insertTaxSettingsSchema,
  insertStockInflowSchema,
  products,
  customers,
  orders,
  marketplaceSettings,
  taxSettings,
  auditLog,
  stockInflow
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
  products: {
    list: {
      method: 'GET' as const,
      path: '/api/products',
      responses: {
        200: z.array(z.custom<typeof products.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/products/:id',
      responses: {
        200: z.custom<typeof products.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/products',
      input: insertProductSchema,
      responses: {
        201: z.custom<typeof products.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/products/:id',
      input: insertProductSchema.partial(),
      responses: {
        200: z.custom<typeof products.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/products/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
    sync: {
      method: 'POST' as const,
      path: '/api/products/:id/sync',
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        404: errorSchemas.notFound,
      },
    }
  },
  customers: {
    list: {
      method: 'GET' as const,
      path: '/api/customers',
      responses: {
        200: z.array(z.custom<typeof customers.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/customers/:id',
      responses: {
        200: z.custom<typeof customers.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/customers',
      input: insertCustomerSchema,
      responses: {
        201: z.custom<typeof customers.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/customers/:id',
      input: insertCustomerSchema.partial(),
      responses: {
        200: z.custom<typeof customers.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
  orders: {
    list: {
      method: 'GET' as const,
      path: '/api/orders',
      responses: {
        200: z.array(z.custom<any>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/orders/:id',
      responses: {
        200: z.custom<any>(),
        404: errorSchemas.notFound,
      },
    },
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
      responses: {
        201: z.custom<typeof orders.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    updateStatus: {
      method: 'PATCH' as const,
      path: '/api/orders/:id/status',
      input: z.object({ status: z.string() }),
      responses: {
        200: z.custom<typeof orders.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
  marketplace: {
    list: {
      method: 'GET' as const,
      path: '/api/marketplace/settings',
      responses: {
        200: z.array(z.custom<typeof marketplaceSettings.$inferSelect>()),
      },
    },
    save: {
      method: 'POST' as const,
      path: '/api/marketplace/settings',
      input: insertMarketplaceSettingsSchema,
      responses: {
        201: z.custom<typeof marketplaceSettings.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    syncAll: {
      method: 'POST' as const,
      path: '/api/marketplace/sync',
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
      },
    }
  },
  taxSettings: {
    get: {
      method: 'GET' as const,
      path: '/api/settings/tax',
      responses: {
        200: z.custom<typeof taxSettings.$inferSelect>().nullable(),
      },
    },
    save: {
      method: 'POST' as const,
      path: '/api/settings/tax',
      input: insertTaxSettingsSchema,
      responses: {
        201: z.custom<typeof taxSettings.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
  },
  kpi: {
    get: {
      method: 'GET' as const,
      path: '/api/kpi',
      responses: {
        200: z.object({
          totalStock: z.number(),
          capitalization: z.number(),
          expectedRevenue: z.number(),
          expectedProfit: z.number(),
          stockDistribution: z.object({
            local: z.number(),
            ozon: z.number(),
            wb: z.number(),
          }),
        }),
      },
    },
  },
  auditLog: {
    list: {
      method: 'GET' as const,
      path: '/api/audit-log',
      responses: {
        200: z.array(z.custom<typeof auditLog.$inferSelect>()),
      },
    },
  },
  stockInflow: {
    list: {
      method: 'GET' as const,
      path: '/api/stock-inflow',
      responses: {
        200: z.array(z.custom<typeof stockInflow.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/stock-inflow',
      input: insertStockInflowSchema,
      responses: {
        201: z.custom<typeof stockInflow.$inferSelect>(),
        400: errorSchemas.validation,
      },
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
