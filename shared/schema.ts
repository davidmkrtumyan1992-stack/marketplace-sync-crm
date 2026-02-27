import { pgTable, text, serial, integer, boolean, timestamp, jsonb, decimal, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
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
  stockQuantity: integer("stock_quantity").notNull().default(0),
  stockLocal: integer("stock_local").notNull().default(0),
  stockOzon: integer("stock_ozon").notNull().default(0),
  stockWb: integer("stock_wb").notNull().default(0),
  stockYandex: integer("stock_yandex").notNull().default(0),
  logisticsCost: decimal("logistics_cost", { precision: 10, scale: 2 }).default("0"),
  marketplaceCommission: decimal("marketplace_commission", { precision: 5, scale: 2 }).default("0"),
  ozonId: text("ozon_id"),
  wbId: text("wb_id"),
  yandexId: text("yandex_id"),
  imageUrl: text("image_url"),
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
  fulfillmentType: text("fulfillment_type"),
  companyId: integer("company_id").references(() => companies.id),
  storeId: integer("store_id").references(() => stores.id),
  organizationId: text("organization_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id),
  productId: integer("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  originalPrice: decimal("original_price", { precision: 10, scale: 2 }),
  salePrice: decimal("sale_price", { precision: 10, scale: 2 }),
});

export const productStoreExclusions = pgTable("product_store_exclusions", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => products.id),
  storeId: integer("store_id").notNull().references(() => stores.id),
  organizationId: text("organization_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const marketplaceSettings = pgTable("marketplace_settings", {
  id: serial("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  companyId: integer("company_id").references(() => companies.id),
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

export const webhookLogs = pgTable("webhook_logs", {
  id: serial("id").primaryKey(),
  organizationId: text("organization_id"),
  source: text("source").notNull(),
  eventType: text("event_type"),
  payload: text("payload"),
  status: text("status").notNull().default("received"),
  errorMessage: text("error_message"),
  orderId: integer("order_id").references(() => orders.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const syncHistory = pgTable("sync_history", {
  id: serial("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  storeId: integer("store_id").references(() => stores.id),
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
  orderId: integer("order_id").references(() => orders.id),
  productId: integer("product_id").references(() => products.id),
  productName: text("product_name"),
  sku: text("sku"),
  sourceStoreId: integer("source_store_id").references(() => stores.id),
  sourceStoreName: text("source_store_name"),
  action: text("action").notNull(),
  previousStock: integer("previous_stock").notNull().default(0),
  newStock: integer("new_stock").notNull().default(0),
  quantityChanged: integer("quantity_changed").notNull().default(0),
  safetyStockTriggered: boolean("safety_stock_triggered").default(false),
  syncResults: jsonb("sync_results"),
  status: text("status").notNull().default("success"),
  details: text("details"),
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
  companyId: number | null;
  companyName: string;
};

export type SalesResponse = {
  data: SalesDataPoint[];
  totalOrders: number;
  totalRevenue: number;
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
export type TodayKPI = {
  ordersCount: number;
  revenue: number;
  itemsCount: number;
};

export type DashboardKPI = {
  totalStock: number;
  capitalization: number;
  expectedRevenue: number;
  expectedProfit: number;
  today: TodayKPI;
  stockDistribution: {
    local: number;
    ozon: number;
    wb: number;
    yandex: number;
  };
  companies: CompanyWithStores[];
};
