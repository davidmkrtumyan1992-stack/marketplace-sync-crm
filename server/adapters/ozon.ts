import type { Store } from "@shared/schema";
import type { MarketplaceAdapter, StockUpdate, StockInfo, AdapterResult } from "./base";
import { sleep } from "./base";

const OZON_API = "https://api-seller.ozon.ru";
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 750; // ~80 req/min rate limit

export class OzonAdapter implements MarketplaceAdapter {
  constructor(private store: Store) {}

  getName(): string {
    return `Ozon(${this.store.name})`;
  }

  private async fetchWarehouseId(): Promise<number | null> {
    try {
      const res = await fetch(`${OZON_API}/v2/warehouse/list`, {
        method: "POST",
        headers: {
          "Client-Id": this.store.clientId!,
          "Api-Key": this.store.apiKey!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json() as any;
      const warehouses: any[] = data?.warehouses || [];
      const fbs = warehouses.find(w =>
        w.warehouse_type === "fbs" && w.status !== "disabled"
      ) || warehouses.find(w => w.warehouse_type === "fbs");
      return fbs?.warehouse_id ? Number(fbs.warehouse_id) : null;
    } catch {
      return null;
    }
  }

  async updateStocks(updates: StockUpdate[]): Promise<AdapterResult> {
    if (!this.store.apiKey || !this.store.clientId) {
      return { success: false, errors: [`API-ключ или Client ID не настроен для «${this.store.name}»`] };
    }

    const errors: string[] = [];
    let updatedCount = 0;

    const warehouseId: number | null = this.store.warehouseId ? Number(this.store.warehouseId) : null;
    if (!warehouseId) {
      // FBO store — no explicit FBS warehouse configured, skip silently
      console.log(`[ozon-adapter] ${this.store.name}: warehouseId не задан — FBS-запись пропущена (FBO-магазин)`);
      return { success: true, errors: [], updatedCount: 0 };
    }

    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);

      const stocks = batch.map(u => ({
        offer_id: u.externalSku,
        stock: Math.max(0, u.quantity),
        warehouse_id: warehouseId,
      }));

      const t0 = Date.now();
      try {
        const res = await fetch(`${OZON_API}/v2/products/stocks`, {
          method: "POST",
          headers: {
            "Client-Id": this.store.clientId!,
            "Api-Key": this.store.apiKey!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ stocks }),
          signal: AbortSignal.timeout(15_000),
        });

        const data = await res.json() as any;

        if (!res.ok) {
          errors.push(`Ozon HTTP ${res.status}: ${data?.message || res.statusText}`);
          continue;
        }

        const result = data?.result || [];
        for (const item of result) {
          if (item.errors?.length) {
            const msg = item.errors.map((e: any) => e.message).join(', ');
            // Товар не в каталоге этого магазина — не ошибка, просто пропускаем
            if (/not found|не найден|does not exist|SKU not found/i.test(msg)) {
              console.log(`[ozon-adapter] ${this.store.name}: SKU ${item.offer_id} не в каталоге — пропуск`);
            } else {
              errors.push(`SKU ${item.offer_id}: ${msg}`);
            }
          } else {
            updatedCount++;
          }
        }

        console.log(`[ozon-adapter] ${this.store.name}: batch ${i / BATCH_SIZE + 1}, updated=${updatedCount}, dur=${Date.now() - t0}ms`);
      } catch (e: any) {
        errors.push(`Batch ${i}-${i + BATCH_SIZE}: ${e.message}`);
      }

      if (i + BATCH_SIZE < updates.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    return { success: errors.length === 0, errors, updatedCount };
  }

  async getStocks(skus: string[]): Promise<StockInfo[]> {
    if (!this.store.apiKey || !this.store.clientId) return [];

    const result: StockInfo[] = [];

    if (skus.length === 0) {
      let lastId = "";
      let page = 0;
      do {
        try {
          const res = await fetch(`${OZON_API}/v4/product/info/stocks`, {
            method: "POST",
            headers: {
              "Client-Id": this.store.clientId!,
              "Api-Key": this.store.apiKey!,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ filter: {}, last_id: lastId, limit: 100 }),
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok) break;
          const data = await res.json() as any;
          const items = data?.items || [];
          for (const item of items) {
            const fbs = item.stocks?.find((s: any) => s.type === "fbs");
            // Return FBS stock only — FBO is managed by Ozon warehouse, not by us
            result.push({
              externalSku: item.offer_id,
              available: fbs?.present || 0,
              reserved: fbs?.reserved || 0,
            });
          }
          lastId = data?.last_id || "";
          if (items.length < 100) break;
          if (++page > 50) break;
          await sleep(BATCH_DELAY_MS);
        } catch (e: any) {
          console.error(`[ozon-adapter] getStocks full-scan: ${e.message}`);
          break;
        }
      } while (lastId);
      return result;
    }

    for (let i = 0; i < skus.length; i += BATCH_SIZE) {
      const batch = skus.slice(i, i + BATCH_SIZE);
      try {
        const res = await fetch(`${OZON_API}/v4/product/info/stocks`, {
          method: "POST",
          headers: {
            "Client-Id": this.store.clientId!,
            "Api-Key": this.store.apiKey!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ filter: { offer_id: batch }, last_id: "", limit: BATCH_SIZE }),
          signal: AbortSignal.timeout(15_000),
        });

        const data = await res.json() as any;
        const items = data?.items || [];

        for (const item of items) {
          const fbs = item.stocks?.find((s: any) => s.type === "fbs");
          const fbo = item.stocks?.find((s: any) => s.type === "fbo");
          result.push({
            externalSku: item.offer_id,
            available: (fbs?.present || 0) + (fbo?.present || 0),
            reserved: (fbs?.reserved || 0) + (fbo?.reserved || 0),
          });
        }
      } catch (e: any) {
        console.error(`[ozon-adapter] getStocks error: ${e.message}`);
      }

      if (i + BATCH_SIZE < skus.length) await sleep(BATCH_DELAY_MS);
    }

    return result;
  }
}
