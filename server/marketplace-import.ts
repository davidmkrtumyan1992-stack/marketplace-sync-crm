export type NormalizedProduct = {
  name: string;
  sku: string;
  barcode?: string;
  category?: string;
  price: number;
  stock: number;
  marketplaceId?: string;
  imageUrl?: string;
};

export type ImportResult = {
  created: number;
  updated: number;
  failed: number;
  errors: string[];
  products: NormalizedProduct[];
};

async function fetchWithRetry(url: string, options: RequestInit, retries = 2): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, options);
    if (res.ok) return res;
    if (res.status === 429 && i < retries) {
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
      continue;
    }
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  throw new Error("Превышено количество попыток запроса");
}

function buildOzonHeaders(apiKey: string, clientId: string): HeadersInit {
  return {
    "Client-Id": String(parseInt(clientId.trim(), 10)),
    "Api-Key": apiKey.trim(),
    "Content-Type": "application/json",
  };
}

export async function fetchOzonProducts(apiKey: string, clientId: string): Promise<NormalizedProduct[]> {
  const BASE = "https://api-seller.ozon.ru";
  const headers = buildOzonHeaders(apiKey, clientId);

  const allItems: any[] = [];
  let lastId = "";

  while (true) {
    const body: any = {
      filter: { visibility: "ALL" },
      limit: 1000,
    };
    if (lastId) body.last_id = lastId;

    const res = await fetchWithRetry(`${BASE}/v3/product/list`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await res.json();
    const items = data?.result?.items || [];
    allItems.push(...items);

    lastId = data?.result?.last_id || "";
    if (!lastId || items.length === 0) break;

    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`[Ozon Import] Step 1 complete: found ${allItems.length} product IDs`);

  const products: NormalizedProduct[] = [];
  const BATCH = 100;

  for (let i = 0; i < allItems.length; i += BATCH) {
    const batch = allItems.slice(i, i + BATCH);
    const offerIds = batch.map((item: any) => item.offer_id).filter(Boolean);
    if (offerIds.length === 0) continue;

    if (i > 0) {
      await new Promise(r => setTimeout(r, 500));
    }

    let infoItems: any[] = [];
    try {
      const infoRes = await fetchWithRetry(`${BASE}/v3/product/info/list`, {
        method: "POST",
        headers,
        body: JSON.stringify({ offer_id: offerIds, product_id: [], sku: [] }),
      });
      const infoData = await infoRes.json();
      infoItems = infoData?.items || [];
      if (i === 0 && infoItems.length === 0) {
        console.log(`[Ozon Import] V3 info returned 0 items for ${offerIds.length} offer_ids`);
      }
    } catch (err: any) {
      console.error(`[Ozon Import] V3 info batch ${i / BATCH + 1} failed: ${err.message}`);
      for (const item of batch) {
        products.push({
          name: item.offer_id || `Ozon-${item.product_id}`,
          sku: item.offer_id || String(item.product_id),
          price: 0,
          stock: 0,
          marketplaceId: String(item.product_id),
        });
      }
      continue;
    }

    console.log(`[Ozon Import] Step 2 batch ${i / BATCH + 1}: got V3 info for ${infoItems.length} products (requested ${offerIds.length})`);

    for (const info of infoItems) {
      const np = parseOzonInfoItem(info);
      products.push(np);
    }

    const infoOfferIds = new Set(infoItems.map((item: any) => item.offer_id));
    for (const item of batch) {
      if (!infoOfferIds.has(item.offer_id)) {
        products.push({
          name: item.offer_id || `Ozon-${item.product_id}`,
          sku: item.offer_id || String(item.product_id),
          price: 0,
          stock: 0,
          marketplaceId: String(item.product_id),
        });
      }
    }
  }

  console.log(`[Ozon Import] Step 2 complete: ${products.length} products with info (V3 includes inline stocks)`);

  const withImages = products.filter(p => p.imageUrl).length;
  const withPrice = products.filter(p => p.price > 0).length;
  const withStock = products.filter(p => p.stock > 0).length;
  console.log(`[Ozon Import] Final: ${products.length} products — ${withImages} with images, ${withPrice} with price, ${withStock} with stock`);

  return products;
}

function parseOzonInfoItem(info: any): NormalizedProduct {
  let price = 0;
  if (info.price && info.price !== "" && info.price !== "0" && info.price !== "0.00") {
    price = parseFloat(info.price);
  } else if (info.old_price && info.old_price !== "" && info.old_price !== "0" && info.old_price !== "0.00") {
    price = parseFloat(info.old_price);
  } else if (info.marketing_price && info.marketing_price !== "" && info.marketing_price !== "0") {
    price = parseFloat(info.marketing_price);
  } else if (info.min_price && info.min_price !== "" && info.min_price !== "0") {
    price = parseFloat(info.min_price);
  }
  if (isNaN(price)) price = 0;

  let stock = 0;
  if (info.stocks && typeof info.stocks === "object") {
    if (Array.isArray(info.stocks.stocks)) {
      for (const s of info.stocks.stocks) {
        stock += (s.present || 0);
      }
    } else if (typeof info.stocks.present === "number") {
      stock = info.stocks.present;
    }
  }

  let imageUrl: string | undefined;
  if (typeof info.primary_image === "string" && info.primary_image.startsWith("http")) {
    imageUrl = info.primary_image;
  } else if (Array.isArray(info.images) && info.images.length > 0 && typeof info.images[0] === "string" && info.images[0].startsWith("http")) {
    imageUrl = info.images[0];
  }

  let barcode: string | undefined;
  if (Array.isArray(info.barcodes) && info.barcodes.length > 0) {
    barcode = info.barcodes[0];
  } else if (info.barcode && info.barcode !== "") {
    barcode = info.barcode;
  }

  const categoryId = info.description_category_id || info.category_id;

  return {
    name: info.name || info.offer_id || `Ozon-${info.id}`,
    sku: info.offer_id || String(info.id),
    barcode,
    category: categoryId ? String(categoryId) : undefined,
    price,
    stock,
    marketplaceId: String(info.id),
    imageUrl,
  };
}

export async function enrichOzonProducts(
  apiKey: string,
  clientId: string,
  productsToEnrich: Array<{ id: number; sku: string; ozonId: string }>
): Promise<{ updated: number; failed: number; errors: string[]; updates: Array<{ dbId: number; data: NormalizedProduct }> }> {
  const BASE = "https://api-seller.ozon.ru";
  const headers = buildOzonHeaders(apiKey, clientId);

  let failed = 0;
  const errors: string[] = [];
  const updates: Array<{ dbId: number; data: NormalizedProduct }> = [];

  const BATCH = 100;
  for (let i = 0; i < productsToEnrich.length; i += BATCH) {
    const batch = productsToEnrich.slice(i, i + BATCH);
    const offerIds = batch.map(p => p.sku);

    if (i > 0) {
      await new Promise(r => setTimeout(r, 600));
    }

    try {
      const infoRes = await fetchWithRetry(`${BASE}/v3/product/info/list`, {
        method: "POST",
        headers,
        body: JSON.stringify({ offer_id: offerIds, product_id: [], sku: [] }),
      });
      const infoData = await infoRes.json();
      const infoItems: any[] = infoData?.items || [];

      if (i === 0) {
        console.log(`[Ozon Enrich] V3 API: ${infoItems.length} items for ${offerIds.length} offer_ids`);
        if (infoItems.length === 0) {
          console.log(`[Ozon Enrich] Empty response. Keys: ${JSON.stringify(Object.keys(infoData || {}))}`);
        }
      }

      const infoMap = new Map<string, any>();
      for (const item of infoItems) {
        if (item.offer_id) infoMap.set(item.offer_id, item);
      }

      let matchCount = 0;
      for (const p of batch) {
        const info = infoMap.get(p.sku);
        if (info) {
          const parsed = parseOzonInfoItem(info);
          updates.push({ dbId: p.id, data: parsed });
          matchCount++;
        }
      }
    } catch (err: any) {
      console.error(`[Ozon Enrich] V3 batch ${i / BATCH + 1} failed: ${err.message}`);
      failed += batch.length;
      if (errors.length < 10) errors.push(`Batch ${i / BATCH + 1}: ${err.message}`);
    }

    console.log(`[Ozon Enrich] Batch ${i / BATCH + 1}/${Math.ceil(productsToEnrich.length / BATCH)}: ${updates.length} enriched so far`);
  }

  const withImg = updates.filter(u => u.data.imageUrl).length;
  const withPrice = updates.filter(u => u.data.price > 0).length;
  const withStock = updates.filter(u => u.data.stock > 0).length;
  console.log(`[Ozon Enrich] SUMMARY: ${updates.length} updates — ${withImg} with images, ${withPrice} with price>0, ${withStock} with stock>0`);

  return { updated: updates.length, failed, errors, updates };
}

function buildWbHeaders(apiToken: string): HeadersInit {
  const token = apiToken.startsWith("Bearer ") ? apiToken.slice(7) : apiToken;
  return {
    "Authorization": token,
    "Content-Type": "application/json",
  };
}

function buildWbCdnImageUrl(nmId: number | string): string {
  const id = typeof nmId === "string" ? parseInt(nmId, 10) : nmId;
  if (isNaN(id) || id <= 0) return "";
  const vol = Math.floor(id / 100000);
  const part = Math.floor(id / 1000);
  let basket: number;
  if (vol >= 0 && vol <= 143) basket = 1;
  else if (vol <= 287) basket = 2;
  else if (vol <= 431) basket = 3;
  else if (vol <= 719) basket = 4;
  else if (vol <= 1007) basket = 5;
  else if (vol <= 1061) basket = 6;
  else if (vol <= 1115) basket = 7;
  else if (vol <= 1169) basket = 8;
  else if (vol <= 1313) basket = 9;
  else if (vol <= 1601) basket = 10;
  else if (vol <= 1655) basket = 11;
  else if (vol <= 1919) basket = 12;
  else if (vol <= 2045) basket = 13;
  else if (vol <= 2189) basket = 14;
  else if (vol <= 2405) basket = 15;
  else if (vol <= 2621) basket = 16;
  else if (vol <= 2837) basket = 17;
  else basket = 18;
  return `https://basket-${String(basket).padStart(2, "0")}.wbbasket.ru/vol${vol}/part${part}/${id}/images/c516x688/1.webp`;
}

function collectAllBarcodes(cards: any[]): string[] {
  const barcodes: string[] = [];
  for (const card of cards) {
    const sizes = card.sizes || [];
    for (const size of sizes) {
      const skus = size.skus || [];
      for (const sku of skus) {
        if (sku) barcodes.push(String(sku));
      }
    }
    if (card.skus) {
      for (const sku of card.skus) {
        if (sku) barcodes.push(String(sku));
      }
    }
  }
  return Array.from(new Set(barcodes));
}

async function fetchWbStocks(apiToken: string, warehouseId: string, barcodes: string[]): Promise<Map<string, number>> {
  const stockMap = new Map<string, number>();
  const headers = buildWbHeaders(apiToken);
  const BATCH = 1000;

  for (let i = 0; i < barcodes.length; i += BATCH) {
    const batch = barcodes.slice(i, i + BATCH);
    try {
      const stockRes = await fetchWithRetry(
        `https://marketplace-api.wildberries.ru/api/v3/stocks/${warehouseId}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ skus: batch }),
        }
      );
      const stockData = await stockRes.json();
      const stocks = stockData?.stocks || [];
      for (const item of stocks) {
        const key = String(item.sku || "");
        if (key) stockMap.set(key, (stockMap.get(key) || 0) + (item.amount || 0));
      }
    } catch (err: any) {
      console.warn(`[WB Stocks] Batch ${i / BATCH + 1} failed: ${err.message}`);
    }
    if (i + BATCH < barcodes.length) await new Promise(r => setTimeout(r, 300));
  }

  return stockMap;
}

async function fetchWbPrices(apiToken: string): Promise<Map<string, { price: number; discount: number }>> {
  const priceMap = new Map<string, { price: number; discount: number }>();
  const headers = buildWbHeaders(apiToken);
  let offset = 0;
  const LIMIT = 1000;

  while (true) {
    try {
      const priceRes = await fetchWithRetry(
        `https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=${LIMIT}&offset=${offset}`,
        { method: "GET", headers }
      );
      const priceData = await priceRes.json();
      const goods = priceData?.data?.listGoods || [];

      if (goods.length === 0) break;

      for (const g of goods) {
        const key = String(g.nmID);
        const sizes = g.sizes || [];
        const firstSize = sizes[0] || {};
        const discount = g.discount || 0;
        let finalPrice = 0;

        if (firstSize.discountedPrice && firstSize.discountedPrice > 0) {
          finalPrice = firstSize.discountedPrice;
        } else if (firstSize.price && firstSize.price > 0) {
          finalPrice = discount > 0 ? Math.round(firstSize.price * (1 - discount / 100)) : firstSize.price;
        }

        if (finalPrice > 0) {
          priceMap.set(key, { price: finalPrice, discount });
        }
      }

      offset += LIMIT;
      if (goods.length < LIMIT) break;
      await new Promise(r => setTimeout(r, 300));
    } catch (err: any) {
      console.warn(`[WB Prices] Offset ${offset} failed: ${err.message}`);
      break;
    }
  }

  return priceMap;
}

async function resolveWbWarehouses(apiToken: string, warehouseId?: string): Promise<number[]> {
  if (warehouseId) return [parseInt(warehouseId, 10)];

  const headers = buildWbHeaders(apiToken);
  try {
    const res = await fetchWithRetry(
      `https://marketplace-api.wildberries.ru/api/v3/warehouses`,
      { method: "GET", headers }
    );
    const warehouses = await res.json();
    if (Array.isArray(warehouses) && warehouses.length > 0) {
      console.log(`[WB] Found ${warehouses.length} warehouses: ${warehouses.map((w: any) => `${w.name} (id=${w.id})`).join(", ")}`);
      return warehouses.map((w: any) => w.id).filter(Boolean);
    }
    console.warn(`[WB] No warehouses found`);
    return [];
  } catch (err: any) {
    console.warn(`[WB] Warehouse fetch failed: ${err.message}`);
    return [];
  }
}

export async function fetchWildberriesProducts(apiToken: string, warehouseId?: string): Promise<NormalizedProduct[]> {
  const CONTENT_BASE = "https://content-api.wildberries.ru";
  const headers = buildWbHeaders(apiToken);

  console.log(`[WB Import] Step 1: Fetching product cards...`);
  const allCards: any[] = [];
  let cursor: any = { limit: 100 };

  while (true) {
    const body = {
      settings: {
        cursor,
        filter: { withPhoto: -1 },
      },
    };

    const res = await fetchWithRetry(`${CONTENT_BASE}/content/v2/get/cards/list`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await res.json();
    const cards = data?.cards || data?.data?.cards || [];
    allCards.push(...cards);

    const nextCursor = data?.cursor || data?.data?.cursor;
    if (!nextCursor || cards.length < 100) break;

    cursor = {
      limit: 100,
      updatedAt: nextCursor.updatedAt,
      nmID: nextCursor.nmID,
    };

    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`[WB Import] Step 1 complete: ${allCards.length} cards fetched`);

  console.log(`[WB Import] Step 2: Fetching prices (with pagination)...`);
  const priceMap = await fetchWbPrices(apiToken);
  console.log(`[WB Import] Step 2 complete: ${priceMap.size} prices fetched`);

  console.log(`[WB Import] Step 3: Fetching stock levels...`);
  const allBarcodes = collectAllBarcodes(allCards);
  console.log(`[WB Import] Collected ${allBarcodes.length} unique barcodes from cards`);

  const stockMap = new Map<string, number>();
  const warehouseIds = await resolveWbWarehouses(apiToken, warehouseId);

  for (const whId of warehouseIds) {
    try {
      const whStocks = await fetchWbStocks(apiToken, String(whId), allBarcodes);
      whStocks.forEach((val, key) => {
        stockMap.set(key, (stockMap.get(key) || 0) + val);
      });
      console.log(`[WB Import] Warehouse ${whId}: ${whStocks.size} stock entries`);
    } catch (err: any) {
      console.warn(`[WB Import] Warehouse ${whId} stocks failed: ${err.message}`);
    }
    if (warehouseIds.length > 1) await new Promise(r => setTimeout(r, 300));
  }
  console.log(`[WB Import] Step 3 complete: ${stockMap.size} total stock entries across ${warehouseIds.length} warehouses`);

  console.log(`[WB Import] Step 4: Building product list with CDN images...`);
  const products = allCards.map((card: any) => {
    const nmId = String(card.nmID || card.nmId || "");
    const vendorCode = card.vendorCode || card.supplierArticle || "";
    const sizes = card.sizes || [];
    const firstSize = sizes[0] || {};
    const skus = firstSize.skus || card.skus || [];
    const barcode = skus[0] || "";

    const priceEntry = priceMap.get(nmId);
    let price = priceEntry?.price || 0;
    if (price === 0 && firstSize.price) {
      price = firstSize.price;
    }
    if (price === 0 && card.sizes?.[0]?.price) {
      price = card.sizes[0].price;
    }

    let imageUrl: string | undefined;
    const mediaFiles: string[] = card.mediaFiles || [];
    if (mediaFiles.length > 0) {
      const firstMedia = mediaFiles[0];
      imageUrl = firstMedia.startsWith("http") ? firstMedia : `https://${firstMedia}`;
    }
    if (!imageUrl) {
      imageUrl = buildWbCdnImageUrl(nmId) || undefined;
    }

    let stock = 0;
    for (const sku of skus) {
      stock += stockMap.get(String(sku)) || 0;
    }
    if (stock === 0) {
      stock = stockMap.get(nmId) || 0;
    }
    if (stock === 0 && barcode) {
      stock = stockMap.get(barcode) || 0;
    }

    return {
      name: card.title || card.subjectName || vendorCode || `WB-${nmId}`,
      sku: vendorCode || nmId,
      barcode: barcode || undefined,
      category: card.subjectName || card.object || undefined,
      price,
      stock,
      marketplaceId: nmId,
      imageUrl,
    };
  });

  const withImages = products.filter(p => p.imageUrl).length;
  const withPrice = products.filter(p => p.price > 0).length;
  const withStock = products.filter(p => p.stock > 0).length;
  console.log(`[WB Import] Final: ${products.length} products — ${withImages} with images, ${withPrice} with price, ${withStock} with stock`);

  return products;
}

export async function enrichWbProducts(
  apiToken: string,
  warehouseId: string | undefined,
  productsToEnrich: Array<{ id: number; sku: string; wbId: string; barcode?: string | null }>
): Promise<{ updated: number; failed: number; errors: string[]; updates: Array<{ dbId: number; data: Partial<NormalizedProduct> }> }> {
  const CONTENT_BASE = "https://content-api.wildberries.ru";
  const headers = buildWbHeaders(apiToken);
  const updates: Array<{ dbId: number; data: Partial<NormalizedProduct> }> = [];
  const errors: string[] = [];
  let failed = 0;

  const targetNmIds = new Set(productsToEnrich.map(p => p.wbId));
  console.log(`[WB Sync] Starting deep enrichment for ${productsToEnrich.length} products (${targetNmIds.size} unique nmIds)...`);

  // Step 1: Collect barcodes from DB for products linked to WB
  console.log(`[WB Sync] Step 1: Collecting barcodes from database...`);
  const dbBarcodes: string[] = [];
  const barcodeToProduct = new Map<string, string[]>();
  for (const p of productsToEnrich) {
    if (p.barcode && p.barcode.length > 0) {
      dbBarcodes.push(p.barcode);
      const existing = barcodeToProduct.get(p.barcode) || [];
      existing.push(p.wbId);
      barcodeToProduct.set(p.barcode, existing);
    }
  }
  const uniqueDbBarcodes = Array.from(new Set(dbBarcodes));
  console.log(`[WB Sync] Found ${uniqueDbBarcodes.length} barcodes in database for ${productsToEnrich.length} WB products`);

  // Step 2: Fetch product cards from WB to get fresh barcodes and mediaFiles
  console.log(`[WB Sync] Step 2: Fetching product cards from WB for photo and barcode recovery...`);
  const allCards: any[] = [];
  let cursor: any = { limit: 100 };

  while (true) {
    const body = {
      settings: {
        cursor,
        filter: { withPhoto: -1 },
      },
    };
    try {
      const res = await fetchWithRetry(`${CONTENT_BASE}/content/v2/get/cards/list`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      const cards = data?.cards || data?.data?.cards || [];
      allCards.push(...cards);

      const nextCursor = data?.cursor || data?.data?.cursor;
      if (!nextCursor || cards.length < 100) break;

      cursor = {
        limit: 100,
        updatedAt: nextCursor.updatedAt,
        nmID: nextCursor.nmID,
      };
      await new Promise(r => setTimeout(r, 300));
    } catch (err: any) {
      console.error(`[WB Sync] Card fetch failed: ${err.message}`);
      break;
    }
  }

  // Filter cards to only those matching our target products
  const cardMap = new Map<string, any>();
  for (const card of allCards) {
    const nmId = String(card.nmID || card.nmId || "");
    if (nmId && targetNmIds.has(nmId)) {
      cardMap.set(nmId, card);
    }
  }
  console.log(`[WB Sync] Step 2 complete: ${allCards.length} total cards from WB, ${cardMap.size} matched to our products`);

  // Step 3: Merge barcodes — DB barcodes + fresh barcodes from matched cards
  console.log(`[WB Sync] Step 3: Merging barcodes and fetching stocks...`);
  const productBarcodeMap = new Map<string, string[]>(); // nmId -> barcodes for that product
  for (const product of productsToEnrich) {
    const barcodes: string[] = [];
    if (product.barcode && product.barcode.length > 0) {
      barcodes.push(product.barcode);
    }
    const card = cardMap.get(product.wbId);
    if (card) {
      const sizes = card.sizes || [];
      for (const size of sizes) {
        const skus = size.skus || [];
        for (const sku of skus) {
          if (sku && !barcodes.includes(String(sku))) barcodes.push(String(sku));
        }
      }
      if (card.skus) {
        for (const sku of card.skus) {
          if (sku && !barcodes.includes(String(sku))) barcodes.push(String(sku));
        }
      }
    }
    productBarcodeMap.set(product.wbId, barcodes);
  }

  // Collect all unique barcodes across all target products for batch stock fetch
  const allBarcodesSet = new Set<string>();
  productBarcodeMap.forEach((barcodes) => {
    for (const b of barcodes) allBarcodesSet.add(b);
  });
  // Also include DB barcodes that may not be in cards
  for (const b of uniqueDbBarcodes) allBarcodesSet.add(b);
  const allBarcodes = Array.from(allBarcodesSet);
  console.log(`[WB Sync] Total unique barcodes for stock query: ${allBarcodes.length} (${uniqueDbBarcodes.length} from DB, rest from cards)`);

  // Fetch stocks only for our barcodes — never send empty array
  const stockMap = new Map<string, number>();
  if (allBarcodes.length > 0) {
    const warehouseIds = await resolveWbWarehouses(apiToken, warehouseId);
    console.log(`[WB Sync] Querying stocks across ${warehouseIds.length} warehouse(s)...`);

    for (const whId of warehouseIds) {
      try {
        const whStocks = await fetchWbStocks(apiToken, String(whId), allBarcodes);
        whStocks.forEach((val, key) => {
          stockMap.set(key, (stockMap.get(key) || 0) + val);
        });
        console.log(`[WB Sync] Warehouse ${whId}: ${whStocks.size} stock entries`);
      } catch (err: any) {
        console.warn(`[WB Sync] Warehouse ${whId} stocks failed: ${err.message}`);
      }
      if (warehouseIds.length > 1) await new Promise(r => setTimeout(r, 300));
    }
  } else {
    console.warn(`[WB Sync] No barcodes found (DB or cards) — skipping stock fetch`);
  }
  console.log(`[WB Sync] Step 3 complete: ${stockMap.size} stock entries from API`);

  // Step 4: Fetch prices with pagination
  console.log(`[WB Sync] Step 4: Fetching prices...`);
  const priceMap = await fetchWbPrices(apiToken);
  console.log(`[WB Sync] Step 4 complete: ${priceMap.size} prices fetched`);

  // Step 5: Build updates for each product
  console.log(`[WB Sync] Step 5: Building updates for ${productsToEnrich.length} products...`);
  let photosUpdated = 0;
  let stocksUpdated = 0;

  for (const product of productsToEnrich) {
    try {
      const nmId = product.wbId;
      const card = cardMap.get(nmId);
      const data: Partial<NormalizedProduct> = {};

      // Photo: primary source is mediaFiles from card, fallback to CDN URL
      let imageUrl: string | undefined;
      if (card) {
        const mediaFiles: string[] = card.mediaFiles || [];
        if (mediaFiles.length > 0) {
          const firstPhoto = mediaFiles[0];
          imageUrl = firstPhoto.startsWith("http") ? firstPhoto : `https://${firstPhoto}`;
        }
      }
      if (!imageUrl) {
        imageUrl = buildWbCdnImageUrl(nmId);
      }
      if (imageUrl) {
        data.imageUrl = imageUrl;
        photosUpdated++;
      }

      // Price from price API
      const priceEntry = priceMap.get(nmId);
      if (priceEntry && priceEntry.price > 0) {
        data.price = priceEntry.price;
      }

      // Barcode: get fresh barcode from card data if product doesn't have one
      const productBarcodes = productBarcodeMap.get(nmId) || [];
      if (productBarcodes.length > 0 && (!product.barcode || product.barcode.length === 0)) {
        data.barcode = productBarcodes[0];
      } else if (productBarcodes.length > 0 && product.barcode) {
        // Keep existing barcode, but also save the first card barcode if different
        const cardBarcode = card ? (card.sizes?.[0]?.skus?.[0] || card.skus?.[0]) : undefined;
        if (cardBarcode && String(cardBarcode) !== product.barcode) {
          data.barcode = String(cardBarcode);
        }
      }

      // Stock: sum up stocks for all barcodes belonging to THIS product only
      let stock = 0;
      for (const bc of productBarcodes) {
        stock += stockMap.get(bc) || 0;
      }
      data.stock = stock;
      if (stock > 0) stocksUpdated++;

      updates.push({ dbId: product.id, data });
    } catch (err: any) {
      failed++;
      if (errors.length < 10) errors.push(`${product.sku}: ${err.message}`);
    }
  }

  const withPrice = updates.filter(u => (u.data.price || 0) > 0).length;
  console.log(`[WB Sync] Updated ${photosUpdated} products with photos and ${stocksUpdated} products with stocks`);
  console.log(`[WB Sync] Price data: ${withPrice} products with price > 0`);
  console.log(`[WB Sync] Total updates: ${updates.length}, failed: ${failed}`);

  return { updated: updates.length, failed, errors, updates };
}

export async function fixWbPhotos(
  apiToken: string,
  productsToFix: Array<{ id: number; wbId: string }>
): Promise<{ updated: number; failed: number; photoMap: Map<number, string> }> {
  const CONTENT_BASE = "https://content-api.wildberries.ru";
  const headers = buildWbHeaders(apiToken);
  const photoMap = new Map<number, string>();
  let failed = 0;

  const targetNmIds = new Set(productsToFix.map(p => p.wbId));
  console.log(`[WB Photo Fix] Fetching cards for ${productsToFix.length} products...`);

  const allCards: any[] = [];
  let cursor: any = { limit: 100 };

  while (true) {
    const body = {
      settings: {
        cursor,
        filter: { withPhoto: -1 },
      },
    };
    try {
      const res = await fetchWithRetry(`${CONTENT_BASE}/content/v2/get/cards/list`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      const cards = data?.cards || data?.data?.cards || [];
      allCards.push(...cards);

      const nextCursor = data?.cursor || data?.data?.cursor;
      if (!nextCursor || cards.length < 100) break;

      cursor = {
        limit: 100,
        updatedAt: nextCursor.updatedAt,
        nmID: nextCursor.nmID,
      };
      await new Promise(r => setTimeout(r, 300));
    } catch (err: any) {
      console.error(`[WB Photo Fix] Card fetch failed: ${err.message}`);
      break;
    }
  }

  console.log(`[WB Photo Fix] Fetched ${allCards.length} cards from WB`);

  const cardMap = new Map<string, any>();
  for (const card of allCards) {
    const nmId = String(card.nmID || card.nmId || "");
    if (nmId && targetNmIds.has(nmId)) {
      cardMap.set(nmId, card);
    }
  }
  console.log(`[WB Photo Fix] Matched ${cardMap.size} cards to target products`);

  for (const product of productsToFix) {
    const card = cardMap.get(product.wbId);
    if (!card) {
      failed++;
      continue;
    }

    const mediaFiles: string[] = card.mediaFiles || [];
    let imageUrl: string | undefined;

    if (mediaFiles.length > 0) {
      const firstMedia = mediaFiles[0];
      imageUrl = firstMedia.startsWith("http") ? firstMedia : `https://${firstMedia}`;
    }

    if (!imageUrl) {
      const photos: any[] = card.photos || [];
      if (photos.length > 0) {
        const photo = photos[0];
        let photoUrl: string | undefined;
        if (typeof photo === "string") {
          photoUrl = photo;
        } else if (photo && typeof photo === "object") {
          photoUrl = photo.big || photo.c516x688 || photo.tm || photo.c246x328 || photo.square || photo.small;
        }
        if (photoUrl) {
          imageUrl = photoUrl.startsWith("http") ? photoUrl : `https://${photoUrl}`;
        }
      }
    }

    if (!imageUrl) {
      imageUrl = buildWbCdnImageUrl(product.wbId);
    }

    if (imageUrl && imageUrl.startsWith("http")) {
      photoMap.set(product.id, imageUrl);
      console.log(`[WB Photo Fix] Updated image for nmId: ${product.wbId}`);
    } else {
      failed++;
    }
  }

  console.log(`[WB Photo Fix] Result: ${photoMap.size} photos found, ${failed} failed`);
  return { updated: photoMap.size, failed, photoMap };
}

export async function pushWbPrice(
  apiToken: string,
  nmId: string,
  price: number
): Promise<{ success: boolean; error?: string }> {
  const headers = buildWbHeaders(apiToken);

  try {
    const res = await fetchWithRetry(
      `https://discounts-prices-api.wildberries.ru/api/v2/upload/task`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          data: [{
            nmID: parseInt(nmId, 10),
            price: Math.round(price),
          }],
        }),
      }
    );
    const data = await res.json();

    if (data?.error || data?.errorText) {
      return { success: false, error: data.errorText || data.error || "Ошибка обновления цены в WB" };
    }
    if (data?.data?.alreadyExists === true) {
      return { success: true };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Ошибка обновления цены в WB" };
  }
}

export type WbSyncResult = {
  priceUpdated: boolean;
  errors: string[];
};

export async function syncProductToWb(
  apiToken: string,
  nmId: string,
  updates: { sellingPrice?: number }
): Promise<WbSyncResult> {
  const result: WbSyncResult = {
    priceUpdated: false,
    errors: [],
  };

  if (updates.sellingPrice !== undefined) {
    const priceResult = await pushWbPrice(apiToken, nmId, updates.sellingPrice);
    if (priceResult.success) {
      result.priceUpdated = true;
    } else {
      result.errors.push(`Цена WB: ${priceResult.error}`);
    }
  }

  return result;
}

export async function fetchYandexProducts(oauthToken: string, clientId: string, businessId: string): Promise<NormalizedProduct[]> {
  const BASE = "https://api.partner.market.yandex.ru";
  const headers: HeadersInit = {
    "Authorization": `Bearer ${oauthToken}`,
    "Content-Type": "application/json",
  };

  const allEntries: any[] = [];
  let pageToken: string | undefined;

  while (true) {
    let url = `${BASE}/businesses/${businessId}/offer-mappings`;
    const params: string[] = [];
    if (pageToken) params.push(`page_token=${encodeURIComponent(pageToken)}`);
    params.push("limit=200");
    if (params.length > 0) url += `?${params.join("&")}`;

    const res = await fetchWithRetry(url, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });

    const data = await res.json();
    const entries = data?.result?.offerMappings || data?.result?.offerMappingEntries || [];
    allEntries.push(...entries);

    pageToken = data?.result?.paging?.nextPageToken;
    if (!pageToken || entries.length === 0) break;
  }

  return allEntries.map((entry: any) => {
    const offer = entry.offer || {};
    return {
      name: offer.name || offer.shopSku || "Товар Яндекс",
      sku: offer.shopSku || "",
      barcode: offer.barcodes?.[0] || undefined,
      category: offer.category || undefined,
      price: offer.price?.value || offer.basicPrice?.value || 0,
      stock: 0,
      marketplaceId: entry.mapping?.marketSku ? String(entry.mapping.marketSku) : undefined,
      imageUrl: offer.pictures?.[0] || undefined,
    };
  }).filter(p => p.sku);
}

export type OzonSyncResult = {
  priceUpdated: boolean;
  attributesUpdated: boolean;
  errors: string[];
};

export async function pushOzonPrice(
  apiKey: string,
  clientId: string,
  offerId: string,
  price: number,
  oldPrice?: number
): Promise<{ success: boolean; error?: string }> {
  const BASE = "https://api-seller.ozon.ru";
  const headers = buildOzonHeaders(apiKey, clientId);

  const priceItem: any = {
    offer_id: offerId,
    price: String(price),
    currency_code: "RUB",
  };
  if (oldPrice && oldPrice > price) {
    priceItem.old_price = String(oldPrice);
  }

  try {
    const res = await fetchWithRetry(`${BASE}/v4/product/info/prices`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prices: [priceItem] }),
    });
    const data = await res.json();
    const result = data?.result?.[0];
    if (result?.errors && result.errors.length > 0) {
      return { success: false, error: result.errors.map((e: any) => e.message || e.code).join("; ") };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Ошибка обновления цены в Ozon" };
  }
}

