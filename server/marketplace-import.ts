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
      const infoRes = await fetchWithRetry(`${BASE}/v2/product/info/list`, {
        method: "POST",
        headers,
        body: JSON.stringify({ offer_id: offerIds }),
      });
      const infoData = await infoRes.json();
      infoItems = infoData?.result?.items || [];
      if (i === 0) {
        const sample = infoItems[0];
        if (sample) {
          console.log(`[Ozon Import] Sample info keys: ${Object.keys(sample).join(", ")}`);
          console.log(`[Ozon Import] Sample price: "${sample.price}", old_price: "${sample.old_price}", marketing_price: "${sample.marketing_price}"`);
          console.log(`[Ozon Import] Sample stocks: ${JSON.stringify(sample.stocks)}`);
          console.log(`[Ozon Import] Sample images: ${JSON.stringify((sample.images || []).slice(0, 2))}`);
          console.log(`[Ozon Import] Sample primary_image: "${sample.primary_image}"`);
          console.log(`[Ozon Import] Sample name: "${sample.name}", offer_id: "${sample.offer_id}"`);
        } else {
          console.log(`[Ozon Import] WARNING: info response has 0 items for first batch of ${offerIds.length} offer_ids`);
          console.log(`[Ozon Import] Raw response keys: ${JSON.stringify(Object.keys(infoData || {}))}`);
          console.log(`[Ozon Import] Result keys: ${JSON.stringify(Object.keys(infoData?.result || {}))}`);
        }
      }
    } catch (err: any) {
      console.error(`[Ozon Import] Info batch ${i / BATCH + 1} failed: ${err.message}`);
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

    console.log(`[Ozon Import] Step 2 batch ${i / BATCH + 1}: got info for ${infoItems.length} products (requested ${offerIds.length})`);

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

  console.log(`[Ozon Import] Step 2 complete: ${products.length} products with info`);

  const stockMap = new Map<string, number>();
  const STOCK_BATCH = 100;
  for (let i = 0; i < allItems.length; i += STOCK_BATCH) {
    const batch = allItems.slice(i, i + STOCK_BATCH);
    const productIds = batch.map((item: any) => item.product_id).filter(Boolean);
    if (productIds.length === 0) continue;

    if (i > 0) {
      await new Promise(r => setTimeout(r, 500));
    }

    try {
      const stockRes = await fetchWithRetry(`${BASE}/v1/product/info/stocks`, {
        method: "POST",
        headers,
        body: JSON.stringify({ product_id: productIds }),
      });
      const stockData = await stockRes.json();
      const stockItems = stockData?.result?.items || [];
      if (i === 0 && stockItems[0]) {
        console.log(`[Ozon Import] Sample stock item: ${JSON.stringify(stockItems[0])}`);
      }
      for (const si of stockItems) {
        const offerId = si.offer_id || "";
        let total = 0;
        if (Array.isArray(si.stocks)) {
          for (const s of si.stocks) {
            total += s.present || 0;
          }
        }
        if (offerId) stockMap.set(offerId, total);
        stockMap.set(String(si.product_id), total);
      }
    } catch (err: any) {
      console.error(`[Ozon Import] Stock batch ${i / STOCK_BATCH + 1} failed: ${err.message}`);
    }
  }

  console.log(`[Ozon Import] Step 3 complete: got stock for ${stockMap.size} entries`);

  for (const p of products) {
    const stockBySku = stockMap.get(p.sku);
    const stockByMpId = p.marketplaceId ? stockMap.get(p.marketplaceId) : undefined;
    if (stockBySku !== undefined) {
      p.stock = stockBySku;
    } else if (stockByMpId !== undefined) {
      p.stock = stockByMpId;
    }
  }

  const withImages = products.filter(p => p.imageUrl).length;
  const withPrice = products.filter(p => p.price > 0).length;
  const withStock = products.filter(p => p.stock > 0).length;
  console.log(`[Ozon Import] Final: ${products.length} products — ${withImages} with images, ${withPrice} with price, ${withStock} with stock`);

  return products;
}

