import { pgTable, text, serial, integer, boolean, timestamp, jsonb, decimal } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./models/auth";

// Export Auth Models
export * from "./models/auth";

// === TABLE DEFINITIONS ===

// Products / Inventory
export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sku: text("sku").notNull().unique(),
  description: text("description"),
  category: text("category"),
  purchasePrice: decimal("purchase_price", { precision: 10, scale: 2 }).notNull().default("0"),
  sellingPrice: decimal("selling_price", { precision: 10, scale: 2 }).notNull().default("0"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull().default("0"), // Legacy: same as sellingPrice
  weight: decimal("weight", { precision: 10, scale: 3 }), // kg
  dimensionLength: decimal("dimension_length", { precision: 10, scale: 2 }), // cm
  dimensionWidth: decimal("dimension_width", { precision: 10, scale: 2 }), // cm
  dimensionHeight: decimal("dimension_height", { precision: 10, scale: 2 }), // cm
  stockQuantity: integer("stock_quantity").notNull().default(0), // Total stock
  stockLocal: integer("stock_local").notNull().default(0), // On local warehouse
  stockOzon: integer("stock_ozon").notNull().default(0), // On Ozon warehouse
  stockWb: integer("stock_wb").notNull().default(0), // On Wildberries warehouse
  logisticsCost: decimal("logistics_cost", { precision: 10, scale: 2 }).default("0"), // Per item
  marketplaceCommission: decimal("marketplace_commission", { precision: 5, scale: 2 }).default("0"), // Percentage
  ozonId: text("ozon_id"),
  wbId: text("wb_id"),
  imageUrl: text("image_url"),
  organizationId: text("organization_id").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Customers (CRM)
export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  notes: text("notes"),
  organizationId: text("organization_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Orders
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull(),
  customerId: integer("customer_id").references(() => customers.id),
  status: text("status").notNull().default("pending"),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  source: text("source").notNull().default("manual"),
  externalId: text("external_id"),
  organizationId: text("organization_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Order Items
export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id),
  productId: integer("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
});

// Marketplace Settings
export const marketplaceSettings = pgTable("marketplace_settings", {
  id: serial("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  marketplace: text("marketplace").notNull(),
  apiKey: text("api_key").notNull(),
  clientId: text("client_id"),
  warehouseId: text("warehouse_id"), // For Wildberries
  isActive: boolean("is_active").default(true),
  lastSync: timestamp("last_sync"),
});

// Tax Settings
export const taxSettings = pgTable("tax_settings", {
  id: serial("id").primaryKey(),
  organizationId: text("organization_id").notNull().unique(),
  taxSystem: text("tax_system").notNull().default("usn_6"), // usn_6 = УСН 6%, usn_15 = УСН 15%
  defaultLogisticsCost: decimal("default_logistics_cost", { precision: 10, scale: 2 }).default("0"),
  defaultMarketplaceCommission: decimal("default_marketplace_commission", { precision: 5, scale: 2 }).default("15"), // Percentage
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Audit Log
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  userId: text("user_id").notNull(),
  userName: text("user_name"),
  action: text("action").notNull(), // stock_adjustment, product_create, product_update, order_create, etc.
  entityType: text("entity_type").notNull(), // product, order, customer
  entityId: integer("entity_id"),
  details: text("details"), // JSON stringified details
  delta: integer("delta"), // For stock changes
  createdAt: timestamp("created_at").defaultNow(),
});

// Stock Inflow (Оприходование)
export const stockInflow = pgTable("stock_inflow", {
  id: serial("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  productId: integer("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(),
  toLocal: integer("to_local").notNull().default(0),
  toOzon: integer("to_ozon").notNull().default(0),
  toWb: integer("to_wb").notNull().default(0),
  purchasePrice: decimal("purchase_price", { precision: 10, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === RELATIONS ===
export const productsRelations = relations(products, ({ many }) => ({
  orderItems: many(orderItems),
  stockInflows: many(stockInflow),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
}));

export const customersRelations = relations(customers, ({ many }) => ({
  orders: many(orders),
}));

export const stockInflowRelations = relations(stockInflow, ({ one }) => ({
  product: one(products, {
    fields: [stockInflow.productId],
    references: [products.id],
  }),
}));

// === ZOD SCHEMAS ===
export const insertProductSchema = createInsertSchema(products).omit({ id: true, updatedAt: true });
export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true, createdAt: true });
export const insertOrderSchema = createInsertSchema(orders).omit({ id: true, createdAt: true });
export const insertOrderItemSchema = createInsertSchema(orderItems).omit({ id: true });
export const insertMarketplaceSettingsSchema = createInsertSchema(marketplaceSettings).omit({ id: true, lastSync: true });
export const insertTaxSettingsSchema = createInsertSchema(taxSettings).omit({ id: true, updatedAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLog).omit({ id: true, createdAt: true });
export const insertStockInflowSchema = createInsertSchema(stockInflow).omit({ id: true, createdAt: true });

// === TYPES ===
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

// API Requests
export type CreateProductRequest = InsertProduct;
export type UpdateProductRequest = Partial<InsertProduct>;
export type CreateCustomerRequest = InsertCustomer;
export type UpdateCustomerRequest = Partial<InsertCustomer>;
export type CreateOrderRequest = InsertOrder & { items: { productId: number; quantity: number; price: number }[] };
export type UpdateOrderRequest = Partial<InsertOrder>;

// Composite Response
export type OrderWithDetails = Order & {
  customer: Customer | null;
  items: (OrderItem & { product: Product | null })[];
};

// KPI Types
export type DashboardKPI = {
  totalStock: number;
  capitalization: number;
  expectedRevenue: number;
  expectedProfit: number;
  stockDistribution: {
    local: number;
    ozon: number;
    wb: number;
  };
};
