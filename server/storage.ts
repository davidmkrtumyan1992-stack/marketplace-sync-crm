import { 
  companies, stores, userRoles, expenses,
  products, customers, orders, orderItems, marketplaceSettings, taxSettings, auditLog, stockInflow, syncHistory,
  stockSyncLog, inventorySyncSettings, productStoreExclusions, webhookLogs, productMarketplaceLinks,
  type Company, type InsertCompany,
  type Store, type InsertStore,
  type UserRole, type InsertUserRole,
  type Expense, type InsertExpense,
  type Product, type InsertProduct, type UpdateProductRequest,
  type Customer, type InsertCustomer, type UpdateCustomerRequest,
  type Order, type InsertOrder, type OrderItem, type InsertOrderItem, type UpdateOrderRequest, type OrderWithDetails,
  type MarketplaceSetting, type InsertMarketplaceSetting,
  type TaxSetting, type InsertTaxSetting,
  type AuditLogEntry, type InsertAuditLog,
  type StockInflow, type InsertStockInflow,
  type SyncHistoryEntry, type InsertSyncHistory,
  type StockSyncLogEntry, type InsertStockSyncLog,
  type InventorySyncSetting, type InsertInventorySyncSettings,
  type ProductStoreExclusion, type InsertProductStoreExclusion,
  type WebhookLog, type InsertWebhookLog,
  type ProductMarketplaceLink, type InsertProductMarketplaceLink, type ProductStoreStatus,
  type DashboardKPI, type CompanyWithStores, type StoreWithStats,
  type ABCProduct, type LowStockProduct, type SalesDataPoint, type SalesResponse,
  type SyncStatusSummary,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql, inArray, gte } from "drizzle-orm";
import { authStorage } from "./replit_integrations/auth/storage";

export interface IStorage {
  // Companies
  getCompanies(organizationId: string): Promise<Company[]>;
  getCompany(id: number): Promise<Company | undefined>;
  createCompany(company: InsertCompany): Promise<Company>;

  // Stores
  getStore(id: number): Promise<Store | undefined>;
  getStores(companyId: number): Promise<Store[]>;
  getStoresByOrg(organizationId: string): Promise<Store[]>;
  createStore(store: InsertStore): Promise<Store>;
  updateStore(id: number, updates: Partial<InsertStore>): Promise<Store>;
  deleteStore(id: number): Promise<void>;

  // Companies (extended)
  updateCompany(id: number, updates: Partial<InsertCompany>): Promise<Company>;
  deleteCompany(id: number): Promise<void>;

  // User Roles
  getUserRole(userId: string, organizationId: string): Promise<UserRole | undefined>;
  setUserRole(role: InsertUserRole): Promise<UserRole>;

  // Expenses
  getExpenses(organizationId: string, companyId?: number): Promise<Expense[]>;
  getExpense(id: number): Promise<Expense | undefined>;
  createExpense(expense: InsertExpense): Promise<Expense>;
  deleteExpense(id: number): Promise<void>;

  // Products
  getProducts(organizationId: string, companyId?: number): Promise<Product[]>;
  getProduct(id: number): Promise<Product | undefined>;
  getProductByBarcode(barcode: string, organizationId: string): Promise<Product | undefined>;
  getProductBySku(sku: string, companyId: number): Promise<Product | undefined>;
  getProductBySkuAndOrg(sku: string, organizationId: string): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, updates: UpdateProductRequest): Promise<Product>;
  deleteProduct(id: number): Promise<void>;

  // Customers
  getCustomers(organizationId: string): Promise<Customer[]>;
  getCustomer(id: number): Promise<Customer | undefined>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  updateCustomer(id: number, updates: UpdateCustomerRequest): Promise<Customer>;

  // Orders
  getOrders(organizationId: string, companyId?: number): Promise<OrderWithDetails[]>;
  getOrder(id: number): Promise<OrderWithDetails | undefined>;
  getOrdersByCustomerId(customerId: number, organizationId: string): Promise<OrderWithDetails[]>;
  getOrderByPostingNumber(postingNumber: string, organizationId: string, storeId?: number | null): Promise<Order | undefined>;
  createOrder(order: InsertOrder & { createdAt?: Date }, items: { productId?: number | null; sku?: string; productName?: string; quantity: number; price: number; originalPrice?: number; salePrice?: number }[]): Promise<Order>;
  updateOrderStatus(id: number, status: string): Promise<Order>;
  updateOrderOzonStatus(id: number, ozonStatus: string, status?: string, createdAt?: Date): Promise<Order>;
  updateOrderYandexStatus(id: number, yandexStatus: string, status?: string, createdAt?: Date): Promise<Order>;
  getOrderByExternalId(externalId: string, organizationId: string, storeId?: number | null): Promise<Order | undefined>;

  // Webhook Logs
  createWebhookLog(log: InsertWebhookLog): Promise<WebhookLog>;
  getWebhookLogs(organizationId: string, limit?: number): Promise<WebhookLog[]>;

  // Marketplace
  getMarketplaceSettings(organizationId: string): Promise<MarketplaceSetting[]>;
  saveMarketplaceSetting(setting: InsertMarketplaceSetting): Promise<MarketplaceSetting>;
  createMarketplaceSetting(setting: InsertMarketplaceSetting): Promise<MarketplaceSetting>;
  updateMarketplaceSetting(id: number, updates: Partial<InsertMarketplaceSetting>): Promise<MarketplaceSetting>;
  deleteMarketplaceSetting(id: number): Promise<void>;

  // Tax Settings
  getTaxSettings(organizationId: string): Promise<TaxSetting | undefined>;
  saveTaxSettings(settings: InsertTaxSetting): Promise<TaxSetting>;

  // Audit Log
  getAuditLog(organizationId: string): Promise<AuditLogEntry[]>;
  createAuditLog(entry: InsertAuditLog): Promise<AuditLogEntry>;

  // Stock Inflow
  createStockInflow(inflow: InsertStockInflow, userId: string, userName: string): Promise<StockInflow>;
  getStockInflows(organizationId: string): Promise<StockInflow[]>;

  // Dashboard KPI
  getDashboardKPI(organizationId: string): Promise<DashboardKPI>;

  // Sync History
  getSyncHistory(organizationId: string): Promise<SyncHistoryEntry[]>;
  createSyncHistory(entry: InsertSyncHistory): Promise<SyncHistoryEntry>;

  // Analytics
  getABCAnalysis(organizationId: string): Promise<ABCProduct[]>;
  getLowStockProducts(organizationId: string, threshold?: number): Promise<LowStockProduct[]>;
  getSalesData(organizationId: string, options?: { days?: number; from?: string; to?: string; storeId?: number }): Promise<SalesResponse>;
  
  // Stock Sync Log
  getStockSyncLogs(organizationId: string, limit?: number): Promise<StockSyncLogEntry[]>;
  createStockSyncLog(entry: InsertStockSyncLog): Promise<StockSyncLogEntry>;

  // Inventory Sync Settings
  getInventorySyncSettings(organizationId: string): Promise<InventorySyncSetting | undefined>;
  saveInventorySyncSettings(organizationId: string, settings: Partial<InsertInventorySyncSettings>): Promise<InventorySyncSetting>;

  // Store Exclusions
  getProductStoreExclusions(productId: number): Promise<ProductStoreExclusion[]>;
  setProductStoreExclusions(productId: number, storeIds: number[], organizationId: string): Promise<ProductStoreExclusion[]>;

  // Product Marketplace Links
  getProductMarketplaceLinks(productId: number): Promise<ProductMarketplaceLink[]>;
  upsertProductMarketplaceLink(data: InsertProductMarketplaceLink): Promise<ProductMarketplaceLink>;
  updateProductMarketplaceLinkSync(productId: number, storeId: number, status: string, error?: string): Promise<void>;
  getProductStoresWithStatus(productId: number, organizationId: string): Promise<ProductStoreStatus[]>;

  // Seed
  seedData(organizationId: string): Promise<void>;

  // Auth
  auth: typeof authStorage;
}

