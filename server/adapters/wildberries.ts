import type { Store } from "@shared/schema";
import type { MarketplaceAdapter, StockUpdate, StockInfo, AdapterResult } from "./base";
import { sleep } from "./base";

const WB_STOCKS_API = "https://marketplace-api.wildberries.ru";
const WB_STATS_API = "https://statistics-api.wildberries.ru";
const MAX_RETRIES = 3;

export class WildberriesAdapter implements MarketplaceAdapter {
  constructor(private store: Store) {}

  getName(): string {
    return `WB(${this.store.name})`;
  }

  async updateStocks(updates: StockUpdate[]): Promise<AdapterResult> {
    if (!this.store.apiKey) {
      return { success: false, errors: [`API-ключ не настроен для «${this.store.name}»`] };
    }

    const warehouseId = this.store.warehouseId || updates[0]?.warehouseId;
    if (!warehouseId) {
      return { success: false, errors: [`warehouseId не указан для «${this.store.name}»`] };
    }

    const stocks = updates.map(u => ({
      sku: u.externalSku,
      amount: Math.max(0, u.quantity),
    }));

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${WB_STOCKS_API}/api/v3/stocks/${warehouseId}`, {
          method: "PUT",
          headers: {
            "Authorization": this.store.apiKey!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ stocks }),
          signal: AbortSignal.timeout(15_000),
        });

        if (res.status === 429) {
          const retryAfter = Number(res.headers.get("X-Ratelimit-Retry-After") || "5");
          console.warn(`[wb-adapter] 429 rate limit, retry after ${retryAfter}s`);
          await sleep(retryAfter * 1000);
          continue;
        }

        if (res.status === 409) {
          console.warn(`[wb-adapter] 409 store processing, attempt ${attempt}/${MAX_RETRIES}`);
          await sleep(5_000);
          continue;
        }

        if (!res.ok) {
          const text = await res.text();
          return { success: false, errors: [`WB HTTP ${res.status}: ${text}`] };
        }

        console.log(`[wb-adapter] ${this.store.name}: updated ${stocks.length} SKUs, warehouse=${warehouseId}`);
        return { success: true, errors: [], updatedCount: stocks.length };

      } catch (e: any) {
        if (attempt === MAX_RETRIES) {
          return { success: false, errors: [`WB timeout/network: ${e.message}`] };
        }
        await sleep(2_000 * attempt);
      }
    }

    return { success: false, errors: ["WB: превышено число попыток"] };
  }

  async getStocks(skus: string[]): Promise<StockInfo[]> {
    if (!this.store.apiKey) return [];

    const today = new Date().toISOString().split("T")[0];
    try {
      const res = await fetch(
        `${WB_STATS_API}/api/v1/supplier/stocks?dateFrom=${today}`,
        {
          headers: { "Authorization": this.store.apiKey! },
          signal: AbortSignal.timeout(30_000),
        }
      );

      if (!res.ok) return [];

      const data = await res.json() as any[];
      const skuSet = new Set(skus);
      const result: StockInfo[] = [];

      for (const item of data) {
        const sku = String(item.nmId || item.supplierArticle || "");
        if (!skus.length || skuSet.has(sku)) {
          result.push({
            externalSku: sku,
            available: item.quantity || 0,
            reserved: item.inWayToClient || 0,
          });
        }
      }

      return result;
    } catch (e: any) {
      console.error(`[wb-adapter] getStocks error: ${e.message}`);
      return [];
    }
  }
}