export async function pushOzonAttributes(
  apiKey: string,
  clientId: string,
  offerId: string,
  updates: { name?: string; barcode?: string }
): Promise<{ success: boolean; error?: string }> {
  const BASE = "https://api-seller.ozon.ru";
  const headers = buildOzonHeaders(apiKey, clientId);

  const attributes: any[] = [];
  if (updates.name) {
    attributes.push({ id: 4180, values: [{ value: updates.name }] });
  }
  if (updates.barcode) {
    attributes.push({ id: 8229, values: [{ value: updates.barcode }] });
  }

  if (attributes.length === 0) {
    return { success: true };
  }

  try {
    const res = await fetchWithRetry(`${BASE}/v1/product/update`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        items: [{
          offer_id: offerId,
          attributes,
        }],
      }),
    });
    const data = await res.json();
    if (data?.result?.task_id) {
      return { success: true };
    }
    if (data?.message) {
      return { success: false, error: data.message };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Ошибка обновления атрибутов в Ozon" };
  }
}

export async function syncProductToOzon(
  apiKey: string,
  clientId: string,
  offerId: string,
  updates: { name?: string; barcode?: string; sellingPrice?: number; oldPrice?: number }
): Promise<OzonSyncResult> {
  const result: OzonSyncResult = {
    priceUpdated: false,
    attributesUpdated: false,
    errors: [],
  };

  if (updates.sellingPrice !== undefined) {
    const priceResult = await pushOzonPrice(apiKey, clientId, offerId, updates.sellingPrice, updates.oldPrice);
    if (priceResult.success) {
      result.priceUpdated = true;
    } else {
      result.errors.push(`Цена: ${priceResult.error}`);
    }
  }

  const attrUpdates: { name?: string; barcode?: string } = {};
  if (updates.name) attrUpdates.name = updates.name;
  if (updates.barcode) attrUpdates.barcode = updates.barcode;

  if (Object.keys(attrUpdates).length > 0) {
    const attrResult = await pushOzonAttributes(apiKey, clientId, offerId, attrUpdates);
    if (attrResult.success) {
      result.attributesUpdated = true;
    } else {
      result.errors.push(`Атрибуты: ${attrResult.error}`);
    }
  }

  return result;
}