function parseOzonInfoItem(info: any): NormalizedProduct {
  let price = 0;
  if (info.price && info.price !== "" && info.price !== "0") {
    price = parseFloat(info.price);
  } else if (info.old_price && info.old_price !== "" && info.old_price !== "0") {
    price = parseFloat(info.old_price);
  } else if (info.marketing_price && info.marketing_price !== "" && info.marketing_price !== "0") {
    price = parseFloat(info.marketing_price);
  } else if (info.min_ozon_price && info.min_ozon_price !== "" && info.min_ozon_price !== "0") {
    price = parseFloat(info.min_ozon_price);
  }
  if (isNaN(price)) price = 0;

  let stock = 0;
  if (info.stocks && typeof info.stocks === "object" && !Array.isArray(info.stocks)) {
    stock = info.stocks.present ?? info.stocks.coming ?? 0;
  }

  let imageUrl: string | undefined;
  if (typeof info.primary_image === "string" && info.primary_image.length > 0) {
    imageUrl = info.primary_image;
  } else if (Array.isArray(info.images) && info.images.length > 0) {
    imageUrl = info.images[0];
  }

  let barcode: string | undefined;
  if (info.barcode && info.barcode !== "") {
    barcode = info.barcode;
  } else if (Array.isArray(info.barcodes) && info.barcodes.length > 0) {
    barcode = info.barcodes[0];
  }

  return {
    name: info.name || info.offer_id || `Ozon-${info.id}`,
    sku: info.offer_id || String(info.id),
    barcode,
    category: info.category_id ? String(info.category_id) : undefined,
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

  // STEP 0: Diagnostic — call /v2/product/info for the FIRST product (single-item endpoint) to see full response
  if (productsToEnrich.length > 0) {
    const firstProduct = productsToEnrich[0];
    const diagProductId = parseInt(firstProduct.ozonId);
    console.log(`[Ozon Enrich DIAG] Testing single product: sku="${firstProduct.sku}", ozonId="${firstProduct.ozonId}", dbId=${firstProduct.id}`);

    try {
      const diagRes = await fetchWithRetry(`${BASE}/v2/product/info`, {
        method: "POST",
        headers,
        body: JSON.stringify({ offer_id: firstProduct.sku }),
      });
      const diagData = await diagRes.json();
      const diagResult = diagData?.result;
      if (diagResult) {
        console.log(`[Ozon Enrich DIAG] /v2/product/info TOP-LEVEL KEYS: ${JSON.stringify(Object.keys(diagResult))}`);
        console.log(`[Ozon Enrich DIAG] name: "${diagResult.name}"`);
        console.log(`[Ozon Enrich DIAG] offer_id: "${diagResult.offer_id}"`);
        console.log(`[Ozon Enrich DIAG] id: ${diagResult.id}`);
        console.log(`[Ozon Enrich DIAG] barcode: "${diagResult.barcode}"`);
        console.log(`[Ozon Enrich DIAG] price: "${diagResult.price}"`);
        console.log(`[Ozon Enrich DIAG] old_price: "${diagResult.old_price}"`);
        console.log(`[Ozon Enrich DIAG] marketing_price: "${diagResult.marketing_price}"`);
        console.log(`[Ozon Enrich DIAG] min_price: "${diagResult.min_price}"`);
        console.log(`[Ozon Enrich DIAG] primary_image: "${diagResult.primary_image}"`);
        console.log(`[Ozon Enrich DIAG] images: ${JSON.stringify(diagResult.images)}`);
        console.log(`[Ozon Enrich DIAG] stocks: ${JSON.stringify(diagResult.stocks)}`);
        console.log(`[Ozon Enrich DIAG] sources: ${JSON.stringify(diagResult.sources)}`);
        console.log(`[Ozon Enrich DIAG] visibility_details: ${JSON.stringify(diagResult.visibility_details)}`);
        console.log(`[Ozon Enrich DIAG] status: ${JSON.stringify(diagResult.status)}`);
        console.log(`[Ozon Enrich DIAG] FULL RAW (first 3000 chars): ${JSON.stringify(diagResult).slice(0, 3000)}`);
      } else {
        console.log(`[Ozon Enrich DIAG] /v2/product/info returned NO result. Full response keys: ${JSON.stringify(Object.keys(diagData || {}))}`);
        console.log(`[Ozon Enrich DIAG] Full response (first 1000 chars): ${JSON.stringify(diagData).slice(0, 1000)}`);
      }
    } catch (err: any) {
      console.error(`[Ozon Enrich DIAG] /v2/product/info failed: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // STEP 1: Fetch product info in batches via /v2/product/info/list
  const BATCH = 50;
  for (let i = 0; i < productsToEnrich.length; i += BATCH) {
    const batch = productsToEnrich.slice(i, i + BATCH);
    const offerIds = batch.map(p => p.sku);

    if (i > 0) {
      await new Promise(r => setTimeout(r, 600));
    }

    try {
      const infoRes = await fetchWithRetry(`${BASE}/v2/product/info/list`, {
        method: "POST",
        headers,
        body: JSON.stringify({ offer_id: offerIds }),
      });
      const infoData = await infoRes.json();
      const infoItems: any[] = infoData?.result?.items || [];

      if (i === 0) {
        console.log(`[Ozon Enrich] /v2/product/info/list response: ${infoItems.length} items for ${offerIds.length} offer_ids`);
        if (infoItems.length === 0) {
          console.log(`[Ozon Enrich] EMPTY RESPONSE! Full data keys: ${JSON.stringify(Object.keys(infoData || {}))}`);
          console.log(`[Ozon Enrich] Full response (first 1000): ${JSON.stringify(infoData).slice(0, 1000)}`);
          console.log(`[Ozon Enrich] Sent offer_ids sample: ${JSON.stringify(offerIds.slice(0, 5))}`);
        }
        for (let j = 0; j < Math.min(5, infoItems.length); j++) {
          const item = infoItems[j];
          console.log(`[Ozon Enrich] RAW ITEM ${j}: ${JSON.stringify(item).slice(0, 2000)}`);
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
          if (i === 0 && matchCount <= 3) {
            console.log(`[Ozon Enrich] PARSED product dbId=${p.id}: name="${parsed.name}", price=${parsed.price}, imageUrl="${parsed.imageUrl}", stock=${parsed.stock}, barcode="${parsed.barcode}"`);
          }
        }
      }

      if (i === 0) {
        console.log(`[Ozon Enrich] First batch: ${matchCount} matched out of ${batch.length} (${infoItems.length} returned by API)`);
        if (matchCount === 0 && infoItems.length > 0) {
          console.log(`[Ozon Enrich] MISMATCH! DB SKUs: ${JSON.stringify(batch.slice(0, 5).map(p => p.sku))}`);
          console.log(`[Ozon Enrich] API offer_ids: ${JSON.stringify(infoItems.slice(0, 5).map((it: any) => it.offer_id))}`);
        }
      }
    } catch (err: any) {
      console.error(`[Ozon Enrich] Info batch ${i / BATCH + 1} failed: ${err.message}`);
      failed += batch.length;
      if (errors.length < 10) errors.push(`Batch ${i / BATCH + 1}: ${err.message}`);
    }

    console.log(`[Ozon Enrich] Info batch ${i / BATCH + 1}/${Math.ceil(productsToEnrich.length / BATCH)}: ${updates.length} enriched so far`);
  }

  // STEP 2: Fetch stock data separately via /v1/product/info/stocks
  const productIds = productsToEnrich.map(p => parseInt(p.ozonId)).filter(n => !isNaN(n));
  const stockMap = new Map<string, number>();

  for (let i = 0; i < productIds.length; i += BATCH) {
    const batchIds = productIds.slice(i, i + BATCH);
    if (i > 0) await new Promise(r => setTimeout(r, 600));

    try {
      const stockRes = await fetchWithRetry(`${BASE}/v1/product/info/stocks`, {
        method: "POST",
        headers,
        body: JSON.stringify({ product_id: batchIds }),
      });
      const stockData = await stockRes.json();
      const stockItems: any[] = stockData?.result?.items || [];

      if (i === 0) {
        console.log(`[Ozon Enrich] Stock endpoint returned ${stockItems.length} items for ${batchIds.length} product_ids`);
        for (let j = 0; j < Math.min(3, stockItems.length); j++) {
          console.log(`[Ozon Enrich] RAW STOCK ${j}: ${JSON.stringify(stockItems[j])}`);
        }
      }

      for (const si of stockItems) {
        let total = 0;
        if (Array.isArray(si.stocks)) {
          for (const s of si.stocks) {
            total += (s.present || 0);
          }
        }
        if (si.offer_id) stockMap.set(si.offer_id, total);
        stockMap.set(String(si.product_id), total);
      }
    } catch (err: any) {
      console.error(`[Ozon Enrich] Stock batch failed: ${err.message}`);
    }
  }

  console.log(`[Ozon Enrich] Got stock data for ${stockMap.size} entries`);

  // STEP 3: Merge stock data into updates
  for (const u of updates) {
    const stockBySku = stockMap.get(u.data.sku);
    const stockByMpId = u.data.marketplaceId ? stockMap.get(u.data.marketplaceId) : undefined;
    if (stockBySku !== undefined) u.data.stock = stockBySku;
    else if (stockByMpId !== undefined) u.data.stock = stockByMpId;
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
