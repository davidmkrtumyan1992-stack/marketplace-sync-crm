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

export async function fetchWildberriesProducts(apiToken: string): Promise<NormalizedProduct[]> {
  const CONTENT_BASE = "https://content-api.wildberries.ru";
  const STATS_BASE = "https://statistics-api.wildberries.ru";
  const headers: HeadersInit = {
    "Authorization": apiToken.startsWith("Bearer ") ? apiToken : `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };

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
  }

  let stockMap = new Map<string, number>();
  try {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 1);
    const stockRes = await fetchWithRetry(
      `${STATS_BASE}/api/v1/supplier/stocks?dateFrom=${dateFrom.toISOString().split("T")[0]}`,
      { method: "GET", headers }
    );
    const stockData = await stockRes.json();
    if (Array.isArray(stockData)) {
      for (const item of stockData) {
        const key = String(item.nmId || item.nmID);
        stockMap.set(key, (stockMap.get(key) || 0) + (item.quantity || 0));
      }
    }
  } catch {
  }

  return allCards.map((card: any) => {
    const nmId = String(card.nmID || card.nmId || "");
    const vendorCode = card.vendorCode || card.supplierArticle || "";
    const sizes = card.sizes || [];
    const firstSize = sizes[0] || {};
    const skus = firstSize.skus || card.skus || [];
    const barcode = skus[0] || "";

    let price = 0;
    if (firstSize.price) {
      price = firstSize.price;
    } else if (card.sizes?.[0]?.price) {
      price = card.sizes[0].price;
    }

    return {
      name: card.title || card.subjectName || vendorCode || `WB-${nmId}`,
      sku: vendorCode || nmId,
      barcode: barcode || undefined,
      category: card.subjectName || card.object || undefined,
      price,
      stock: stockMap.get(nmId) || 0,
      marketplaceId: nmId,
      imageUrl: card.mediaFiles?.[0] || undefined,
    };
  });
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
