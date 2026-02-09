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

export async function fetchOzonProducts(apiKey: string, clientId: string): Promise<NormalizedProduct[]> {
  const BASE = "https://api-seller.ozon.ru";
  const cleanClientId = String(parseInt(clientId.trim(), 10));
  const cleanApiKey = apiKey.trim();
  const headers: HeadersInit = {
    "Client-Id": cleanClientId,
    "Api-Key": cleanApiKey,
    "Content-Type": "application/json",
  };

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
  }

  const products: NormalizedProduct[] = [];

  const BATCH = 100;
  for (let i = 0; i < allItems.length; i += BATCH) {
    const batch = allItems.slice(i, i + BATCH);
    const productIds = batch.map((item: any) => item.product_id).filter(Boolean);
    if (productIds.length === 0) continue;

    let infoItems: any[] = [];
    try {
      const infoRes = await fetchWithRetry(`${BASE}/v2/product/info/list`, {
        method: "POST",
        headers,
        body: JSON.stringify({ product_id: productIds }),
      });
      const infoData = await infoRes.json();
      infoItems = infoData?.result?.items || [];
    } catch {
      for (const item of batch) {
        products.push({
          name: item.offer_id || `Ozon-${item.product_id}`,
          sku: item.offer_id || String(item.product_id),
          price: parseFloat(item.price || "0"),
          stock: item.stocks?.present || 0,
          marketplaceId: String(item.product_id),
        });
      }
      continue;
    }

    for (const info of infoItems) {
      const listItem = batch.find((b: any) => b.product_id === info.id);
      products.push({
        name: info.name || info.offer_id || `Ozon-${info.id}`,
        sku: info.offer_id || String(info.id),
        barcode: info.barcode || info.barcodes?.[0] || undefined,
        category: info.category_id ? String(info.category_id) : undefined,
        price: parseFloat(info.price || listItem?.price || "0"),
        stock: listItem?.stocks?.present ?? info.stocks?.present ?? 0,
        marketplaceId: String(info.id),
        imageUrl: info.primary_image || info.images?.[0] || undefined,
      });
    }
  }

  return products;
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
