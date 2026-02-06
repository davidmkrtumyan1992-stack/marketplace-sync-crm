import { 
  companies, stores, userRoles, expenses,
  products, customers, orders, orderItems, marketplaceSettings, taxSettings, auditLog, stockInflow,
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
  type DashboardKPI, type CompanyWithStores, type StoreWithStats
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { authStorage } from "./replit_integrations/auth/storage";

export interface IStorage {
  // Companies
  getCompanies(organizationId: string): Promise<Company[]>;
  getCompany(id: number): Promise<Company | undefined>;
  createCompany(company: InsertCompany): Promise<Company>;

  // Stores
  getStores(companyId: number): Promise<Store[]>;
  getStoresByOrg(organizationId: string): Promise<Store[]>;
  createStore(store: InsertStore): Promise<Store>;
  updateStore(id: number, updates: Partial<InsertStore>): Promise<Store>;

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
  createOrder(order: InsertOrder, items: { productId: number; quantity: number; price: number }[]): Promise<Order>;
  updateOrderStatus(id: number, status: string): Promise<Order>;

  // Marketplace
  getMarketplaceSettings(organizationId: string): Promise<MarketplaceSetting[]>;
  saveMarketplaceSetting(setting: InsertMarketplaceSetting): Promise<MarketplaceSetting>;

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

  // Stores
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

  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const stockLocal = insertProduct.stockLocal || 0;
    const stockOzon = insertProduct.stockOzon || 0;
    const stockWb = insertProduct.stockWb || 0;
    const stockYandex = insertProduct.stockYandex || 0;
    const calculatedTotal = stockLocal + stockOzon + stockWb + stockYandex;
    
    const [product] = await db.insert(products).values({
      ...insertProduct,
      stockQuantity: calculatedTotal
    }).returning();
    return product;
  }

  async updateProduct(id: number, updates: UpdateProductRequest): Promise<Product> {
    const [existingProduct] = await db.select().from(products).where(eq(products.id, id));
    
    const stockLocal = updates.stockLocal !== undefined ? updates.stockLocal : (existingProduct?.stockLocal || 0);
    const stockOzon = updates.stockOzon !== undefined ? updates.stockOzon : (existingProduct?.stockOzon || 0);
    const stockWb = updates.stockWb !== undefined ? updates.stockWb : (existingProduct?.stockWb || 0);
    const stockYandex = updates.stockYandex !== undefined ? updates.stockYandex : (existingProduct?.stockYandex || 0);
    const calculatedTotal = stockLocal + stockOzon + stockWb + stockYandex;
    
    const [product] = await db.update(products).set({ 
      ...updates, 
      stockQuantity: calculatedTotal,
      updatedAt: new Date() 
    }).where(eq(products.id, id)).returning();
    return product;
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
        const product = await this.getProduct(item.productId);
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
      const product = await this.getProduct(item.productId);
      return { ...item, product: product || null };
    }));

    return {
      ...order,
      customer: customer || null,
      items: itemsWithProducts
    };
  }

  async createOrder(orderData: InsertOrder, itemsData: { productId: number; quantity: number; price: number }[]): Promise<Order> {
    return await db.transaction(async (tx) => {
      const [order] = await tx.insert(orders).values(orderData).returning();
      
      for (const item of itemsData) {
        await tx.insert(orderItems).values({
          orderId: order.id,
          productId: item.productId,
          quantity: item.quantity,
          price: item.price.toString()
        });

        const [product] = await tx.select().from(products).where(eq(products.id, item.productId));
        if (product) {
          let newStockLocal = product.stockLocal || 0;
          let newStockOzon = product.stockOzon || 0;
          let newStockWb = product.stockWb || 0;
          let newStockYandex = product.stockYandex || 0;
          
          const source = orderData.source;
          if (source === "ozon") {
            if (newStockOzon < item.quantity) throw new Error(`Недостаточно товара на Ozon: доступно ${newStockOzon}, запрошено ${item.quantity}`);
            newStockOzon -= item.quantity;
          } else if (source === "wildberries") {
            if (newStockWb < item.quantity) throw new Error(`Недостаточно товара на Wildberries: доступно ${newStockWb}, запрошено ${item.quantity}`);
            newStockWb -= item.quantity;
          } else if (source === "yandex") {
            if (newStockYandex < item.quantity) throw new Error(`Недостаточно товара на Yandex Market: доступно ${newStockYandex}, запрошено ${item.quantity}`);
            newStockYandex -= item.quantity;
          } else {
            if (newStockLocal < item.quantity) throw new Error(`Недостаточно товара на складе: доступно ${newStockLocal}, запрошено ${item.quantity}`);
            newStockLocal -= item.quantity;
          }
          
          const newTotal = newStockLocal + newStockOzon + newStockWb + newStockYandex;
          
          await tx.update(products).set({ 
            stockQuantity: newTotal,
            stockLocal: newStockLocal,
            stockOzon: newStockOzon,
            stockWb: newStockWb,
            stockYandex: newStockYandex,
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
    const toLocal = inflow.toLocal || 0;
    const toOzon = inflow.toOzon || 0;
    const toWb = inflow.toWb || 0;
    const toYandex = inflow.toYandex || 0;
    const channelSum = toLocal + toOzon + toWb + toYandex;
    
    if (channelSum !== inflow.quantity) {
      throw new Error(`Stock inflow validation failed: quantity (${inflow.quantity}) must equal sum of channels (${channelSum})`);
    }
    
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(stockInflow).values(inflow).returning();
      
      const [product] = await tx.select().from(products).where(eq(products.id, inflow.productId));
      if (product) {
        const newStockLocal = (product.stockLocal || 0) + toLocal;
        const newStockOzon = (product.stockOzon || 0) + toOzon;
        const newStockWb = (product.stockWb || 0) + toWb;
        const newStockYandex = (product.stockYandex || 0) + toYandex;
        const newTotal = newStockLocal + newStockOzon + newStockWb + newStockYandex;
        
        await tx.update(products).set({
          stockQuantity: newTotal,
          stockLocal: newStockLocal,
          stockOzon: newStockOzon,
          stockWb: newStockWb,
          stockYandex: newStockYandex,
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
          toLocal, toOzon, toWb, toYandex,
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
    
    let totalStock = 0;
    let capitalization = 0;
    let expectedRevenue = 0;
    let stockLocal = 0;
    let stockOzon = 0;
    let stockWb = 0;
    let stockYandex = 0;

    for (const p of productsList) {
      const qty = p.stockQuantity;
      totalStock += qty;
      capitalization += qty * Number(p.purchasePrice || 0);
      expectedRevenue += qty * Number(p.sellingPrice || p.price || 0);
      stockLocal += p.stockLocal || 0;
      stockOzon += p.stockOzon || 0;
      stockWb += p.stockWb || 0;
      stockYandex += p.stockYandex || 0;
    }

    const taxRate = Number(taxSetting?.taxRate || 7) / 100;
    const defaultCommission = Number(taxSetting?.defaultMarketplaceCommission || 15) / 100;
    const defaultLogistics = Number(taxSetting?.defaultLogisticsCost || 0);

    let expectedProfit = 0;
    for (const p of productsList) {
      const qty = p.stockQuantity;
      const revenue = qty * Number(p.sellingPrice || p.price || 0);
      const cost = qty * Number(p.purchasePrice || 0);
      const commission = revenue * (Number(p.marketplaceCommission || 0) / 100 || defaultCommission);
      const logistics = qty * (Number(p.logisticsCost) || defaultLogistics);
      const tax = revenue * taxRate;
      expectedProfit += revenue - cost - commission - logistics - tax;
    }

    const companiesWithStores: CompanyWithStores[] = [];
    for (const company of companyList) {
      const companyProducts = productsList.filter(p => p.companyId === company.id);
      const companyStores = await this.getStores(company.id);
      const companyOrders = allOrders.filter(o => o.companyId === company.id);

      const storesWithStats: StoreWithStats[] = companyStores.map(store => {
        const storeOrders = companyOrders.filter(o => o.storeId === store.id);
        const pendingOrders = storeOrders.filter(o => o.status === "pending").length;
        
        let productCount = 0;
        const mp = store.marketplace;
        for (const p of companyProducts) {
          if (mp === "ozon" && (p.stockOzon || 0) > 0) productCount++;
          else if (mp === "wildberries" && (p.stockWb || 0) > 0) productCount++;
          else if (mp === "yandex" && (p.stockYandex || 0) > 0) productCount++;
        }

        return { ...store, productCount, pendingOrders };
      });

      let companyTotalStock = 0;
      let companyTotalValue = 0;
      for (const p of companyProducts) {
        companyTotalStock += p.stockQuantity;
        companyTotalValue += p.stockQuantity * Number(p.sellingPrice || p.price || 0);
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
      expectedProfit,
      stockDistribution: { local: stockLocal, ozon: stockOzon, wb: stockWb, yandex: stockYandex },
      companies: companiesWithStores
    };
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
      weight: "0.25", stockQuantity: 50, stockLocal: 15, stockOzon: 12, stockWb: 13, stockYandex: 10,
      logisticsCost: "150", marketplaceCommission: "15", organizationId: orgId, companyId: company1.id,
      description: "Премиальные беспроводные наушники с шумоподавлением",
    });
    const p2 = await this.createProduct({
      name: "Подставка для смартфона алюминиевая", sku: "SS-002", barcode: "4600000000123",
      category: "Аксессуары", purchasePrice: "500", sellingPrice: "1490", price: "1490",
      weight: "0.15", stockQuantity: 120, stockLocal: 40, stockOzon: 30, stockWb: 25, stockYandex: 25,
      logisticsCost: "80", marketplaceCommission: "12", organizationId: orgId, companyId: company1.id,
      description: "Регулируемая алюминиевая подставка",
    });
    const p3 = await this.createProduct({
      name: "Умные часы Xiaomi Mi Watch", sku: "SW-003", barcode: "6934177756313",
      category: "Электроника", purchasePrice: "8000", sellingPrice: "14990", price: "14990",
      weight: "0.05", stockQuantity: 30, stockLocal: 8, stockOzon: 8, stockWb: 7, stockYandex: 7,
      logisticsCost: "100", marketplaceCommission: "15", organizationId: orgId, companyId: company1.id,
      description: "Фитнес-трекер с уведомлениями",
    });

    const p4 = await this.createProduct({
      name: "Кроссовки Nike Air Max 90", sku: "NK-001", barcode: "0194500882201",
      category: "Обувь", purchasePrice: "5500", sellingPrice: "12990", price: "12990",
      weight: "0.8", stockQuantity: 80, stockLocal: 25, stockOzon: 20, stockWb: 20, stockYandex: 15,
      logisticsCost: "200", marketplaceCommission: "18", organizationId: orgId, companyId: company2.id,
      description: "Культовые кроссовки Nike Air Max 90",
    });
    const p5 = await this.createProduct({
      name: "Сумка женская кожаная", sku: "BG-002", barcode: "2000000001234",
      category: "Аксессуары", purchasePrice: "3000", sellingPrice: "7990", price: "7990",
      weight: "0.6", stockQuantity: 45, stockLocal: 15, stockOzon: 10, stockWb: 12, stockYandex: 8,
      logisticsCost: "150", marketplaceCommission: "16", organizationId: orgId, companyId: company2.id,
      description: "Элегантная кожаная сумка",
    });
    const p6 = await this.createProduct({
      name: "Парфюм Chanel No.5 EDP 100ml", sku: "PF-003", barcode: "3145891255300",
      category: "Красота", purchasePrice: "6000", sellingPrice: "15490", price: "15490",
      weight: "0.35", stockQuantity: 25, stockLocal: 8, stockOzon: 6, stockWb: 6, stockYandex: 5,
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
