import { 
  products, customers, orders, orderItems, marketplaceSettings,
  type Product, type InsertProduct, type UpdateProductRequest,
  type Customer, type InsertCustomer, type UpdateCustomerRequest,
  type Order, type InsertOrder, type OrderItem, type InsertOrderItem, type UpdateOrderRequest, type OrderWithDetails,
  type MarketplaceSetting, type InsertMarketplaceSetting
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";
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
    
    // Fetch details for each order (could be optimized with joins/aggregation but simple loop is fine for MVP)
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

        // Update stock
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
    // Check if exists
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
}

export const storage = new DatabaseStorage();
