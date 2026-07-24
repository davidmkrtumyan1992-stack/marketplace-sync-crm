/**
 * Полный цикл проверки: прогнать reconcileMarketplaceProducts на ВСЕХ активных
 * подключённых магазинах (5xOzon + WB + Yandex) и убедиться, что суммарное число
 * товаров в организации не увеличилось (никаких новых дублей).
 * Запуск: npx tsx scripts/verify-reconcile-all.ts
 */
import { db } from "../server/db";
import { products } from "../shared/schema";
import { eq } from "drizzle-orm";
import { fetchOzonProducts, fetchWildberriesProducts, fetchYandexProducts } from "../server/marketplace-import";
import { reconcileMarketplaceProducts } from "../server/product-matching";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows: settings } = await pool.query(
    `SELECT organization_id, store_id, marketplace, store_name, api_key, client_id, warehouse_id
     FROM marketplace_settings WHERE is_active = true AND api_key IS NOT NULL AND store_id IS NOT NULL`
  );
  await pool.end();

  console.log(`[verify-all] ${settings.length} активных подключённых магазинов`);

  const orgIds = Array.from(new Set(settings.map((s: any) => s.organization_id)));
  const beforeCounts = new Map<string, number>();
  for (const orgId of orgIds) {
    const rows = await db.select().from(products).where(eq(products.organizationId, orgId));
    beforeCounts.set(orgId, rows.length);
  }
  console.log(`[verify-all] товаров ДО (по организациям): ${JSON.stringify(Object.fromEntries(beforeCounts))}`);

  let totalUpdated = 0;
  let totalUnlinked = 0;

  for (const setting of settings) {
    const label = setting.store_name || `${setting.marketplace} #${setting.store_id}`;
    try {
      let items: any[] = [];
      if (setting.marketplace === "ozon" && setting.client_id) {
        items = await fetchOzonProducts(setting.api_key, setting.client_id);
      } else if (setting.marketplace === "wildberries") {
        items = await fetchWildberriesProducts(setting.api_key, setting.warehouse_id || undefined);
      } else if (setting.marketplace === "yandex" && setting.warehouse_id) {
        const yToken = setting.api_key.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
        const yBusinessId = setting.warehouse_id.replace(/[^\x00-\x7F]/g, "").replace(/\s/g, "").trim();
        items = await fetchYandexProducts(yToken, yBusinessId);
      } else {
        console.log(`[verify-all] ${label}: пропущен (не хватает настроек)`);
        continue;
      }

      const result = await reconcileMarketplaceProducts({
        items,
        storeId: setting.store_id,
        orgId: setting.organization_id,
        marketplace: setting.marketplace,
      });
      totalUpdated += result.updated;
      totalUnlinked += result.unlinked;
      console.log(`[verify-all] ${label}: fetched=${items.length}, updated=${result.updated}, unlinked=${result.unlinked}`);
    } catch (e: any) {
      console.error(`[verify-all] ${label}: ОШИБКА ${e.message}`);
    }
  }

  console.log(`[verify-all] ИТОГО: updated=${totalUpdated}, unlinked=${totalUnlinked}`);

  let anyMismatch = false;
  for (const orgId of orgIds) {
    const rows = await db.select().from(products).where(eq(products.organizationId, orgId));
    const before = beforeCounts.get(orgId)!;
    const diff = rows.length - before;
    console.log(`[verify-all] org=${orgId}: товаров ДО=${before}, ПОСЛЕ=${rows.length}, разница=${diff}`);
    if (diff !== 0) anyMismatch = true;
  }

  if (anyMismatch) {
    console.error("[verify-all] FAIL: количество товаров изменилось хотя бы в одной организации!");
    process.exit(1);
  }
  console.log("[verify-all] OK: во всех организациях количество товаров не изменилось.");
}

main().catch((e) => {
  console.error("[verify-all] fatal:", e);
  process.exit(1);
});
