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
  price: decimal("price", { precision: 10, scale: 2 }).notNull().default("0"),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  ozonId: text("ozon_id"), // ID in Ozon system
  wbId: text("wb_id"), // ID in Wildberries system
  imageUrl: text("image_url"),
  organizationId: text("organization_id").notNull(), // Link to owner/organization (using auth user id for now)
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
  status: text("status").notNull().default("pending"), // pending, processing, shipped, completed, cancelled
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  source: text("source").notNull().default("manual"), // manual, ozon, wildberries
  externalId: text("external_id"), // ID in marketplace
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
  marketplace: text("marketplace").notNull(), // ozon, wildberries
  apiKey: text("api_key").notNull(),
  clientId: text("client_id"), // For Ozon
  isActive: boolean("is_active").default(true),
  lastSync: timestamp("last_sync"),
});

// === RELATIONS ===
export const productsRelations = relations(products, ({ many }) => ({
  orderItems: many(orderItems),
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

// === ZOD SCHEMAS ===
export const insertProductSchema = createInsertSchema(products).omit({ id: true, updatedAt: true });
export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true, createdAt: true });
export const insertOrderSchema = createInsertSchema(orders).omit({ id: true, createdAt: true });
export const insertOrderItemSchema = createInsertSchema(orderItems).omit({ id: true });
export const insertMarketplaceSettingsSchema = createInsertSchema(marketplaceSettings).omit({ id: true, lastSync: true });

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