export class DatabaseStorage implements IStorage {
  auth = authStorage;

  // Companies
  async getCompanies(organizationId: string): Promise<Company[]> {
    return await db.select().from(companies).where(eq(companies.organizationId, organizationId)).orderBy(companies.id);
  }

  async getCompany(id: number): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return company;
  }

  async createCompany(company: InsertCompany): Promise<Company> {
    const [created] = await db.insert(companies).values(company).returning();
    return created;
  }

  async updateCompany(id: number, updates: Partial<InsertCompany>): Promise<Company> {
    const [updated] = await db.update(companies).set(updates).where(eq(companies.id, id)).returning();
    return updated;
  }

  async deleteCompany(id: number): Promise<void> {
    await db.delete(stores).where(eq(stores.companyId, id));
    await db.delete(companies).where(eq(companies.id, id));
  }

  // Stores
  async getStore(id: number): Promise<Store | undefined> {
    const [store] = await db.select().from(stores).where(eq(stores.id, id));
    return store;
  }

  async getStores(companyId: number): Promise<Store[]> {
    return await db.select().from(stores).where(eq(stores.companyId, companyId)).orderBy(stores.id);
  }

  async getStoresByOrg(organizationId: string): Promise<Store[]> {
    const companyList = await this.getCompanies(organizationId);
    if (companyList.length === 0) return [];
    const companyIds = companyList.map(c => c.id);
    return await db.select().from(stores).where(inArray(stores.companyId, companyIds)).orderBy(stores.id);
  }

  async createStore(store: InsertStore): Promise<Store> {
    const [created] = await db.insert(stores).values(store).returning();
    return created;
  }

  async updateStore(id: number, updates: Partial<InsertStore>): Promise<Store> {
    const [updated] = await db.update(stores).set(updates).where(eq(stores.id, id)).returning();
    return updated;
  }

  async deleteStore(id: number): Promise<void> {
    await db.delete(stores).where(eq(stores.id, id));
  }

  // User Roles
  async getUserRole(userId: string, organizationId: string): Promise<UserRole | undefined> {
    const [role] = await db.select().from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.organizationId, organizationId)));
    return role;
  }

  async setUserRole(role: InsertUserRole): Promise<UserRole> {
    const existing = await this.getUserRole(role.userId, role.organizationId);
    if (existing) {
      const [updated] = await db.update(userRoles).set(role).where(eq(userRoles.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(userRoles).values(role).returning();
    return created;
  }

  // Expenses
  async getExpenses(organizationId: string, companyId?: number): Promise<Expense[]> {
    if (companyId) {
      return await db.select().from(expenses)
        .where(and(eq(expenses.organizationId, organizationId), eq(expenses.companyId, companyId)))
        .orderBy(desc(expenses.date));
    }
    return await db.select().from(expenses)
      .where(eq(expenses.organizationId, organizationId))
      .orderBy(desc(expenses.date));
  }

  async getExpense(id: number): Promise<Expense | undefined> {
    const [expense] = await db.select().from(expenses).where(eq(expenses.id, id));
    return expense;
  }

  async createExpense(expense: InsertExpense): Promise<Expense> {
    const [created] = await db.insert(expenses).values(expense).returning();
    return created;
  }

  async deleteExpense(id: number): Promise<void> {
    await db.delete(expenses).where(eq(expenses.id, id));
  }

  // Products
  async getProducts(organizationId: string, companyId?: number): Promise<Product[]> {
    if (companyId) {
      return await db.select().from(products)
        .where(and(eq(products.organizationId, organizationId), eq(products.companyId, companyId)))
        .orderBy(desc(products.id));
    }
    return await db.select().from(products)
      .where(eq(products.organizationId, organizationId))
      .orderBy(desc(products.id));
  }

  async getProduct(id: number): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product;
  }

  async getProductByBarcode(barcode: string, organizationId: string): Promise<Product | undefined> {
    const [product] = await db.select().from(products)
      .where(and(eq(products.barcode, barcode), eq(products.organizationId, organizationId)));
    return product;
  }

  async getProductBySku(sku: string, companyId: number): Promise<Product | undefined> {
    const [product] = await db.select().from(products)
      .where(and(eq(products.sku, sku), eq(products.companyId, companyId)));
    return product;
  }

  async getProductBySkuAndOrg(sku: string, organizationId: string): Promise<Product | undefined> {
    const [product] = await db.select().from(products)
      .where(and(eq(products.sku, sku), eq(products.organizationId, organizationId)));
    return product;
  }

  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const centralStock = insertProduct.centralStock || 0;
    const [product] = await db.insert(products).values({
      ...insertProduct,
      centralStock,
      stockQuantity: centralStock,
      stockLocal: centralStock,
      stockOzon: 0,
      stockWb: 0,
      stockYandex: 0,
    }).returning();
    return product;
  }

  async updateProduct(id: number, updates: UpdateProductRequest): Promise<Product> {
    return await db.transaction(async (tx) => {
      const [existingProduct] = await tx.select().from(products)
        .where(eq(products.id, id))
        .for("update");
      
      const centralStock = updates.centralStock !== undefined ? updates.centralStock : (existingProduct?.centralStock || 0);
      
      const [product] = await tx.update(products).set({ 
        ...updates, 
        centralStock,
        stockQuantity: centralStock,
        updatedAt: new Date() 
      }).where(eq(products.id, id)).returning();
      return product;
    });
  }

  async deleteProduct(id: number): Promise<void> {
    await db.delete(products).where(eq(products.id, id));
  }

  // Customers
  async getCustomers(organizationId: string): Promise<Customer[]> {
    return await db.select().from(customers).where(eq(customers.organizationId, organizationId)).orderBy(desc(customers.id));
  }

  async getCustomer(id: number): Promise<Customer | undefined> {
    const [customer] = await db.select().from(customers).where(eq(customers.id, id));
    return customer;
  }

  async createCustomer(insertCustomer: InsertCustomer): Promise<Customer> {
    const [customer] = await db.insert(customers).values(insertCustomer).returning();
    return customer;
  }

  async updateCustomer(id: number, updates: UpdateCustomerRequest): Promise<Customer> {
    const [customer] = await db.update(customers).set(updates).where(eq(customers.id, id)).returning();
    return customer;
  }

  // Orders
  async getOrders(organizationId: string, companyId?: number): Promise<OrderWithDetails[]> {
    let ordersList;
    if (companyId) {
      ordersList = await db.select().from(orders)
        .where(and(eq(orders.organizationId, organizationId), eq(orders.companyId, companyId)))
        .orderBy(desc(orders.createdAt));
    } else {
      ordersList = await db.select().from(orders)
        .where(eq(orders.organizationId, organizationId))
        .orderBy(desc(orders.createdAt));
    }
    
    const detailedOrders: OrderWithDetails[] = [];
    for (const order of ordersList) {
      const customer = order.customerId ? await this.getCustomer(order.customerId) : null;
      const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
      
      const itemsWithProducts = await Promise.all(items.map(async (item) => {
        const product = item.productId ? await this.getProduct(item.productId) : null;
        return { ...item, product: product || null };
      }));

      detailedOrders.push({
        ...order,
        customer: customer || null,
        items: itemsWithProducts
      });
    }
    return detailedOrders;
  }

  async getOrder(id: number): Promise<OrderWithDetails | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    if (!order) return undefined;

    const customer = order.customerId ? await this.getCustomer(order.customerId) : null;
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    
    const itemsWithProducts = await Promise.all(items.map(async (item) => {
      const product = item.productId ? await this.getProduct(item.productId) : null;
      return { ...item, product: product || null };
    }));

    return {
      ...order,
      customer: customer || null,
      items: itemsWithProducts
    };
  }

  async getOrdersByCustomerId(customerId: number, organizationId: string): Promise<OrderWithDetails[]> {
    const ordersList = await db.select().from(orders)
      .where(and(eq(orders.customerId, customerId), eq(orders.organizationId, organizationId)))
      .orderBy(desc(orders.createdAt));

    const detailedOrders: OrderWithDetails[] = [];
    for (const order of ordersList) {
      const customer = order.customerId ? await this.getCustomer(order.customerId) : null;
      const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
      const itemsWithProducts = await Promise.all(items.map(async (item) => {
        const product = item.productId ? await this.getProduct(item.productId) : null;
        return { ...item, product: product || null };
      }));
      detailedOrders.push({ ...order, customer: customer || null, items: itemsWithProducts });
    }
    return detailedOrders;
  }

  async createOrder(orderData: InsertOrder & { createdAt?: Date }, itemsData: { productId?: number | null; sku?: string; productName?: string; quantity: number; price: number; originalPrice?: number; salePrice?: number }[]): Promise<Order> {
    return await db.transaction(async (tx) => {
      const [order] = await tx.insert(orders)
        .values(orderData as typeof orders.$inferInsert)
        .onConflictDoNothing()
        .returning();

      if (!order) {
        if (!orderData.postingNumber || !orderData.storeId) {
          throw new Error(`[createOrder] Unexpected conflict on order without postingNumber or storeId`);
        }
        const [existing] = await tx.select().from(orders).where(
          and(
            eq(orders.postingNumber, orderData.postingNumber),
            eq(orders.storeId, orderData.storeId),
            eq(orders.organizationId, orderData.organizationId)
          )
        );
        if (!existing) {
          throw new Error(`[createOrder] Conflict on posting ${orderData.postingNumber} storeId ${orderData.storeId} but no existing row found`);
        }
        console.log(`[createOrder] Conflict on posting ${orderData.postingNumber} storeId ${orderData.storeId} — returning existing order #${existing.id}`);
        return existing;
      }
      
      for (const item of itemsData) {
        let product: typeof products.$inferSelect | undefined;

        if (item.productId) {
          const [p] = await tx.select().from(products)
            .where(eq(products.id, item.productId))
            .for("update");
          product = p;
        }

        await tx.insert(orderItems).values({
          orderId: order.id,
          productId: item.productId ?? null,
          sku: item.sku ?? null,
          productName: item.productName ?? null,
          quantity: item.quantity,
          price: item.price.toString(),
          originalPrice: item.originalPrice?.toString() || null,
          salePrice: item.salePrice?.toString() || null,
          purchasePrice: product?.purchasePrice?.toString() || null,
        });

        if (product && item.productId) {
          const newCentralStock = Math.max(0, (product.centralStock || 0) - item.quantity);
          await tx.update(products).set({
            centralStock: newCentralStock,
            stockQuantity: newCentralStock,
            stockLocal: newCentralStock,
            updatedAt: new Date()
          }).where(eq(products.id, item.productId));
        }
      }
      return order;
    });
  }

  async updateOrderStatus(id: number, status: string): Promise<Order> {
    const [order] = await db.update(orders).set({ status }).where(eq(orders.id, id)).returning();
    return order;
  }

  async getOrderByPostingNumber(postingNumber: string, organizationId: string, storeId?: number | null): Promise<Order | undefined> {
    const conditions = [eq(orders.postingNumber, postingNumber), eq(orders.organizationId, organizationId)];
    if (storeId != null) {
      conditions.push(eq(orders.storeId, storeId));
    }
    const [order] = await db.select().from(orders).where(and(...conditions));
    return order;
  }

  async updateOrderOzonStatus(id: number, ozonStatus: string, status?: string, createdAt?: Date): Promise<Order> {
    const updates: Record<string, any> = { ozonStatus };
    if (status) updates.status = status;
    if (createdAt) updates.createdAt = createdAt;
    const [order] = await db.update(orders).set(updates).where(eq(orders.id, id)).returning();
    return order;
  }

  async updateOrderYandexStatus(id: number, yandexStatus: string, status?: string, createdAt?: Date): Promise<Order> {
    const updates: Record<string, any> = { yandexStatus };
    if (status) updates.status = status;
    if (createdAt) updates.createdAt = createdAt;
    const [order] = await db.update(orders).set(updates).where(eq(orders.id, id)).returning();
    return order;
  }

  async getOrderByExternalId(externalId: string, organizationId: string, storeId?: number | null): Promise<Order | undefined> {
    const conditions = [eq(orders.externalId, externalId), eq(orders.organizationId, organizationId)];
    if (storeId != null) {
      conditions.push(eq(orders.storeId, storeId));
    }
    const [order] = await db.select().from(orders).where(and(...conditions));
    return order;
  }

  async createWebhookLog(log: InsertWebhookLog): Promise<WebhookLog> {
    const [entry] = await db.insert(webhookLogs).values(log).returning();
    return entry;
  }

  async getWebhookLogs(organizationId: string, limit = 50): Promise<WebhookLog[]> {
    return await db.select().from(webhookLogs)
      .where(eq(webhookLogs.organizationId, organizationId))
      .orderBy(desc(webhookLogs.createdAt))
      .limit(limit);
  }

  // Marketplace
  async getMarketplaceSettings(organizationId: string): Promise<MarketplaceSetting[]> {
    return await db.select().from(marketplaceSettings).where(eq(marketplaceSettings.organizationId, organizationId));
  }

  async saveMarketplaceSetting(setting: InsertMarketplaceSetting): Promise<MarketplaceSetting> {
    const [existing] = await db.select().from(marketplaceSettings)
      .where(and(
        eq(marketplaceSettings.organizationId, setting.organizationId),
        eq(marketplaceSettings.marketplace, setting.marketplace)
      ));
    
    if (existing) {
       const [updated] = await db.update(marketplaceSettings)
        .set(setting)
        .where(eq(marketplaceSettings.id, existing.id))
        .returning();
       return updated;
    } else {
      const [created] = await db.insert(marketplaceSettings).values(setting).returning();
      return created;
    }
  }

  async createMarketplaceSetting(setting: InsertMarketplaceSetting): Promise<MarketplaceSetting> {
    const [created] = await db.insert(marketplaceSettings).values(setting).returning();
    return created;
  }

  async updateMarketplaceSetting(id: number, updates: Partial<InsertMarketplaceSetting>): Promise<MarketplaceSetting> {
    const [updated] = await db.update(marketplaceSettings)
      .set(updates)
      .where(eq(marketplaceSettings.id, id))
      .returning();
    return updated;
  }

  async deleteMarketplaceSetting(id: number): Promise<void> {
    await db.delete(marketplaceSettings).where(eq(marketplaceSettings.id, id));
  }

  // Tax Settings
  async getTaxSettings(organizationId: string): Promise<TaxSetting | undefined> {
    const [settings] = await db.select().from(taxSettings).where(eq(taxSettings.organizationId, organizationId));
    return settings;
  }

  async saveTaxSettings(settings: InsertTaxSetting): Promise<TaxSetting> {
    const [existing] = await db.select().from(taxSettings).where(eq(taxSettings.organizationId, settings.organizationId));
    
    if (existing) {
      const [updated] = await db.update(taxSettings)
        .set({ ...settings, updatedAt: new Date() })
        .where(eq(taxSettings.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(taxSettings).values(settings).returning();
      return created;
    }
  }

  // Audit Log
  async getAuditLog(organizationId: string): Promise<AuditLogEntry[]> {
    return await db.select().from(auditLog)
      .where(eq(auditLog.organizationId, organizationId))
      .orderBy(desc(auditLog.createdAt))
      .limit(100);
  }

  async createAuditLog(entry: InsertAuditLog): Promise<AuditLogEntry> {
    const [created] = await db.insert(auditLog).values(entry).returning();
    return created;
  }

  // Stock Inflow
  async createStockInflow(inflow: InsertStockInflow, userId: string, userName: string): Promise<StockInflow> {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(stockInflow).values({
        ...inflow,
        toLocal: inflow.quantity,
        toOzon: 0,
        toWb: 0,
        toYandex: 0,
      }).returning();
      
      const [product] = await tx.select().from(products)
        .where(eq(products.id, inflow.productId))
        .for("update");
      if (product) {
        const newCentralStock = (product.centralStock || 0) + inflow.quantity;
        
        await tx.update(products).set({
          centralStock: newCentralStock,
          stockQuantity: newCentralStock,
          stockLocal: newCentralStock,
          purchasePrice: inflow.purchasePrice || product.purchasePrice,
          updatedAt: new Date()
        }).where(eq(products.id, inflow.productId));
      }

      await tx.insert(auditLog).values({
        organizationId: inflow.organizationId,
        companyId: inflow.companyId,
        userId,
        userName,
        action: "stock_inflow",
        entityType: "product",
        entityId: inflow.productId,
        delta: inflow.quantity,
        details: JSON.stringify({
          toCentralWarehouse: inflow.quantity,
          purchasePrice: inflow.purchasePrice
        })
      });

      return created;
    });
  }

  async getStockInflows(organizationId: string): Promise<StockInflow[]> {
    return await db.select().from(stockInflow)
      .where(eq(stockInflow.organizationId, organizationId))
      .orderBy(desc(stockInflow.createdAt));
  }

  // Dashboard KPI
  async getDashboardKPI(organizationId: string): Promise<DashboardKPI> {
    const productsList = await this.getProducts(organizationId);
    const taxSetting = await this.getTaxSettings(organizationId);
    const companyList = await this.getCompanies(organizationId);
    const allOrders = await db.select().from(orders).where(eq(orders.organizationId, organizationId));

    const activeOrders = allOrders.filter(o => {
      if (o.source === "ozon" && o.fulfillmentType === "FBS" &&
        (o.ozonStatus === "awaiting_packaging" || o.ozonStatus === "awaiting_deliver")) return true;
      if (o.source === "yandex" &&
        (o.yandexStatus === "NEW" || o.yandexStatus === "PROCESSING" || o.yandexStatus === "READY_TO_SHIP")) return true;
      return false;
    });
    const activeOrderIds = activeOrders.map(o => o.id);
    let activeItemsCount = 0;
    if (activeOrderIds.length > 0) {
      const activeItems = await db.select().from(orderItems).where(inArray(orderItems.orderId, activeOrderIds));
      activeItemsCount = activeItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
    }
    const activeRevenue = activeOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);

    let totalStock = 0;
    let capitalization = 0;
    let expectedRevenue = 0;
    let stockLocal = 0;
    let stockOzon = 0;
    let stockWb = 0;
    let stockYandex = 0;

    for (const p of productsList) {
      const qty = p.centralStock || 0;
      totalStock += qty;
      capitalization += qty * Number(p.purchasePrice || 0);
      expectedRevenue += qty * Number(p.sellingPrice || p.price || 0);
      stockLocal += p.centralStock || 0;
      stockOzon += p.stockOzon || 0;
      stockWb += p.stockWb || 0;
      stockYandex += p.stockYandex || 0;
    }

    const taxRate = Number(taxSetting?.taxRate || 7) / 100;
    const defaultCommission = Number(taxSetting?.defaultMarketplaceCommission || 15) / 100;
    const defaultLogistics = Number(taxSetting?.defaultLogisticsCost || 0);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentOrders = allOrders.filter(o =>
      o.status !== "cancelled" &&
      o.ozonStatus !== "cancelled" &&
      o.yandexStatus !== "CANCELLED" &&
      o.yandexStatus !== "RETURNED" &&
      new Date(o.createdAt || 0) >= thirtyDaysAgo
    );
    const recentOrderIds = recentOrders.map(o => o.id);
    let realProfit = 0;
    if (recentOrderIds.length > 0) {
      const recentItems = await db.select().from(orderItems).where(inArray(orderItems.orderId, recentOrderIds));
      for (const item of recentItems) {
        const revenue = Number(item.price) * item.quantity;
        const cost = Number(item.purchasePrice || 0) * item.quantity;
        const commission = revenue * defaultCommission;
        const logistics = item.quantity * defaultLogistics;
        const tax = revenue * taxRate;
        realProfit += revenue - cost - commission - logistics - tax;
      }
    }

    const companiesWithStores: CompanyWithStores[] = [];
    for (const company of companyList) {
      const companyProducts = productsList.filter(p => p.companyId === company.id);
      const companyStores = await this.getStores(company.id);
      const companyOrders = allOrders.filter(o => o.companyId === company.id);

      const storesWithStats: StoreWithStats[] = companyStores.map(store => {
        const storeOrders = companyOrders.filter(o => o.storeId === store.id);
        const pendingOrders = storeOrders.filter(o => 
          o.source === "ozon" && o.fulfillmentType === "FBS" &&
          (o.ozonStatus === "awaiting_packaging" || o.ozonStatus === "awaiting_deliver")
        ).length;
        const storeActiveOrders = storeOrders.filter(o =>
          (o.source === "ozon" && o.fulfillmentType === "FBS" &&
            (o.ozonStatus === "awaiting_packaging" || o.ozonStatus === "awaiting_deliver")) ||
          (o.source === "yandex" &&
            (o.yandexStatus === "NEW" || o.yandexStatus === "PROCESSING" || o.yandexStatus === "READY_TO_SHIP"))
        );
        const activeOrdersCount = storeActiveOrders.length;
        const activeOrdersRevenue = storeActiveOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
        
        const productCount = companyProducts.length;

        return { ...store, productCount, pendingOrders, activeOrdersCount, activeOrdersRevenue };
      });

      let companyTotalStock = 0;
      let companyTotalValue = 0;
      for (const p of companyProducts) {
        companyTotalStock += p.centralStock || 0;
        companyTotalValue += (p.centralStock || 0) * Number(p.sellingPrice || p.price || 0);
      }

      companiesWithStores.push({
        ...company,
        stores: storesWithStats,
        totalStock: companyTotalStock,
        totalValue: companyTotalValue,
      });
    }

    return {
      totalStock,
      capitalization,
      expectedRevenue,
      realProfit,
      today: {
        ordersCount: activeOrders.length,
        revenue: activeRevenue,
        itemsCount: activeItemsCount,
      },
      stockDistribution: { local: stockLocal, ozon: stockOzon, wb: stockWb, yandex: stockYandex },
      companies: companiesWithStores
    };
  }

  // Sync History
  async getSyncHistory(organizationId: string): Promise<SyncHistoryEntry[]> {
    return await db.select().from(syncHistory)
      .where(eq(syncHistory.organizationId, organizationId))
      .orderBy(desc(syncHistory.createdAt))
      .limit(100);
  }

  async createSyncHistory(entry: InsertSyncHistory): Promise<SyncHistoryEntry> {
    const [created] = await db.insert(syncHistory).values(entry).returning();
    return created;
  }

  // Analytics
  async getABCAnalysis(organizationId: string): Promise<ABCProduct[]> {
    const productsList = await this.getProducts(organizationId);
    const ordersList = await db.select().from(orders).where(eq(orders.organizationId, organizationId));
    const allItems = await db.select().from(orderItems);
    
    const orderIdSet = new Set(ordersList.map(o => o.id));
    const relevantItems = allItems.filter(item => {
      const order = ordersList.find(o => o.id === item.orderId);
      return order !== undefined;
    });

    const revenueByProduct: Record<number, number> = {};
    for (const item of relevantItems) {
      const pid = item.productId;
      if (!pid) continue;
      revenueByProduct[pid] = (revenueByProduct[pid] || 0) + item.quantity * Number(item.price);
    }

    for (const p of productsList) {
      if (!revenueByProduct[p.id]) {
        revenueByProduct[p.id] = p.stockQuantity * Number(p.sellingPrice || p.price || 0);
      }
    }

    const totalRevenue = Object.values(revenueByProduct).reduce((sum, v) => sum + v, 0) || 1;

    const sorted = productsList
      .map(p => ({
        ...p,
        revenue: revenueByProduct[p.id] || 0,
        revenueShare: ((revenueByProduct[p.id] || 0) / totalRevenue) * 100,
        cumulativeShare: 0,
        abcCategory: "C" as "A" | "B" | "C",
      }))
      .sort((a, b) => b.revenue - a.revenue);

    let cumulative = 0;
    for (const item of sorted) {
      cumulative += item.revenueShare;
      item.cumulativeShare = cumulative;
      if (cumulative <= 80) {
        item.abcCategory = "A";
      } else if (cumulative <= 95) {
        item.abcCategory = "B";
      } else {
        item.abcCategory = "C";
      }
    }

    return sorted;
  }

  async getLowStockProducts(organizationId: string, threshold: number = 10): Promise<LowStockProduct[]> {
    const productsList = await this.getProducts(organizationId);
    const companyList = await this.getCompanies(organizationId);
    const companyMap = new Map(companyList.map(c => [c.id, c.name]));

    return productsList
      .filter(p => (p.centralStock || 0) < threshold)
      .map(p => ({
        ...p,
        companyName: companyMap.get(p.companyId || 0) || "—",
      }))
      .sort((a, b) => (a.centralStock || 0) - (b.centralStock || 0));
  }

  async getSalesData(organizationId: string, options: { days?: number; from?: string; to?: string; storeId?: number } = {}): Promise<SalesResponse> {
    const companyList = await this.getCompanies(organizationId);
    const companyMap = new Map(companyList.map(c => [c.id, c.name]));

    const ordersList = await db.select().from(orders)
      .where(eq(orders.organizationId, organizationId));

    const toMskDateStr = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });

    let fromDateStr: string;
    let toDateStr: string;

    if (options.from && options.to) {
      fromDateStr = options.from;
      toDateStr = options.to;
    } else {
      const days = options.days || 30;
      const now = new Date();
      toDateStr = toMskDateStr(now);
      const fromD = new Date(now);
      fromD.setDate(fromD.getDate() - days + 1);
      fromDateStr = toMskDateStr(fromD);
    }

    const filtered = ordersList.filter(o => {
      if (!o.createdAt) return false;
      const createdDateStr = toMskDateStr(new Date(o.createdAt));
      if (createdDateStr < fromDateStr || createdDateStr > toDateStr) return false;
      const isCancelled = o.status === "cancelled" && (!o.ozonStatus || o.ozonStatus === "cancelled");
      if (isCancelled) return false;
      if (o.yandexStatus === "CANCELLED" || o.yandexStatus === "RETURNED") return false;
      if (options.storeId && o.storeId !== options.storeId) return false;
      return true;
    });

    const filteredIds = filtered.map(o => o.id);
    let allItems: { orderId: number; price: string | null; quantity: number; }[] = [];
    if (filteredIds.length > 0) {
      allItems = await db.select({
        orderId: orderItems.orderId,
        price: orderItems.price,
        quantity: orderItems.quantity,
      }).from(orderItems).where(inArray(orderItems.orderId, filteredIds));
    }

    const itemsByOrder = new Map<number, typeof allItems>();
    for (const item of allItems) {
      if (!itemsByOrder.has(item.orderId)) itemsByOrder.set(item.orderId, []);
      itemsByOrder.get(item.orderId)!.push(item);
    }

    const dataByDateCompany: Record<string, SalesDataPoint> = {};
    const marketplaceBreakdown = { ozon: 0, yandex: 0, wildberries: 0, other: 0 };
    let totalItemsQty = 0;

    for (const order of filtered) {
      const dateStr = order.createdAt ? toMskDateStr(new Date(order.createdAt)) : "unknown";
      const key = `${dateStr}_${order.companyId || 0}`;
      if (!dataByDateCompany[key]) {
        dataByDateCompany[key] = {
          date: dateStr,
          revenue: 0,
          companyId: order.companyId,
          companyName: companyMap.get(order.companyId || 0) || "—",
        };
      }

      const items = itemsByOrder.get(order.id) || [];
      let orderRevenue = 0;
      let orderQty = 0;
      for (const item of items) {
        orderRevenue += Number(item.price || 0) * item.quantity;
        orderQty += item.quantity;
      }
      dataByDateCompany[key].revenue += orderRevenue;
      totalItemsQty += orderQty;

      const src = (order.source || "").toLowerCase();
      if (src === "ozon") marketplaceBreakdown.ozon += orderRevenue;
      else if (src === "yandex") marketplaceBreakdown.yandex += orderRevenue;
      else if (src === "wildberries" || src === "wb") marketplaceBreakdown.wildberries += orderRevenue;
      else marketplaceBreakdown.other += orderRevenue;
    }

    const data = Object.values(dataByDateCompany).sort((a, b) => a.date.localeCompare(b.date));
    const totalRevenue = data.reduce((sum, d) => sum + d.revenue, 0);

    return { data, totalOrders: totalItemsQty, totalRevenue, marketplaceBreakdown };
  }

  // Stock Sync Log
  async getStockSyncLogs(organizationId: string, limit: number = 100): Promise<StockSyncLogEntry[]> {
    return await db.select().from(stockSyncLog)
      .where(eq(stockSyncLog.organizationId, organizationId))
      .orderBy(desc(stockSyncLog.createdAt))
      .limit(limit);
  }

  async createStockSyncLog(entry: InsertStockSyncLog): Promise<StockSyncLogEntry> {
    const [created] = await db.insert(stockSyncLog).values(entry).returning();
    return created;
  }

  // Inventory Sync Settings
  async getInventorySyncSettings(organizationId: string): Promise<InventorySyncSetting | undefined> {
    const [settings] = await db.select().from(inventorySyncSettings)
      .where(eq(inventorySyncSettings.organizationId, organizationId));
    return settings;
  }

  async saveInventorySyncSettings(organizationId: string, updates: Partial<InsertInventorySyncSettings>): Promise<InventorySyncSetting> {
    const existing = await this.getInventorySyncSettings(organizationId);
    if (existing) {
      const [updated] = await db.update(inventorySyncSettings)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(inventorySyncSettings.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(inventorySyncSettings).values({
      organizationId,
      defaultSafetyStock: updates.defaultSafetyStock ?? 2,
      syncEnabled: updates.syncEnabled ?? true,
    }).returning();
    return created;
  }

  async getProductStoreExclusions(productId: number): Promise<ProductStoreExclusion[]> {
    return await db.select().from(productStoreExclusions)
      .where(eq(productStoreExclusions.productId, productId));
  }

  async setProductStoreExclusions(productId: number, storeIds: number[], organizationId: string): Promise<ProductStoreExclusion[]> {
    await db.delete(productStoreExclusions)
      .where(eq(productStoreExclusions.productId, productId));
    
    if (storeIds.length === 0) return [];
    
    const values = storeIds.map(storeId => ({
      productId,
      storeId,
      organizationId,
    }));
    
    return await db.insert(productStoreExclusions).values(values).returning();
  }

  async getProductMarketplaceLinks(productId: number): Promise<ProductMarketplaceLink[]> {
    return await db.select().from(productMarketplaceLinks)
      .where(eq(productMarketplaceLinks.productId, productId));
  }

  async upsertProductMarketplaceLink(data: InsertProductMarketplaceLink): Promise<ProductMarketplaceLink> {
    const [result] = await db.insert(productMarketplaceLinks)
      .values(data)
      .onConflictDoUpdate({
        target: [productMarketplaceLinks.productId, productMarketplaceLinks.storeId],
        set: {
          marketplaceProductId: data.marketplaceProductId,
          isActive: data.isActive,
          organizationId: data.organizationId,
        },
      })
      .returning();
    return result;
  }

  async updateProductMarketplaceLinkSync(productId: number, storeId: number, status: string, error?: string): Promise<void> {
    await db.update(productMarketplaceLinks)
      .set({
        lastSyncAt: new Date(),
        lastSyncStatus: status,
        lastSyncError: error ?? null,
      })
      .where(and(
        eq(productMarketplaceLinks.productId, productId),
        eq(productMarketplaceLinks.storeId, storeId),
      ));
  }

  async getProductStoresWithStatus(productId: number, organizationId: string): Promise<ProductStoreStatus[]> {
    const orgStores = await this.getStoresByOrg(organizationId);
    const allSettings = await this.getMarketplaceSettings(organizationId);
    const links = await this.getProductMarketplaceLinks(productId);
    const linksMap = new Map(links.map(l => [l.storeId, l]));

    return orgStores
      .filter(s => s.isActive)
      .map(store => {
        const setting = allSettings.find(ms => ms.storeId === store.id && ms.isActive);
        const link = linksMap.get(store.id);
        const isConnected = !!setting && !!setting.apiKey;
        const hasProduct = !!link && link.isActive === true;
        return {
          storeId: store.id,
          storeName: store.name,
          marketplace: store.marketplace,
          isConnected,
          hasProduct,
          marketplaceProductId: link?.marketplaceProductId ?? null,
          lastSyncAt: link?.lastSyncAt ? link.lastSyncAt.toISOString() : null,
          lastSyncStatus: link?.lastSyncStatus ?? null,
          lastSyncError: link?.lastSyncError ?? null,
        };
      });
  }

  async seedData(orgId: string): Promise<void> {
    const existingCompanies = await this.getCompanies(orgId);
    if (existingCompanies.length > 0) return;

    const company1 = await this.createCompany({ name: "ИП Тигран", inn: "770012345678", organizationId: orgId });
    const company2 = await this.createCompany({ name: "ИП Лаура", inn: "770098765432", organizationId: orgId });

    const s1ozon = await this.createStore({ companyId: company1.id, marketplace: "ozon", name: "Тигран — Ozon", isActive: true });
    const s1wb = await this.createStore({ companyId: company1.id, marketplace: "wildberries", name: "Тигран — Wildberries", isActive: true });
    const s1ym = await this.createStore({ companyId: company1.id, marketplace: "yandex", name: "Тигран — Yandex Market", isActive: true });
    const s2ozon = await this.createStore({ companyId: company2.id, marketplace: "ozon", name: "Лаура — Ozon", isActive: true });
    const s2wb = await this.createStore({ companyId: company2.id, marketplace: "wildberries", name: "Лаура — Wildberries", isActive: true });
    const s2ym = await this.createStore({ companyId: company2.id, marketplace: "yandex", name: "Лаура — Yandex Market", isActive: true });

    await this.setUserRole({ userId: orgId, organizationId: orgId, role: "owner" });

    const p1 = await this.createProduct({
      name: "Беспроводные наушники Sony WH-1000XM5", sku: "WH-001", barcode: "4548736132573",
      category: "Электроника", purchasePrice: "15000", sellingPrice: "29990", price: "29990",
      weight: "0.25", centralStock: 50, stockQuantity: 50, stockLocal: 50, stockOzon: 0, stockWb: 0, stockYandex: 0,
      logisticsCost: "150", marketplaceCommission: "15", organizationId: orgId, companyId: company1.id,
      description: "Премиальные беспроводные наушники с шумоподавлением",
    });
    const p2 = await this.createProduct({
      name: "Подставка для смартфона алюминиевая", sku: "SS-002", barcode: "4600000000123",
      category: "Аксессуары", purchasePrice: "500", sellingPrice: "1490", price: "1490",
      weight: "0.15", centralStock: 120, stockQuantity: 120, stockLocal: 120, stockOzon: 0, stockWb: 0, stockYandex: 0,
      logisticsCost: "80", marketplaceCommission: "12", organizationId: orgId, companyId: company1.id,
      description: "Регулируемая алюминиевая подставка",
    });
    const p3 = await this.createProduct({
      name: "Умные часы Xiaomi Mi Watch", sku: "SW-003", barcode: "6934177756313",
      category: "Электроника", purchasePrice: "8000", sellingPrice: "14990", price: "14990",
      weight: "0.05", centralStock: 30, stockQuantity: 30, stockLocal: 30, stockOzon: 0, stockWb: 0, stockYandex: 0,
      logisticsCost: "100", marketplaceCommission: "15", organizationId: orgId, companyId: company1.id,
      description: "Фитнес-трекер с уведомлениями",
    });

    const p4 = await this.createProduct({
      name: "Кроссовки Nike Air Max 90", sku: "NK-001", barcode: "0194500882201",
      category: "Обувь", purchasePrice: "5500", sellingPrice: "12990", price: "12990",
      weight: "0.8", centralStock: 80, stockQuantity: 80, stockLocal: 80, stockOzon: 0, stockWb: 0, stockYandex: 0,
      logisticsCost: "200", marketplaceCommission: "18", organizationId: orgId, companyId: company2.id,
      description: "Культовые кроссовки Nike Air Max 90",
    });
    const p5 = await this.createProduct({
      name: "Сумка женская кожаная", sku: "BG-002", barcode: "2000000001234",
      category: "Аксессуары", purchasePrice: "3000", sellingPrice: "7990", price: "7990",
      weight: "0.6", centralStock: 45, stockQuantity: 45, stockLocal: 45, stockOzon: 0, stockWb: 0, stockYandex: 0,
      logisticsCost: "150", marketplaceCommission: "16", organizationId: orgId, companyId: company2.id,
      description: "Элегантная кожаная сумка",
    });
    const p6 = await this.createProduct({
      name: "Парфюм Chanel No.5 EDP 100ml", sku: "PF-003", barcode: "3145891255300",
      category: "Красота", purchasePrice: "6000", sellingPrice: "15490", price: "15490",
      weight: "0.35", centralStock: 25, stockQuantity: 25, stockLocal: 25, stockOzon: 0, stockWb: 0, stockYandex: 0,
      logisticsCost: "120", marketplaceCommission: "14", organizationId: orgId, companyId: company2.id,
      description: "Легендарный парфюм Chanel",
    });

    const c1 = await this.createCustomer({ name: "Иван Иванов", email: "ivan@example.com", phone: "+7 900 111-22-33", organizationId: orgId, companyId: company1.id });
    const c2 = await this.createCustomer({ name: "Мария Петрова", email: "maria@example.com", phone: "+7 900 444-55-66", organizationId: orgId, companyId: company1.id });
    const c3 = await this.createCustomer({ name: "Алексей Сидоров", email: "alexey@example.com", phone: "+7 900 777-88-99", organizationId: orgId, companyId: company2.id });

    await this.createOrder({
      orderNumber: "ORD-T-001", customerId: c1.id, totalAmount: "31480",
      organizationId: orgId, companyId: company1.id, storeId: s1ozon.id, source: "ozon"
    }, [
      { productId: p1.id, quantity: 1, price: 29990 },
      { productId: p2.id, quantity: 1, price: 1490 }
    ]);

    await this.createOrder({
      orderNumber: "ORD-T-002", customerId: c2.id, totalAmount: "14990",
      organizationId: orgId, companyId: company1.id, storeId: s1wb.id, source: "wildberries",
      externalId: "WB-556677"
    }, [
      { productId: p3.id, quantity: 1, price: 14990 }
    ]);

    await this.createOrder({
      orderNumber: "ORD-L-001", customerId: c3.id, totalAmount: "12990",
      organizationId: orgId, companyId: company2.id, storeId: s2ozon.id, source: "ozon"
    }, [
      { productId: p4.id, quantity: 1, price: 12990 }
    ]);

    await this.createOrder({
      orderNumber: "ORD-L-002", customerId: c3.id, totalAmount: "23480",
      organizationId: orgId, companyId: company2.id, storeId: s2ym.id, source: "yandex"
    }, [
      { productId: p5.id, quantity: 1, price: 7990 },
      { productId: p6.id, quantity: 1, price: 15490 }
    ]);

    await this.createExpense({ organizationId: orgId, companyId: company1.id, category: "internal", type: "salary", description: "Зарплата менеджера", amount: "85000" });
    await this.createExpense({ organizationId: orgId, companyId: company1.id, category: "internal", type: "rent", description: "Аренда склада", amount: "45000" });
    await this.createExpense({ organizationId: orgId, companyId: company1.id, category: "external", type: "logistics", description: "Доставка Ozon", amount: "12500" });
    await this.createExpense({ organizationId: orgId, companyId: company1.id, category: "external", type: "commission", description: "Комиссия WB", amount: "18200" });
    await this.createExpense({ organizationId: orgId, companyId: company2.id, category: "internal", type: "salary", description: "Зарплата менеджера", amount: "75000" });
    await this.createExpense({ organizationId: orgId, companyId: company2.id, category: "internal", type: "supplies", description: "Упаковочные материалы", amount: "8500" });
    await this.createExpense({ organizationId: orgId, companyId: company2.id, category: "external", type: "taxes", description: "Налог УСН", amount: "32000" });
    await this.createExpense({ organizationId: orgId, companyId: company2.id, category: "external", type: "logistics", description: "Доставка Yandex Market", amount: "9800" });

    await this.saveTaxSettings({
      organizationId: orgId, taxSystem: "usn_6", taxRate: "7",
      defaultLogisticsCost: "100", defaultMarketplaceCommission: "15"
    });
  }
}

export const storage = new DatabaseStorage();
