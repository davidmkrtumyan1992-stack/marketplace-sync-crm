import { db } from "./db";
import { products, stores, stockSyncLog, inventorySyncSettings, companies, syncHistory, productStoreExclusions, productMarketplaceLinks } from "@shared/schema";
import type { Store, StockSyncLogEntry, InsertStockSyncLog, InventorySyncSetting } from "@shared/schema";
import { eq, and, desc, sql, inArray, gte } from "drizzle-orm";
import { createAdapter } from "./adapters/factory";

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

        const previousStock = product.centralStock || 0;
        const newCentralStock = Math.max(0, previousStock - quantity);

        const syncSettings = await this.getSyncSettings(organizationId);
        const safetyThreshold = product.safetyStock > 0 ? product.safetyStock : (syncSettings?.defaultSafetyStock || 2);
        const safetyTriggered = newCentralStock <= safetyThreshold;

        await tx.update(products).set({
          centralStock: newCentralStock,
          stockQuantity: newCentralStock,
          stockLocal: newCentralStock,
          updatedAt: new Date(),
        }).where(eq(products.id, productId));

        const exclusions = await tx.select().from(productStoreExclusions)
          .where(eq(productStoreExclusions.productId, productId));
        const excludedStoreIds = new Set(exclusions.map(e => e.storeId));

        const companyList = await tx.select().from(companies)
          .where(eq(companies.organizationId, organizationId));
        const companyIds = companyList.map(c => c.id);

        let allStores: Store[] = [];
        if (companyIds.length > 0) {
          allStores = await tx.select().from(stores)
            .where(inArray(stores.companyId, companyIds));
        }

        const targetStores = allStores.filter(s =>
          s.id !== sourceStoreId && s.isActive && !excludedStoreIds.has(s.id) && s.stockSyncEnabled !== false
        );

        const stockToSend = safetyTriggered ? 0 : newCentralStock;

        const syncResults: StoreSyncResult[] = await this.broadcastStockUpdate(
          targetStores, product.sku, stockToSend, safetyTriggered, productId
        );

        const allSuccess = syncResults.every(r => r.status === "success");
        const overallStatus = syncResults.length === 0 ? "success" : (allSuccess ? "success" : "partial");

        let details = `Заказ из «${sourceStoreName}» → центральный склад: ${previousStock} → ${newCentralStock}`;
        if (safetyTriggered) {
          details += ` → резервный остаток (${safetyThreshold}) достигнут, остаток на маркетплейсах: 0`;
        }
        if (excludedStoreIds.size > 0) {
          details += ` → исключено ${excludedStoreIds.size} магазинов`;
        }
        details += ` → синхронизация ${stockToSend} ед. на ${targetStores.length} магазинов: ${allSuccess ? "SUCCESS" : "PARTIAL"}`;

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
          newStock: newCentralStock,
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
    safetyTriggered: boolean,
    productId?: number
  ): Promise<StoreSyncResult[]> {
    const results: StoreSyncResult[] = [];

    // Load per-store externalSku overrides from product_marketplace_links
    const linkMap = new Map<number, string>(); // storeId → externalSku
    if (productId) {
      const links = await db.select({
        storeId: productMarketplaceLinks.storeId,
        externalSku: productMarketplaceLinks.externalSku,
      }).from(productMarketplaceLinks)
        .where(and(
          eq(productMarketplaceLinks.productId, productId),
          eq(productMarketplaceLinks.isActive, true)
        ));
      for (const link of links) {
        if (link.externalSku) linkMap.set(link.storeId, link.externalSku);
      }
    }

    for (const store of targetStores) {
      const effectiveSku = linkMap.get(store.id) ?? sku;
      try {
        await this.sendStockToMarketplace(store, effectiveSku, stockLevel);
        results.push({
          storeId: store.id,
          storeName: store.name,
          marketplace: store.marketplace,
          status: "success",
          sentStock: stockLevel,
        });
        if (productId) {
          await db.update(productMarketplaceLinks)
            .set({ lastSyncAt: new Date(), lastSyncStatus: "success", lastSyncError: null })
            .where(and(
              eq(productMarketplaceLinks.productId, productId),
              eq(productMarketplaceLinks.storeId, store.id)
            ));
        }
      } catch (error: any) {
        const errMsg = error.message || "Ошибка синхронизации";
        results.push({
          storeId: store.id,
          storeName: store.name,
          marketplace: store.marketplace,
          status: "fail",
          sentStock: stockLevel,
          error: errMsg,
        });
        if (productId) {
          await db.update(productMarketplaceLinks)
            .set({ lastSyncAt: new Date(), lastSyncStatus: "error", lastSyncError: errMsg })
            .where(and(
              eq(productMarketplaceLinks.productId, productId),
              eq(productMarketplaceLinks.storeId, store.id)
            ));
        }
      }
    }

    return results;
  }

  private async sendStockToMarketplace(store: Store, sku: string, stockLevel: number): Promise<void> {
    if (!store.apiKey) {
      throw new Error(`API-ключ не настроен для «${store.name}»`);
    }

    const adapter = createAdapter(store);
    const t0 = Date.now();
    const result = await adapter.updateStocks([{ externalSku: sku, quantity: stockLevel }]);
    const durationMs = Date.now() - t0;

    console.log(`[inventory-sync] ${adapter.getName()}: sku=${sku}, qty=${stockLevel}, success=${result.success}, dur=${durationMs}ms`);

    if (!result.success) {
      throw new Error(result.errors.join("; "));
    }
  }

  async processOrderCancellation(orderId: number, organizationId: string): Promise<void> {
    const deductionLogs = await db.select().from(stockSyncLog)
      .where(and(eq(stockSyncLog.orderId, orderId), eq(stockSyncLog.action, "order_stock_decrement")));

    if (deductionLogs.length === 0) return;

    const restoreLogs = await db.select().from(stockSyncLog)
      .where(and(eq(stockSyncLog.orderId, orderId), eq(stockSyncLog.action, "order_stock_restore")));

    if (restoreLogs.length > 0) return;

    for (const log of deductionLogs) {
      if (!log.productId || !log.quantityChanged) continue;

      const release = await this.acquireLock(log.productId);
      try {
        let newCentralStock = 0;
        let sku = log.sku || "";
        let syncResults: StoreSyncResult[] = [];

        await db.transaction(async (tx) => {
          const [product] = await tx.select().from(products)
            .where(eq(products.id, log.productId!))
            .for("update");

          if (!product) return;

          const previousStock = product.centralStock || 0;
          newCentralStock = previousStock + (log.quantityChanged || 0);
          sku = product.sku;

          await tx.update(products).set({
            centralStock: newCentralStock,
            stockQuantity: newCentralStock,
            stockLocal: newCentralStock,
            updatedAt: new Date(),
          }).where(eq(products.id, log.productId!));

          const companyList = await tx.select().from(companies)
            .where(eq(companies.organizationId, organizationId));
          const companyIds = companyList.map(c => c.id);

          let allStores: Store[] = [];
          if (companyIds.length > 0) {
            allStores = await tx.select().from(stores)
              .where(inArray(stores.companyId, companyIds));
          }

          const targetStores = allStores.filter(s => s.isActive && s.id !== log.sourceStoreId && s.stockSyncEnabled !== false);
          syncResults = await this.broadcastStockUpdate(targetStores, sku, newCentralStock, false, log.productId ?? undefined);

          await tx.insert(stockSyncLog).values({
            organizationId,
            orderId,
            productId: log.productId,
            productName: log.productName,
            sku,
            sourceStoreId: log.sourceStoreId,
            sourceStoreName: log.sourceStoreName || "Отмена заказа",
            action: "order_stock_restore",
            previousStock,
            newStock: newCentralStock,
            quantityChanged: log.quantityChanged,
            safetyStockTriggered: false,
            syncResults: syncResults as any,
            status: syncResults.every(r => r.status === "success") ? "success" : "partial",
            details: `Отмена заказа #${orderId} → остаток восстановлен: ${previousStock} → ${newCentralStock}`,
          });
        });

        console.log(`[cancel-restore] orderId=${orderId} productId=${log.productId} sku=${sku}: ${log.quantityChanged} ед. возвращено, новый остаток=${newCentralStock}`);
      } catch (e: any) {
        console.error(`[cancel-restore] orderId=${orderId} productId=${log.productId}: ${e.message}`);
      } finally {
        release();
      }
    }
  }

  async getSyncSettings(organizationId: string): Promise<InventorySyncSetting | null> {
    const [settings] = await db.select().from(inventorySyncSettings)
      .where(eq(inventorySyncSettings.organizationId, organizationId));
    return settings || null;
  }

  async saveSyncSettings(organizationId: string, defaultSafetyStock: number, syncEnabled: boolean, demoMode?: boolean): Promise<InventorySyncSetting> {
    const existing = await this.getSyncSettings(organizationId);
    const updateData: any = { defaultSafetyStock, syncEnabled, updatedAt: new Date() };
    if (demoMode !== undefined) updateData.demoMode = demoMode;

    if (existing) {
      const [updated] = await db.update(inventorySyncSettings)
        .set(updateData)
        .where(eq(inventorySyncSettings.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(inventorySyncSettings).values({
      organizationId,
      defaultSafetyStock,
      syncEnabled,
      demoMode: demoMode ?? false,
    }).returning();
    return created;
  }

  async isDemoMode(organizationId: string): Promise<boolean> {
    const settings = await this.getSyncSettings(organizationId);
    return settings?.demoMode ?? false;
  }

  private randomDelay(): Promise<void> {
    const delay = 500 + Math.random() * 1000;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  private randomStock(): number {
    return Math.floor(5 + Math.random() * 45);
  }

  private formatNum(n: number): string {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }

  async demoSyncAllStores(organizationId: string): Promise<StockSyncLogEntry[]> {
    const companyList = await db.select().from(companies)
      .where(eq(companies.organizationId, organizationId));
    const companyIds = companyList.map(c => c.id);

    let allStores: Store[] = [];
    if (companyIds.length > 0) {
      allStores = await db.select().from(stores)
        .where(inArray(stores.companyId, companyIds));
    }

    const activeStores = allStores.filter(s => s.isActive);
    const logEntries: StockSyncLogEntry[] = [];

    for (const store of activeStores) {
      await this.randomDelay();

      const stockUpdated = this.randomStock();
      const itemsCount = Math.floor(3 + Math.random() * 15);
      const syncResults: StoreSyncResult[] = [{
        storeId: store.id,
        storeName: store.name,
        marketplace: store.marketplace,
        status: "success",
        sentStock: stockUpdated,
      }];

      const details = `[ДЕМО] Остатки обновлены на «${store.name}»: ${this.formatNum(stockUpdated)} шт. (${this.formatNum(itemsCount)} позиций) → синхронизация SUCCESS`;

      const [logEntry] = await db.insert(stockSyncLog).values({
        organizationId,
        productName: "Все товары",
        sourceStoreName: store.name,
        sourceStoreId: store.id,
        action: "demo_sync",
        previousStock: stockUpdated + Math.floor(Math.random() * 10),
        newStock: stockUpdated,
        quantityChanged: 0,
        safetyStockTriggered: false,
        syncResults: syncResults as any,
        status: "success",
        details,
      }).returning();

      await db.insert(syncHistory).values({
        organizationId,
        storeId: store.id,
        companyId: store.companyId,
        action: "stock_sync",
        status: "success",
        details: `[ДЕМО] Синхронизация остатков с «${store.name}»`,
        itemsCount,
      });

      await db.update(stores).set({ lastSync: new Date() }).where(eq(stores.id, store.id));

      logEntries.push(logEntry);
    }

    return logEntries;
  }

  async demoSyncStore(organizationId: string, storeId: number): Promise<StockSyncLogEntry> {
    const allStoreList = await this.getStoresByOrg(organizationId);
    const store = allStoreList.find(s => s.id === storeId);
    if (!store) throw new Error("Магазин не найден");

    await this.randomDelay();

    const stockUpdated = this.randomStock();
    const itemsCount = Math.floor(3 + Math.random() * 15);
    const syncResults: StoreSyncResult[] = [{
      storeId: store.id,
      storeName: store.name,
      marketplace: store.marketplace,
      status: "success",
      sentStock: stockUpdated,
    }];

    const details = `[ДЕМО] Остатки обновлены на «${store.name}»: ${this.formatNum(stockUpdated)} шт. (${this.formatNum(itemsCount)} позиций) → синхронизация SUCCESS`;

    const [logEntry] = await db.insert(stockSyncLog).values({
      organizationId,
      productName: "Все товары",
      sourceStoreName: store.name,
      sourceStoreId: store.id,
      action: "demo_sync",
      previousStock: stockUpdated + Math.floor(Math.random() * 10),
      newStock: stockUpdated,
      quantityChanged: 0,
      safetyStockTriggered: false,
      syncResults: syncResults as any,
      status: "success",
      details,
    }).returning();

    await db.insert(syncHistory).values({
      organizationId,
      storeId: store.id,
      companyId: store.companyId,
      action: "stock_sync",
      status: "success",
      details: `[ДЕМО] Синхронизация остатков с «${store.name}»`,
      itemsCount,
    });

    await db.update(stores).set({ lastSync: new Date() }).where(eq(stores.id, store.id));

    return logEntry;
  }

  async autoCreateLinks(product: { id: number; sku: string; barcode: string | null; organizationId: string }): Promise<void> {
    try {
      const orgStores = await db.execute(sql`
        SELECT s.id FROM stores s
        JOIN companies c ON s.company_id = c.id
        WHERE c.organization_id = ${product.organizationId}
          AND s.is_active = true AND s.api_key IS NOT NULL
          AND s.marketplace != 'wildberries'
      `);

      const externalSku = product.sku || product.barcode;
      if (!externalSku) return;

      for (const row of (orgStores as any).rows) {
        await db.execute(sql`
          INSERT INTO product_marketplace_links (product_id, store_id, external_sku, is_active, organization_id)
          VALUES (${product.id}, ${(row as any).id}, ${externalSku}, true, ${product.organizationId})
          ON CONFLICT (product_id, store_id) DO UPDATE
            SET external_sku = EXCLUDED.external_sku,
                is_active = true
            WHERE product_marketplace_links.external_sku IS NULL
        `);
      }
      console.log(`[auto-link] product ${product.id} sku=${externalSku}: создано ссылок для ${(orgStores as any).rows.length} магазинов`);
    } catch (e: any) {
      console.warn(`[auto-link] product ${product.id}: ${e.message}`);
    }
  }

  async createLinksForAllProducts(organizationId: string): Promise<{ total: number; created: number }> {
    const unlinked = await db.execute(sql`
      SELECT p.id, p.sku, p.barcode
      FROM products p
      WHERE p.organization_id = ${organizationId}
        AND p.sku IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM product_marketplace_links pml
          WHERE pml.product_id = p.id AND pml.is_active = true
        )
    `);

    const rows = (unlinked as any).rows;
    let created = 0;

    for (const row of rows) {
      const before = await db.select().from(productMarketplaceLinks)
        .where(and(eq(productMarketplaceLinks.productId, row.id), eq(productMarketplaceLinks.isActive, true)));
      await this.autoCreateLinks({ id: row.id, sku: row.sku, barcode: row.barcode, organizationId });
      const after = await db.select().from(productMarketplaceLinks)
        .where(and(eq(productMarketplaceLinks.productId, row.id), eq(productMarketplaceLinks.isActive, true)));
      if (after.length > before.length) created++;
    }

    console.log(`[create-all-links] Org ${organizationId}: ${rows.length} без links → создано для ${created} товаров`);
    return { total: rows.length, created };
  }

  async syncProductToAllStores(productId: number): Promise<StoreSyncResult[]> {
    const [product] = await db.select().from(products).where(eq(products.id, productId));
    if (!product) return [];

    let links = await db.select().from(productMarketplaceLinks)
      .where(and(eq(productMarketplaceLinks.productId, productId), eq(productMarketplaceLinks.isActive, true)));

    // Если ссылок нет — автоматически создать по SKU и повторить
    if (links.length === 0) {
      await this.autoCreateLinks(product as any);
      links = await db.select().from(productMarketplaceLinks)
        .where(and(eq(productMarketplaceLinks.productId, productId), eq(productMarketplaceLinks.isActive, true)));
    }

    if (links.length === 0) return [];

    const storeIds = [...new Set(links.map(l => l.storeId))];
    const storeList = await db.select().from(stores).where(inArray(stores.id, storeIds));
    const activeStores = storeList.filter(s => s.isActive && s.stockSyncEnabled !== false);

    return await this.broadcastStockUpdate(activeStores, product.sku, product.centralStock || 0, false, productId);
  }

  private async getStoresByOrg(organizationId: string): Promise<Store[]> {
    const companyList = await db.select().from(companies)
      .where(eq(companies.organizationId, organizationId));
    const companyIds = companyList.map(c => c.id);
    if (companyIds.length === 0) return [];
    return await db.select().from(stores)
      .where(inArray(stores.companyId, companyIds));
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
      partialCount: allLogs.filter(l => l.status === "partial").length,
      failCount: allLogs.filter(l => l.status === "fail").length,
      safetyStockTriggeredCount: allLogs.filter(l => l.safetyStockTriggered).length,
      recentLogs,
    };
  }
}

export const inventorySyncEngine = new InventorySyncEngine();
