/**
 * Разовая проверка: прогнать reconcileMarketplaceProducts на ОДНОМ магазине (Yandex)
 * и убедиться, что новые товары НЕ создаются (created должно остаться 0), а карточки
 * без совпадения остаются в кеше как unlinked.
 * Запуск: npx tsx scripts/verify-reconcile.ts
 */
import { db } from "../server/db";
import { products } from "../shared/schema";
import { eq } from "drizzle-orm";
import { fetchYandexProducts } from "../server/marketplace-import";
import { reconcileMarketplaceProducts } from "../server/product-matching";

async function main() {
  const orgId = "54281609";
  const storeId = 47;

  const before = await db.select().from(products).where(eq(products.organizationId, orgId));
  console.log(`[verify] товаров ДО: ${before.length}`);

  // Настройки берём напрямую из БД, без похода через storage/HTTP-слой.
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(
    `SELECT api_key, warehouse_id FROM marketplace_settings WHERE organization_id = $1 AND store_id = $2 AND marketplace = 'yandex' AND is_active = true LIMIT 1`,
    [orgId, storeId]
  );
  await pool.end();
  if (rows.length === 0) {
    console.error("[verify] настройка Yandex не найдена");
    process.exit(1);
  }
  const setting = rows[0];
  const yToken = setting.api_key.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
  const yBusinessId = setting.warehouse_id.replace(/[^\x00-\x7F]/g, "").replace(/\s/g, "").trim();

  console.log("[verify] тяну карточки с Yandex...");
  const items = await fetchYandexProducts(yToken, yBusinessId);
  console.log(`[verify] получено карточек: ${items.length}`);

  const result = await reconcileMarketplaceProducts({ items, storeId, orgId, marketplace: "yandex" });
  console.log(`[verify] reconcile result: updated=${result.updated}, unlinked=${result.unlinked}`);

  const after = await db.select().from(products).where(eq(products.organizationId, orgId));
  console.log(`[verify] товаров ПОСЛЕ: ${after.length}`);
  console.log(`[verify] разница: ${after.length - before.length} (должно быть 0)`);

  if (after.length !== before.length) {
    console.error("[verify] FAIL: количество товаров изменилось — reconcile создал новые товары!");
    process.exit(1);
  }
  console.log("[verify] OK: количество товаров не изменилось, новых дублей не создано.");
}

main().catch((e) => {
  console.error("[verify] fatal:", e);
  process.exit(1);
});
