import type { Store } from "@shared/schema";
import type { MarketplaceAdapter, StockUpdate, StockInfo, AdapterResult } from "./base";
import { sleep } from "./base";

const YM_API = "https://api.partner.market.yandex.ru";
const BATCH_SIZE = 100;

export class YandexMarketAdapter implements MarketplaceAdapter {
  constructor(private store: Store) {}

  getName(): string {
    return `YM(${this.store.name})`;
  }

  private get businessId(): string {
    return this.store.warehouseId || "";
  }

  private async resolveCampaignIds(): Promise<string[]> {
    // warehouseId хранит Business ID (131115754).
    // Для обновления остатков нужны реальные Campaign IDs.
    try {
      const res = await fetch(`${YM_API}/campaigns`, {
        headers: { "Api-Key": this.store.apiKey!, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return [];
      const data = await res.json() as any;
      const campaigns: any[] = data?.campaigns || [];
      const bizId = this.businessId;
      const filtered = bizId
        ? campaigns.filter(c =>
            String(c.business?.id) === bizId ||
            String(c.clientId) === bizId ||
            String(c.id) === bizId
          )
        : campaigns;
      const ids = filtered.map(c => String(c.id)).filter(id => id !== bizId);
      console.log(`[ym-adapter] ${this.store.name}: resolved campaign IDs: [${ids.join(", ")}]`);
      return ids.length ? ids : [];
    } catch {
      return [];
    }
  }

  async updateStocks(updates: StockUpdate[]): Promise<AdapterResult> {
    if (!this.store.apiKey) {
      return { success: false, errors: [`API-ключ не настроен для «${this.store.name}»`] };
    }
    if (!this.businessId) {
      return { success: false, errors: [`Campaign ID не указан для «${this.store.name}»`] };
    }

    const campaignIds = await this.resolveCampaignIds();
    if (campaignIds.length === 0) {
      return { success: false, errors: [`Не удалось получить Campaign IDs для «${this.store.name}» (Business ID: ${this.businessId})`] };
    }

    const errors: string[] = [];
    let updatedCount = 0;
    const allSkus = updates.map(u => u.externalSku);

    for (const campaignId of campaignIds) {
      // Проверяем какие из наших SKU реально есть в этой кампании
      let skusInCampaign: Set<string>;
      try {
        const checkRes = await fetch(
          `${YM_API}/campaigns/${campaignId}/offers/stocks`,
          {
            method: "POST",
            headers: { "Api-Key": this.store.apiKey!, "Content-Type": "application/json" },
            body: JSON.stringify({ withTurnover: false, archived: false, offerIds: allSkus }),
            signal: AbortSignal.timeout(10_000),
          }
        );
        if (checkRes.ok) {
          const checkData = await checkRes.json() as any;
          const warehouses = checkData?.result?.warehouses || [];
          skusInCampaign = new Set(
            warehouses.flatMap((wh: any) => (wh.offers || []).map((o: any) => o.offerId as string))
          );
        } else {
          skusInCampaign = campaignIds[0] === campaignId ? new Set(allSkus) : new Set();
        }
      } catch {
        skusInCampaign = campaignIds[0] === campaignId ? new Set(allSkus) : new Set();
      }

      const campaignUpdates = updates.filter(u => skusInCampaign.has(u.externalSku));
      if (campaignUpdates.length === 0) {
        console.log(`[ym-adapter] ${this.store.name} campaign=${campaignId}: нет товаров — пропуск`);
        continue;
      }

      for (let i = 0; i < campaignUpdates.length; i += BATCH_SIZE) {
        const batch = campaignUpdates.slice(i, i + BATCH_SIZE);
        const skus = batch.map(u => ({
          sku: u.externalSku,
          items: [{ type: "FIT", count: Math.max(0, u.quantity) }],
        }));

        try {
          const res = await fetch(
            `${YM_API}/campaigns/${campaignId}/offers/stocks`,
            {
              method: "PUT",
              headers: { "Api-Key": this.store.apiKey!, "Content-Type": "application/json" },
              body: JSON.stringify({ skus }),
              signal: AbortSignal.timeout(15_000),
            }
          );
          const data = await res.json() as any;
          if (!res.ok) {
            errors.push(`YM campaign ${campaignId} HTTP ${res.status}: ${data?.errors?.[0]?.message || res.statusText}`);
            continue;
          }
          updatedCount += batch.length;
          console.log(`[ym-adapter] ${this.store.name} campaign=${campaignId}: batch ${i / BATCH_SIZE + 1}, updated=${batch.length}`);
        } catch (e: any) {
          errors.push(`YM campaign ${campaignId} batch ${i}: ${e.message}`);
        }

        if (i + BATCH_SIZE < campaignUpdates.length) await sleep(500);
      }
    }

    return { success: errors.length === 0, errors, updatedCount };
  }

  async getStocks(skus: string[]): Promise<StockInfo[]> {
    if (!this.store.apiKey || !this.businessId) return [];

    const campaignIds = await this.resolveCampaignIds();
    if (campaignIds.length === 0) return [];
    const primaryCampaignId = campaignIds[0];

    try {
      const res = await fetch(
        `${YM_API}/campaigns/${primaryCampaignId}/offers/stocks`,
        {
          method: "POST",
          headers: {
            "Api-Key": this.store.apiKey!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ withTurnover: false, archived: false, limit: 200 }),
          signal: AbortSignal.timeout(15_000),
        }
      );

      if (!res.ok) return [];

      const data = await res.json() as any;
      const warehouses = data?.result?.warehouses || [];
      const skuSet = new Set(skus);
      const result: StockInfo[] = [];

      for (const wh of warehouses) {
        for (const offer of wh.offers || []) {
          if (skus.length && !skuSet.has(offer.offerId)) continue;
          const stocks = Object.fromEntries(
            (offer.stocks || []).map((s: any) => [s.type, s.count])
          );
          result.push({
            externalSku: offer.offerId,
            available: stocks["AVAILABLE"] || 0,
            reserved: stocks["FREEZE"] || 0,
          });
        }
      }

      return result;
    } catch (e: any) {
      console.error(`[ym-adapter] getStocks error: ${e.message}`);
      return [];
    }
  }
}
