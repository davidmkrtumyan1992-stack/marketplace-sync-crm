import { pgTable, text, serial, integer, boolean, timestamp, jsonb, decimal, uniqueIndex } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./models/auth";

export * from "./models/auth";

// === NEW TABLES: Multi-Company Architecture ===

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  inn: text("inn"),
  organizationId: text("organization_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const stores = pgTable("stores", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  marketplace: text("marketplace").notNull(),
  name: text("name").notNull(),
  apiKey: text("api_key"),
  clientId: text("client_id"),
  warehouseId: text("warehouse_id"),
  isActive: boolean("is_active").default(true),
  lastSync: timestamp("last_sync"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userRoles = pgTable("user_roles", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  organizationId: text("organization_id").notNull(),
  role: text("role").notNull().default("owner"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id),
  organizationId: text("organization_id").notNull(),
  category: text("category").notNull(),
  type: text("type").notNull(),
  description: text("description"),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  date: timestamp("date").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// === UPDATED TABLE DEFINITIONS ===

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sku: text("sku").notNull(),
  barcode: text("barcode"),
  description: text("description"),
  category: text("category"),
  purchasePrice: decimal("purchase_price", { precision: 10, scale: 2 }).notNull().default("0"),
  sellingPrice: decimal("selling_price", { precision: 10, scale: 2 }).notNull().default("0"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull().default("0"),
  weight: decimal("weight", { precision: 10, scale: 3 }),
  dimensionLength: decimal("dimension_length", { precision: 10, scale: 2 }),
  dimensionWidth: decimal("dimension_width", { precision: 10, scale: 2 }),
  dimensionHeight: decimal("dimension_height", { precision: 10, scale: 2 }),
  centralStock: integer("central_stock").notNull().default(0),
  availableQuantity: integer("available_quantity").notNull().default(0),
  reservedQuantity: integer("reserved_quantity").notNull().default(0),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  stockLocal: integer("stock_local").notNull().default(0),
  stockOzon: integer("stock_ozon").notNull().default(0),
  stockWb: integer("stock_wb").notNull().default(0),
  stockYandex: integer("stock_yandex").notNull().default(0),
  logisticsCost: decimal("logistics_cost", { precision: 10, scale: 2 }).default("0"),
  marketplaceCommission: decimal("marketplace_commission", { precision: 5, scale: 2 }).default("0"),
  marketplaceCommissionFbs: decimal("marketplace_commission_fbs", { precision: 5, scale: 2 }).default("0"),
  ozonId: text("ozon_id"),
  wbId: text("wb_id"),
  yandexId: text("yandex_id"),
  imageUrl: text("image_url"),
  brand: text("brand"),
  safetyStock: integer("safety_stock").notNull().default(0),
  companyId: integer("company_id").references(() => companies.id),
  organizationId: text("organization_id").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  notes: text("notes"),
  companyId: integer("company_id").references(() => companies.id),
  organizationId: text("organization_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull(),
  customerId: integer("customer_id").references(() => customers.id),
  status: text("status").notNull().default("pending"),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  source: text("source").notNull().default("manual"),
  externalId: text("external_id"),
  postingNumber: text("posting_number"),
  ozonStatus: text("ozon_status"),
  yandexStatus: text("yandex_status"),
  ymCampaignId: text("ym_campaign_id"),
  ymShipmentId: text("ym_shipment_id"),
  wbOrderId: text("wb_order_id"),
  wbStatus: text("wb_status"),
  wbSupplyId: text("wb_supply_id"),
  wbRid: text("wb_rid"),
  fulfillmentType: text("fulfillment_type"),
  companyId: integer("company_id").references(() => companies.id),
  storeId: integer("store_id").references(() => stores.id, { onDelete: "cascade" }),
  sourceStoreName: text("source_store_name"),
  organizationId: text("organization_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  uniqPostingStore: uniqueIndex("orders_posting_store_unique")
    .on(table.postingNumber, table.storeId)
    .where(sql`posting_number IS NOT NULL`),
}));

export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => products.id),
  sku: text("sku"),
  productName: text("product_name"),
  quantity: integer("quantity").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  originalPrice: decimal("original_price", { precision: 10, scale: 2 }),
  salePrice: decimal("sale_price", { precision: 10, scale: 2 }),
  purchasePrice: decimal("purchase_price", { precision: 10, scale: 2 }),
});

