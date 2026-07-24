/**
 * Одноразовый скрипт: наполнить marketplace_catalog_cache для всех активных
 * подключённых магазинов (используется для поиска-и-выбора карточек в UI).
 * Запуск: npx tsx scripts/prime-catalog-cache.ts
 */
import { Pool } from "pg";
import { fetchOzonProducts, fetchWildberriesProducts, fetchYandexProducts } from "../server/marketplace-import";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL не задан");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const { rows: settings } = await pool.query(
      `SELECT id, organization_id, store_id, marketplace, store_name, api_key, client_id, warehouse_id
       FROM marketplace_settings WHERE is_active = true AND api_key IS NOT NULL AND store_id IS NOT NULL`
    );
    console.log(`[prime-catalog] ${settings.length} активных подключённых магазинов найдено`);

    for (const setting of settings) {
      const label = setting.store_name || `${setting.marketplace} #${setting.store_id}`;
      try {
        let fetched: { name: string; sku: string; price: number; marketplaceId?: string; imageUrl?: string }[] = [];

        if (setting.marketplace === "ozon" && setting.client_id) {
          fetched = await fetchOzonProducts(setting.api_key, setting.client_id);
        } else if (setting.marketplace === "wildberries") {
          fetched = await fetchWildberriesProducts(setting.api_key, setting.warehouse_id || undefined);
        } else if (setting.marketplace === "yandex" && setting.warehouse_id) {
          const yToken = setting.api_key.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
          const yBusinessId = setting.warehouse_id.replace(/[^\x00-\x7F]/g, "").replace(/\s/g, "").trim();
          fetched = await fetchYandexProducts(yToken, yBusinessId);
        } else {
          console.log(`[prime-catalog] ${label}: пропущен, не хватает настроек`);
          continue;
        }

        const entries = fetched.filter((p) => p.marketplaceId);
        for (const p of entries) {
          await pool.query(
            `INSERT INTO marketplace_catalog_cache
               (organization_id, store_id, marketplace_product_id, external_sku, name, price, image_url, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (store_id, marketplace_product_id) DO UPDATE
               SET external_sku = EXCLUDED.external_sku,
                   name = EXCLUDED.name,
                   price = EXCLUDED.price,
                   image_url = EXCLUDED.image_url,
                   updated_at = NOW()`,
            [setting.organization_id, setting.store_id, p.marketplaceId, p.sku, p.name, String(p.price ?? 0), p.imageUrl || null]
          );
        }
        console.log(`[prime-catalog] ${label}: ${entries.length} карточек закешировано`);
      } catch (e: any) {
        console.error(`[prime-catalog] ${label}: ОШИБКА ${e.message}`);
      }
    }
    console.log("[prime-catalog] done");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("[prime-catalog] fatal:", e);
  process.exit(1);
});
