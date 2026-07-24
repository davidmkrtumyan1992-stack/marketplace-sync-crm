import { storage } from "./storage";
import type { NormalizedProduct } from "./marketplace-import";

export type ReconcileMarketplace = "ozon" | "wildberries" | "yandex";

export type ReconcileResult = {
  updated: number;
  unlinked: number;
};

function buildProductUpdates(mp: NormalizedProduct, marketplace: ReconcileMarketplace): Record<string, any> {
  const updates: Record<string, any> = {};
  if (mp.price !== undefined && mp.price !== null) {
    updates.sellingPrice = String(mp.price);
    updates.price = String(mp.price);
  }
  if (mp.stock !== undefined && mp.stock !== null) updates.centralStock = mp.stock;
  if (mp.name) updates.name = mp.name;
  if (mp.barcode) updates.barcode = mp.barcode;
  if (mp.imageUrl) updates.imageUrl = mp.imageUrl;
  if (mp.category) updates.category = mp.category;
  if (marketplace === "ozon" && mp.marketplaceId) updates.ozonId = mp.marketplaceId;
  if (marketplace === "wildberries" && mp.marketplaceId) updates.wbId = mp.marketplaceId;
  if (marketplace === "yandex" && mp.marketplaceId) updates.yandexId = mp.marketplaceId;
  return updates;
}

/**
 * Сверяет карточки, полученные с маркетплейса, с каталогом CRM.
 *
 * В отличие от старой логики (просто getProductBySkuAndOrg → создать новый товар,
 * если не нашли), эта функция НИКОГДА не создаёт товар сама. Центральный склад —
 * закрытый список, который пополняется только вручную (по образцу МоегоСклада).
 * Карточка, которая ни к чему не привязана, остаётся в marketplace_catalog_cache
 * и ждёт, пока человек либо привяжет её к существующему товару (поиск-пикер),
 * либо явно создаст из неё новый товар.
 */
export async function reconcileMarketplaceProducts(params: {
  items: NormalizedProduct[];
  storeId: number;
  orgId: string;
  marketplace: ReconcileMarketplace;
}): Promise<ReconcileResult> {
  const { items, storeId, orgId, marketplace } = params;

  // 1. Каталог-кеш магазина всегда обновляется целиком — независимо от результата
  //    сопоставления. Импорт/синк теперь тоже держит кеш тёплым, не только кнопка
  //    "Обновить каталог".
  await storage.upsertMarketplaceCatalogCache(
    items
      .filter(mp => mp.marketplaceId || mp.sku)
      .map(mp => ({
        organizationId: orgId,
        storeId,
        marketplaceProductId: (mp.marketplaceId ?? mp.sku)!,
        externalSku: mp.sku,
        name: mp.name,
        price: String(mp.price ?? 0),
        imageUrl: mp.imageUrl ?? null,
      }))
  );

  let updated = 0;
  let unlinked = 0;

  for (const mp of items) {
    if (!mp.sku && !mp.marketplaceId) { unlinked++; continue; }

    // 2. Матч по конкретному магазину через уже настроенную связь (ручную или прошлую авто).
    const link = await storage.getActiveLinkForStoreCard(storeId, mp.marketplaceId, mp.sku);
    if (link) {
      const updates = buildProductUpdates(mp, marketplace);
      if (Object.keys(updates).length > 0) await storage.updateProduct(link.productId, updates);
      updated++;
      continue;
    }

    // 3. Фоллбэк на старый глобальный sku-матч — только когда для этого товара ещё
    //    нет активной связи именно на этот магазин (иначе рискуем перепривязать
    //    товар на чужую карточку только потому, что sku случайно совпал).
    if (!mp.sku) { unlinked++; continue; }
    const fallback = await storage.getProductBySkuAndOrg(mp.sku, orgId);
    if (fallback) {
      const otherLink = await storage.getActiveLinkForProductAndStore(fallback.id, storeId);
      if (otherLink) {
        const sameCard =
          (!!otherLink.marketplaceProductId && otherLink.marketplaceProductId === mp.marketplaceId) ||
          (!!otherLink.externalSku && otherLink.externalSku === mp.sku);
        if (!sameCard) { unlinked++; continue; }
      }

      const updates = buildProductUpdates(mp, marketplace);
      if (Object.keys(updates).length > 0) await storage.updateProduct(fallback.id, updates);

      // Самоисцеление: записываем настоящую per-store связь, чтобы в следующий раз
      // сработал шаг 2 (точный матч), а не угадывание по sku.
      await storage.upsertProductMarketplaceLink({
        productId: fallback.id,
        storeId,
        organizationId: orgId,
        marketplaceProductId: mp.marketplaceId ?? null,
        externalSku: mp.sku,
        matchType: "auto_sku_fallback",
        confidenceScore: "0.70",
        isActive: true,
      });
      updated++;
      continue;
    }

    // 4. Ничего не совпало — карточка остаётся в кеше как непривязанная.
    //    createProduct здесь сознательно не вызывается.
    unlinked++;
  }

  return { updated, unlinked };
}
