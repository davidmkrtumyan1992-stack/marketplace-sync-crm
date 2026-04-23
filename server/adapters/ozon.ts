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

  async updateStocks(updates: StockUpdate[]): Promise<AdapterResult> {
    if (!this.store.apiKey || !this.store.clientId) {
      return { success: false, errors: [`API-ключ или Client ID не настроен для «${this.store.name}»`] };
    }

    const errors: string[] = [];
    let updatedCount = 0;

    // Ozon: warehouseId нужен для FBS. Берём из store.warehouseId или пропускаем (FBO не требует).
    const warehouseId = this.store.warehouseId || null;

    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);

      const stocks = batch.map(u => ({
        offer_id: u.externalSku,
        stock: Math.max(0, u.quantity),
        ...(warehouseId ? { warehouse_id: Number(warehouseId) } : {}),
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
            errors.push(`SKU ${item.offer_id}: ${item.errors.map((e: any) => e.message).join(', ')}`);
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
