import { 
  products, customers, orders, orderItems, marketplaceSettings, taxSettings, auditLog, stockInflow,
  type Product, type InsertProduct, type UpdateProductRequest,
  type Customer, type InsertCustomer, type UpdateCustomerRequest,
  type Order, type InsertOrder, type OrderItem, type InsertOrderItem, type UpdateOrderRequest, type OrderWithDetails,
  type MarketplaceSetting, type InsertMarketplaceSetting,
  type TaxSetting, type InsertTaxSetting,
  type AuditLogEntry, type InsertAuditLog,
  type StockInflow, type InsertStockInflow,
  type DashboardKPI
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql } from "drizzle-orm";
import { authStorage } from "./replit_integrations/auth/storage";

export interface IStorage {
  // Products
  getProducts(organizationId: string): Promise<Product[]>;
  getProduct(id: number): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, updates: UpdateProductRequest): Promise<Product>;
  deleteProduct(id: number): Promise<void>;

  // Customers
  getCustomers(organizationId: string): Promise<Customer[]>;
  getCustomer(id: number): Promise<Customer | undefined>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  updateCustomer(id: number, updates: UpdateCustomerRequest): Promise<Customer>;

  // Orders
  getOrders(organizationId: string): Promise<OrderWithDetails[]>;
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

  // Products
  async getProducts(organizationId: string): Promise<Product[]> {
    return await db.select().from(products).where(eq(products.organizationId, organizationId)).orderBy(desc(products.id));
  }

  async getProduct(id: number): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product;
  }

  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const [product] = await db.insert(products).values(insertProduct).returning();
    return product;
  }

  async updateProduct(id: number, updates: UpdateProductRequest): Promise<Product> {
    const [product] = await db.update(products).set({ ...updates, updatedAt: new Date() }).where(eq(products.id, id)).returning();
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
  async getOrders(organizationId: string): Promise<OrderWithDetails[]> {
    const ordersList = await db.select().from(orders).where(eq(orders.organizationId, organizationId)).orderBy(desc(orders.createdAt));
    
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
            await tx.update(products)
              .set({ stockQuantity: product.stockQuantity - item.quantity })
              .where(eq(products.id, item.productId));
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
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(stockInflow).values(inflow).returning();
      
      // Update product stock
      const [product] = await tx.select().from(products).where(eq(products.id, inflow.productId));
      if (product) {
        await tx.update(products).set({
          stockQuantity: product.stockQuantity + inflow.quantity,
          stockLocal: product.stockLocal + (inflow.toLocal || 0),
          stockOzon: product.stockOzon + (inflow.toOzon || 0),
          stockWb: product.stockWb + (inflow.toWb || 0),
          purchasePrice: inflow.purchasePrice || product.purchasePrice,
          updatedAt: new Date()
        }).where(eq(products.id, inflow.productId));
      }

      // Create audit log
      await tx.insert(auditLog).values({
        organizationId: inflow.organizationId,
        userId,
        userName,
        action: "stock_inflow",
        entityType: "product",
        entityId: inflow.productId,
        delta: inflow.quantity,
        details: JSON.stringify({
          toLocal: inflow.toLocal,
          toOzon: inflow.toOzon,
          toWb: inflow.toWb,
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
    
    let totalStock = 0;
    let capitalization = 0;
    let expectedRevenue = 0;
    let stockLocal = 0;
    let stockOzon = 0;
    let stockWb = 0;

    for (const p of productsList) {
      const qty = p.stockQuantity;
      totalStock += qty;
      capitalization += qty * Number(p.purchasePrice || 0);
      expectedRevenue += qty * Number(p.sellingPrice || p.price || 0);
      stockLocal += p.stockLocal || 0;
      stockOzon += p.stockOzon || 0;
      stockWb += p.stockWb || 0;
    }

    // Calculate expected profit based on tax system
    const taxRate = taxSetting?.taxSystem === "usn_15" ? 0.15 : 0.06;
    const defaultCommission = Number(taxSetting?.defaultMarketplaceCommission || 15) / 100;
    const defaultLogistics = Number(taxSetting?.defaultLogisticsCost || 0);

    let expectedProfit = 0;
    for (const p of productsList) {
      const qty = p.stockQuantity;
      const revenue = qty * Number(p.sellingPrice || p.price || 0);
      const cost = qty * Number(p.purchasePrice || 0);
      const commission = revenue * (Number(p.marketplaceCommission || 0) / 100 || defaultCommission);
      const logistics = qty * (Number(p.logisticsCost) || defaultLogistics);

      if (taxSetting?.taxSystem === "usn_15") {
        const taxableIncome = revenue - cost - commission - logistics;
        const tax = Math.max(taxableIncome * 0.15, revenue * 0.01); // Min 1%
        expectedProfit += revenue - cost - commission - logistics - tax;
      } else {
        const tax = revenue * 0.06;
        expectedProfit += revenue - cost - commission - logistics - tax;
      }
    }

    return {
      totalStock,
      capitalization,
      expectedRevenue,
      expectedProfit,
      stockDistribution: {
        local: stockLocal,
        ozon: stockOzon,
        wb: stockWb
      }
    };
  }

  async seedData(orgId: string): Promise<void> {
    const existing = await this.getProducts(orgId);
    if (existing.length === 0) {
      const p1 = await this.createProduct({
        name: "Беспроводные наушники Sony WH-1000XM5",
        sku: "WH-001",
        category: "Электроника",
        purchasePrice: "15000",
        sellingPrice: "29990",
        price: "29990",
        weight: "0.25",
        stockQuantity: 50,
        stockLocal: 20,
        stockOzon: 15,
        stockWb: 15,
        logisticsCost: "150",
        marketplaceCommission: "15",
        organizationId: orgId,
        description: "Премиальные беспроводные наушники с шумоподавлением",
      });
      const p2 = await this.createProduct({
        name: "Подставка для смартфона алюминиевая",
        sku: "SS-002",
        category: "Аксессуары",
        purchasePrice: "500",
        sellingPrice: "1490",
        price: "1490",
        weight: "0.15",
        stockQuantity: 120,
        stockLocal: 60,
        stockOzon: 30,
        stockWb: 30,
        logisticsCost: "80",
        marketplaceCommission: "12",
        organizationId: orgId,
        description: "Регулируемая алюминиевая подставка",
      });
      const p3 = await this.createProduct({
        name: "Умные часы Xiaomi Mi Watch",
        sku: "SW-003",
        category: "Электроника",
        purchasePrice: "8000",
        sellingPrice: "14990",
        price: "14990",
        weight: "0.05",
        stockQuantity: 30,
        stockLocal: 10,
        stockOzon: 10,
        stockWb: 10,
        logisticsCost: "100",
        marketplaceCommission: "15",
        organizationId: orgId,
        description: "Фитнес-трекер с уведомлениями",
      });
      
      const c1 = await this.createCustomer({
        name: "Иван Иванов",
        email: "ivan@example.com",
        phone: "+7 900 111-22-33",
        organizationId: orgId,
      });

      const c2 = await this.createCustomer({
        name: "Мария Петрова",
        email: "maria@example.com",
        phone: "+7 900 444-55-66",
        organizationId: orgId,
      });

      await this.createOrder({
        orderNumber: "ORD-2024-001",
        customerId: c1.id,
        totalAmount: "31480",
        organizationId: orgId,
        source: "manual"
      }, [
        { productId: p1.id, quantity: 1, price: 29990 },
        { productId: p2.id, quantity: 1, price: 1490 }
      ]);

      await this.createOrder({
        orderNumber: "ORD-WB-882",
        customerId: c2.id,
        totalAmount: "14990",
        organizationId: orgId,
        source: "wildberries",
        externalId: "WB-556677"
      }, [
        { productId: p3.id, quantity: 1, price: 14990 }
      ]);
      
      await this.saveMarketplaceSetting({
        organizationId: orgId,
        marketplace: "ozon",
        apiKey: "demo-api-key-ozon",
        clientId: "123456",
        isActive: true
      });

      await this.saveMarketplaceSetting({
        organizationId: orgId,
        marketplace: "wildberries",
        apiKey: "demo-api-key-wb",
        isActive: true
      });

      await this.saveTaxSettings({
        organizationId: orgId,
        taxSystem: "usn_6",
        defaultLogisticsCost: "100",
        defaultMarketplaceCommission: "15"
      });
    }
  }
}

export const storage = new DatabaseStorage();