export const productStoreExclusions = pgTable("product_store_exclusions", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => products.id),
  storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const marketplaceSettings = pgTable("marketplace_settings", {
  id: serial("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  companyId: integer("company_id").references(() => companies.id),
  storeId: integer("store_id").references(() => stores.id, { onDelete: "cascade" }),
  marketplace: text("marketplace").notNull(),
  storeName: text("store_name"),
  apiKey: text("api_key").notNull(),
  clientId: text("client_id"),
  warehouseId: text("warehouse_id"),
  isActive: boolean("is_active").default(true),
  lastSync: timestamp("last_sync"),
});

export const taxSettings = pgTable("tax_settings", {
  id: serial("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  companyId: integer("company_id").references(() => companies.id),
  taxSystem: text("tax_system").notNull().default("usn_6"),
  taxRate: decimal("tax_rate", { precision: 5, scale: 2 }).default("7"),
  defaultLogisticsCost: decimal("default_logistics_cost", { precision: 10, scale: 2 }).default("0"),
  defaultMarketplaceCommission: decimal("default_marketplace_commission", { precision: 5, scale: 2 }).default("15"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  companyId: integer("company_id").references(() => companies.id),
  userId: text("user_id").notNull(),
  userName: text("user_name"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  details: text("details"),
  delta: integer("delta"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const stockInflow = pgTable("stock_inflow", {
  id: serial("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  companyId: integer("company_id").references(() => companies.id),
  productId: integer("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(),
  toLocal: integer("to_local").notNull().default(0),
  toOzon: integer("to_ozon").notNull().default(0),
  toWb: integer("to_wb").notNull().default(0),
  toYandex: integer("to_yandex").notNull().default(0),
  purchasePrice: decimal("purchase_price", { precision: 10, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const stockWriteoff = pgTable("stock_writeoff", {
  id: serial("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull(),
  reason: text("reason").notNull(),
  notes: text("notes"),
  userId: text("user_id"),
  userName: text("user_name"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type StockWriteoff = typeof stockWriteoff.$inferSelect;
export type InsertStockWriteoff = typeof stockWriteoff.$inferInsert;

export const webhookLogs = pgTable("webhook_logs", {
  id: serial("id").primaryKey(),
  organizationId: text("organization_id"),
  source: text("source").notNull(),
  eventType: text("event_type"),
  payload: text("payload"),
  status: text("status").notNull().default("received"),
  errorMessage: text("error_message"),
  orderId: integer("order_id").references(() => orders.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const syncHistory = pgTable("sync_history", {
  id: serial("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  storeId: integer("store_id").references(() => stores.id, { onDelete: "cascade" }),
  companyId: integer("company_id").references(() => companies.id),
  action: text("action").notNull(),
  status: text("status").notNull().default("success"),
  details: text("details"),
  itemsCount: integer("items_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const stockSyncLog = pgTable("stock_sync_log", {
  id: serial("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  orderId: integer("order_id").references(() => orders.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => products.id),
  productName: text("product_name"),
  sku: text("sku"),
  sourceStoreId: integer("source_store_id").references(() => stores.id, { onDelete: "cascade" }),
  sourceStoreName: text("source_store_name"),
  action: text("action").notNull(),
  previousStock: integer("previous_stock").notNull().default(0),
  newStock: integer("new_stock").notNull().default(0),
  quantityChanged: integer("quantity_changed").notNull().default(0),
  safetyStockTriggered: boolean("safety_stock_triggered").default(false),
  syncResults: jsonb("sync_results"),
  status: text("status").notNull().default("success"),
  details: text("details"),
  direction: text("direction").default("outbound"),
  marketplace: text("marketplace"),
  requestBody: text("request_body"),
  responseBody: text("response_body"),
  durationMs: integer("duration_ms"),
  retryCount: integer("retry_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const inventorySyncSettings = pgTable("inventory_sync_settings", {
  id: serial("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  defaultSafetyStock: integer("default_safety_stock").notNull().default(2),
  syncEnabled: boolean("sync_enabled").default(true),
  demoMode: boolean("demo_mode").default(false),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const productMarketplaceLinks = pgTable("product_marketplace_links", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  marketplaceProductId: text("marketplace_product_id"),
  externalSku: text("external_sku"),
  matchType: text("match_type").notNull().default("manual"),
  confidenceScore: decimal("confidence_score", { precision: 3, scale: 2 }).default("1.0"),
  linkStatus: text("link_status").notNull().default("active"),
  isActive: boolean("is_active").default(true),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncStatus: text("last_sync_status"),
  lastSyncError: text("last_sync_error"),
  organizationId: text("organization_id").notNull(),
}, (table) => ({
  productStoreUnique: uniqueIndex("pml_product_store_idx").on(table.productId, table.storeId),
}));

export const stockEvents = pgTable("stock_events", {
  id: serial("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  productId: integer("product_id").references(() => products.id),
  marketplace: text("marketplace").notNull(),
  storeId: integer("store_id").references(() => stores.id),
  eventType: text("event_type").notNull(),
  quantityDelta: integer("quantity_delta").notNull(),
  externalEventId: text("external_event_id"),
  payload: jsonb("payload"),
  status: text("status").notNull().default("pending"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
  processedAt: timestamp("processed_at"),
}, (table) => ({
  externalEventUnique: uniqueIndex("stock_events_external_unique")
    .on(table.marketplace, table.externalEventId)
    .where(sql`external_event_id IS NOT NULL`),
}));

// === RELATIONS ===

export const companiesRelations = relations(companies, ({ many }) => ({
  stores: many(stores),
  products: many(products),
  orders: many(orders),
  expenses: many(expenses),
}));

export const storesRelations = relations(stores, ({ one, many }) => ({
  company: one(companies, { fields: [stores.companyId], references: [companies.id] }),
  orders: many(orders),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  company: one(companies, { fields: [products.companyId], references: [companies.id] }),
  orderItems: many(orderItems),
  stockInflows: many(stockInflow),
  storeExclusions: many(productStoreExclusions),
}));

export const productStoreExclusionsRelations = relations(productStoreExclusions, ({ one }) => ({
  product: one(products, { fields: [productStoreExclusions.productId], references: [products.id] }),
  store: one(stores, { fields: [productStoreExclusions.storeId], references: [stores.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  company: one(companies, { fields: [orders.companyId], references: [companies.id] }),
  store: one(stores, { fields: [orders.storeId], references: [stores.id] }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  company: one(companies, { fields: [customers.companyId], references: [companies.id] }),
  orders: many(orders),
}));

export const stockInflowRelations = relations(stockInflow, ({ one }) => ({
  product: one(products, { fields: [stockInflow.productId], references: [products.id] }),
  company: one(companies, { fields: [stockInflow.companyId], references: [companies.id] }),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  company: one(companies, { fields: [expenses.companyId], references: [companies.id] }),
}));

// === ZOD SCHEMAS ===

export const insertCompanySchema = createInsertSchema(companies).omit({ id: true, createdAt: true });
export const insertStoreSchema = createInsertSchema(stores).omit({ id: true, createdAt: true, lastSync: true });
export const insertUserRoleSchema = createInsertSchema(userRoles).omit({ id: true, createdAt: true });
export const insertExpenseSchema = createInsertSchema(expenses).omit({ id: true, createdAt: true });
export const insertProductSchema = createInsertSchema(products).omit({ id: true, updatedAt: true });
export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true, createdAt: true });
export const insertOrderSchema = createInsertSchema(orders).omit({ id: true, createdAt: true });
export const insertOrderItemSchema = createInsertSchema(orderItems).omit({ id: true });
export const insertMarketplaceSettingsSchema = createInsertSchema(marketplaceSettings).omit({ id: true, lastSync: true });
export const insertTaxSettingsSchema = createInsertSchema(taxSettings).omit({ id: true, updatedAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLog).omit({ id: true, createdAt: true });
export const insertStockInflowSchema = createInsertSchema(stockInflow).omit({ id: true, createdAt: true });
export const insertSyncHistorySchema = createInsertSchema(syncHistory).omit({ id: true, createdAt: true });
export const insertStockSyncLogSchema = createInsertSchema(stockSyncLog).omit({ id: true, createdAt: true });
export const insertWebhookLogSchema = createInsertSchema(webhookLogs).omit({ id: true, createdAt: true });
export const insertInventorySyncSettingsSchema = createInsertSchema(inventorySyncSettings).omit({ id: true, updatedAt: true });
export const insertProductStoreExclusionSchema = createInsertSchema(productStoreExclusions).omit({ id: true, createdAt: true });
export const insertProductMarketplaceLinkSchema = createInsertSchema(productMarketplaceLinks).omit({ id: true });
export const insertStockEventSchema = createInsertSchema(stockEvents).omit({ id: true, createdAt: true, processedAt: true });

// === TYPES ===

export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Store = typeof stores.$inferSelect;
export type InsertStore = z.infer<typeof insertStoreSchema>;
export type UserRole = typeof userRoles.$inferSelect;
export type InsertUserRole = z.infer<typeof insertUserRoleSchema>;
export type Expense = typeof expenses.$inferSelect;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type MarketplaceSetting = typeof marketplaceSettings.$inferSelect;
export type InsertMarketplaceSetting = z.infer<typeof insertMarketplaceSettingsSchema>;
export type TaxSetting = typeof taxSettings.$inferSelect;
export type InsertTaxSetting = z.infer<typeof insertTaxSettingsSchema>;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type StockInflow = typeof stockInflow.$inferSelect;
export type InsertStockInflow = z.infer<typeof insertStockInflowSchema>;
export type SyncHistoryEntry = typeof syncHistory.$inferSelect;
export type InsertSyncHistory = z.infer<typeof insertSyncHistorySchema>;
export type StockSyncLogEntry = typeof stockSyncLog.$inferSelect;
export type InsertStockSyncLog = z.infer<typeof insertStockSyncLogSchema>;
export type InventorySyncSetting = typeof inventorySyncSettings.$inferSelect;
export type InsertInventorySyncSettings = z.infer<typeof insertInventorySyncSettingsSchema>;
export type ProductStoreExclusion = typeof productStoreExclusions.$inferSelect;
export type InsertProductStoreExclusion = z.infer<typeof insertProductStoreExclusionSchema>;
export type WebhookLog = typeof webhookLogs.$inferSelect;
export type InsertWebhookLog = z.infer<typeof insertWebhookLogSchema>;
export type ProductMarketplaceLink = typeof productMarketplaceLinks.$inferSelect;
export type InsertProductMarketplaceLink = z.infer<typeof insertProductMarketplaceLinkSchema>;
export type StockEvent = typeof stockEvents.$inferSelect;
export type InsertStockEvent = z.infer<typeof insertStockEventSchema>;

// Product store status for SyncPriceDialog
export type ProductStoreStatus = {
  storeId: number;
  storeName: string;
  marketplace: string;
  isConnected: boolean;
  hasProduct: boolean;
  marketplaceProductId: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
};

// API Requests
export type CreateProductRequest = InsertProduct;
export type UpdateProductRequest = Partial<InsertProduct>;
export type CreateCustomerRequest = InsertCustomer;
export type UpdateCustomerRequest = Partial<InsertCustomer>;
export type CreateOrderRequest = InsertOrder & { items: { productId: number; quantity: number; price: number; originalPrice?: number; salePrice?: number }[] };
export type UpdateOrderRequest = Partial<InsertOrder>;

// Role type
export type RoleName = "owner" | "accountant" | "administrator";

// ABC Analysis
export type ABCProduct = Product & {
  abcCategory: "A" | "B" | "C";
  revenue: number;
  revenueShare: number;
  cumulativeShare: number;
};

// Low Stock Alert
export type LowStockProduct = Product & {
  companyName: string;
};

// Sales Data Point
export type SalesDataPoint = {
  date: string;
  revenue: number;
  grossRevenue: number;
  cancelledRevenue: number;
  companyId: number | null;
  companyName: string;
};

export type MarketplaceBreakdown = {
  ozon: number;
  yandex: number;
  wildberries: number;
  other: number;
};

export type SalesResponse = {
  data: SalesDataPoint[];
  totalOrders: number;
  totalRevenue: number;
  marketplaceBreakdown: MarketplaceBreakdown;
  grossRevenue: number;
  netRevenue: number;
  cancelledRevenue: number;
  cancelledCount: number;
  cancellationRate: number;
  grossMarketplaceBreakdown: MarketplaceBreakdown;
};

// Sync Status
export type SyncStatusSummary = {
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  totalSyncsToday: number;
  successCount: number;
  failCount: number;
  safetyStockTriggeredCount: number;
  recentLogs: StockSyncLogEntry[];
};

// Composite Response
export type OrderWithDetails = Order & {
  customer: Customer | null;
  items: (OrderItem & { product: Product | null })[];
};

export type StoreWithStats = Store & {
  productCount: number;
  pendingOrders: number;
  activeOrdersCount: number;
  activeOrdersRevenue: number;
};

export type CompanyWithStores = Company & {
  stores: StoreWithStats[];
  totalStock: number;
  totalValue: number;
};

// KPI Types
export type DashboardKPI = {
  totalStock: number;
  capitalization: number;
  expectedRevenue: number;
  realProfit: number;
  stockDistribution: {
    local: number;
    ozon: number;
    wb: number;
    yandex: number;
  };
  companies: CompanyWithStores[];
};

export const wbSupplies = pgTable("wb_supplies", {
  id: serial("id").primaryKey(),
  supplyId: text("supply_id").notNull(),
  storeId: integer("store_id").references(() => stores.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull(),
  name: text("name"),
  status: text("status").default("open"),
  createdAt: timestamp("created_at").defaultNow(),
  closedAt: timestamp("closed_at"),
  wbSyncedAsClosed: boolean("wb_synced_as_closed").default(false),
});
