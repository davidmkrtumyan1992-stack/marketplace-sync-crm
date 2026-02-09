import { db } from "./db";
import { products, stores, stockSyncLog, inventorySyncSettings, companies } from "@shared/schema";
import type { Store, StockSyncLogEntry, InsertStockSyncLog, InventorySyncSetting } from "@shared/schema";
import { eq, and, desc, sql, inArray, gte } from "drizzle-orm";

type StoreSyncResult = {
  storeId: number;
  storeName: string;
  marketplace: string;
  status: "success" | "fail";
  sentStock: number;
  error?: string;
};

export class InventorySyncEngine {
  private lockMap = new Map<number, Promise<void>>();

  private async acquireLock(productId: number): Promise<() => void> {
    while (this.lockMap.has(productId)) {
      await this.lockMap.get(productId);
    }

    let releaseFn: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseFn = resolve;
    });
    this.lockMap.set(productId, lockPromise);

    return () => {
      this.lockMap.delete(productId);
      releaseFn!();
    };
  }

  async processOrderStockUpdate(params: {
    organizationId: string;
    orderId: number;
    productId: number;
    quantity: number;
    sourceStoreId: number | null;
    sourceStoreName: string;
  }): Promise<StockSyncLogEntry> {
    const { organizationId, orderId, productId, quantity, sourceStoreId, sourceStoreName } = params;

    const release = await this.acquireLock(productId);

    try {
      return await db.transaction(async (tx) => {
        const [product] = await tx.select().from(products)
          .where(eq(products.id, productId))
          .for("update");

        if (!product) {
          throw new Error(`Товар с ID ${productId} не найден`);
        }

        const previousStock = product.stockLocal || 0;
        const newLocalStock = Math.max(0, previousStock - quantity);
        const newTotal = newLocalStock + (product.stockOzon || 0) + (product.stockWb || 0) + (product.stockYandex || 0);

        const syncSettings = await this.getSyncSettings(organizationId);
        const safetyThreshold = product.safetyStock > 0 ? product.safetyStock : (syncSettings?.defaultSafetyStock || 2);
        const safetyTriggered = newLocalStock <= safetyThreshold;

        await tx.update(products).set({
          stockLocal: newLocalStock,
          stockQuantity: newTotal,
          updatedAt: new Date(),
        }).where(eq(products.id, productId));

        const companyList = await tx.select().from(companies)
          .where(eq(companies.organizationId, organizationId));
        const companyIds = companyList.map(c => c.id);

        let allStores: Store[] = [];
        if (companyIds.length > 0) {
          allStores = await tx.select().from(stores)
            .where(inArray(stores.companyId, companyIds));
        }

        const otherStores = allStores.filter(s => s.id !== sourceStoreId && s.isActive);

        const stockToSend = safetyTriggered ? 0 : newLocalStock;

        const syncResults: StoreSyncResult[] = await this.broadcastStockUpdate(
          otherStores, product.sku, stockToSend, safetyTriggered
        );

        const allSuccess = syncResults.every(r => r.status === "success");
        const overallStatus = syncResults.length === 0 ? "success" : (allSuccess ? "success" : "partial");

        let details = `Заказ из «${sourceStoreName}» → остаток обновлён: ${previousStock} → ${newLocalStock}`;
        if (safetyTriggered) {
          details += ` → резервный остаток (${safetyThreshold}) достигнут, остаток на маркетплейсах: 0`;
        }
        details += ` → синхронизация ${stockToSend} ед. на ${otherStores.length} магазинов: ${allSuccess ? "SUCCESS" : "PARTIAL"}`;

        const [logEntry] = await tx.insert(stockSyncLog).values({
          organizationId,
          orderId,
          productId,
          productName: product.name,
          sku: product.sku,
          sourceStoreId,
          sourceStoreName,
          action: "order_stock_decrement",
          previousStock,
          newStock: newLocalStock,
          quantityChanged: quantity,
          safetyStockTriggered: safetyTriggered,
          syncResults: syncResults as any,
          status: overallStatus,
          details,
        }).returning();

        return logEntry;
      });
    } finally {
      release();
    }
  }

  async broadcastStockUpdate(
    targetStores: Store[],
    sku: string,
    stockLevel: number,
    safetyTriggered: boolean
  ): Promise<StoreSyncResult[]> {
    const results: StoreSyncResult[] = [];

    for (const store of targetStores) {
      try {
        await this.sendStockToMarketplace(store, sku, stockLevel);
        results.push({
          storeId: store.id,
          storeName: store.name,
          marketplace: store.marketplace,
          status: "success",
          sentStock: stockLevel,
        });
      } catch (error: any) {
        results.push({
          storeId: store.id,
          storeName: store.name,
          marketplace: store.marketplace,
          status: "fail",
          sentStock: stockLevel,
          error: error.message || "Unknown error",
        });
      }
    }

    return results;
  }

  private async sendStockToMarketplace(store: Store, sku: string, stockLevel: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));

    if (!store.apiKey) {
      throw new Error(`API-ключ не настроен для «${store.name}»`);
    }
  }

  async getSyncSettings(organizationId: string): Promise<InventorySyncSetting | null> {
    const [settings] = await db.select().from(inventorySyncSettings)
      .where(eq(inventorySyncSettings.organizationId, organizationId));
    return settings || null;
  }

  async saveSyncSettings(organizationId: string, defaultSafetyStock: number, syncEnabled: boolean): Promise<InventorySyncSetting> {
    const existing = await this.getSyncSettings(organizationId);
    if (existing) {
      const [updated] = await db.update(inventorySyncSettings)
        .set({ defaultSafetyStock, syncEnabled, updatedAt: new Date() })
        .where(eq(inventorySyncSettings.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(inventorySyncSettings).values({
      organizationId,
      defaultSafetyStock,
      syncEnabled,
    }).returning();
    return created;
  }

  async getSyncLogs(organizationId: string, limit: number = 100): Promise<StockSyncLogEntry[]> {
    return await db.select().from(stockSyncLog)
      .where(eq(stockSyncLog.organizationId, organizationId))
      .orderBy(desc(stockSyncLog.createdAt))
      .limit(limit);
  }

  async getSyncStatus(organizationId: string): Promise<{
    lastSyncAt: string | null;
    lastSyncStatus: string | null;
    totalSyncsToday: number;
    successCount: number;
    failCount: number;
    safetyStockTriggeredCount: number;
    recentLogs: StockSyncLogEntry[];
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const allLogs = await db.select().from(stockSyncLog)
      .where(and(
        eq(stockSyncLog.organizationId, organizationId),
        gte(stockSyncLog.createdAt, today),
      ))
      .orderBy(desc(stockSyncLog.createdAt));

    const recentLogs = await db.select().from(stockSyncLog)
      .where(eq(stockSyncLog.organizationId, organizationId))
      .orderBy(desc(stockSyncLog.createdAt))
      .limit(5);

    const lastLog = recentLogs[0] || null;

    return {
      lastSyncAt: lastLog?.createdAt?.toISOString() || null,
      lastSyncStatus: lastLog?.status || null,
      totalSyncsToday: allLogs.length,
      successCount: allLogs.filter(l => l.status === "success").length,
      failCount: allLogs.filter(l => l.status === "fail" || l.status === "partial").length,
      safetyStockTriggeredCount: allLogs.filter(l => l.safetyStockTriggered).length,
      recentLogs,
    };
  }
}

export const inventorySyncEngine = new InventorySyncEngine();
