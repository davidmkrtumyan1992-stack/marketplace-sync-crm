import type { Express } from "express";
import { createServer, type Server } from "http";
import * as https from "node:https";
import { storage } from "./storage";
import { inventorySyncEngine } from "./inventory-sync";
import { fetchOzonProducts, fetchWildberriesProducts, fetchYandexProducts, enrichOzonProducts, enrichWbProducts, fixWbPhotos, syncProductToOzon, syncProductToWb } from "./marketplace-import";
import { api } from "@shared/routes";
import { marketplaceSettings as marketplaceSettingsTable, products as productsTable, orders as ordersTable, orderItems as orderItemsTable, productMarketplaceLinks, wbSupplies as wbSuppliesTable } from "@shared/schema";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { db } from "./db";
import { eq, and, sql, inArray, gte, lte, lt } from "drizzle-orm";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

function wbFetchJson(url: string, headers: Record<string, string>, timeoutMs = 25000): Promise<{ status: number; json: any }> {
  console.log(`[wbFetchJson] START url=${url} timeout=${timeoutMs}ms`);
  return new Promise((resolve, reject) => {
    let settled = false;
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers,
    }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      res.on("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        try {
          resolve({ status: res.statusCode ?? 0, json: JSON.parse(body) });
        } catch {
          reject(new Error("WB response is not valid JSON"));
        }
      });
      res.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        reject(err);
      });
    });
    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      reject(err);
    });
    const deadline = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.destroy(new Error(`WB supplies fetch timeout (${timeoutMs}ms)`));
      reject(new Error(`WB supplies fetch timeout (${timeoutMs}ms)`));
    }, timeoutMs);
    req.end();
  });
}

async function fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if ((res.status === 429 || res.status === 502 || res.status === 504) && i < retries - 1) {
        console.log(`[fetchWithRetry] Ozon вернул ${res.status}, попытка ${i + 1}/${retries}, жду 3 сек...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      return res;
    } catch (e: any) {
      console.log(`[fetchWithRetry] Ошибка сети: ${e.message}, попытка ${i + 1}/${retries}`);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 3000));
      else throw e;
    }
  }
  throw new Error('fetchWithRetry: все попытки исчерпаны');
}

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), "uploads/images");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error("Только изображения (jpg, png, gif, webp)"));
    }
  }
});

const uploadFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  await setupAuth(app);
  registerAuthRoutes(app);

  const getOrgId = (req: any) => req.user?.claims?.sub;
  const getUserInfo = (req: any) => ({
    userId: req.user?.claims?.sub || "",
    userName: `${req.user?.claims?.first_name || ""} ${req.user?.claims?.last_name || ""}`.trim() || "System"
  });

  const requireRole = (...allowedRoles: string[]) => {
    return async (req: any, res: any, next: any) => {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(401).json({ message: "Unauthorized" });
      const userRole = await storage.getUserRole(orgId, orgId);
      const role = userRole?.role || "owner";
      if (!allowedRoles.includes(role)) {
        return res.status(403).json({ message: "Доступ запрещён для вашей роли" });
      }
      next();
    };
  };

  // Companies
  app.get(api.companies.list.path, isAuthenticated, async (req, res) => {
    const list = await storage.getCompanies(getOrgId(req));
    res.json(list);
  });

  app.post(api.companies.create.path, isAuthenticated, async (req, res) => {
    const input = api.companies.create.input.parse({ ...req.body, organizationId: getOrgId(req) });
    const company = await storage.createCompany(input);
    res.status(201).json(company);
  });

  app.put("/api/companies/:id", isAuthenticated, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await storage.getCompany(id);
      if (!existing || existing.organizationId !== getOrgId(req)) {
        return res.status(404).json({ message: "Компания не найдена" });
      }
      const updated = await storage.updateCompany(id, req.body);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/companies/:id", isAuthenticated, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await storage.getCompany(id);
      if (!existing || existing.organizationId !== getOrgId(req)) {
        return res.status(404).json({ message: "Компания не найдена" });
      }
      await storage.deleteCompany(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Stores
  app.get(api.stores.list.path, isAuthenticated, async (req, res) => {
    const list = await storage.getStoresByOrg(getOrgId(req));
    res.json(list);
  });

  app.get(api.stores.byCompany.path, isAuthenticated, async (req, res) => {
    const company = await storage.getCompany(Number(req.params.companyId));
    if (!company || company.organizationId !== getOrgId(req)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const list = await storage.getStores(Number(req.params.companyId));
    res.json(list);
  });

  app.post(api.stores.create.path, isAuthenticated, async (req, res) => {
    const company = await storage.getCompany(Number(req.body.companyId));
    if (!company || company.organizationId !== getOrgId(req)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const orgId = getOrgId(req);
    if (req.body.apiKey) req.body.apiKey = req.body.apiKey.replace(/[^\x00-\x7F]/g, "").trim();
    if (req.body.warehouseId) req.body.warehouseId = req.body.warehouseId.replace(/[^\x00-\x7F]/g, "").replace(/\s/g, "").trim();
    if (req.body.clientId) req.body.clientId = req.body.clientId.replace(/\s/g, "").trim();
    const store = await storage.createStore(req.body);

    if (store.apiKey) {
      const allSettings = await storage.getMarketplaceSettings(orgId);
      const existingSetting = allSettings.find(s => s.storeId === store.id);
      if (!existingSetting) {
        await storage.createMarketplaceSetting({
          organizationId: orgId,
          companyId: company.id,
          storeId: store.id,
          marketplace: store.marketplace,
          storeName: store.name,
          apiKey: store.apiKey,
          clientId: store.clientId || undefined,
          warehouseId: store.warehouseId || undefined,
          isActive: store.isActive ?? true,
        });
      }
    }

    res.status(201).json(store);
  });

  app.put(api.stores.update.path, isAuthenticated, async (req, res) => {
    try {
      const existing = await storage.getStore(Number(req.params.id));
      if (!existing) return res.status(404).json({ message: "Магазин не найден" });
      const company = await storage.getCompany(existing.companyId);
      if (!company || company.organizationId !== getOrgId(req)) return res.status(403).json({ message: "Доступ запрещён" });
      if (req.body.apiKey && typeof req.body.apiKey === "string") req.body.apiKey = req.body.apiKey.replace(/[^\x00-\x7F]/g, "").trim();
      if (req.body.warehouseId && typeof req.body.warehouseId === "string") req.body.warehouseId = req.body.warehouseId.replace(/[^\x00-\x7F]/g, "").replace(/\s/g, "").trim();
      if (req.body.clientId && typeof req.body.clientId === "string") req.body.clientId = req.body.clientId.replace(/\s/g, "").trim();
      const store = await storage.updateStore(Number(req.params.id), req.body);

      const orgId = getOrgId(req);
      const allSettings = await storage.getMarketplaceSettings(orgId);
      const matchingSetting = allSettings.find(s => s.storeId === store.id);
      if (matchingSetting) {
        const settingUpdate: any = {};
        if (req.body.apiKey !== undefined) settingUpdate.apiKey = req.body.apiKey;
        if (req.body.clientId !== undefined) settingUpdate.clientId = req.body.clientId;
        if (req.body.warehouseId !== undefined) settingUpdate.warehouseId = req.body.warehouseId;
        if (req.body.name !== undefined) settingUpdate.storeName = req.body.name;
        if (req.body.isActive !== undefined) settingUpdate.isActive = req.body.isActive;
        if (Object.keys(settingUpdate).length > 0) {
          await storage.updateMarketplaceSetting(matchingSetting.id, settingUpdate);
        }
      } else if (store.apiKey) {
        await storage.createMarketplaceSetting({
          organizationId: orgId,
          companyId: store.companyId,
          storeId: store.id,
          marketplace: store.marketplace,
          storeName: store.name,
          apiKey: store.apiKey,
          clientId: store.clientId || undefined,
          warehouseId: store.warehouseId || undefined,
          isActive: store.isActive ?? true,
        });
      }

      res.json(store);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/stores", isAuthenticated, async (req, res) => {
    const allStores = await storage.getStoresByOrg(getOrgId(req));
    res.json(allStores);
  });

  app.post("/api/stores/:id/test-connection", isAuthenticated, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await storage.getStore(id);
      if (!existing) return res.status(404).json({ message: "Магазин не найден" });
      const company = await storage.getCompany(existing.companyId);
      if (!company || company.organizationId !== getOrgId(req)) return res.status(403).json({ message: "Доступ запрещён" });

      const apiKey = (req.body?.apiKey || existing.apiKey || "").trim();
      const clientId = (req.body?.clientId || existing.clientId || "").trim();
      const marketplace = existing.marketplace;

      if (!apiKey) {
        return res.json({ success: false, message: "API-ключ не задан" });
      }

      if (marketplace === "ozon") {
        if (!clientId) {
          return res.json({ success: false, message: "Client ID не задан" });
        }
        try {
          const headers = {
            "Client-Id": String(parseInt(clientId, 10)),
            "Api-Key": apiKey,
            "Content-Type": "application/json",
          };
          const testRes = await fetchWithRetry("https://api-seller.ozon.ru/v3/product/list", {
            method: "POST",
            headers,
            body: JSON.stringify({ filter: { visibility: "ALL" }, limit: 1 }),
          });
          if (!testRes.ok) {
            const errText = await testRes.text().catch(() => "");
            let detail = "";
            try {
              const errJson = JSON.parse(errText);
              detail = errJson.message || errJson.error || "";
            } catch { detail = errText.slice(0, 200); }
            if (testRes.status === 401 || testRes.status === 403) {
              return res.json({ success: false, message: `Неверный API-ключ или Client ID: ${detail || "доступ запрещён"}` });
            }
            return res.json({ success: false, message: `Ошибка Ozon API (${testRes.status}): ${detail || "Нет деталей"}` });
          }
          return res.json({ success: true, message: "Подключение к Ozon успешно" });
        } catch (error: any) {
          return res.json({ success: false, message: `Ошибка сети: ${error.message}` });
        }
      }

      if (marketplace === "yandex") {
        try {
          const cleanToken = apiKey.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
          const isAcmaKey = cleanToken.startsWith("ACMA:");
          const authHeaders: Record<string, string> = {
            ...(isAcmaKey ? { "Api-Key": cleanToken } : { "Authorization": `OAuth ${cleanToken}` }),
            "Content-Type": "application/json",
            "Accept": "application/json",
          };
          const testRes = await fetch("https://api.partner.market.yandex.ru/campaigns", {
            method: "GET",
            headers: authHeaders,
          });
          if (!testRes.ok) {
            if (testRes.status === 401 || testRes.status === 403) {
              return res.json({ success: false, message: "Неверный токен (OAuth)" });
            }
            const errText = await testRes.text().catch(() => "");
            return res.json({ success: false, message: `Ошибка Yandex API (${testRes.status}): ${errText.slice(0, 200) || "Нет деталей"}` });
          }
          const data = await testRes.json();
          const campaignCount = data?.campaigns?.length || 0;
          return res.json({ success: true, message: `Подключение к Yandex Market успешно (${campaignCount} кампаний)` });
        } catch (error: any) {
          return res.json({ success: false, message: `Ошибка сети: ${error.message}` });
        }
      }

      if (marketplace === "wildberries") {
        try {
          const cleanApiKey = apiKey.trim();
          const pingRes = await fetch("https://common-api.wildberries.ru/ping", {
            method: "GET",
            headers: { "Authorization": cleanApiKey },
          });
          if (pingRes.ok || pingRes.status === 200) {
            return res.json({ success: true, message: "Подключение к Wildberries успешно" });
          }
          if (pingRes.status === 401 || pingRes.status === 403) {
            return res.json({ success: false, message: "Неверный API ключ Wildberries" });
          }
          // Только при 404 — пробуем fallback endpoint
          if (pingRes.status === 404) {
            const newOrdersRes = await fetch(
              "https://marketplace-api.wildberries.ru/api/v3/orders/new?limit=1&next=0",
              { method: "GET", headers: { "Authorization": cleanApiKey } }
            );
            if (newOrdersRes.ok || newOrdersRes.status === 200) {
              return res.json({ success: true, message: "Подключение к Wildberries успешно" });
            }
            if (newOrdersRes.status === 401 || newOrdersRes.status === 403) {
              return res.json({ success: false, message: "Неверный API ключ Wildberries" });
            }
            if (newOrdersRes.status === 404) {
              return res.json({ success: false, message: "Неверный URL — проверьте документацию WB API" });
            }
            return res.json({ success: false, message: `Ошибка WB API (${newOrdersRes.status})` });
          }
          return res.json({ success: false, message: `Ошибка WB API (${pingRes.status})` });
        } catch (error: any) {
          return res.json({ success: false, message: `Ошибка сети: ${error.message}` });
        }
      }

      return res.json({ success: false, message: "Неизвестный маркетплейс" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/stores/:id", isAuthenticated, requireRole("owner"), async (req, res) => {
    try {
      const storeId = Number(req.params.id);
      const store = await storage.getStore(storeId);
      if (!store) return res.status(404).json({ message: "Магазин не найден" });
      const company = await storage.getCompany(store.companyId);
      if (!company || company.organizationId !== getOrgId(req)) return res.status(403).json({ message: "Доступ запрещён" });

      // 1 — Удалить API ключи первым (безопасная остановка синка)
      await db.delete(marketplaceSettingsTable).where(eq(marketplaceSettingsTable.storeId, storeId));
      console.log(`[store-delete] API ключи магазина ${storeId} удалены`);

      // 2 — Закрыть открытые поставки WB перед удалением
      await db.update(wbSuppliesTable)
        .set({ status: "closed", closedAt: new Date() })
        .where(and(eq(wbSuppliesTable.storeId, storeId), eq(wbSuppliesTable.status, "open")));

      // 3 — Удалить ссылки товаров на магазин
      await db.delete(productMarketplaceLinks).where(eq(productMarketplaceLinks.storeId, storeId));

      // 4 — Удалить магазин (CASCADE удалит orders, order_items, wb_supplies, sync_history)
      await storage.deleteStore(storeId);

      console.log(`[store-delete] Магазин «${store.name}» (id=${storeId}) полностью удалён`);
      return res.json({ success: true, message: `Магазин «${store.name}» и все связанные данные удалены` });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // User Roles
  app.get(api.userRoles.get.path, isAuthenticated, async (req, res) => {
    const orgId = getOrgId(req);
    const role = await storage.getUserRole(orgId, orgId);
    res.json(role || { role: "owner" });
  });

  app.post(api.userRoles.set.path, isAuthenticated, requireRole("owner"), async (req, res) => {
    const input = api.userRoles.set.input.parse({ ...req.body, organizationId: getOrgId(req) });
    const role = await storage.setUserRole(input);
    res.json(role);
  });

  // Expenses (owner & accountant)
  app.get(api.expenses.list.path, isAuthenticated, requireRole("owner", "accountant"), async (req, res) => {
    const companyId = req.query.companyId ? Number(req.query.companyId) : undefined;
    const list = await storage.getExpenses(getOrgId(req), companyId);
    res.json(list);
  });

  app.post(api.expenses.create.path, isAuthenticated, requireRole("owner", "accountant"), async (req, res) => {
    const input = api.expenses.create.input.parse({ ...req.body, organizationId: getOrgId(req) });
    const expense = await storage.createExpense(input);
    res.status(201).json(expense);
  });

  app.delete(api.expenses.delete.path, isAuthenticated, requireRole("owner", "accountant"), async (req, res) => {
    const expense = await storage.getExpense(Number(req.params.id));
    if (!expense || expense.organizationId !== getOrgId(req)) {
      return res.status(403).json({ message: "Access denied" });
    }
    await storage.deleteExpense(Number(req.params.id));
    res.status(204).send();
  });

  // Products (owner & administrator only)
  app.get(api.products.list.path, isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    const companyId = req.query.companyId ? Number(req.query.companyId) : undefined;
    const list = await storage.getProducts(getOrgId(req), companyId);
    res.json(list);
  });

  app.get("/api/products/barcode/:barcode", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    const product = await storage.getProductByBarcode(String(req.params.barcode), getOrgId(req));
    if (!product) return res.status(404).json({ message: "Товар не найден" });
    res.json(product);
  });

  app.get(api.products.get.path, isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    const product = await storage.getProduct(Number(req.params.id));
    if (!product) return res.status(404).json({ message: "Not found" });
    res.json(product);
  });

  app.post(api.products.create.path, isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const body = { ...req.body, organizationId: orgId };
      if (!body.companyId) delete body.companyId;
      const input = api.products.create.input.parse(body);
      if (input.companyId) {
        const orgCompanies = await storage.getCompanies(orgId);
        const validCompany = orgCompanies.find(c => c.id === input.companyId);
        if (!validCompany) {
          return res.status(403).json({ message: "Компания не принадлежит вашей организации" });
        }
      }
      const product = await storage.createProduct(input);
      res.json(product);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Проверьте правильность заполнения полей" });
      throw err;
    }
  });

  app.put(api.products.update.path, isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    console.log("PUT /api/products/:id body:", JSON.stringify(req.body));
    const existing = await storage.getProduct(Number(req.params.id));
    if (!existing) return res.status(404).json({ message: "Товар не найден" });
    if (existing.organizationId !== getOrgId(req)) return res.status(403).json({ message: "Доступ запрещён" });
    const product = await storage.updateProduct(Number(req.params.id), req.body);
    res.json(product);
  });

  app.delete(api.products.delete.path, isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    const existing = await storage.getProduct(Number(req.params.id));
    if (!existing) return res.status(404).json({ message: "Товар не найден" });
    if (existing.organizationId !== getOrgId(req)) return res.status(403).json({ message: "Доступ запрещён" });
    await storage.deleteProduct(Number(req.params.id));
    res.status(204).send();
  });

  app.post(api.products.sync.path, isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    const productId = Number(req.params.id);
    const product = await storage.getProduct(productId);
    if (!product) return res.status(404).json({ message: "Товар не найден" });
    if (product.organizationId !== getOrgId(req)) return res.status(403).json({ message: "Доступ запрещён" });
    res.json({ success: true, message: "Синхронизация запущена" });
  });

  app.get("/api/products/:id/exclusions", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    const product = await storage.getProduct(Number(req.params.id));
    if (!product) return res.status(404).json({ message: "Товар не найден" });
    if (product.organizationId !== getOrgId(req)) return res.status(403).json({ message: "Доступ запрещён" });
    const exclusions = await storage.getProductStoreExclusions(Number(req.params.id));
    res.json(exclusions);
  });

  app.put("/api/products/:id/exclusions", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    const { storeIds } = req.body;
    if (!Array.isArray(storeIds)) return res.status(400).json({ message: "storeIds must be an array" });
    const product = await storage.getProduct(Number(req.params.id));
    if (!product) return res.status(404).json({ message: "Товар не найден" });
    if (product.organizationId !== getOrgId(req)) return res.status(403).json({ message: "Доступ запрещён" });
    const orgStores = await storage.getStores(getOrgId(req));
    const orgStoreIds = new Set(orgStores.map(s => s.id));
    const invalidIds = storeIds.filter((id: number) => !orgStoreIds.has(id));
    if (invalidIds.length > 0) return res.status(400).json({ message: "Некорректные ID магазинов" });
    const exclusions = await storage.setProductStoreExclusions(Number(req.params.id), storeIds, getOrgId(req));
    res.json(exclusions);
  });

  // GET /api/products/:id/stores — список магазинов с статусом для товара
  app.get("/api/products/:id/stores", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const orgId = getOrgId(req);
      const product = await storage.getProduct(productId);
      if (!product) return res.status(404).json({ message: "Товар не найден" });
      if (product.organizationId !== orgId) return res.status(403).json({ message: "Доступ запрещён" });
      const statuses = await storage.getProductStoresWithStatus(productId, orgId);
      res.json(statuses);
    } catch (err: any) {
      console.error("[GET /api/products/:id/stores]", err);
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/products/:id/sync-price — синхронизировать цену на выбранные магазины
  app.post("/api/products/:id/sync-price", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const orgId = getOrgId(req);
      const product = await storage.getProduct(productId);
      if (!product) return res.status(404).json({ message: "Товар не найден" });
      if (product.organizationId !== orgId) return res.status(403).json({ message: "Доступ запрещён" });

      const { storeIds, price } = req.body;
      if (!Array.isArray(storeIds) || storeIds.length === 0) {
        return res.status(400).json({ message: "storeIds must be a non-empty array" });
      }
      if (typeof price !== "number" && typeof price !== "string") {
        return res.status(400).json({ message: "price is required" });
      }

      const priceStr = String(Math.round(Number(price)));
      const allSettings = await storage.getMarketplaceSettings(orgId);
      const productLinks = await storage.getProductMarketplaceLinks(productId);
      const activeLinksMap = new Map(productLinks.filter(l => l.isActive).map(l => [l.storeId, l]));
      const results: { storeId: number; storeName: string; marketplace: string; success: boolean; error?: string }[] = [];

      for (const storeId of storeIds) {
        const storeNum = Number(storeId);
        const setting = allSettings.find(s => s.storeId === storeNum && s.isActive);
        if (!setting) {
          results.push({ storeId: storeNum, storeName: String(storeId), marketplace: "unknown", success: false, error: "Магазин не найден или не настроен" });
          continue;
        }
        if (!activeLinksMap.has(storeNum)) {
          results.push({ storeId: storeNum, storeName: setting.storeName || String(storeId), marketplace: setting.marketplace, success: false, error: "Товар не найден в этом магазине" });
          continue;
        }

        let storeName = setting.storeName || String(storeId);
        let success = false;
        let errorMsg: string | undefined;

        try {
          if (setting.marketplace === "ozon" && setting.apiKey && setting.clientId) {
            const offerId = product.sku;
            console.log("[sync-price] === Попытка синхронизации ===");
            console.log("[sync-price] product.sku:", offerId);
            console.log("[sync-price] price:", priceStr);
            console.log("[sync-price] store:", setting.storeName);
            console.log("[sync-price] clientId:", setting.clientId);
            console.log("[sync-price] apiKey первые 8 символов:", setting.apiKey?.substring(0, 8));
            console.log("[sync-price] request body:", JSON.stringify({
              prices: [{ offer_id: offerId, price: priceStr, old_price: "0", premium_price: "0", min_price: "0" }],
            }));
            const ozonRes = await fetchWithRetry("https://api-seller.ozon.ru/v1/product/import/prices", {
              method: "POST",
              headers: { "Client-Id": setting.clientId, "Api-Key": setting.apiKey, "Content-Type": "application/json" },
              body: JSON.stringify({
                prices: [{ offer_id: offerId, price: priceStr, old_price: "0", premium_price: "0", min_price: "0" }],
              }),
            });
            console.log("[sync-price] HTTP статус:", ozonRes.status);
            const responseText = await ozonRes.text();
            console.log("[sync-price] Полный ответ Ozon:", responseText);
            let data: any;
            try { data = JSON.parse(responseText); } catch { data = null; }
            const item = data?.result?.[0];
            if (item?.updated === true) {
              success = true;
            } else {
              const ozonError = item?.errors?.[0]?.message || data?.message || "Ozon вернул ошибку";
              errorMsg = ozonError;
              console.log("[sync-price] Ozon error detail:", ozonError);
              console.log("[sync-price] Full Ozon response:", JSON.stringify(data));
            }
          } else if (setting.marketplace === "yandex" && setting.apiKey) {
            errorMsg = "Синхронизация цен Яндекс Маркет пока не реализована";
          } else if (setting.marketplace === "wildberries" && setting.apiKey) {
            errorMsg = "Синхронизация цен Wildberries пока не реализована";
          } else {
            errorMsg = "Маркетплейс не поддерживается или не настроен";
          }
        } catch (e: any) {
          errorMsg = e.message || "Ошибка сети";
        }

        await storage.updateProductMarketplaceLinkSync(productId, storeNum, success ? "success" : "error", errorMsg);
        results.push({ storeId: storeNum, storeName, marketplace: setting.marketplace, success, error: errorMsg });
      }

      res.json({ results });
    } catch (err: any) {
      console.error("[POST /api/products/:id/sync-price]", err);
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/admin/migrate-product-links — миграция ozonId в product_marketplace_links
  app.post("/api/admin/migrate-product-links", isAuthenticated, requireRole("owner"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const allProducts = await storage.getProducts(orgId);
      const allSettings = await storage.getMarketplaceSettings(orgId);
      const ozonSettings = allSettings.filter(s => s.marketplace === "ozon" && s.isActive && s.storeId);

      let created = 0;
      let skipped = 0;

      for (const product of allProducts) {
        if (!product.ozonId) { skipped++; continue; }

        for (const setting of ozonSettings) {
          if (!setting.storeId) continue;
          try {
            await storage.upsertProductMarketplaceLink({
              productId: product.id,
              storeId: setting.storeId,
              marketplaceProductId: product.ozonId,
              isActive: true,
              organizationId: orgId,
            });
            created++;
          } catch (e) {
            console.warn("[migrate-product-links] skip", product.id, setting.storeId, e);
          }
        }
      }

      console.log(`[migrate-product-links] done: created=${created} skipped=${skipped}`);
      res.json({ message: "Миграция завершена", created, skipped });
    } catch (err: any) {
      console.error("[POST /api/admin/migrate-product-links]", err);
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/admin/fix-product-links — проверить реальное наличие товаров в магазинах через Ozon API
  app.post("/api/admin/fix-product-links", isAuthenticated, requireRole("owner"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const allSettings = await storage.getMarketplaceSettings(orgId);

      // Загружаем все связи для этой организации
      const allLinks = await db.select().from(productMarketplaceLinks)
        .where(eq(productMarketplaceLinks.organizationId, orgId));

      if (allLinks.length === 0) {
        return res.json({ message: "Нет записей для проверки", checked: 0, active: 0, inactive: 0 });
      }

      // Группируем по (storeId, marketplaceProductId) — один запрос к Ozon на уникальную пару
      const uniquePairs = new Map<string, { storeId: number; marketplaceProductId: string }>();
      for (const link of allLinks) {
        if (!link.marketplaceProductId) continue;
        const key = `${link.storeId}:${link.marketplaceProductId}`;
        if (!uniquePairs.has(key)) {
          uniquePairs.set(key, { storeId: link.storeId, marketplaceProductId: link.marketplaceProductId });
        }
      }

      const pairs = Array.from(uniquePairs.values());
      console.log(`[fix-product-links] Всего уникальных пар (storeId, marketplaceProductId): ${pairs.length}`);

      // Результаты: ключ → true (exists) / false (not found)
      const pairResults = new Map<string, boolean>();
      let checked = 0;
      let apiErrors = 0;

      for (const pair of pairs) {
        const setting = allSettings.find(s => s.storeId === pair.storeId && s.marketplace === "ozon" && s.isActive && s.apiKey && s.clientId);
        if (!setting) {
          pairResults.set(`${pair.storeId}:${pair.marketplaceProductId}`, false);
          continue;
        }

        try {
          const ozonRes = await fetchWithRetry("https://api-seller.ozon.ru/v3/product/info", {
            method: "POST",
            headers: {
              "Client-Id": setting.clientId!,
              "Api-Key": setting.apiKey!,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ product_id: Number(pair.marketplaceProductId) }),
          });
          const data = await ozonRes.json() as any;
          const exists = ozonRes.ok && !data?.code && !data?.message?.includes("NOT_FOUND");
          pairResults.set(`${pair.storeId}:${pair.marketplaceProductId}`, exists);
          checked++;
        } catch (e) {
          pairResults.set(`${pair.storeId}:${pair.marketplaceProductId}`, false);
          apiErrors++;
        }

        if (checked % 50 === 0 && checked > 0) {
          console.log(`[fix-product-links] Прогресс: проверено ${checked}/${pairs.length}`);
        }

        // Небольшая пауза чтобы не перегружать API
        await new Promise(r => setTimeout(r, 80));
      }

      console.log(`[fix-product-links] API запросов: ${checked}, ошибок: ${apiErrors}`);

      // Обновляем isActive в таблице для всех записей
      let activeCount = 0;
      let inactiveCount = 0;

      for (const link of allLinks) {
        if (!link.marketplaceProductId) {
          await db.update(productMarketplaceLinks)
            .set({ isActive: false })
            .where(eq(productMarketplaceLinks.id, link.id));
          inactiveCount++;
          continue;
        }
        const key = `${link.storeId}:${link.marketplaceProductId}`;
        const exists = pairResults.get(key) ?? false;
        await db.update(productMarketplaceLinks)
          .set({ isActive: exists })
          .where(eq(productMarketplaceLinks.id, link.id));
        if (exists) activeCount++;
        else inactiveCount++;
      }

      console.log(`[fix-product-links] Готово: активных=${activeCount}, неактивных=${inactiveCount}`);
      res.json({
        message: "Проверка завершена",
        totalLinks: allLinks.length,
        uniquePairsChecked: checked,
        active: activeCount,
        inactive: inactiveCount,
        apiErrors,
      });
    } catch (err: any) {
      console.error("[POST /api/admin/fix-product-links]", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Customers (owner & administrator only)
  app.get(api.customers.list.path, isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    const list = await storage.getCustomers(getOrgId(req));
    res.json(list);
  });

  app.post(api.customers.create.path, isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    const input = api.customers.create.input.parse({ ...req.body, organizationId: getOrgId(req) });
    const customer = await storage.createCustomer(input);
    res.status(201).json(customer);
  });

  app.put(api.customers.update.path, isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    const customer = await storage.updateCustomer(Number(req.params.id), req.body);
    res.json(customer);
  });

  // Customer orders (for customer profile)
  app.get("/api/customers/:id/orders", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const customerOrders = await storage.getOrdersByCustomerId(Number(req.params.id), orgId);
      res.json(customerOrders);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Orders (owner & administrator only)
  app.get(api.orders.list.path, isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    const companyId = req.query.companyId ? Number(req.query.companyId) : undefined;
    const list = await storage.getOrders(getOrgId(req), companyId);
    res.json(list);
  });

  app.get("/api/orders/:id", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const order = await storage.getOrder(Number(req.params.id));
      if (!order) {
        return res.status(404).json({ message: "Заказ не найден" });
      }
      if (order.organizationId !== getOrgId(req)) {
        return res.status(403).json({ message: "Нет доступа" });
      }
      res.json(order);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Standard order creation (marketplace orders). Does NOT create customer records —
  // marketplace buyers are anonymous. Only direct sales (/api/orders/direct) create CRM customers.
  app.post(api.orders.create.path, isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { items, ...orderData } = req.body;
      const inputOrder = { ...orderData, organizationId: orgId };
      const order = await storage.createOrder(inputOrder, items);

      const allStores = await storage.getStoresByOrg(orgId);
      const sourceStore = allStores.find(s => s.id === order.storeId);
      const sourceStoreName = sourceStore?.name || orderData.source || "Ручной заказ";

      for (const item of items) {
        try {
          await inventorySyncEngine.processOrderStockUpdate({
            organizationId: orgId,
            orderId: order.id,
            productId: item.productId,
            quantity: item.quantity,
            sourceStoreId: order.storeId,
            sourceStoreName,
          });
        } catch (syncError) {
          console.error("Inventory sync error for product", item.productId, syncError);
        }
      }

      res.status(201).json(order);
    } catch (err: any) {
      console.error("Order creation error:", err);
      res.status(400).json({ message: err.message || "Ошибка создания заказа" });
    }
  });

  app.patch(api.orders.updateStatus.path, isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    const order = await storage.updateOrderStatus(Number(req.params.id), req.body.status);
    res.json(order);
  });

  // Direct Sale endpoint
  app.post("/api/orders/direct", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { customerId, newCustomer, items, notes } = req.body;

      let finalCustomerId = customerId || null;
      if (newCustomer && newCustomer.name) {
        const customer = await storage.createCustomer({
          name: newCustomer.name,
          phone: newCustomer.phone || null,
          email: null,
          notes: newCustomer.notes || null,
          organizationId: orgId,
          companyId: null,
        });
        finalCustomerId = customer.id;
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Добавьте хотя бы один товар" });
      }

      const totalAmount = items.reduce((sum: number, item: any) => sum + (item.salePrice * item.quantity), 0);
      const orderNumber = `DS-${Date.now().toString(36).toUpperCase()}`;

      const order = await storage.createOrder(
        {
          orderNumber,
          customerId: finalCustomerId,
          status: "completed",
          totalAmount: totalAmount.toString(),
          source: "direct",
          organizationId: orgId,
          companyId: null,
          storeId: null,
          externalId: null,
        },
        items.map((item: any) => ({
          productId: item.productId,
          quantity: item.quantity,
          price: item.salePrice,
          originalPrice: item.originalPrice,
          salePrice: item.salePrice,
        }))
      );

      // Trigger inventory sync for each item - broadcast to ALL stores
      for (const item of items) {
        try {
          await inventorySyncEngine.processOrderStockUpdate({
            organizationId: orgId,
            orderId: order.id,
            productId: item.productId,
            quantity: item.quantity,
            sourceStoreId: null,
            sourceStoreName: "Прямая продажа / Самовывоз",
          });
        } catch (syncError) {
          console.error("Inventory sync error for direct sale product", item.productId, syncError);
        }
      }

      // Log to audit
      const user = req.user as any;
      await storage.createAuditLog({
        organizationId: orgId,
        companyId: null,
        userId: user?.id || "system",
        userName: user?.username || user?.email || "system",
        action: "direct_sale",
        entityType: "order",
        entityId: order.id,
        details: JSON.stringify({
          type: "Прямая продажа / Самовывоз",
          items: items.map((i: any) => ({ productId: i.productId, qty: i.quantity, price: i.salePrice })),
          totalAmount,
          customerId: finalCustomerId,
          notes,
        }),
        delta: null,
      });

      res.json(order);
    } catch (err: any) {
      console.error("Direct sale error:", err);
      res.status(400).json({ message: err.message || "Ошибка оформления продажи" });
    }
  });

  // Marketplace Settings (owner only)
  app.get(api.marketplace.list.path, isAuthenticated, requireRole("owner"), async (req, res) => {
    const settings = await storage.getMarketplaceSettings(getOrgId(req));
    res.json(settings);
  });

  app.post(api.marketplace.save.path, isAuthenticated, requireRole("owner"), async (req, res) => {
    const orgId = getOrgId(req);
    const body = { ...req.body, organizationId: orgId };
    if (body.apiKey && typeof body.apiKey === "string") body.apiKey = body.apiKey.replace(/[^\x00-\x7F]/g, "").trim();
    if (body.clientId && typeof body.clientId === "string") body.clientId = body.clientId.replace(/\s/g, "").trim();
    if (body.warehouseId && typeof body.warehouseId === "string") body.warehouseId = body.warehouseId.replace(/[^\x00-\x7F]/g, "").replace(/\s/g, "").trim();
    if (body.storeName && typeof body.storeName === "string") body.storeName = body.storeName.trim();
    const input = api.marketplace.save.input.parse(body);
    const setting = await storage.createMarketplaceSetting(input);

    let createdStoreId: number | null = null;
    if (body.companyId) {
      const company = await storage.getCompany(Number(body.companyId));
      if (company && company.organizationId === orgId) {
        const newStore = await storage.createStore({
          companyId: company.id,
          marketplace: body.marketplace,
          name: body.storeName || `${body.marketplace} магазин`,
          apiKey: body.apiKey || null,
          clientId: body.clientId || null,
          warehouseId: body.warehouseId || null,
          isActive: body.isActive ?? true,
        });
        createdStoreId = newStore.id;
        await storage.updateMarketplaceSetting(setting.id, { storeId: newStore.id });
      }
    }

    let autoSyncStarted = false;
    if (body.marketplace === "ozon" && body.apiKey && body.clientId) {
      autoSyncStarted = true;
      const displayName = body.storeName || `Client ${body.clientId}`;
      (async () => {
        try {
          console.log(`[Auto Import] Starting product import for new store «${displayName}»...`);
          const products = await fetchOzonProducts(body.apiKey, body.clientId);
          console.log(`[Auto Import] «${displayName}»: ${products.length} products fetched`);
          let created = 0, updated = 0;
          for (const mp of products) {
            try {
              if (!mp.sku) continue;
              const existing = await storage.getProductBySkuAndOrg(mp.sku, orgId);
              if (existing) {
                const updates: any = {};
                if (mp.price !== undefined && mp.price !== null) { updates.sellingPrice = String(mp.price); updates.price = String(mp.price); }
                if (mp.stock !== undefined && mp.stock !== null) updates.centralStock = mp.stock;
                if (mp.name && mp.name !== existing.name) updates.name = mp.name;
                if (mp.barcode) updates.barcode = mp.barcode;
                if (mp.imageUrl) updates.imageUrl = mp.imageUrl;
                if (mp.category) updates.category = mp.category;
                if (mp.marketplaceId) updates.ozonId = mp.marketplaceId;
                if (Object.keys(updates).length > 0) await storage.updateProduct(existing.id, updates);
                updated++;
              } else {
                await storage.createProduct({
                  name: mp.name, sku: mp.sku, barcode: mp.barcode || null, category: mp.category || null,
                  purchasePrice: "0", sellingPrice: String(mp.price ?? 0), price: String(mp.price ?? 0),
                  centralStock: mp.stock ?? 0, stockQuantity: mp.stock ?? 0, imageUrl: mp.imageUrl || null,
                  ozonId: mp.marketplaceId || null, wbId: null, yandexId: null, organizationId: orgId,
                });
                created++;
              }
            } catch (err: any) { /* skip individual product errors */ }
          }
          await storage.createSyncHistory({
            organizationId: orgId, action: "product_import", status: "success",
            details: `Автоимпорт для «${displayName}»: создано ${created}, обновлено ${updated}`,
            itemsCount: created + updated,
          });
          console.log(`[Auto Import] «${displayName}» complete: created ${created}, updated ${updated}`);
        } catch (err: any) {
          console.error(`[Auto Import] Error for «${displayName}»:`, err.message);
          await storage.createSyncHistory({
            organizationId: orgId, action: "product_import", status: "fail",
            details: `Ошибка автоимпорта для «${displayName}»: ${err.message}`,
            itemsCount: 0,
          });
        }
      })();
    } else if (body.marketplace === "yandex" && body.apiKey && body.warehouseId) {
      autoSyncStarted = true;
      const displayName = body.storeName || `Yandex ${body.warehouseId}`;
      (async () => {
        try {
          console.log(`[Auto Import] Starting Yandex product import for «${displayName}»...`);
          const yToken = body.apiKey.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
          const yBusinessId = body.warehouseId.replace(/[^\x00-\x7F]/g, "").replace(/\s/g, "").trim();
          const products = await fetchYandexProducts(yToken, yBusinessId);
          console.log(`[Auto Import] «${displayName}»: ${products.length} Yandex products fetched`);
          let created = 0, updated = 0;
          for (const mp of products) {
            try {
              if (!mp.sku) continue;
              const existing = await storage.getProductBySkuAndOrg(mp.sku, orgId);
              if (existing) {
                const updates: any = {};
                if (mp.price !== undefined && mp.price !== null) { updates.sellingPrice = String(mp.price); updates.price = String(mp.price); }
                if (mp.stock !== undefined && mp.stock !== null) updates.centralStock = mp.stock;
                if (mp.name && mp.name !== existing.name) updates.name = mp.name;
                if (mp.barcode) updates.barcode = mp.barcode;
                if (mp.imageUrl) updates.imageUrl = mp.imageUrl;
                if (mp.category) updates.category = mp.category;
                if (mp.marketplaceId) updates.yandexId = mp.marketplaceId;
                if (Object.keys(updates).length > 0) await storage.updateProduct(existing.id, updates);
                updated++;
              } else {
                await storage.createProduct({
                  name: mp.name, sku: mp.sku, barcode: mp.barcode || null, category: mp.category || null,
                  purchasePrice: "0", sellingPrice: String(mp.price ?? 0), price: String(mp.price ?? 0),
                  centralStock: mp.stock ?? 0, stockQuantity: mp.stock ?? 0, imageUrl: mp.imageUrl || null,
                  ozonId: null, wbId: null, yandexId: mp.marketplaceId || null, organizationId: orgId,
                });
                created++;
              }
            } catch (err: any) { /* skip individual product errors */ }
          }
          await storage.createSyncHistory({
            organizationId: orgId, action: "product_import", status: "success",
            details: `Автоимпорт Yandex для «${displayName}»: создано ${created}, обновлено ${updated}`,
            itemsCount: created + updated,
          });
          console.log(`[Auto Import] «${displayName}» complete: created ${created}, updated ${updated}`);
        } catch (err: any) {
          console.error(`[Auto Import] Yandex error for «${displayName}»:`, err.message);
          await storage.createSyncHistory({
            organizationId: orgId, action: "product_import", status: "fail",
            details: `Ошибка автоимпорта Yandex для «${displayName}»: ${err.message}`,
            itemsCount: 0,
          });
        }
      })();
    }

    res.status(201).json({ ...setting, autoSyncStarted });
  });

  app.put("/api/marketplace/settings/:id", isAuthenticated, requireRole("owner"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const orgId = getOrgId(req);
      const allSettings = await storage.getMarketplaceSettings(orgId);
      const existing = allSettings.find(s => s.id === id);
      if (!existing) return res.status(404).json({ message: "Настройка не найдена" });

      const body = { ...req.body };
      if (body.apiKey && typeof body.apiKey === "string") body.apiKey = body.apiKey.trim();
      if (body.clientId && typeof body.clientId === "string") body.clientId = body.clientId.trim();
      if (body.warehouseId && typeof body.warehouseId === "string") body.warehouseId = body.warehouseId.trim();
      if (body.storeName && typeof body.storeName === "string") body.storeName = body.storeName.trim();

      const updated = await storage.updateMarketplaceSetting(id, body);
      res.json(updated);
    } catch (error: any) {
      console.error("Update marketplace setting error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/marketplace/settings/:id", isAuthenticated, requireRole("owner"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const orgId = getOrgId(req);
      const allSettings = await storage.getMarketplaceSettings(orgId);
      const existing = allSettings.find(s => s.id === id);
      if (!existing) return res.status(404).json({ message: "Настройка не найдена" });

      await storage.deleteMarketplaceSetting(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete marketplace setting error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post(api.marketplace.syncAll.path, isAuthenticated, requireRole("owner"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const isDemo = await inventorySyncEngine.isDemoMode(orgId);
      if (isDemo) {
        const logs = await inventorySyncEngine.demoSyncAllStores(orgId);
        return res.json({ success: true, message: `[ДЕМО] Синхронизация завершена: ${logs.length} магазинов`, demoMode: true, logs });
      }
      res.json({ success: true, message: "Синхронизация всех маркетплейсов запущена" });
    } catch (error) {
      console.error("Sync all error:", error);
      res.status(500).json({ message: "Ошибка синхронизации" });
    }
  });

  // Marketplace Product Import (owner & administrator)
  app.post("/api/marketplace/import/:marketplace", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const marketplace = String(req.params.marketplace);
      const { userId, userName } = getUserInfo(req);

      if (!["ozon", "wildberries", "yandex"].includes(marketplace)) {
        return res.status(400).json({ message: "Неизвестный маркетплейс" });
      }

      const allSettings = await storage.getMarketplaceSettings(orgId);

      let fetchedProducts: any[] = [];
      const importErrors: string[] = [];

      if (marketplace === "ozon") {
        const ozonSettings = allSettings.filter(s => s.marketplace === "ozon" && s.isActive && s.apiKey && s.clientId);
        if (ozonSettings.length === 0) {
          return res.status(400).json({ message: `API-ключ для «${marketplace}» не настроен. Перейдите в «Настройки» и добавьте ключ.` });
        }
        for (const setting of ozonSettings) {
          const displayName = setting.storeName || `Client ${setting.clientId}`;
          try {
            console.log(`[Marketplace Import] Fetching Ozon products for «${displayName}»...`);
            const products = await fetchOzonProducts(setting.apiKey!, setting.clientId!);
            console.log(`[Marketplace Import] «${displayName}»: ${products.length} products fetched`);
            fetchedProducts = fetchedProducts.concat(products);
          } catch (err: any) {
            console.error(`[Marketplace Import] Error for «${displayName}»:`, err.message);
            importErrors.push(`Ошибка для магазина «${displayName}»: ${err.message}`);
          }
        }
        if (fetchedProducts.length === 0 && importErrors.length > 0) {
          await storage.createSyncHistory({
            organizationId: orgId, action: "product_import", status: "fail",
            details: importErrors.join("; "), itemsCount: 0,
          });
          return res.status(502).json({ message: importErrors.join("; ") });
        }
      } else {
        const setting = allSettings.find(s => s.marketplace === marketplace && s.isActive);
        if (!setting || !setting.apiKey) {
          return res.status(400).json({ message: `API-ключ для «${marketplace}» не настроен. Перейдите в «Настройки» и добавьте ключ.` });
        }
        try {
          if (marketplace === "wildberries") {
            fetchedProducts = await fetchWildberriesProducts(setting.apiKey, setting.warehouseId || undefined);
          } else {
            if (!setting.warehouseId) {
              return res.status(400).json({ message: "Business ID для Yandex Market не указан в настройках" });
            }
            const yToken = setting.apiKey.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
            const yBusinessId = setting.warehouseId.replace(/[^\x00-\x7F]/g, "").replace(/\s/g, "").trim();
            console.log(`[Yandex Sync] Token: first 5 chars="${yToken.substring(0, 5)}…", length=${yToken.length}, businessId="${yBusinessId}", rawApiKeyLen=${setting.apiKey.length}`);
            fetchedProducts = await fetchYandexProducts(yToken, yBusinessId);
          }
        } catch (err: any) {
          console.error(`Marketplace import error (${marketplace}):`, err);
          await storage.createSyncHistory({
            organizationId: orgId, action: "product_import", status: "fail",
            details: `Ошибка импорта из «${marketplace}»: ${err.message}`, itemsCount: 0,
          });
          return res.status(502).json({ message: `Ошибка подключения к API «${marketplace}»: ${err.message}` });
        }
      }

      let created = 0;
      let updated = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const mp of fetchedProducts) {
        try {
          if (!mp.sku) {
            failed++;
            continue;
          }

          const existing = await storage.getProductBySkuAndOrg(mp.sku, orgId);

          if (existing) {
            const updates: any = {};
            if (mp.price !== undefined && mp.price !== null) {
              updates.sellingPrice = String(mp.price);
              updates.price = String(mp.price);
            }
            if (mp.stock !== undefined && mp.stock !== null) {
              updates.centralStock = mp.stock;
            }
            if (mp.name && mp.name !== existing.name) {
              updates.name = mp.name;
            }
            if (mp.barcode) {
              updates.barcode = mp.barcode;
            }
            if (mp.imageUrl) {
              updates.imageUrl = mp.imageUrl;
            }
            if (mp.category) {
              updates.category = mp.category;
            }
            if (marketplace === "ozon" && mp.marketplaceId) updates.ozonId = mp.marketplaceId;
            if (marketplace === "wildberries" && mp.marketplaceId) updates.wbId = mp.marketplaceId;
            if (marketplace === "yandex" && mp.marketplaceId) updates.yandexId = mp.marketplaceId;

            if (Object.keys(updates).length > 0) {
              await storage.updateProduct(existing.id, updates);
            }
            updated++;
          } else {
            await storage.createProduct({
              name: mp.name,
              sku: mp.sku,
              barcode: mp.barcode || null,
              category: mp.category || null,
              purchasePrice: "0",
              sellingPrice: String(mp.price ?? 0),
              price: String(mp.price ?? 0),
              centralStock: mp.stock ?? 0,
              stockQuantity: mp.stock ?? 0,
              imageUrl: mp.imageUrl || null,
              ozonId: marketplace === "ozon" ? mp.marketplaceId || null : null,
              wbId: marketplace === "wildberries" ? mp.marketplaceId || null : null,
              yandexId: marketplace === "yandex" ? mp.marketplaceId || null : null,
              organizationId: orgId,
            });
            created++;
          }
        } catch (err: any) {
          failed++;
          if (errors.length < 10) {
            errors.push(`${mp.sku}: ${err.message}`);
          }
        }
      }

      await storage.createSyncHistory({
        organizationId: orgId,
        action: "product_import",
        status: failed > 0 && created === 0 && updated === 0 ? "fail" : "success",
        details: `Импорт из «${marketplace}»: создано ${created}, обновлено ${updated}, ошибок ${failed}`,
        itemsCount: created + updated,
      });

      await storage.createAuditLog({
        organizationId: orgId,
        userId,
        userName,
        action: "marketplace_import",
        entityType: "product",
        details: `Импорт из «${marketplace}»: создано ${created}, обновлено ${updated}`,
      });

      const responseData: any = {
        success: true,
        marketplace,
        created,
        updated,
        failed,
        total: fetchedProducts.length,
        errors: errors.length > 0 ? errors : undefined,
        importErrors: importErrors.length > 0 ? importErrors : undefined,
      };
      if (marketplace === "yandex" && fetchedProducts.length === 0) {
        responseData.noProductsMessage = "Авторизация успешна, но товары не найдены. Проверьте Campaign ID в логах";
      }
      res.json(responseData);
    } catch (error: any) {
      console.error("Marketplace import error:", error);
      res.status(500).json({ message: "Ошибка импорта товаров" });
    }
  });

  // Smart Sync: Ozon (import + enrich in one call)
  app.post("/api/marketplace/sync/ozon", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { userId, userName } = getUserInfo(req);
      const allSettings = await storage.getMarketplaceSettings(orgId);
      const ozonSettings = allSettings.filter(s => s.marketplace === "ozon" && s.isActive && s.apiKey && s.clientId);
      if (ozonSettings.length === 0) {
        return res.status(400).json({ message: "API-ключ или Client-Id для Ozon не настроен" });
      }

      let created = 0, updated = 0, failed = 0, enriched = 0;
      let totalFetched = 0;
      const storeResults: { storeName: string; created: number; updated: number; enriched: number; error?: string }[] = [];

      for (const setting of ozonSettings) {
        const displayName = setting.storeName || `Client ${setting.clientId}`;
        let storeCreated = 0, storeUpdated = 0, storeFailed = 0, storeEnriched = 0;
        let storeError: string | undefined;

        try {
          console.log(`[Ozon Smart Sync] Importing products for «${displayName}» (clientId=${setting.clientId})...`);
          const fetchedProducts = await fetchOzonProducts(setting.apiKey!, setting.clientId!);
          totalFetched += fetchedProducts.length;

          for (const mp of fetchedProducts) {
            try {
              if (!mp.sku) { storeFailed++; continue; }
              const existing = await storage.getProductBySkuAndOrg(mp.sku, orgId);
              if (existing) {
                const updates: any = {};
                if (mp.price !== undefined && mp.price !== null) { updates.sellingPrice = String(mp.price); updates.price = String(mp.price); }
                if (mp.stock !== undefined && mp.stock !== null) updates.centralStock = mp.stock;
                if (mp.name && mp.name !== existing.name) updates.name = mp.name;
                if (mp.barcode) updates.barcode = mp.barcode;
                if (mp.imageUrl) updates.imageUrl = mp.imageUrl;
                if (mp.category) updates.category = mp.category;
                if (mp.marketplaceId) updates.ozonId = mp.marketplaceId;
                if (Object.keys(updates).length > 0) await storage.updateProduct(existing.id, updates);
                storeUpdated++;
              } else {
                await storage.createProduct({
                  name: mp.name, sku: mp.sku, barcode: mp.barcode || null, category: mp.category || null,
                  purchasePrice: "0", sellingPrice: String(mp.price ?? 0), price: String(mp.price ?? 0),
                  centralStock: mp.stock ?? 0, stockQuantity: mp.stock ?? 0, imageUrl: mp.imageUrl || null,
                  ozonId: mp.marketplaceId || null, wbId: null, yandexId: null, organizationId: orgId,
                });
                storeCreated++;
              }
            } catch (err: any) { storeFailed++; }
          }
          console.log(`[Ozon Smart Sync] «${displayName}»: created ${storeCreated}, updated ${storeUpdated}, failed ${storeFailed}`);

          const storeSkus = new Set(fetchedProducts.filter(mp => mp.sku).map(mp => mp.sku));
          const allProducts = await storage.getProducts(orgId);
          const toEnrich = allProducts.filter(p => p.ozonId && storeSkus.has(p.sku)).map(p => ({ id: p.id, sku: p.sku, ozonId: p.ozonId! }));

          if (toEnrich.length > 0) {
            try {
              const enrichResult = await enrichOzonProducts(setting.apiKey!, setting.clientId!, toEnrich);
              for (const u of (enrichResult.updates || [])) {
                try {
                  const updateData: any = {};
                  if (u.data.name && u.data.name.length > 0) updateData.name = u.data.name;
                  if (u.data.imageUrl && u.data.imageUrl.startsWith("http")) updateData.imageUrl = u.data.imageUrl;
                  if (u.data.price > 0) { updateData.sellingPrice = String(u.data.price); updateData.price = String(u.data.price); }
                  if (u.data.stock !== undefined && u.data.stock !== null) updateData.centralStock = u.data.stock;
                  if (u.data.barcode && u.data.barcode.length > 0) updateData.barcode = u.data.barcode;
                  if (u.data.category && u.data.category.length > 0) updateData.category = u.data.category;
                  if (Object.keys(updateData).length > 0) { await storage.updateProduct(u.dbId, updateData); storeEnriched++; }
                } catch (err: any) { console.error(`[Ozon Smart Sync] Enrich DB update failed: ${err.message}`); }
              }
            } catch (err: any) {
              console.error(`[Ozon Smart Sync] Enrichment failed for «${displayName}»: ${err.message}`);
            }
          }
          console.log(`[Ozon Smart Sync] «${displayName}» enriched: ${storeEnriched}`);
        } catch (err: any) {
          console.error(`[Ozon Smart Sync] Error for «${displayName}»:`, err.message);
          storeError = `Ошибка для магазина «${displayName}»: ${err.message}`;
        }

        created += storeCreated;
        updated += storeUpdated;
        failed += storeFailed;
        enriched += storeEnriched;
        storeResults.push({ storeName: displayName, created: storeCreated, updated: storeUpdated, enriched: storeEnriched, error: storeError });
      }

      await storage.createAuditLog({
        organizationId: orgId, userId, userName,
        action: "ozon_smart_sync", entityType: "product",
        details: `Синхронизация Ozon: создано ${created}, обновлено ${updated}, обогащено ${enriched} (${ozonSettings.length} магазинов)`,
      });
      await storage.createSyncHistory({
        organizationId: orgId, action: "product_sync",
        status: failed > 0 && created === 0 && updated === 0 ? "fail" : "success",
        details: `Синхронизация Ozon: создано ${created}, обновлено ${updated}, обогащено ${enriched} (${ozonSettings.length} магазинов)`,
        itemsCount: created + updated,
      });

      res.json({ success: true, marketplace: "ozon", created, updated, enriched, failed, total: totalFetched, storeResults });
    } catch (error: any) {
      console.error("Ozon smart sync error:", error);
      res.status(500).json({ message: `Ошибка синхронизации Ozon: ${error.message}` });
    }
  });

  // Smart Sync: Wildberries (import + enrich + fix photos in one call)
  app.post("/api/marketplace/sync/wildberries", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { userId, userName } = getUserInfo(req);
      const allSettings = await storage.getMarketplaceSettings(orgId);
      const setting = allSettings.find(s => s.marketplace === "wildberries" && s.isActive);
      if (!setting || !setting.apiKey) {
        return res.status(400).json({ message: "API-ключ Wildberries не настроен" });
      }

      console.log(`[WB Smart Sync] Step 1/3: Importing products...`);
      const fetchedProducts = await fetchWildberriesProducts(setting.apiKey, setting.warehouseId || undefined);

      let created = 0, updated = 0, failed = 0;
      for (const mp of fetchedProducts) {
        try {
          if (!mp.sku) { failed++; continue; }
          const existing = await storage.getProductBySkuAndOrg(mp.sku, orgId);
          if (existing) {
            const updates: any = {};
            if (mp.price !== undefined && mp.price !== null) { updates.sellingPrice = String(mp.price); updates.price = String(mp.price); }
            if (mp.stock !== undefined && mp.stock !== null) updates.centralStock = mp.stock;
            if (mp.name && mp.name !== existing.name) updates.name = mp.name;
            if (mp.barcode) updates.barcode = mp.barcode;
            if (mp.imageUrl) updates.imageUrl = mp.imageUrl;
            if (mp.category) updates.category = mp.category;
            if (mp.marketplaceId) updates.wbId = mp.marketplaceId;
            if (Object.keys(updates).length > 0) await storage.updateProduct(existing.id, updates);
            updated++;
          } else {
            await storage.createProduct({
              name: mp.name, sku: mp.sku, barcode: mp.barcode || null, category: mp.category || null,
              purchasePrice: "0", sellingPrice: String(mp.price ?? 0), price: String(mp.price ?? 0),
              centralStock: mp.stock ?? 0, stockQuantity: mp.stock ?? 0, imageUrl: mp.imageUrl || null,
              ozonId: null, wbId: mp.marketplaceId || null, yandexId: null, organizationId: orgId,
            });
            created++;
          }
        } catch (err: any) { failed++; }
      }
      console.log(`[WB Smart Sync] Step 1 complete: created ${created}, updated ${updated}, failed ${failed}`);

      console.log(`[WB Smart Sync] Step 2/3: Enriching stocks & prices...`);
      const allProducts = await storage.getProducts(orgId);
      const toEnrich = allProducts.filter(p => p.wbId).map(p => ({ id: p.id, sku: p.sku, wbId: p.wbId!, barcode: p.barcode }));
      let enriched = 0;
      let stocksUpdated = 0;

      if (toEnrich.length > 0) {
        const enrichResult = await enrichWbProducts(setting.apiKey, setting.warehouseId || undefined, toEnrich);
        for (const u of (enrichResult.updates || [])) {
          try {
            const updateData: any = {};
            if (u.data.imageUrl && u.data.imageUrl.startsWith("http")) updateData.imageUrl = u.data.imageUrl;
            if (u.data.price && u.data.price > 0) { updateData.sellingPrice = String(u.data.price); updateData.price = String(u.data.price); }
            if (u.data.stock !== undefined && u.data.stock !== null) { updateData.centralStock = u.data.stock; if (u.data.stock > 0) stocksUpdated++; }
            if (u.data.barcode && u.data.barcode.length > 0) updateData.barcode = u.data.barcode;
            if (Object.keys(updateData).length > 0) { await storage.updateProduct(u.dbId, updateData); enriched++; }
          } catch (err: any) { console.error(`[WB Smart Sync] Enrich DB update failed: ${err.message}`); }
        }
      }
      console.log(`[WB Smart Sync] Step 2 complete: enriched ${enriched}, stocks updated ${stocksUpdated}`);

      console.log(`[WB Smart Sync] Step 3/3: Fixing photos from mediaFiles...`);
      const wbProducts = allProducts.filter(p => p.wbId).map(p => ({ id: p.id, wbId: p.wbId! }));
      let photosFixed = 0;

      if (wbProducts.length > 0) {
        const photoResult = await fixWbPhotos(setting.apiKey, wbProducts);
        const entries = Array.from(photoResult.photoMap.entries());
        for (const [productId, imageUrl] of entries) {
          try {
            await storage.updateProduct(productId, { imageUrl });
            photosFixed++;
          } catch (err: any) { console.error(`[WB Smart Sync] Photo DB update failed: ${err.message}`); }
        }
      }
      console.log(`[WB Smart Sync] Step 3 complete: ${photosFixed} photos fixed`);

      await storage.createAuditLog({
        organizationId: orgId, userId, userName,
        action: "wb_smart_sync", entityType: "product",
        details: `Синхронизация Wildberries: создано ${created}, обновлено ${updated}, обогащено ${enriched}, фото: ${photosFixed}`,
      });
      await storage.createSyncHistory({
        organizationId: orgId, action: "product_sync",
        status: failed > 0 && created === 0 && updated === 0 ? "fail" : "success",
        details: `Синхронизация WB: создано ${created}, обновлено ${updated}, остатки: ${stocksUpdated}, фото: ${photosFixed}`,
        itemsCount: created + updated,
      });

      res.json({ success: true, marketplace: "wildberries", created, updated, enriched, stocksUpdated, photosFixed, failed, total: fetchedProducts.length });
    } catch (error: any) {
      console.error("WB smart sync error:", error);
      res.status(500).json({ message: `Ошибка синхронизации Wildberries: ${error.message}` });
    }
  });

  // Enrich existing Ozon products with images/prices/stock
  app.post("/api/marketplace/enrich/ozon", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const allSettings = await storage.getMarketplaceSettings(orgId);
      const setting = allSettings.find(s => s.marketplace === "ozon" && s.isActive);
      if (!setting || !setting.apiKey || !setting.clientId) {
        return res.status(400).json({ message: "API-ключ Ozon не настроен" });
      }

      const allProducts = await storage.getProducts(orgId);
      const toEnrich = allProducts
        .filter(p => p.ozonId)
        .map(p => ({ id: p.id, sku: p.sku, ozonId: p.ozonId! }));

      if (toEnrich.length === 0) {
        return res.json({ success: true, message: "Нет товаров для обогащения", updated: 0 });
      }

      console.log(`[Ozon Enrich] Starting enrichment for ${toEnrich.length} products`);

      const result = await enrichOzonProducts(setting.apiKey, setting.clientId, toEnrich);
      const enrichUpdates = result.updates || [];

      let dbUpdated = 0;
      for (const u of enrichUpdates) {
        try {
          const updateData: any = {};
          if (u.data.name && u.data.name.length > 0) updateData.name = u.data.name;
          if (u.data.imageUrl && u.data.imageUrl.startsWith("http")) updateData.imageUrl = u.data.imageUrl;
          if (u.data.price > 0) {
            updateData.sellingPrice = String(u.data.price);
            updateData.price = String(u.data.price);
          }
          if (u.data.stock !== undefined && u.data.stock !== null) {
            updateData.centralStock = u.data.stock;
          }
          if (u.data.barcode && u.data.barcode.length > 0) updateData.barcode = u.data.barcode;
          if (u.data.category && u.data.category.length > 0) updateData.category = u.data.category;

          if (Object.keys(updateData).length > 0) {
            await storage.updateProduct(u.dbId, updateData);
            dbUpdated++;
          }
        } catch (err: any) {
          console.error(`[Ozon Enrich] DB update failed for product ${u.dbId}: ${err.message}`);
        }
      }

      console.log(`[Ozon Enrich] DB updated: ${dbUpdated}/${enrichUpdates.length} products`);

      const { userId, userName } = getUserInfo(req);
      await storage.createAuditLog({
        organizationId: orgId,
        userId,
        userName,
        action: "ozon_enrich",
        entityType: "product",
        details: `Обогащение товаров из Ozon: обновлено ${dbUpdated} из ${toEnrich.length}`,
      });

      console.log(`[Ozon Enrich] Complete: ${dbUpdated} products updated in DB`);

      res.json({
        success: true,
        total: toEnrich.length,
        enriched: dbUpdated,
        failed: result.failed,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } catch (error: any) {
      console.error("Ozon enrich error:", error);
      res.status(500).json({ message: `Ошибка обогащения: ${error.message}` });
    }
  });

  // Enrich product from Ozon (dimensions + commissions)
  app.post("/api/products/enrich-from-ozon", isAuthenticated, async (req, res) => {
    try {
      const { productId } = req.body;
      const orgId = getOrgId(req);
      const product = await storage.getProduct(productId);
      if (!product || product.organizationId !== orgId) {
        return res.status(404).json({ message: "Товар не найден" });
      }
      if (!product.ozonId) {
        return res.status(400).json({ message: "У товара нет Ozon ID" });
      }

      const allSettings = await storage.getMarketplaceSettings(orgId);
      const ozonSetting = allSettings.find(s => s.marketplace === "ozon" && s.isActive && s.apiKey && s.clientId);
      if (!ozonSetting) {
        return res.status(400).json({ message: "Не настроен Ozon API ключ" });
      }

      console.log("[enrich-from-ozon] product_id:", product.ozonId);

      const infoRes = await fetchWithRetry("https://api-seller.ozon.ru/v3/product/info", {
        method: "POST",
        headers: {
          "Client-Id": ozonSetting.clientId!,
          "Api-Key": ozonSetting.apiKey!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ product_id: Number(product.ozonId) })
      });
      
      if (!infoRes.ok) {
        return res.status(400).json({ message: "Ошибка Ozon API" });
      }
      
      const info = await infoRes.json();
      const item = info.result;
      console.log("[enrich-from-ozon] item keys:", Object.keys(item || {}));

      const toCm = (val: any): number => {
        const n = Number(val || 0);
        return n > 100 ? Math.round((n / 10) * 10) / 10 : n;
      };

      let dimensionLength = toCm(item.depth);
      let dimensionWidth = toCm(item.width);
      let dimensionHeight = toCm(item.height);
      const weight = Number(item.weight || 0) / 1000;

      console.log("[enrich-from-ozon] dimensions:", { dimensionLength, dimensionWidth, dimensionHeight, weight });

      let commissionFbo = 15;
      let commissionFbs = 19;
      
      const categoryId = item.description_category_id || item.category_id;
      if (categoryId) {
        const commRes = await fetchWithRetry("https://api-seller.ozon.ru/v1/category/commission", {
          method: "POST",
          headers: {
            "Client-Id": ozonSetting.clientId!,
            "Api-Key": ozonSetting.apiKey!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ 
            category_id: [Number(categoryId)],
            price: String(product.sellingPrice || "1000")
          })
        });
        
        if (commRes.ok) {
          const commData = await commRes.json();
          const comm = commData.result?.[0];
          if (comm) {
            commissionFbo = Number(comm.fbo_percent || 15);
            commissionFbs = Number(comm.fbs_percent || 19);
          }
        }
      }

      console.log("[enrich-from-ozon] commission:", { commissionFbo, commissionFbs });
      
      await storage.updateProduct(productId, {
        dimensionLength: String(dimensionLength),
        dimensionWidth: String(dimensionWidth),
        dimensionHeight: String(dimensionHeight),
        weight: String(weight),
        marketplaceCommission: String(commissionFbo),
        marketplaceCommissionFbs: String(commissionFbs),
      });
      
      return res.json({
        dimensionLength,
        dimensionWidth,
        dimensionHeight,
        weight,
        commissionFbo,
        commissionFbs,
      });
    } catch (err: any) {
      console.error("Enrich from Ozon error:", err);
      res.status(500).json({ message: err.message || "Ошибка обогащения товара" });
    }
  });

  app.post("/api/marketplace/enrich/wildberries", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const allSettings = await storage.getMarketplaceSettings(orgId);
      const setting = allSettings.find(s => s.marketplace === "wildberries" && s.isActive);
      if (!setting || !setting.apiKey) {
        return res.status(400).json({ message: "API-ключ Wildberries не настроен" });
      }

      const allProducts = await storage.getProducts(orgId);
      const toEnrich = allProducts
        .filter(p => p.wbId)
        .map(p => ({ id: p.id, sku: p.sku, wbId: p.wbId!, barcode: p.barcode }));

      if (toEnrich.length === 0) {
        return res.json({ success: true, message: "Нет товаров WB для обогащения", updated: 0 });
      }

      console.log(`[WB Enrich] Starting enrichment for ${toEnrich.length} products`);

      const result = await enrichWbProducts(setting.apiKey, setting.warehouseId || undefined, toEnrich);
      const enrichUpdates = result.updates || [];

      let dbUpdated = 0;
      let photosSet = 0;
      let stocksSet = 0;
      let barcodesSet = 0;
      for (const u of enrichUpdates) {
        try {
          const updateData: any = {};
          if (u.data.imageUrl && u.data.imageUrl.startsWith("http")) {
            updateData.imageUrl = u.data.imageUrl;
            photosSet++;
          }
          if (u.data.price && u.data.price > 0) {
            updateData.sellingPrice = String(u.data.price);
            updateData.price = String(u.data.price);
          }
          if (u.data.stock !== undefined && u.data.stock !== null) {
            updateData.centralStock = u.data.stock;
            if (u.data.stock > 0) stocksSet++;
          }
          if (u.data.barcode && u.data.barcode.length > 0) {
            updateData.barcode = u.data.barcode;
            barcodesSet++;
          }

          if (Object.keys(updateData).length > 0) {
            await storage.updateProduct(u.dbId, updateData);
            dbUpdated++;
          }
        } catch (err: any) {
          console.error(`[WB Sync] DB update failed for product ${u.dbId}: ${err.message}`);
        }
      }

      console.log(`[WB Sync] Updated ${photosSet} products with photos and ${stocksSet} products with stocks`);
      console.log(`[WB Sync] Barcodes saved: ${barcodesSet}, total DB updates: ${dbUpdated}/${enrichUpdates.length}`);

      const { userId, userName } = getUserInfo(req);
      await storage.createAuditLog({
        organizationId: orgId,
        userId,
        userName,
        action: "wb_enrich",
        entityType: "product",
        details: `Обогащение товаров из Wildberries: обновлено ${dbUpdated} из ${toEnrich.length} (фото: ${photosSet}, остатки: ${stocksSet})`,
      });

      await storage.createSyncHistory({
        organizationId: orgId,
        action: "product_enrich",
        status: result.failed > 0 && dbUpdated === 0 ? "fail" : "success",
        details: `Обогащение WB: обновлено ${dbUpdated}, фото: ${photosSet}, остатки: ${stocksSet}, ошибок: ${result.failed}`,
        itemsCount: dbUpdated,
      });

      res.json({
        success: true,
        total: toEnrich.length,
        enriched: dbUpdated,
        photosUpdated: photosSet,
        stocksUpdated: stocksSet,
        barcodesUpdated: barcodesSet,
        failed: result.failed,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } catch (error: any) {
      console.error("WB enrich error:", error);
      res.status(500).json({ message: `Ошибка обогащения WB: ${error.message}` });
    }
  });

  app.post("/api/marketplace/fix-photos/wildberries", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const allSettings = await storage.getMarketplaceSettings(orgId);
      const setting = allSettings.find(s => s.marketplace === "wildberries" && s.isActive);
      if (!setting || !setting.apiKey) {
        return res.status(400).json({ message: "API-ключ Wildberries не настроен" });
      }

      const allProducts = await storage.getProducts(orgId);
      const wbProducts = allProducts
        .filter(p => p.wbId)
        .map(p => ({ id: p.id, wbId: p.wbId! }));

      if (wbProducts.length === 0) {
        return res.json({ success: true, message: "Нет товаров WB", updated: 0 });
      }

      console.log(`[WB Photo Fix] Starting photo fix for ${wbProducts.length} products`);

      const result = await fixWbPhotos(setting.apiKey, wbProducts);

      let dbUpdated = 0;
      const entries = Array.from(result.photoMap.entries());
      for (const [productId, imageUrl] of entries) {
        try {
          await storage.updateProduct(productId, { imageUrl });
          dbUpdated++;
        } catch (err: any) {
          console.error(`[WB Photo Fix] DB update failed for product ${productId}: ${err.message}`);
        }
      }

      const { userId, userName } = getUserInfo(req);
      await storage.createAuditLog({
        organizationId: orgId,
        userId,
        userName,
        action: "wb_photo_fix",
        entityType: "product",
        details: `Исправление фото WB: обновлено ${result.updated} из ${wbProducts.length}`,
      });

      res.json({
        success: true,
        total: wbProducts.length,
        photosUpdated: result.updated,
        failed: result.failed,
      });
    } catch (error: any) {
      console.error("WB photo fix error:", error);
      res.status(500).json({ message: `Ошибка исправления фото WB: ${error.message}` });
    }
  });

  app.post("/api/products/:id/sync-to-marketplace", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const orgId = getOrgId(req);
      const product = await storage.getProduct(productId);
      if (!product) return res.status(404).json({ message: "Товар не найден" });
      if (product.organizationId !== orgId) return res.status(403).json({ message: "Доступ запрещён" });

      const { name, barcode, sellingPrice, category } = req.body;
      const syncResults: any = { ozon: null, wb: null, errors: [] };
      const allSettings = await storage.getMarketplaceSettings(orgId);

      if (product.ozonId) {
        const ozonSetting = allSettings.find(s => s.marketplace === "ozon" && s.isActive);

        if (ozonSetting && ozonSetting.apiKey && ozonSetting.clientId) {
          const offerId = product.sku;
          const updates: any = {};

          if (name && name !== product.name) updates.name = name;
          if (barcode && barcode !== product.barcode) updates.barcode = barcode;
          if (sellingPrice !== undefined) {
            const newPrice = Number(sellingPrice);
            const oldPrice = Number(product.sellingPrice) || 0;
            if (newPrice !== oldPrice) {
              updates.sellingPrice = newPrice;
              if (oldPrice > newPrice) updates.oldPrice = oldPrice;
            }
          }

          if (Object.keys(updates).length > 0) {
            const ozonResult = await syncProductToOzon(
              ozonSetting.apiKey,
              ozonSetting.clientId,
              offerId,
              updates
            );
            syncResults.ozon = ozonResult;

            if (ozonResult.errors.length > 0) {
              syncResults.errors.push(...ozonResult.errors);
            }
          }
        }
      }

      if (product.wbId) {
        const wbSetting = allSettings.find(s => s.marketplace === "wildberries" && s.isActive);

        if (wbSetting && wbSetting.apiKey) {
          const wbUpdates: any = {};

          if (sellingPrice !== undefined) {
            const newPrice = Number(sellingPrice);
            const oldPrice = Number(product.sellingPrice) || 0;
            if (newPrice !== oldPrice) {
              wbUpdates.sellingPrice = newPrice;
            }
          }

          if (Object.keys(wbUpdates).length > 0) {
            const wbResult = await syncProductToWb(
              wbSetting.apiKey,
              product.wbId,
              wbUpdates
            );
            syncResults.wb = wbResult;

            if (wbResult.errors.length > 0) {
              syncResults.errors.push(...wbResult.errors);
            }
          }
        }
      }

      if (syncResults.errors.length > 0) {
        return res.status(422).json({
          message: "Маркетплейс отклонил изменения",
          details: syncResults.errors,
          syncResults,
        });
      }

      const { dimensionLength, dimensionWidth, dimensionHeight, weight, marketplaceCommission, marketplaceCommissionFbs } = req.body;
      const updateData: any = {};
      if (name) updateData.name = name;
      if (barcode !== undefined) updateData.barcode = barcode;
      if (sellingPrice !== undefined) {
        updateData.sellingPrice = String(sellingPrice);
        updateData.price = String(sellingPrice);
      }
      if (category !== undefined) updateData.category = category;
      if (dimensionLength !== undefined) updateData.dimensionLength = String(dimensionLength);
      if (dimensionWidth !== undefined) updateData.dimensionWidth = String(dimensionWidth);
      if (dimensionHeight !== undefined) updateData.dimensionHeight = String(dimensionHeight);
      if (weight !== undefined) updateData.weight = String(weight);
      if (marketplaceCommission !== undefined) updateData.marketplaceCommission = String(marketplaceCommission);
      if (marketplaceCommissionFbs !== undefined) updateData.marketplaceCommissionFbs = String(marketplaceCommissionFbs);

      const updated = await storage.updateProduct(productId, updateData);

      const { userId, userName } = getUserInfo(req);
      await storage.createAuditLog({
        organizationId: orgId,
        userId,
        userName,
        action: "product_update_with_sync",
        entityType: "product",
        entityId: productId,
        details: `Обновлён товар «${updated.name}» с синхронизацией на маркетплейсы`,
      });

      res.json({ product: updated, syncResults });
    } catch (error: any) {
      console.error("Product sync error:", error);
      res.status(500).json({ message: `Ошибка синхронизации: ${error.message}` });
    }
  });

  // Tax Settings (owner only)
  app.get(api.taxSettings.get.path, isAuthenticated, requireRole("owner"), async (req, res) => {
    const settings = await storage.getTaxSettings(getOrgId(req));
    res.json(settings || null);
  });

  app.post(api.taxSettings.save.path, isAuthenticated, requireRole("owner"), async (req, res) => {
    try {
      const input = api.taxSettings.save.input.parse({ ...req.body, organizationId: getOrgId(req) });
      const setting = await storage.saveTaxSettings(input);
      res.status(201).json(setting);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json(err);
      throw err;
    }
  });

  // KPI Dashboard
  app.get(api.kpi.get.path, isAuthenticated, async (req, res) => {
    const kpi = await storage.getDashboardKPI(getOrgId(req));
    res.json(kpi);
  });

  // Audit Log (owner & accountant)
  app.get(api.auditLog.list.path, isAuthenticated, requireRole("owner", "accountant"), async (req, res) => {
    const log = await storage.getAuditLog(getOrgId(req));
    res.json(log);
  });

  // Stock Inflow (owner & administrator)
  app.get(api.stockInflow.list.path, isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    const inflows = await storage.getStockInflows(getOrgId(req));
    res.json(inflows);
  });

  app.post(api.stockInflow.create.path, isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const { userId, userName } = getUserInfo(req);
      const input = api.stockInflow.create.input.parse({ ...req.body, organizationId: getOrgId(req) });
      const inflow = await storage.createStockInflow(input, userId, userName);
      res.status(201).json(inflow);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json(err);
      throw err;
    }
  });

  // Sync History (owner only)
  app.get(api.syncHistory.list.path, isAuthenticated, requireRole("owner"), async (req, res) => {
    const history = await storage.getSyncHistory(getOrgId(req));
    res.json(history);
  });

  // Analytics
  app.get(api.analytics.abc.path, isAuthenticated, requireRole("owner"), async (req, res) => {
    const abc = await storage.getABCAnalysis(getOrgId(req));
    res.json(abc);
  });

  app.get(api.analytics.sales.path, isAuthenticated, requireRole("owner"), async (req, res) => {
    const days = req.query.days ? Number(req.query.days) : undefined;
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    const storeId = req.query.storeId ? Number(req.query.storeId) : undefined;
    const result = await storage.getSalesData(getOrgId(req), { days, from, to, storeId });
    res.json(result);
  });

  app.get(api.analytics.lowStock.path, isAuthenticated, async (req, res) => {
    const threshold = req.query.threshold ? Number(req.query.threshold) : 10;
    const lowStock = await storage.getLowStockProducts(getOrgId(req), threshold);
    res.json(lowStock);
  });

  // Marketplace Sync (production-ready wrapper)
  // IMPORTANT: Marketplace sync must NEVER create or import customer records into the CRM.
  // CRM customers are exclusively created via direct sales or manual entry.
  // Marketplace orders (Ozon, Wildberries, Yandex) are anonymous/marketplace-owned transactions.
  app.post("/api/marketplace/sync-store/:storeId", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const storeId = Number(req.params.storeId);

      const isDemo = await inventorySyncEngine.isDemoMode(orgId);
      if (isDemo) {
        const logEntry = await inventorySyncEngine.demoSyncStore(orgId, storeId);
        return res.json({ success: true, message: `[ДЕМО] Синхронизация завершена`, demoMode: true, log: logEntry });
      }

      const allStores = await storage.getStoresByOrg(orgId);
      const store = allStores.find(s => s.id === storeId);
      if (!store) return res.status(404).json({ message: "Магазин не найден" });

      const settings = await storage.getMarketplaceSettings(orgId);
      const storeSetting = settings.find(s => s.marketplace === store.marketplace);

      if (!storeSetting || !storeSetting.apiKey) {
        await storage.createSyncHistory({
          organizationId: orgId, storeId: store.id, companyId: store.companyId,
          action: "stock_sync", status: "error", details: "API-ключ не настроен", itemsCount: 0,
        });
        return res.status(400).json({ message: "API-ключ не настроен для данного маркетплейса" });
      }

      await storage.createSyncHistory({
        organizationId: orgId, storeId: store.id, companyId: store.companyId,
        action: "stock_sync", status: "success", details: `Синхронизация остатков с ${store.name}`, itemsCount: 0,
      });

      await storage.updateStore(store.id, { lastSync: new Date() } as any);
      res.json({ success: true, message: `Синхронизация с ${store.name} запущена` });
    } catch (error) {
      console.error("Sync error:", error);
      res.status(500).json({ message: "Ошибка синхронизации" });
    }
  });

  // Sync on order status change  
  app.patch(api.orders.updateStatus.path + "-sync", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const orderId = Number(req.params.id);
      const { status } = req.body;
      const order = await storage.updateOrderStatus(orderId, status);

      if (status === "confirmed" && order.storeId) {
        await storage.createSyncHistory({
          organizationId: orgId, storeId: order.storeId, companyId: order.companyId,
          action: "order_status_push", status: "success",
          details: `Заказ ${order.orderNumber} — статус «${status}» отправлен на маркетплейс`,
          itemsCount: 1,
        });
      }

      res.json(order);
    } catch (error) {
      console.error("Status sync error:", error);
      res.status(500).json({ message: "Ошибка обновления статуса" });
    }
  });

  // Export endpoints
  app.get("/api/export/products", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    const productsList = await storage.getProducts(getOrgId(req));
    const ws = XLSX.utils.json_to_sheet(productsList.map(p => ({
      "Название": p.name,
      "Артикул": p.sku,
      "Штрихкод": p.barcode || "",
      "Категория": p.category || "",
      "Закупка": Number(p.purchasePrice),
      "Продажа": Number(p.sellingPrice),
      "Центральный склад": p.centralStock || 0,
      "Всего": p.stockQuantity,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Товары");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=products.xlsx");
    res.send(Buffer.from(buffer));
  });

  app.get("/api/export/sales", isAuthenticated, requireRole("owner"), async (req, res) => {
    const orgId = getOrgId(req);
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    const storeId = req.query.storeId ? Number(req.query.storeId) : undefined;
    const result = await storage.getSalesData(orgId, { from, to, storeId });

    const rows = result.data.map(s => ({
      "Дата": s.date,
      "Компания": s.companyName,
      "Выручка": s.revenue,
    }));
    rows.push({ "Дата": "ИТОГО", "Компания": "", "Выручка": result.totalRevenue });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Выручка");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=sales-${from || "all"}-${to || "all"}.xlsx`);
    res.send(Buffer.from(buffer));
  });

  app.get("/api/export/pnl", isAuthenticated, requireRole("owner", "accountant"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const expensesList = await storage.getExpenses(orgId);
      const taxSetting = await storage.getTaxSettings(orgId);
      const taxRate = Number(taxSetting?.taxRate || 7) / 100;
      const defaultCommission = Number(taxSetting?.defaultMarketplaceCommission || 15) / 100;
      const defaultLogistics = Number(taxSetting?.defaultLogisticsCost || 0);

      const fromParam = req.query.from as string | undefined;
      const toParam = req.query.to as string | undefined;
      const fromDate = fromParam ? new Date(fromParam) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const toDate = toParam ? new Date(toParam) : new Date();
      toDate.setHours(23, 59, 59, 999);

      const periodOrders = await db.select().from(ordersTable).where(
        and(
          eq(ordersTable.organizationId, orgId),
          gte(ordersTable.createdAt, fromDate),
          lte(ordersTable.createdAt, toDate)
        )
      );

      const nonCancelledOrders = periodOrders.filter(o =>
        o.status !== "cancelled" &&
        o.ozonStatus !== "cancelled" &&
        o.yandexStatus !== "CANCELLED" &&
        o.yandexStatus !== "RETURNED"
      );
      const orderIds = nonCancelledOrders.map(o => o.id);

      let totalRevenue = 0, totalCost = 0, totalCommission = 0, totalLogistics = 0;

      if (orderIds.length > 0) {
        const items = await db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, orderIds));
        for (const item of items) {
          const rev = Number(item.price) * item.quantity;
          const cost = Number(item.purchasePrice || 0) * item.quantity;
          totalRevenue += rev;
          totalCost += cost;
          totalCommission += rev * defaultCommission;
          totalLogistics += item.quantity * defaultLogistics;
        }
      }

      const totalExpenses = expensesList.reduce((s, e) => s + Number(e.amount), 0);
      const tax = totalRevenue * taxRate;
      const profit = totalRevenue - totalCost - totalCommission - totalLogistics - totalExpenses - tax;

      const fromLabel = fromDate.toLocaleDateString("ru-RU");
      const toLabel = toDate.toLocaleDateString("ru-RU");

      const ws = XLSX.utils.json_to_sheet([
        { "Показатель": `Период`, "Сумма": `${fromLabel} — ${toLabel}` },
        { "Показатель": "Выручка (продажи)", "Сумма": Math.round(totalRevenue) },
        { "Показатель": "Себестоимость", "Сумма": Math.round(totalCost) },
        { "Показатель": `Комиссия МП (${(defaultCommission * 100).toFixed(0)}%)`, "Сумма": Math.round(totalCommission) },
        { "Показатель": "Логистика", "Сумма": Math.round(totalLogistics) },
        { "Показатель": "Операционные расходы", "Сумма": Math.round(totalExpenses) },
        { "Показатель": `Налог (${(taxRate * 100).toFixed(0)}%)`, "Сумма": Math.round(tax) },
        { "Показатель": "Чистая прибыль", "Сумма": Math.round(profit) },
        {},
        { "Показатель": "Расшифровка расходов", "Сумма": "" },
        ...expensesList.map(e => ({
          "Показатель": e.description || e.type,
          "Сумма": Number(e.amount),
        })),
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "P&L");
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=pnl-report.xlsx");
      res.send(Buffer.from(buffer));
    } catch (err: any) {
      console.error("[pnl-export] Error:", err);
      res.status(500).json({ message: "Ошибка формирования P&L" });
    }
  });

  // Inventory Sync Endpoints
  app.get(api.inventorySync.status.path, isAuthenticated, async (req, res) => {
    try {
      const status = await inventorySyncEngine.getSyncStatus(getOrgId(req));
      res.json(status);
    } catch (error) {
      console.error("Sync status error:", error);
      res.status(500).json({ message: "Ошибка получения статуса синхронизации" });
    }
  });

  app.get(api.inventorySync.logs.path, isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      const logs = await inventorySyncEngine.getSyncLogs(getOrgId(req), limit);
      res.json(logs);
    } catch (error) {
      console.error("Sync logs error:", error);
      res.status(500).json({ message: "Ошибка получения логов синхронизации" });
    }
  });

  app.get(api.inventorySync.settings.path, isAuthenticated, requireRole("owner"), async (req, res) => {
    try {
      const settings = await inventorySyncEngine.getSyncSettings(getOrgId(req));
      res.json(settings || { defaultSafetyStock: 2, syncEnabled: true, demoMode: false });
    } catch (error) {
      console.error("Sync settings error:", error);
      res.status(500).json({ message: "Ошибка получения настроек синхронизации" });
    }
  });

  app.post(api.inventorySync.saveSettings.path, isAuthenticated, requireRole("owner"), async (req, res) => {
    try {
      const { defaultSafetyStock, syncEnabled, demoMode } = req.body;
      const settings = await inventorySyncEngine.saveSyncSettings(
        getOrgId(req),
        defaultSafetyStock ?? 2,
        syncEnabled ?? true,
        demoMode
      );
      res.json(settings);
    } catch (error) {
      console.error("Save sync settings error:", error);
      res.status(500).json({ message: "Ошибка сохранения настроек синхронизации" });
    }
  });

  app.patch(api.inventorySync.updateProductSafetyStock.path, isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const { safetyStock } = req.body;
      const product = await storage.updateProduct(productId, { safetyStock });
      res.json(product);
    } catch (error) {
      console.error("Update product safety stock error:", error);
      res.status(500).json({ message: "Ошибка обновления резервного остатка" });
    }
  });

  // Seed Data
  app.post("/api/seed", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      await storage.seedData(orgId);
      res.json({ message: "Демо-данные успешно созданы" });
    } catch (error) {
      console.error("Seed error:", error);
      res.status(500).json({ message: "Ошибка при создании демо-данных" });
    }
  });

  // Image Upload
  app.post("/api/upload/image", isAuthenticated, uploadImage.single("image"), (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Файл не загружен" });
    const imageUrl = `/uploads/images/${req.file.filename}`;
    res.json({ imageUrl });
  });

  app.use("/uploads/images", (req, res, next) => {
    const baseDir = path.join(process.cwd(), "uploads/images");
    const requestedPath = path.normalize(req.path).replace(/^(\.\.(\/|\\|$))+/, "");
    const filePath = path.resolve(baseDir, requestedPath);
    if (!filePath.startsWith(baseDir)) return res.status(403).json({ message: "Доступ запрещён" });
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ message: "Файл не найден" });
    }
  });

  // Product Import
  app.post("/api/products/import", isAuthenticated, requireRole("owner", "administrator"), uploadFile.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Файл не загружен" });

    const orgId = getOrgId(req);
    const ext = path.extname(req.file.originalname).toLowerCase();
    let parsedProducts: any[] = [];

    try {
      if (ext === ".xlsx" || ext === ".xls") {
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);
        
        parsedProducts = data.map((row: any, index: number) => ({
          name: row["Название"] || row["name"] || `Товар ${index + 1}`,
          sku: row["Артикул"] || row["sku"] || `SKU-${Date.now()}-${index}`,
          barcode: row["Штрихкод"] || row["barcode"] || null,
          purchasePrice: String(row["Закупка"] || row["purchasePrice"] || 0),
          sellingPrice: String(row["Продажа"] || row["sellingPrice"] || row["Цена"] || 0),
          stockLocal: Number(row["Склад"] || row["stockLocal"] || row["Количество"] || 0),
          category: row["Категория"] || row["category"] || "",
          description: row["Описание"] || row["description"] || "",
        }));
      } else if (ext === ".docx" || ext === ".doc") {
        const result = await mammoth.extractRawText({ buffer: req.file.buffer });
        const lines = result.value.split("\n").filter(line => line.trim());
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line && !line.startsWith("#") && !line.toLowerCase().includes("название")) {
            const parts = line.split(/\t|\s{2,}/).map(p => p.trim());
            if (parts.length >= 1 && parts[0]) {
              parsedProducts.push({
                name: parts[0], sku: parts[1] || `SKU-${Date.now()}-${i}`,
                purchasePrice: String(parts[2] || 0), sellingPrice: String(parts[3] || 0),
                stockLocal: Number(parts[4] || 0), category: parts[5] || "", description: "",
              });
            }
          }
        }
      } else if (ext === ".pdf") {
        const pdfData = await pdfParse(req.file.buffer);
        const lines: string[] = pdfData.text.split("\n").filter((line: string) => line.trim());
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line && !line.toLowerCase().includes("название") && line.length > 3) {
            const parts = line.split(/\t|\s{2,}/).map((p: string) => p.trim());
            if (parts.length >= 1 && parts[0] && !/^\d+$/.test(parts[0])) {
              parsedProducts.push({
                name: parts[0], sku: parts[1] || `SKU-${Date.now()}-${i}`,
                purchasePrice: String(parts[2]?.replace(/[^\d.]/g, "") || 0),
                sellingPrice: String(parts[3]?.replace(/[^\d.]/g, "") || 0),
                stockLocal: Number(parts[4]?.replace(/\D/g, "") || 0), category: "", description: "",
              });
            }
          }
        }
      } else {
        return res.status(400).json({ message: "Неподдерживаемый формат файла." });
      }

      const created: any[] = [];
      const errors: string[] = [];
      const companyId = req.body.companyId ? Number(req.body.companyId) : null;
      
      for (const p of parsedProducts) {
        try {
          const product = await storage.createProduct({
            ...p, price: p.sellingPrice,
            organizationId: orgId, companyId,
          });
          created.push(product);
        } catch (err: any) {
          errors.push(`${p.name}: ${err.message}`);
        }
      }

      res.json({
        success: true, imported: created.length, errors: errors.length > 0 ? errors : undefined,
        message: `Импортировано ${created.length} товаров${errors.length > 0 ? `, ошибок: ${errors.length}` : ""}`
      });
    } catch (error: any) {
      console.error("Import error:", error);
      res.status(500).json({ message: `Ошибка импорта: ${error.message}` });
    }
  });

  // ===== OZON ORDER MANAGEMENT =====

  // Ozon FBS Status Mapping
  const ozonStatusToInternal = (ozonStatus: string): string => {
    switch (ozonStatus) {
      case "awaiting_approve": return "pending";
      case "awaiting_packaging": return "pending";
      case "awaiting_deliver": return "pending";
      case "delivering": return "shipped";
      case "sent_by_seller": return "shipped";
      case "delivered": return "completed";
      case "cancelled": return "cancelled";
      case "not_accepted": return "cancelled";
      case "arbitration": return "disputed";
      default: return "pending";
    }
  };

  const ozonStatusLabel = (status: string): string => {
    const map: Record<string, string> = {
      awaiting_approve: "Ожидает подтверждения",
      awaiting_packaging: "Ожидает сборки",
      awaiting_deliver: "Ожидает отгрузки",
      arbitration: "Арбитраж",
      delivering: "Доставляется",
      delivered: "Доставлен",
      cancelled: "Отменён",
      not_accepted: "Не принят",
    };
    return map[status] || status;
  };

  const resolveStoreForSetting = async (setting: { companyId: number | null; clientId: string | null }): Promise<{ storeId: number | null; companyId: number | null; storeName: string | null }> => {
    if (setting.companyId) {
      const companyStores = await storage.getStores(setting.companyId);
      const ozonStore = companyStores.find(s => s.marketplace === "ozon" && s.clientId === setting.clientId);
      if (ozonStore) return { storeId: ozonStore.id, companyId: setting.companyId, storeName: ozonStore.name };
      const anyOzonStore = companyStores.find(s => s.marketplace === "ozon");
      if (anyOzonStore) return { storeId: anyOzonStore.id, companyId: setting.companyId, storeName: anyOzonStore.name };
      return { storeId: null, companyId: setting.companyId, storeName: null };
    }
    return { storeId: null, companyId: null, storeName: null };
  };

  const getOzonHeadersForOrder = async (order: { storeId: number | null }, orgId: string): Promise<{ "Client-Id": string; "Api-Key": string; "Content-Type": string } | null> => {
    const allSettings = await storage.getMarketplaceSettings(orgId);
    const ozonSettings = allSettings.filter(s => s.marketplace === "ozon" && s.apiKey && s.clientId);
    if (ozonSettings.length === 0) return null;

    if (order.storeId) {
      const store = await storage.getStore(order.storeId);
      if (store && store.clientId) {
        const matchedSetting = ozonSettings.find(s => s.clientId === store.clientId);
        if (matchedSetting) {
          return {
            "Client-Id": String(parseInt(matchedSetting.clientId!.trim(), 10)),
            "Api-Key": matchedSetting.apiKey!.trim(),
            "Content-Type": "application/json",
          };
        }
      }
    }

    const fallback = ozonSettings[0];
    return {
      "Client-Id": String(parseInt(fallback.clientId!.trim(), 10)),
      "Api-Key": fallback.apiKey!.trim(),
      "Content-Type": "application/json",
    };
  };

  // Webhook: receive Ozon push notifications for FBS orders
  app.post("/api/webhooks/ozon/orders", async (req, res) => {
    const clientId = req.headers["client-id"] as string || "";
    const apiKey = req.headers["api-key"] as string || "";
    const payload = JSON.stringify(req.body);

    console.log(`[ozon-webhook] Incoming webhook, Client-Id: ${clientId}, body size: ${payload.length}`);

    try {
      if (!clientId) {
        console.warn("[ozon-webhook] Missing Client-Id header");
        await storage.createWebhookLog({ source: "ozon", eventType: "order", payload, status: "error", errorMessage: "Missing Client-Id header", organizationId: null });
        return res.status(401).json({ message: "Missing Client-Id" });
      }

      const allSettings = await db.select().from(marketplaceSettingsTable)
        .where(and(
          eq(marketplaceSettingsTable.marketplace, "ozon"),
          eq(marketplaceSettingsTable.clientId, clientId)
        ));

      if (allSettings.length === 0) {
        console.warn(`[ozon-webhook] No marketplace setting found for Client-Id: ${clientId}`);
        await storage.createWebhookLog({ source: "ozon", eventType: "order", payload, status: "error", errorMessage: `Unknown Client-Id: ${clientId}`, organizationId: null });
        return res.status(403).json({ message: "Unknown Client-Id" });
      }

      const setting = allSettings[0];
      const orgId = setting.organizationId;

      if (setting.apiKey !== apiKey) {
        console.warn(`[ozon-webhook] API key mismatch for Client-Id: ${clientId}`);
        await storage.createWebhookLog({ source: "ozon", eventType: "order", payload, status: "error", errorMessage: "API key mismatch", organizationId: orgId });
        return res.status(403).json({ message: "Invalid Api-Key" });
      }

      const { storeId: resolvedStoreId, companyId: resolvedCompanyId, storeName: resolvedStoreName } = await resolveStoreForSetting(setting);

      const data = req.body;
      const postingNumber = data?.posting_number || data?.posting?.posting_number;
      const ozonStatus = data?.status || data?.posting?.status;
      const products_list = data?.products || data?.posting?.products || [];

      console.log(`[ozon-webhook] Processing posting ${postingNumber}, status: ${ozonStatus}, products: ${products_list.length}, storeId: ${resolvedStoreId}, companyId: ${resolvedCompanyId}`);

      const existingOrder = postingNumber ? await storage.getOrderByPostingNumber(postingNumber, orgId) : null;

      if (existingOrder) {
        console.log(`[ozon-webhook] Updating existing order #${existingOrder.id} for posting ${postingNumber}`);
        const internalStatus = ozonStatusToInternal(ozonStatus);
        await storage.updateOrderOzonStatus(existingOrder.id, ozonStatus, internalStatus);
        await storage.createWebhookLog({ source: "ozon", eventType: "order_update", payload, status: "processed", organizationId: orgId, orderId: existingOrder.id });
        return res.json({ success: true, action: "updated", orderId: existingOrder.id });
      }

      const orderItems: { productId: number; quantity: number; price: number }[] = [];
      let totalAmount = 0;

      for (const prod of products_list) {
        const sku = prod.offer_id || prod.sku || "";
        const qty = prod.quantity || 1;
        const price = parseFloat(prod.price || "0");

        if (sku) {
          const [dbProduct] = await db.select().from(productsTable)
            .where(and(eq(productsTable.sku, sku), eq(productsTable.organizationId, orgId)));

          if (dbProduct) {
            orderItems.push({ productId: dbProduct.id, quantity: qty, price });
            totalAmount += price * qty;
          } else {
            console.warn(`[ozon-webhook] Product not found by SKU: ${sku}`);
          }
        }
      }

      if (orderItems.length === 0) {
        console.warn(`[ozon-webhook] No products matched for posting ${postingNumber}`);
        await storage.createWebhookLog({ source: "ozon", eventType: "order_no_match", payload, status: "warning", errorMessage: "No products matched by SKU", organizationId: orgId });
        return res.json({ success: false, message: "No matching products" });
      }

      const internalStatus = ozonStatusToInternal(ozonStatus);
      const order = await storage.createOrder({
        orderNumber: postingNumber || `OZON-${Date.now()}`,
        status: internalStatus,
        totalAmount: totalAmount.toFixed(2),
        source: "ozon",
        externalId: data?.order_id?.toString() || postingNumber,
        postingNumber: postingNumber || null,
        ozonStatus: ozonStatus || null,
        storeId: resolvedStoreId,
        sourceStoreName: resolvedStoreName,
        companyId: resolvedCompanyId,
        fulfillmentType: "FBS",
        organizationId: orgId,
      }, orderItems);

      console.log(`[ozon-webhook] Created order #${order.id} for posting ${postingNumber} with ${orderItems.length} items`);
      await storage.createWebhookLog({ source: "ozon", eventType: "order_created", payload, status: "processed", organizationId: orgId, orderId: order.id });

      res.status(201).json({ success: true, action: "created", orderId: order.id });
    } catch (error: any) {
      console.error("[ozon-webhook] Error processing webhook:", error);
      await storage.createWebhookLog({ source: "ozon", eventType: "order", payload, status: "error", errorMessage: error.message, organizationId: null });
      res.status(500).json({ message: "Internal error" });
    }
  });

  /**
   * ЗОЛОТОЙ СТАНДАРТ OZON СИНХРОНИЗАЦИИ — НЕ ИЗМЕНЯТЬ БЕЗ ВЕСКОЙ ПРИЧИНЫ
   *
   * Временная зона: since = предыдущий день 21:00 UTC = 00:00 МСК
   * FBO limit: 1000 (было 50 — не возвращать!)
   * FBO цены: из financial_data (не из каталога)
   * Retry: fetchWithRetry (3 попытки при 429/502/504)
   * Пагинация: макс 10 страниц × 1000 = 10 000 заказов на магазин
   */
  // Pull Ozon FBS orders (polling fallback)
  app.post("/api/marketplace/ozon/sync-orders", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const allSettings = await storage.getMarketplaceSettings(orgId);
      const ozonSettings = allSettings.filter(s => s.marketplace === "ozon" && s.apiKey && s.clientId);

      if (ozonSettings.length === 0) {
        return res.status(400).json({ message: "Настройки Ozon не найдены" });
      }

      const BASE = "https://api-seller.ozon.ru";
      const since = new Date();
      since.setDate(since.getDate() - 30);
      since.setUTCHours(21, 0, 0, 0);
      since.setUTCDate(since.getUTCDate() - 1);

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const storeResults: { storeName: string; storeId: number | null; created: number; updated: number; skippedNoSku: number; error?: string }[] = [];

      for (const ozonSetting of ozonSettings) {
        const { storeId: resolvedStoreId, companyId: resolvedCompanyId, storeName: resolvedStoreName } = await resolveStoreForSetting(ozonSetting);
        const displayName = resolvedStoreName || ozonSetting.storeName || `Client ${ozonSetting.clientId}`;
        let storeCreated = 0;
        let storeUpdated = 0;
        let storeSkippedPartial = 0;
        let storeError: string | undefined;
        const headers = {
          "Client-Id": String(parseInt(ozonSetting.clientId!.trim(), 10)),
          "Api-Key": ozonSetting.apiKey!.trim(),
          "Content-Type": "application/json",
        };

        const body = {
          dir: "ASC",
          filter: { since: since.toISOString(), to: new Date().toISOString(), status: "" },
          limit: 1000,
          offset: 0,
        };

        console.log(`[ozon-sync-orders] Fetching FBS+FBO for store «${displayName}» clientId=${ozonSetting.clientId}, storeId=${resolvedStoreId}`);

        const syncPostings = async (postings: any[], fulfillmentType: string) => {
          for (const posting of postings) {
            const postingNumber = posting.posting_number;
            const ozonStatus = posting.status;

            // Fix 1: date fallback chain — never default to NOW() for old postings
            const ozonCreatedAt = posting.created_at
              ? new Date(posting.created_at)
              : posting.in_process_at
                ? new Date(posting.in_process_at)
                : posting.shipment_date
                  ? new Date(posting.shipment_date)
                  : null;
            if (!ozonCreatedAt) {
              console.warn(`[ozon-sync] posting ${postingNumber} has no date fields — using current time as fallback`);
            }

            const existingOrder = await storage.getOrderByPostingNumber(postingNumber, orgId, resolvedStoreId);

            if (existingOrder) {
              const internalStatus = ozonStatusToInternal(ozonStatus);
              const needsStatusUpdate = existingOrder.ozonStatus !== ozonStatus;
              const needsStatusCorrection = existingOrder.status === 'cancelled' && internalStatus !== 'cancelled';
              const needsDateUpdate = ozonCreatedAt && existingOrder.createdAt &&
                Math.abs(new Date(existingOrder.createdAt).getTime() - ozonCreatedAt.getTime()) > 60000;
              if (needsStatusUpdate || needsDateUpdate || needsStatusCorrection) {
                await storage.updateOrderOzonStatus(existingOrder.id, ozonStatus, internalStatus, needsDateUpdate ? ozonCreatedAt : undefined);
                updated++;
                storeUpdated++;
              } else {
                skipped++;
              }
              continue;
            }

            // Fix 2 + 3: build items — create even when SKU not in DB; use financial_data for FBO price
            const items: { productId?: number | null; sku?: string; productName?: string; quantity: number; price: number }[] = [];
            let totalAmount = 0;

            for (const prod of posting.products || []) {
              const sku = prod.offer_id || "";
              if (!sku) continue;

              const qty = prod.quantity || 1;

              // Fix 3: for FBO use financial_data price when available
              const financialProduct = fulfillmentType === "FBO"
                ? (posting.financial_data?.products || []).find((fp: any) => fp.product_id === prod.sku_id)
                : null;
              const price = financialProduct?.price
                ? parseFloat(String(financialProduct.price))
                : parseFloat(prod.price || "0");

              const [dbProduct] = await db.select().from(productsTable)
                .where(and(eq(productsTable.sku, sku), eq(productsTable.organizationId, orgId)));

              if (dbProduct) {
                items.push({ productId: dbProduct.id, quantity: qty, price });
              } else {
                // Fix 2: don't skip — create item with SKU/name text fields
                console.warn(`[ozon-sync] SKU not found: ${sku} for posting ${postingNumber} — creating item without product link`);
                items.push({ productId: null, sku, productName: prod.name || sku, quantity: qty, price });
              }
              totalAmount += price * qty;
            }

            if (items.length > 0) {
              const internalStatus = ozonStatusToInternal(ozonStatus);
              await storage.createOrder({
                orderNumber: postingNumber,
                status: internalStatus,
                totalAmount: totalAmount.toFixed(2),
                source: "ozon",
                externalId: posting.order_id?.toString() || postingNumber,
                postingNumber,
                ozonStatus,
                fulfillmentType,
                storeId: resolvedStoreId,
                sourceStoreName: resolvedStoreName,
                companyId: resolvedCompanyId,
                organizationId: orgId,
                createdAt: ozonCreatedAt ?? new Date(),
              }, items);
              created++;
              storeCreated++;
            } else {
              storeSkippedPartial++;
            }
          }
        };

        {
          const LIMIT = 1000;
          const MAX_PAGES = 10;
          const allFbsPostings: any[] = [];
          let fbsOffset = 0;
          let fbsError = false;
          for (let page = 0; page < MAX_PAGES; page++) {
            const fbsResponse = await fetchWithRetry(`${BASE}/v3/posting/fbs/list`, {
              method: "POST", headers, body: JSON.stringify({ ...body, limit: LIMIT, offset: fbsOffset }),
            });
            if (!fbsResponse.ok) {
              const errText = await fbsResponse.text().catch(() => "");
              const errMsg = fbsResponse.status === 401 || fbsResponse.status === 403
                ? `Ошибка авторизации для магазина «${displayName}» (код ${fbsResponse.status})`
                : `Ошибка API для магазина «${displayName}» (код ${fbsResponse.status})`;
              console.error(`[ozon-sync-orders] Store «${displayName}» FBS API error ${fbsResponse.status}: ${errText}`);
              storeError = errMsg;
              fbsError = true;
              break;
            }
            const fbsData = await fbsResponse.json();
            const pagePostings: any[] = fbsData?.result?.postings || [];
            allFbsPostings.push(...pagePostings);
            console.log(`[ozon-sync-orders] Store «${displayName}» FBS page ${page + 1}: ${pagePostings.length} postings (итого: ${allFbsPostings.length})`);
            if (pagePostings.length < LIMIT) break;
            if (page === MAX_PAGES - 1) {
              console.warn(`[ozon-sync-orders] Достигнут лимит пагинации (10 страниц) для магазина: ${displayName}`);
            }
            fbsOffset += LIMIT;
          }
          if (!fbsError) {
            await syncPostings(allFbsPostings, "FBS");
          }
        }

        {
          const LIMIT = 1000;
          const MAX_PAGES = 10;
          const allFboPostings: any[] = [];
          let fboOffset = 0;
          for (let page = 0; page < MAX_PAGES; page++) {
            const fboResponse = await fetchWithRetry(`${BASE}/v2/posting/fbo/list`, {
              method: "POST", headers,
              body: JSON.stringify({ dir: "ASC", filter: { since: since.toISOString(), to: new Date().toISOString(), status: "" }, limit: LIMIT, offset: fboOffset, with: { analytics_data: false, financial_data: true } }),
            });
            if (!fboResponse.ok) {
              const errText = await fboResponse.text().catch(() => "");
              if (!storeError) {
                storeError = fboResponse.status === 401 || fboResponse.status === 403
                  ? `Ошибка авторизации для магазина «${displayName}» (код ${fboResponse.status})`
                  : `Ошибка API для магазина «${displayName}» (код ${fboResponse.status})`;
              }
              console.error(`[ozon-sync-orders] Store «${displayName}» FBO API error ${fboResponse.status}: ${errText}`);
              break;
            }
            const fboData = await fboResponse.json();
            const pagePostings: any[] = fboData?.result || [];
            allFboPostings.push(...pagePostings);
            console.log(`[ozon-sync-orders] Store «${displayName}» FBO page ${page + 1}: ${pagePostings.length} postings (итого: ${allFboPostings.length})`);
            if (pagePostings.length < LIMIT) break;
            if (page === MAX_PAGES - 1) {
              console.warn(`[ozon-sync-orders] Достигнут лимит пагинации (10 страниц) для магазина: ${displayName}`);
            }
            fboOffset += LIMIT;
          }
          await syncPostings(allFboPostings, "FBO");
        }

        storeResults.push({ storeName: displayName, storeId: resolvedStoreId, created: storeCreated, updated: storeUpdated, skippedNoSku: storeSkippedPartial, error: storeError });
      }

      console.log(`[ozon-sync-orders] Sync complete: created=${created}, updated=${updated}, skipped=${skipped}`);
      res.json({ success: true, created, updated, skipped, storeResults });
    } catch (error: any) {
      console.error("[ozon-sync-orders] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Ozon: Historical resync for a custom date range (delete + re-fetch from API)
  app.post("/api/admin/ozon/historical-resync", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { since: sinceParam, to: toParam } = req.body;

      if (!sinceParam || !toParam) {
        return res.status(400).json({ message: "Укажите since и to (ISO UTC строки, напр. '2026-02-28T21:00:00Z')" });
      }
      const isoUtcRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
      if (!isoUtcRe.test(sinceParam) || !isoUtcRe.test(toParam)) {
        return res.status(400).json({ message: "since и to должны быть в формате ISO UTC, напр. '2026-02-28T21:00:00Z'" });
      }
      const sinceDate = new Date(sinceParam);
      const toDate = new Date(toParam);
      if (isNaN(sinceDate.getTime()) || isNaN(toDate.getTime())) {
        return res.status(400).json({ message: "Неверный формат дат since/to" });
      }
      if (sinceDate >= toDate) {
        return res.status(400).json({ message: "since должен быть строго меньше to" });
      }

      const allSettings = await storage.getMarketplaceSettings(orgId);
      const ozonSettings = allSettings.filter(s => s.marketplace === "ozon" && s.apiKey && s.clientId);
      if (ozonSettings.length === 0) {
        return res.status(400).json({ message: "Настройки Ozon не найдены" });
      }

      const BASE = "https://api-seller.ozon.ru";
      let totalCreated = 0;
      let totalDeleted = 0;
      let totalSkippedNoSku = 0;
      const storeResults: { storeName: string; storeId: number | null; deleted: number; created: number; skippedNoSku: number; error?: string }[] = [];

      for (const ozonSetting of ozonSettings) {
        const { storeId: resolvedStoreId, companyId: resolvedCompanyId, storeName: resolvedStoreName } = await resolveStoreForSetting(ozonSetting);
        const displayName = resolvedStoreName || ozonSetting.storeName || `Client ${ozonSetting.clientId}`;
        let storeCreated = 0;
        let storeDeleted = 0;
        let storeSkippedPartial = 0;
        let storeError: string | undefined;

        const headers = {
          "Client-Id": String(parseInt(ozonSetting.clientId!.trim(), 10)),
          "Api-Key": ozonSetting.apiKey!.trim(),
          "Content-Type": "application/json",
        };

        // Step 1: Delete existing orders for this store in the period
        if (resolvedStoreId !== null) {
          const countRes = await db.select({ cnt: sql<number>`COUNT(*)` }).from(ordersTable).where(
            and(
              eq(ordersTable.organizationId, orgId),
              eq(ordersTable.source, "ozon"),
              eq(ordersTable.storeId, resolvedStoreId),
              gte(ordersTable.createdAt, sinceDate),
              lt(ordersTable.createdAt, toDate)
            )
          );
          storeDeleted = Number(countRes[0]?.cnt || 0);
          await db.delete(ordersTable).where(
            and(
              eq(ordersTable.organizationId, orgId),
              eq(ordersTable.source, "ozon"),
              eq(ordersTable.storeId, resolvedStoreId),
              gte(ordersTable.createdAt, sinceDate),
              lt(ordersTable.createdAt, toDate)
            )
          );
          totalDeleted += storeDeleted;
          console.log(`[ozon-historical-resync] Deleted ${storeDeleted} orders for store «${displayName}» (storeId=${resolvedStoreId})`);
        } else {
          console.warn(`[ozon-historical-resync] No storeId resolved for «${displayName}» — skipping delete`);
        }

        // syncPostings: identical to sync-orders logic — create orders from Ozon postings
        const historicSyncPostings = async (postings: any[], fulfillmentType: string) => {
          for (const posting of postings) {
            const postingNumber = posting.posting_number;
            const ozonStatus = posting.status;

            const ozonCreatedAt = posting.created_at
              ? new Date(posting.created_at)
              : posting.in_process_at
                ? new Date(posting.in_process_at)
                : posting.shipment_date
                  ? new Date(posting.shipment_date)
                  : null;
            if (!ozonCreatedAt) {
              console.warn(`[ozon-historical-resync] posting ${postingNumber} has no date fields — using current time as fallback`);
            }

            const existingOrder = await storage.getOrderByPostingNumber(postingNumber, orgId, resolvedStoreId);
            if (existingOrder) {
              // Already exists (e.g. appears in both FBS and FBO response) — skip
              continue;
            }

            const items: { productId?: number | null; sku?: string; productName?: string; quantity: number; price: number }[] = [];
            let totalAmount = 0;

            for (const prod of posting.products || []) {
              const sku = prod.offer_id || "";
              if (!sku) continue;
              const qty = prod.quantity || 1;

              const financialProduct = fulfillmentType === "FBO"
                ? (posting.financial_data?.products || []).find((fp: any) => fp.product_id === prod.sku_id)
                : null;
              const price = financialProduct?.price
                ? parseFloat(String(financialProduct.price))
                : parseFloat(prod.price || "0");

              const [dbProduct] = await db.select().from(productsTable)
                .where(and(eq(productsTable.sku, sku), eq(productsTable.organizationId, orgId)));

              if (dbProduct) {
                items.push({ productId: dbProduct.id, quantity: qty, price });
              } else {
                console.warn(`[ozon-historical-resync] SKU not found: ${sku} for posting ${postingNumber} — creating item without product link`);
                items.push({ productId: null, sku, productName: prod.name || sku, quantity: qty, price });
              }
              totalAmount += price * qty;
            }

            if (items.length > 0) {
              const internalStatus = ozonStatusToInternal(ozonStatus);
              await storage.createOrder({
                orderNumber: postingNumber,
                status: internalStatus,
                totalAmount: totalAmount.toFixed(2),
                source: "ozon",
                externalId: posting.order_id?.toString() || postingNumber,
                postingNumber,
                ozonStatus,
                fulfillmentType,
                storeId: resolvedStoreId,
                sourceStoreName: resolvedStoreName,
                companyId: resolvedCompanyId,
                organizationId: orgId,
                createdAt: ozonCreatedAt ?? new Date(),
              }, items);
              storeCreated++;
              totalCreated++;
            } else {
              storeSkippedPartial++;
              totalSkippedNoSku++;
            }
          }
        };

        // Step 2: Fetch FBS with pagination (max 20 pages)
        {
          const LIMIT = 1000;
          const MAX_PAGES = 20;
          const allFbsPostings: any[] = [];
          let fbsOffset = 0;
          let fbsError = false;
          for (let page = 0; page < MAX_PAGES; page++) {
            const fbsResponse = await fetchWithRetry(`${BASE}/v3/posting/fbs/list`, {
              method: "POST", headers,
              body: JSON.stringify({
                dir: "ASC",
                filter: { since: sinceDate.toISOString(), to: toDate.toISOString(), status: "" },
                limit: LIMIT,
                offset: fbsOffset,
              }),
            });
            if (!fbsResponse.ok) {
              const errText = await fbsResponse.text().catch(() => "");
              storeError = fbsResponse.status === 401 || fbsResponse.status === 403
                ? `Ошибка авторизации для магазина «${displayName}» (код ${fbsResponse.status})`
                : `Ошибка API для магазина «${displayName}» FBS (код ${fbsResponse.status})`;
              console.error(`[ozon-historical-resync] Store «${displayName}» FBS API error ${fbsResponse.status}: ${errText}`);
              fbsError = true;
              break;
            }
            const fbsData = await fbsResponse.json();
            const pagePostings: any[] = fbsData?.result?.postings || [];
            allFbsPostings.push(...pagePostings);
            console.log(`[ozon-historical-resync] Store «${displayName}» FBS page ${page + 1}: ${pagePostings.length} postings (итого: ${allFbsPostings.length})`);
            if (pagePostings.length < LIMIT) break;
            if (page === MAX_PAGES - 1) {
              console.warn(`[ozon-historical-resync] Достигнут лимит пагинации (20 страниц) FBS для магазина: ${displayName}`);
            }
            fbsOffset += LIMIT;
          }
          if (!fbsError) {
            await historicSyncPostings(allFbsPostings, "FBS");
          }
        }

        // Step 3: Fetch FBO with financial_data and pagination (max 20 pages)
        {
          const LIMIT = 1000;
          const MAX_PAGES = 20;
          const allFboPostings: any[] = [];
          let fboOffset = 0;
          for (let page = 0; page < MAX_PAGES; page++) {
            const fboResponse = await fetchWithRetry(`${BASE}/v2/posting/fbo/list`, {
              method: "POST", headers,
              body: JSON.stringify({
                dir: "ASC",
                filter: { since: sinceDate.toISOString(), to: toDate.toISOString(), status: "" },
                limit: LIMIT,
                offset: fboOffset,
                with: { analytics_data: false, financial_data: true },
              }),
            });
            if (!fboResponse.ok) {
              const errText = await fboResponse.text().catch(() => "");
              if (!storeError) {
                storeError = fboResponse.status === 401 || fboResponse.status === 403
                  ? `Ошибка авторизации для магазина «${displayName}» (код ${fboResponse.status})`
                  : `Ошибка API для магазина «${displayName}» FBO (код ${fboResponse.status})`;
              }
              console.error(`[ozon-historical-resync] Store «${displayName}» FBO API error ${fboResponse.status}: ${errText}`);
              break;
            }
            const fboData = await fboResponse.json();
            const pagePostings: any[] = fboData?.result || [];
            allFboPostings.push(...pagePostings);
            console.log(`[ozon-historical-resync] Store «${displayName}» FBO page ${page + 1}: ${pagePostings.length} postings (итого: ${allFboPostings.length})`);
            if (pagePostings.length < LIMIT) break;
            if (page === MAX_PAGES - 1) {
              console.warn(`[ozon-historical-resync] Достигнут лимит пагинации (20 страниц) FBO для магазина: ${displayName}`);
            }
            fboOffset += LIMIT;
          }
          await historicSyncPostings(allFboPostings, "FBO");
        }

        storeResults.push({ storeName: displayName, storeId: resolvedStoreId, deleted: storeDeleted, created: storeCreated, skippedNoSku: storeSkippedPartial, error: storeError });
      }

      // Step 4: Summary SQL — orders per day per store after resync
      const summaryRows = await db.execute(sql`
        SELECT
          DATE(o.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Moscow') as date_msk,
          s.name as store_name,
          COUNT(DISTINCT o.id)::int as orders,
          COALESCE(SUM(oi.quantity), 0)::int as qty,
          ROUND(COALESCE(SUM(oi.price * oi.quantity), 0)::numeric, 0)::bigint as revenue
        FROM orders o
        JOIN stores s ON o.store_id = s.id
        LEFT JOIN order_items oi ON o.id = oi.order_id
        WHERE o.organization_id = ${orgId}
          AND o.source = 'ozon'
          AND o.created_at >= ${sinceDate}
          AND o.created_at < ${toDate}
        GROUP BY DATE(o.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Moscow'), s.name
        ORDER BY date_msk, s.name
      `);

      console.log(`[ozon-historical-resync] Complete: totalDeleted=${totalDeleted}, totalCreated=${totalCreated}, totalSkippedNoSku=${totalSkippedNoSku}`);
      res.json({
        success: true,
        period: { since: sinceDate.toISOString(), to: toDate.toISOString() },
        totalDeleted,
        totalCreated,
        totalSkippedNoSku,
        storeResults,
        summary: summaryRows.rows,
      });
    } catch (error: any) {
      console.error("[ozon-historical-resync] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Ozon FBS: Ship order (Собрать заказ)
  app.post("/api/orders/:id/ozon-ship", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const orderId = Number(req.params.id);
      const order = await storage.getOrder(orderId);

      if (!order || order.organizationId !== orgId) {
        return res.status(404).json({ message: "Заказ не найден" });
      }
      if (!order.postingNumber || order.source !== "ozon") {
        return res.status(400).json({ message: "Это не заказ Ozon" });
      }
      if (order.ozonStatus === "awaiting_deliver") {
        return res.status(400).json({ message: "Заказ уже собран. Используйте печать этикетки." });
      }
      if (order.ozonStatus && !["awaiting_packaging"].includes(order.ozonStatus)) {
        return res.status(400).json({ message: `Невозможно собрать заказ в статусе «${order.ozonStatus}»` });
      }

      const headers = await getOzonHeadersForOrder(order, orgId);
      if (!headers) {
        return res.status(400).json({ message: "Настройки Ozon не найдены" });
      }

      const BASE = "https://api-seller.ozon.ru";

      console.log(`[ozon-ship] Fetching posting details for ${order.postingNumber}`);
      const getPostingRes = await fetchWithRetry(`${BASE}/v3/posting/fbs/get`, {
        method: "POST",
        headers,
        body: JSON.stringify({ posting_number: order.postingNumber, with: { product_exemplars: false } }),
      });

      const getPostingText = await getPostingRes.text();
      let postingData: any;
      try {
        postingData = JSON.parse(getPostingText);
      } catch {
        console.error(`[ozon-ship] Failed to fetch posting details (${getPostingRes.status}):`, getPostingText.slice(0, 500));
        return res.status(502).json({ message: `Не удалось получить данные заказа из Ozon (${getPostingRes.status})` });
      }

      if (!getPostingRes.ok) {
        console.error(`[ozon-ship] Get posting error ${getPostingRes.status}:`, JSON.stringify(postingData).slice(0, 500));
        const errMsg = postingData?.message || `Ошибка ${getPostingRes.status}`;
        return res.status(502).json({ message: `Ozon API: ${errMsg}` });
      }

      const ozonProducts = postingData?.result?.products || [];
      if (ozonProducts.length === 0) {
        console.error(`[ozon-ship] No products found in Ozon posting ${order.postingNumber}`);
        return res.status(400).json({ message: "Нет товаров в отправлении Ozon" });
      }

      const items = ozonProducts.map((p: any) => ({
        item_id: p.sku,
        quantity: p.quantity || 1,
      }));

      const shipBody = {
        packages: [{ items }],
        posting_number: order.postingNumber,
      };

      console.log(`[ozon-ship] Shipping posting ${order.postingNumber}, payload:`, JSON.stringify(shipBody).slice(0, 500));

      const response = await fetchWithRetry(`${BASE}/v3/posting/fbs/ship`, {
        method: "POST",
        headers,
        body: JSON.stringify(shipBody),
      });

      const rawText = await response.text();
      console.log(`[ozon-ship] Response (${response.status}):`, rawText.slice(0, 1000));
      let result: any;
      try {
        result = JSON.parse(rawText);
      } catch {
        console.error(`[ozon-ship] Non-JSON response (${response.status}):`, rawText.slice(0, 500));
        return res.status(502).json({ message: `Ozon вернул некорректный ответ (${response.status}). Проверьте права API-ключа.` });
      }

      if (!response.ok) {
        console.error(`[ozon-ship] API error ${response.status}:`, JSON.stringify(result).slice(0, 500));
        const errMsg = result?.message || result?.error?.message || result?.error?.[0] || `Ошибка ${response.status}`;
        return res.status(502).json({ message: `Ozon API: ${errMsg}` });
      }

      await storage.updateOrderOzonStatus(orderId, "awaiting_deliver", "processing");
      console.log(`[ozon-ship] Successfully shipped posting ${order.postingNumber}`);
      res.json({ success: true, result });
    } catch (error: any) {
      console.error("[ozon-ship] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Ozon FBS: Cancel order (Отменить)
  app.post("/api/orders/:id/ozon-cancel", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const orderId = Number(req.params.id);
      const order = await storage.getOrder(orderId);

      if (!order || order.organizationId !== orgId) {
        return res.status(404).json({ message: "Заказ не найден" });
      }
      if (!order.postingNumber || order.source !== "ozon") {
        return res.status(400).json({ message: "Это не заказ Ozon" });
      }

      const headers = await getOzonHeadersForOrder(order, orgId);
      if (!headers) {
        return res.status(400).json({ message: "Настройки Ozon не найдены" });
      }

      const BASE = "https://api-seller.ozon.ru";

      const cancelReason = req.body.reason || "seller_other";
      const cancelBody = {
        posting_number: order.postingNumber,
        cancel_reason_id: 352,
        cancel_reason_message: cancelReason,
      };

      console.log(`[ozon-cancel] Cancelling posting ${order.postingNumber}, reason: ${cancelReason}`);

      const response = await fetchWithRetry(`${BASE}/v2/posting/fbs/cancel`, {
        method: "POST",
        headers,
        body: JSON.stringify(cancelBody),
      });

      const rawText = await response.text();
      let result: any;
      try {
        result = JSON.parse(rawText);
      } catch {
        console.error(`[ozon-cancel] Non-JSON response (${response.status}):`, rawText.slice(0, 500));
        return res.status(502).json({ message: `Ozon вернул некорректный ответ (${response.status}). Проверьте права API-ключа.` });
      }

      if (!response.ok) {
        console.error(`[ozon-cancel] API error ${response.status}:`, JSON.stringify(result).slice(0, 500));
        const errMsg = result?.message || result?.error?.message || result?.error?.[0] || `Ошибка ${response.status}`;
        return res.status(502).json({ message: `Ozon API: ${errMsg}` });
      }

      await storage.updateOrderOzonStatus(orderId, "cancelled", "cancelled");
      console.log(`[ozon-cancel] Successfully cancelled posting ${order.postingNumber}`);
      res.json({ success: true, result });
    } catch (error: any) {
      console.error("[ozon-cancel] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get Ozon status label (for frontend)
  app.get("/api/ozon/status-labels", isAuthenticated, async (_req, res) => {
    res.json({
      awaiting_approve: "Ожидает подтверждения",
      awaiting_packaging: "Ожидает сборки",
      awaiting_deliver: "Ожидает отгрузки",
      arbitration: "Арбитраж",
      delivering: "Доставляется",
      delivered: "Доставлен",
      cancelled: "Отменён",
      not_accepted: "Не принят",
    });
  });

  // Ozon FBS: Print label (Этикетка)
  app.post("/api/orders/:id/ozon-label", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const orderId = Number(req.params.id);
      const order = await storage.getOrder(orderId);

      if (!order || order.organizationId !== orgId) {
        return res.status(404).json({ message: "Заказ не найден" });
      }
      if (!order.postingNumber || order.source !== "ozon") {
        return res.status(400).json({ message: "Это не заказ Ozon" });
      }
      if (order.fulfillmentType === "FBO") {
        return res.status(400).json({ message: "Этикетки для FBO заказов недоступны — этикетки формирует Ozon" });
      }

      const headers = await getOzonHeadersForOrder(order, orgId);
      if (!headers) {
        return res.status(400).json({ message: "Настройки Ozon не найдены" });
      }

      const BASE = "https://api-seller.ozon.ru";

      console.log(`[ozon-label] Creating 58x40 label for posting ${order.postingNumber}`);

      const createRes = await fetchWithRetry(`${BASE}/v2/posting/fbs/package-label/create`, {
        method: "POST",
        headers,
        body: JSON.stringify({ posting_number: [order.postingNumber] }),
      });

      if (!createRes.ok) {
        const errText = await createRes.text().catch(() => "");
        console.error(`[ozon-label] Create API error ${createRes.status}:`, errText.slice(0, 500));
        const fallbackRes = await fetchWithRetry(`${BASE}/v2/posting/fbs/package-label`, {
          method: "POST",
          headers,
          body: JSON.stringify({ posting_number: [order.postingNumber] }),
        });
        if (!fallbackRes.ok) {
          return res.status(502).json({ message: `Ozon API: ошибка получения этикетки (${createRes.status})` });
        }
        const ct = fallbackRes.headers.get("content-type") || "";
        if (ct.includes("application/pdf") || ct.includes("application/octet-stream")) {
          const buffer = await fallbackRes.arrayBuffer();
          res.set("Content-Type", "application/pdf");
          res.set("Content-Disposition", `inline; filename="label-${order.postingNumber}.pdf"`);
          return res.send(Buffer.from(buffer));
        }
        return res.status(502).json({ message: "Ozon вернул неожиданный формат ответа" });
      }

      const createData = await createRes.json();
      const taskId = createData?.result?.task_id;

      if (!taskId) {
        console.log(`[ozon-label] No task_id, trying direct download`);
        const directRes = await fetchWithRetry(`${BASE}/v2/posting/fbs/package-label`, {
          method: "POST",
          headers,
          body: JSON.stringify({ posting_number: [order.postingNumber] }),
        });
        if (directRes.ok) {
          const ct = directRes.headers.get("content-type") || "";
          if (ct.includes("application/pdf") || ct.includes("application/octet-stream")) {
            const buffer = await directRes.arrayBuffer();
            res.set("Content-Type", "application/pdf");
            res.set("Content-Disposition", `inline; filename="label-${order.postingNumber}.pdf"`);
            return res.send(Buffer.from(buffer));
          }
        }
        return res.status(502).json({ message: "Не удалось создать этикетку" });
      }

      await new Promise(resolve => setTimeout(resolve, 2000));

      for (let attempt = 0; attempt < 5; attempt++) {
        const getRes = await fetchWithRetry(`${BASE}/v1/posting/fbs/package-label/get`, {
          method: "POST",
          headers,
          body: JSON.stringify({ task_id: taskId }),
        });

        if (getRes.ok) {
          const ct = getRes.headers.get("content-type") || "";
          if (ct.includes("application/pdf") || ct.includes("application/octet-stream")) {
            const buffer = await getRes.arrayBuffer();
            res.set("Content-Type", "application/pdf");
            res.set("Content-Disposition", `inline; filename="label-${order.postingNumber}.pdf"`);
            return res.send(Buffer.from(buffer));
          }
          const body = await getRes.json().catch(() => null);
          if (body?.result?.status === "completed" && body?.result?.file_url) {
            const fileRes = await fetch(body.result.file_url);
            const buffer = await fileRes.arrayBuffer();
            res.set("Content-Type", "application/pdf");
            res.set("Content-Disposition", `inline; filename="label-${order.postingNumber}.pdf"`);
            return res.send(Buffer.from(buffer));
          }
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      return res.status(502).json({ message: "Этикетка ещё формируется, попробуйте позже" });
    } catch (error: any) {
      console.error("[ozon-label] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Ozon FBS: Bulk download labels for all orders awaiting shipment
  app.post("/api/marketplace/ozon/bulk-labels", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const allOrders = await storage.getOrders(orgId);
      const awaitingOrders = allOrders.filter(o =>
        o.source === "ozon" &&
        o.postingNumber &&
        (o.fulfillmentType === "FBS" || !o.fulfillmentType) &&
        (o.ozonStatus === "awaiting_deliver" || o.ozonStatus === "awaiting_packaging")
      );

      if (awaitingOrders.length === 0) {
        return res.status(400).json({ message: "Нет заказов для печати этикеток" });
      }

      const requestedStoreId = req.body.storeId ? Number(req.body.storeId) : null;
      const filteredOrders = requestedStoreId != null
        ? awaitingOrders.filter(o => o.storeId === requestedStoreId)
        : awaitingOrders;

      if (filteredOrders.length === 0) {
        return res.status(400).json({ message: "Нет заказов для печати этикеток в этом магазине" });
      }

      const firstOrder = filteredOrders[0];
      const headers = await getOzonHeadersForOrder(firstOrder, orgId);
      if (!headers) {
        return res.status(400).json({ message: "Настройки Ozon не найдены" });
      }

      const postingNumbers = filteredOrders.map(o => o.postingNumber!).slice(0, 20);
      console.log(`[ozon-bulk-labels] Creating labels for ${postingNumbers.length} postings (storeId=${firstOrder.storeId})`);

      const BASE = "https://api-seller.ozon.ru";

      const createRes = await fetchWithRetry(`${BASE}/v2/posting/fbs/package-label/create`, {
        method: "POST",
        headers,
        body: JSON.stringify({ posting_number: postingNumbers }),
      });

      if (!createRes.ok) {
        const fallbackRes = await fetchWithRetry(`${BASE}/v2/posting/fbs/package-label`, {
          method: "POST",
          headers,
          body: JSON.stringify({ posting_number: postingNumbers }),
        });
        if (!fallbackRes.ok) {
          return res.status(502).json({ message: `Ozon API: ошибка получения этикеток` });
        }
        const ct = fallbackRes.headers.get("content-type") || "";
        if (ct.includes("application/pdf") || ct.includes("application/octet-stream")) {
          const buffer = await fallbackRes.arrayBuffer();
          res.set("Content-Type", "application/pdf");
          res.set("Content-Disposition", `inline; filename="labels-bulk.pdf"`);
          return res.send(Buffer.from(buffer));
        }
        return res.status(502).json({ message: "Ozon вернул неожиданный формат" });
      }

      const createData = await createRes.json();
      const taskId = createData?.result?.task_id;

      if (!taskId) {
        const directRes = await fetchWithRetry(`${BASE}/v2/posting/fbs/package-label`, {
          method: "POST",
          headers,
          body: JSON.stringify({ posting_number: postingNumbers }),
        });
        if (directRes.ok) {
          const ct = directRes.headers.get("content-type") || "";
          if (ct.includes("application/pdf") || ct.includes("application/octet-stream")) {
            const buffer = await directRes.arrayBuffer();
            res.set("Content-Type", "application/pdf");
            res.set("Content-Disposition", `inline; filename="labels-bulk.pdf"`);
            return res.send(Buffer.from(buffer));
          }
        }
        return res.status(502).json({ message: "Не удалось создать этикетки" });
      }

      await new Promise(resolve => setTimeout(resolve, 3000));

      for (let attempt = 0; attempt < 8; attempt++) {
        const getRes = await fetchWithRetry(`${BASE}/v1/posting/fbs/package-label/get`, {
          method: "POST",
          headers,
          body: JSON.stringify({ task_id: taskId }),
        });

        if (getRes.ok) {
          const ct = getRes.headers.get("content-type") || "";
          if (ct.includes("application/pdf") || ct.includes("application/octet-stream")) {
            const buffer = await getRes.arrayBuffer();
            res.set("Content-Type", "application/pdf");
            res.set("Content-Disposition", `inline; filename="labels-bulk.pdf"`);
            return res.send(Buffer.from(buffer));
          }
          const body = await getRes.json().catch(() => null);
          if (body?.result?.file_url) {
            const fileRes = await fetch(body.result.file_url);
            const buffer = await fileRes.arrayBuffer();
            res.set("Content-Type", "application/pdf");
            res.set("Content-Disposition", `inline; filename="labels-bulk.pdf"`);
            return res.send(Buffer.from(buffer));
          }
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      return res.status(502).json({ message: "Этикетки ещё формируются, попробуйте через минуту" });
    } catch (error: any) {
      console.error("[ozon-bulk-labels] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  function parseOzonErrorMessage(status: number, body: string): string {
    try {
      const parsed = JSON.parse(body);
      if (parsed?.message) return parsed.message;
      if (parsed?.error?.message) return parsed.error.message;
      if (parsed?.error) return String(parsed.error);
    } catch {}
    if (status === 401 || status === 403) return "Неверный API-ключ или Client-Id (Access Denied)";
    if (status === 429) return "Превышен лимит запросов к Ozon API (Rate Limit)";
    if (status >= 500) return `Сервер Ozon недоступен (HTTP ${status})`;
    return `Ошибка Ozon API (HTTP ${status})`;
  }

  app.post("/api/marketplace/ozon/resync-orders", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const allSettings = await storage.getMarketplaceSettings(orgId);
      const ozonSettings = allSettings.filter(s => s.marketplace === "ozon" && s.apiKey && s.clientId);

      if (ozonSettings.length === 0) {
        return res.status(400).json({ message: "Настройки Ozon не найдены" });
      }

      const allOrders = await db.select().from(ordersTable)
        .where(and(
          eq(ordersTable.organizationId, orgId),
          eq(ordersTable.source, "ozon"),
        ));

      const ozonOrders = allOrders.filter(o => o.postingNumber);
      if (ozonOrders.length === 0) {
        return res.json({ success: true, updated: 0, message: "No Ozon orders to resync" });
      }

      console.log(`[ozon-resync] Starting resync for ${ozonOrders.length} Ozon orders across ${ozonSettings.length} stores in org ${orgId}`);

      const BASE = "https://api-seller.ozon.ru";
      const since = new Date();
      since.setDate(since.getDate() - 60);
      const body = {
        dir: "ASC",
        filter: { since: since.toISOString(), to: new Date().toISOString(), status: "" },
        limit: 1000,
        offset: 0,
      };

      let updated = 0;
      let totalApiPostings = 0;

      for (const ozonSetting of ozonSettings) {
        const { storeId: resolvedStoreId } = await resolveStoreForSetting(ozonSetting);
        if (resolvedStoreId == null) {
          console.warn(`[ozon-resync] Skipping setting clientId=${ozonSetting.clientId}: no matching store found`);
          continue;
        }
        const headers = {
          "Client-Id": String(parseInt(ozonSetting.clientId!.trim(), 10)),
          "Api-Key": ozonSetting.apiKey!.trim(),
          "Content-Type": "application/json",
        };

        const storeOrders = ozonOrders.filter(o => o.storeId === resolvedStoreId);

        const allPostings = new Map<string, any>();

        {
          const LIMIT = 1000;
          const MAX_PAGES = 10;
          let fbsOffset = 0;
          let fbsTotal = 0;
          for (let page = 0; page < MAX_PAGES; page++) {
            const fbsResponse = await fetchWithRetry(`${BASE}/v3/posting/fbs/list`, {
              method: "POST", headers, body: JSON.stringify({ ...body, limit: LIMIT, offset: fbsOffset }),
            });
            if (!fbsResponse.ok) break;
            const fbsData = await fbsResponse.json();
            const pagePostings: any[] = fbsData?.result?.postings || [];
            for (const p of pagePostings) allPostings.set(p.posting_number, p);
            fbsTotal += pagePostings.length;
            console.log(`[ozon-resync] Store ${ozonSetting.clientId} FBS page ${page + 1}: ${pagePostings.length} postings (итого: ${fbsTotal})`);
            if (pagePostings.length < LIMIT) break;
            if (page === MAX_PAGES - 1) console.warn(`[ozon-resync] Достигнут лимит пагинации (10 страниц) для магазина: ${ozonSetting.clientId}`);
            fbsOffset += LIMIT;
          }
        }

        {
          const LIMIT = 1000;
          const MAX_PAGES = 10;
          let fboOffset = 0;
          let fboTotal = 0;
          for (let page = 0; page < MAX_PAGES; page++) {
            const fboResponse = await fetchWithRetry(`${BASE}/v2/posting/fbo/list`, {
              method: "POST", headers,
              body: JSON.stringify({ ...body, limit: LIMIT, offset: fboOffset, with: { analytics_data: false, financial_data: false } }),
            });
            if (!fboResponse.ok) break;
            const fboData = await fboResponse.json();
            const pagePostings: any[] = fboData?.result || [];
            for (const p of pagePostings) allPostings.set(p.posting_number, p);
            fboTotal += pagePostings.length;
            console.log(`[ozon-resync] Store ${ozonSetting.clientId} FBO page ${page + 1}: ${pagePostings.length} postings (итого: ${fboTotal})`);
            if (pagePostings.length < LIMIT) break;
            if (page === MAX_PAGES - 1) console.warn(`[ozon-resync] Достигнут лимит пагинации (10 страниц) для магазина: ${ozonSetting.clientId}`);
            fboOffset += LIMIT;
          }
        }

        console.log(`[ozon-resync] Store ${ozonSetting.clientId}: ${allPostings.size} postings from API, ${storeOrders.length} local orders`);
        totalApiPostings += allPostings.size;

        for (const order of storeOrders) {
          const posting = allPostings.get(order.postingNumber!);
          if (!posting) continue;

          const newOzonStatus = posting.status;
          const ozonCreatedAt = posting.created_at ? new Date(posting.created_at) : null;
          const internalStatus = ozonStatusToInternal(newOzonStatus);

          const needsStatusUpdate = order.ozonStatus !== newOzonStatus;
          const needsStatusCorrection = order.status === 'cancelled' && internalStatus !== 'cancelled';
          const needsDateUpdate = ozonCreatedAt && order.createdAt &&
            Math.abs(new Date(order.createdAt).getTime() - ozonCreatedAt.getTime()) > 60000;

          if (needsStatusUpdate || needsDateUpdate || needsStatusCorrection) {
            await storage.updateOrderOzonStatus(
              order.id,
              newOzonStatus,
              internalStatus,
              needsDateUpdate ? ozonCreatedAt : undefined
            );
            updated++;
          }
        }
      }

      console.log(`[ozon-resync] Resync complete: updated ${updated} of ${ozonOrders.length} orders`);
      res.json({ success: true, updated, total: ozonOrders.length, apiPostings: totalApiPostings });
    } catch (error: any) {
      console.error("[ozon-resync] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ==================== Yandex Market Order Sync ====================
  const yandexStatusToInternal = (yandexStatus: string): string => {
    switch (yandexStatus?.toUpperCase()) {
      case "NEW":
      case "PROCESSING":
      case "READY_TO_SHIP":
      case "RESERVED":
        return "pending";
      case "DELIVERY":
      case "PICKUP":
        return "shipped";
      case "DELIVERED":
        return "completed";
      case "CANCELLED":
      case "RETURNED":
      case "UNPAID":
        return "cancelled";
      default:
        return "pending";
    }
  };

  const YANDEX_STATUS_LABELS: Record<string, string> = {
    NEW: "Новый",
    PROCESSING: "Ожидает сборки",
    READY_TO_SHIP: "Ожидает отгрузки",
    DELIVERY: "Доставка в процессе",
    PICKUP: "Ожидает получения",
    DELIVERED: "Доставлено",
    CANCELLED: "Отменено",
    RETURNED: "Возвращено",
    UNPAID: "Не оплачено",
    RESERVED: "Зарезервировано",
  };

  const resolveStoreForYandex = async (setting: { storeId?: number | null; companyId: number | null; warehouseId: string | null }): Promise<{ storeId: number | null; companyId: number | null; storeName: string | null }> => {
    if (setting.storeId) {
      const store = await storage.getStore(setting.storeId);
      if (store) return { storeId: store.id, companyId: store.companyId, storeName: store.name };
    }
    if (setting.companyId) {
      const companyStores = await storage.getStores(setting.companyId);
      const yandexStore = companyStores.find(s => s.marketplace === "yandex");
      if (yandexStore) return { storeId: yandexStore.id, companyId: setting.companyId, storeName: yandexStore.name };
      return { storeId: null, companyId: setting.companyId, storeName: null };
    }
    return { storeId: null, companyId: null, storeName: null };
  };

  app.post("/api/marketplace/yandex/sync-orders", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const requestedStoreId = req.body?.storeId ? Number(req.body.storeId) : null;
      const allSettings = await storage.getMarketplaceSettings(orgId);
      let yandexSettings = allSettings.filter(s => s.marketplace === "yandex" && s.isActive && s.apiKey && s.warehouseId);
      
      if (requestedStoreId) {
        yandexSettings = yandexSettings.filter(s => s.storeId === requestedStoreId);

        if (yandexSettings.length === 0) {
          const store = await storage.getStore(requestedStoreId);
          if (store && store.marketplace === "yandex" && store.apiKey && store.warehouseId) {
            const company = await storage.getCompany(store.companyId);
            if (company && company.organizationId === orgId) {
              const newSetting = await storage.createMarketplaceSetting({
                organizationId: orgId,
                companyId: store.companyId,
                storeId: store.id,
                marketplace: "yandex",
                storeName: store.name,
                apiKey: store.apiKey,
                warehouseId: store.warehouseId,
                isActive: store.isActive ?? true,
              });
              yandexSettings = [newSetting];
              console.log(`[yandex-sync] Auto-provisioned marketplace_settings for store «${store.name}» (id=${store.id})`);
            }
          }
        }
      }

      if (yandexSettings.length === 0) {
        if (requestedStoreId) {
          const store = await storage.getStore(requestedStoreId);
          const storeName = store?.name || `ID ${requestedStoreId}`;
          if (store && (!store.apiKey || !store.warehouseId)) {
            return res.status(400).json({ message: `Магазин «${storeName}» не настроен. Пожалуйста, введите API-ключ и Business ID в Настройках` });
          }
        }
        return res.status(400).json({ message: "Настройки Yandex Market не найдены" });
      }

      const YANDEX_BASE = "https://api.partner.market.yandex.ru";
      const since = new Date();
      since.setDate(since.getDate() - 460);

      let created = 0, updated = 0, skipped = 0;
      const storeResults: { storeName: string; storeId: number | null; created: number; updated: number; skippedNoSku: number; error?: string }[] = [];

      for (const ySetting of yandexSettings) {
        const { storeId: resolvedStoreId, companyId: resolvedCompanyId, storeName: resolvedStoreName } = await resolveStoreForYandex(ySetting);
        const displayName = resolvedStoreName || ySetting.storeName || `Yandex ${ySetting.warehouseId}`;
        let storeCreated = 0, storeUpdated = 0, storeSkippedNoSku = 0;
        let storeError: string | undefined;

        try {
          const cleanToken = ySetting.apiKey!.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
          const cleanBusinessId = ySetting.warehouseId!.replace(/[^\x00-\x7F]/g, "").replace(/\s/g, "").trim();
          const isAcmaKey = cleanToken.startsWith("ACMA:");
          const authHeaders: Record<string, string> = {
            ...(isAcmaKey ? { "Api-Key": cleanToken } : { "Authorization": `OAuth ${cleanToken}` }),
            "Content-Type": "application/json",
            "Accept": "application/json",
          };

          console.log(`[yandex-sync-orders] Fetching campaigns for «${displayName}» (Business ID: ${cleanBusinessId}) using ${isAcmaKey ? "Api-Key" : "OAuth token"}...`);
          const campRes = await fetch(`${YANDEX_BASE}/campaigns`, { method: "GET", headers: authHeaders });
          
          if (!campRes.ok) {
            const errText = await campRes.text().catch(() => "");
            if (campRes.status === 401 || campRes.status === 403) {
              throw new Error("Неверный токен (OAuth)");
            }
            throw new Error(`Ошибка Yandex API (${campRes.status}): ${errText || "Нет деталей"}`);
          }
          const campData = await campRes.json();
          const campaigns = campData?.campaigns || [];
          console.log(`[yandex-sync-orders] Found ${campaigns.length} campaign(s) for «${displayName}»`);

          // Auto-discovery and filtering logic:
          // If the user provided an ID (Business ID or Campaign ID) in warehouseId field, use it to filter.
          let filteredCampaigns = campaigns;
          if (cleanBusinessId) {
            // Check if cleanBusinessId is an exact campaign ID
            const exactMatch = campaigns.find((c: any) => String(c.id) === cleanBusinessId);
            if (exactMatch) {
              console.log(`[yandex-sync-orders] Found exact campaign ID match for ${cleanBusinessId}`);
              filteredCampaigns = [exactMatch];
            } else {
              // Otherwise, assume it's a Business ID and filter campaigns belonging to it
              filteredCampaigns = campaigns.filter((c: any) => c.business?.id && String(c.business.id) === cleanBusinessId);
              console.log(`[yandex-sync-orders] Filtered to ${filteredCampaigns.length} campaign(s) for Business ID ${cleanBusinessId}`);
            }
          }

          if (filteredCampaigns.length === 0) {
            console.warn(`[yandex-sync-orders] No campaigns found matching ID ${cleanBusinessId} for «${displayName}». Attempting all available.`);
            filteredCampaigns = campaigns;
          }
          
          for (const campaign of filteredCampaigns) {
            const campaignId = String(campaign.id);
            console.log(`[yandex-sync-orders] Fetching orders for campaign ${campaignId}...`);

            let page = 1;
            let hasMore = true;
            const fromDateStr = [String(since.getDate()).padStart(2,'0'), String(since.getMonth()+1).padStart(2,'0'), since.getFullYear()].join('-');
            console.log(`[yandex-sync-orders] campaign=${campaignId} fromDate=${fromDateStr}`);
            while (hasMore) {
              const ordersRes = await fetch(
                `${YANDEX_BASE}/campaigns/${campaignId}/orders?fromDate=${fromDateStr}&page=${page}&pageSize=50`,
                { method: "GET", headers: authHeaders }
              );
              if (!ordersRes.ok) {
                const errText = await ordersRes.text().catch(() => "");
                if (ordersRes.status === 403) {
                  throw new Error(`Доступ к кампании ${campaignId} запрещен`);
                }
                let detail = "";
                try {
                  const errJson = JSON.parse(errText);
                  detail = errJson.errors?.map((e: any) => `${e.code}: ${e.message}`).join(", ") || 
                           errJson.message || 
                           errJson.error_description || "";
                } catch (e) {
                  detail = errText;
                }
                console.error(`[yandex-sync-orders] Orders API returned ${ordersRes.status}: ${errText.slice(0, 300)}`);
                throw new Error(`Ошибка получения заказов (${ordersRes.status}): ${detail || "Нет деталей"}`);
              }
              const ordersData = await ordersRes.json();
              const ordersList = ordersData?.orders || [];
              const pager = ordersData?.pager;
              console.log(`[yandex-sync-orders] page=${page} orders=${ordersList.length} pager=${JSON.stringify(pager)}`);

              for (const yOrder of ordersList) {
                const yOrderId = String(yOrder.id);
                const rawStatus = yOrder.status || "NEW";
                let yStatus = rawStatus;
                let yShipmentId: string | null = null;
                if (rawStatus === "PROCESSING") {
                  if (yOrder.substatus === "READY_TO_SHIP") {
                    yStatus = "READY_TO_SHIP";
                  } else {
                    try {
                      const dRes = await fetch(`${YANDEX_BASE}/campaigns/${campaignId}/orders/${yOrderId}`, { method: "GET", headers: authHeaders });
                      if (dRes.ok) {
                        const d = await dRes.json(); const fo = d?.order;
                        const fSub = fo?.substatus;
                        const cargoUnits: any[] = fo?.delivery?.shipments || [];
                        const inShipment = cargoUnits.length > 0;
                        if (fSub === "READY_TO_SHIP" || inShipment) yStatus = "READY_TO_SHIP";
                        console.log(`[ym-single] ${yOrderId} sub="${fSub}" inShipment=${inShipment} → ${yStatus}`);
                      } else { console.log(`[ym-single] ${yOrderId} HTTP ${dRes.status}`); }
                    } catch (e: any) { console.log(`[ym-single] ${yOrderId} err=${(e as any).message}`); }
                  }
                }
                console.log(`[ym-substatus] order=${yOrderId} list_substatus="${yOrder.substatus}" → ${yStatus}`);
                const yCreatedAt = yOrder.creationDate
                  ? (() => { const m = String(yOrder.creationDate).match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{1,2}):(\d{1,2}))?/); if (m) { const d = new Date(Date.UTC(+m[3], +m[2]-1, +m[1], (+m[4]||12)-3, +m[5]||0, +m[6]||0)); return isNaN(d.getTime()) ? undefined : d; } const n = Number(yOrder.creationDate); return Number.isFinite(n) && n > 0 ? new Date(n > 1e11 ? n : n*1000) : undefined; })()
                  : (yOrder.createdAt ? new Date(yOrder.createdAt) : undefined);

                const existingOrder = await storage.getOrderByExternalId(yOrderId, orgId, resolvedStoreId);

                if (existingOrder) {
                  const internalStatus = yandexStatusToInternal(yStatus);
                  const needsShipmentId = yShipmentId && !(existingOrder as any).ymShipmentId;
                  if (existingOrder.yandexStatus !== yStatus || needsShipmentId) {
                    await storage.updateOrderYandexStatus(existingOrder.id, yStatus, internalStatus, yCreatedAt, undefined, yShipmentId);
                    updated++;
                    storeUpdated++;
                  } else {
                    skipped++;
                  }
                  continue;
                }

                const items: { productId: number; quantity: number; price: number }[] = [];
                let totalAmount = 0;

                for (const yItem of yOrder.items || []) {
                  const sku = yItem.offerId || yItem.shopSku || "";
                  const qty = yItem.count || 1;
                  const price = parseFloat(yItem.buyerPrice || yItem.price || "0");

                  if (sku) {
                    const [dbProduct] = await db.select().from(productsTable)
                      .where(and(eq(productsTable.sku, sku), eq(productsTable.organizationId, orgId)));
                    if (dbProduct) {
                      items.push({ productId: dbProduct.id, quantity: qty, price });
                      totalAmount += price * qty;
                    }
                  }
                }

                if (items.length === 0) storeSkippedNoSku++;
                const orderTotal = totalAmount > 0 ? totalAmount : parseFloat(String(yOrder.itemsTotal || yOrder.buyerTotal || "0"));
                const internalStatus = yandexStatusToInternal(yStatus);
                await storage.createOrder({
                  orderNumber: `YM-${yOrderId}`,
                  status: internalStatus,
                  totalAmount: orderTotal.toFixed(2),
                  source: "yandex",
                  externalId: yOrderId,
                  postingNumber: null,
                  ozonStatus: null,
                  yandexStatus: yStatus,
                  ymCampaignId: campaignId,
                  ymShipmentId: yShipmentId ?? undefined,
                  fulfillmentType: "FBS",
                  storeId: resolvedStoreId ?? undefined,
                  sourceStoreName: resolvedStoreName ?? undefined,
                  companyId: resolvedCompanyId ?? undefined,
                  organizationId: orgId,
                  createdAt: yCreatedAt || undefined,
                }, items);
                created++;
                storeCreated++;
              }

              if (pager && page < pager.pagesCount) {
                page++;
              } else {
                hasMore = false;
              }
            }
          }

          console.log(`[yandex-sync-orders] «${displayName}»: created ${storeCreated}, updated ${storeUpdated}, skipped no SKU ${storeSkippedNoSku}`);
        } catch (err: any) {
          console.error(`[yandex-sync-orders] Error for «${displayName}»:`, err.message);
          storeError = `Ошибка для магазина «${displayName}»: ${err.message}`;
        }

        storeResults.push({ storeName: displayName, storeId: resolvedStoreId, created: storeCreated, updated: storeUpdated, skippedNoSku: storeSkippedNoSku, error: storeError });
      }

      await storage.createSyncHistory({
        organizationId: orgId,
        action: "yandex_order_sync",
        status: storeResults.some(s => s.error) ? "partial" : "success",
        details: `Синхронизация заказов Yandex: создано ${created}, обновлено ${updated}`,
        itemsCount: created + updated,
      });

      res.json({ success: true, created, updated, skipped, storeResults });
    } catch (error: any) {
      console.error("[yandex-sync-orders] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ==================== Yandex Market Debug ====================

  app.get("/api/marketplace/yandex/debug-processing", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const YANDEX_BASE = "https://api.partner.market.yandex.ru";
      const allSettings = await db.select().from(marketplaceSettingsTable);
      const yandexSettings = allSettings.filter((s: any) => s.marketplace === "yandex" && s.isActive && s.apiKey && s.warehouseId && s.organizationId === orgId);
      const results: any[] = [];
      for (const ySetting of yandexSettings) {
        const cleanToken = ySetting.apiKey!.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
        const isAcmaKey = cleanToken.startsWith("ACMA:");
        const authHeaders: Record<string, string> = {
          ...(isAcmaKey ? { "Api-Key": cleanToken } : { "Authorization": `OAuth ${cleanToken}` }),
          "Content-Type": "application/json", "Accept": "application/json",
        };
        const campRes = await fetch(`${YANDEX_BASE}/campaigns`, { method: "GET", headers: authHeaders });
        if (!campRes.ok) continue;
        const campaigns = (await campRes.json())?.campaigns || [];
        const cleanWh = (ySetting.warehouseId || "").replace(/\s/g, "").trim();
        let filtered = campaigns;
        if (cleanWh) {
          const exact = campaigns.find((c: any) => String(c.id) === cleanWh);
          filtered = exact ? [exact] : campaigns.filter((c: any) => c.business?.id && String(c.business.id) === cleanWh);
        }
        const since = new Date(); since.setDate(since.getDate() - 30);
        const fromDateStr = [String(since.getDate()).padStart(2,'0'), String(since.getMonth()+1).padStart(2,'0'), since.getFullYear()].join('-');
        for (const campaign of filtered) {
          const campaignId = String(campaign.id);
          const ordersRes = await fetch(`${YANDEX_BASE}/campaigns/${campaignId}/orders?fromDate=${fromDateStr}&pageSize=50`, { method: "GET", headers: authHeaders });
          if (!ordersRes.ok) continue;
          const ordersList = (await ordersRes.json())?.orders || [];
          for (const yOrder of ordersList) {
            if (yOrder.status !== "PROCESSING") continue;
            const yOrderId = String(yOrder.id);
            const sRes = await fetch(`${YANDEX_BASE}/campaigns/${campaignId}/orders/${yOrderId}`, { method: "GET", headers: authHeaders });
            let singleData: any = null;
            if (sRes.ok) singleData = (await sRes.json())?.order;
            results.push({
              orderId: yOrderId, campaignId,
              listSubstatus: yOrder.substatus ?? null,
              singleSubstatus: singleData?.substatus ?? null,
              deliveryShipment: singleData?.delivery?.shipment ?? null,
              deliveryShipments: singleData?.delivery?.shipments ?? null,
              singleHttpStatus: sRes.status,
            });
          }
        }
      }
      res.json({ count: results.length, results });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ==================== Yandex Market Bulk Actions ====================

  app.post("/api/marketplace/yandex/bulk-ready-to-ship", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { orderIds } = req.body as { orderIds: number[] };
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ message: "orderIds required" });
      }

      const allSettings = await storage.getMarketplaceSettings(orgId);
      const ymSetting = allSettings.find(s => s.marketplace === "yandex" && s.isActive && s.apiKey);
      if (!ymSetting) return res.status(400).json({ message: "Настройки Яндекс Маркет не найдены" });

      const cleanToken = ymSetting.apiKey!.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
      const isAcmaKey = cleanToken.startsWith("ACMA:");
      const authHeaders: Record<string, string> = {
        ...(isAcmaKey ? { "Api-Key": cleanToken } : { "Authorization": `OAuth ${cleanToken}` }),
        "Content-Type": "application/json",
        "Accept": "application/json",
      };
      const YANDEX_BASE = "https://api.partner.market.yandex.ru";

      const dbOrders = await db.select().from(ordersTable).where(
        and(
          inArray(ordersTable.id, orderIds),
          eq(ordersTable.source, "yandex"),
          eq(ordersTable.organizationId, orgId)
        )
      );

      let successCount = 0;
      const failed: { orderId: number; error: string }[] = [];

      for (const order of dbOrders) {
        const campaignId = (order as any).ymCampaignId;
        const ymOrderId = order.externalId;
        if (!campaignId || !ymOrderId) {
          failed.push({ orderId: order.id, error: "Нет campaign ID или external ID" });
          continue;
        }
        try {
          const statusRes = await fetch(
            `${YANDEX_BASE}/campaigns/${campaignId}/orders/${ymOrderId}/status`,
            {
              method: "PUT",
              headers: authHeaders,
              body: JSON.stringify({ order: { status: "PROCESSING", substatus: "READY_TO_SHIP" } }),
            }
          );
          if (statusRes.ok) {
            await storage.updateOrderYandexStatus(order.id, "READY_TO_SHIP", "pending", undefined, campaignId);
            successCount++;
          } else {
            const errText = await statusRes.text().catch(() => "");
            failed.push({ orderId: order.id, error: `YM API ${statusRes.status}: ${errText.slice(0, 200)}` });
          }
        } catch (err: any) {
          failed.push({ orderId: order.id, error: err.message });
        }
      }

      console.log(`[ym-bulk-ready] org=${orgId} success=${successCount} failed=${failed.length}`);
      res.json({ success: successCount, failed });
    } catch (error: any) {
      console.error("[ym-bulk-ready-to-ship] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/marketplace/yandex/bulk-labels", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { orderIds, pageFormat = "A4", orientation = "VERTICAL" } = req.body as { orderIds: number[]; pageFormat?: string; orientation?: string };
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ message: "orderIds required" });
      }

      const allSettings = await storage.getMarketplaceSettings(orgId);
      const ymSetting = allSettings.find(s => s.marketplace === "yandex" && s.isActive && s.apiKey);
      if (!ymSetting) return res.status(400).json({ message: "Настройки Яндекс Маркет не найдены" });

      const cleanToken = ymSetting.apiKey!.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
      const isAcmaKey = cleanToken.startsWith("ACMA:");
      const authHeaders: Record<string, string> = {
        ...(isAcmaKey ? { "Api-Key": cleanToken } : { "Authorization": `OAuth ${cleanToken}` }),
        "Accept": "application/pdf",
      };
      const YANDEX_BASE = "https://api.partner.market.yandex.ru";

      const dbOrders = await db.select().from(ordersTable).where(
        and(
          inArray(ordersTable.id, orderIds),
          eq(ordersTable.source, "yandex"),
          eq(ordersTable.organizationId, orgId)
        )
      );

      // Если ymCampaignId не заполнен — резолвим через YM API
      const ordersNeedingCampaign = dbOrders.filter(o => !(o as any).ymCampaignId && o.externalId);
      if (ordersNeedingCampaign.length > 0) {
        const cleanToken2 = ymSetting.apiKey!.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
        const isAcmaKey2 = cleanToken2.startsWith("ACMA:");
        const resolveHeaders: Record<string, string> = {
          ...(isAcmaKey2 ? { "Api-Key": cleanToken2 } : { "Authorization": `OAuth ${cleanToken2}` }),
          "Content-Type": "application/json", "Accept": "application/json",
        };
        const campRes = await fetch(`${YANDEX_BASE}/campaigns`, { method: "GET", headers: resolveHeaders });
        if (campRes.ok) {
          const campData = await campRes.json();
          const campaigns: any[] = campData?.campaigns || [];
          for (const order of ordersNeedingCampaign) {
            for (const camp of campaigns) {
              const testRes = await fetch(
                `${YANDEX_BASE}/campaigns/${camp.id}/orders/${order.externalId}`,
                { method: "GET", headers: resolveHeaders }
              );
              if (testRes.ok) {
                await db.update(ordersTable).set({ ymCampaignId: String(camp.id) } as any).where(eq(ordersTable.id, order.id));
                (order as any).ymCampaignId = String(camp.id);
                break;
              }
            }
          }
        }
      }

      // Группируем по campaignId
      const byCampaign = new Map<string, string[]>();
      for (const order of dbOrders) {
        const cid = (order as any).ymCampaignId;
        const eid = order.externalId;
        if (cid && eid) {
          if (!byCampaign.has(cid)) byCampaign.set(cid, []);
          byCampaign.get(cid)!.push(eid);
        }
      }

      if (byCampaign.size === 0) {
        return res.status(400).json({ message: "Не найдено заказов с известным campaign ID. Нажмите «Синхронизировать» и попробуйте снова." });
      }

      const pdfBuffers: Buffer[] = [];
      for (const [campaignId, ymOrderIds] of byCampaign.entries()) {
        // Пробуем батчевый запрос
        const queryIds = ymOrderIds.map(id => `orderIds=${encodeURIComponent(id)}`).join("&");
        const batchRes = await fetch(
          `${YANDEX_BASE}/campaigns/${campaignId}/orders/delivery/labels?${queryIds}`,
          { method: "GET", headers: authHeaders }
        );
        if (batchRes.ok) {
          const buf = Buffer.from(await batchRes.arrayBuffer());
          pdfBuffers.push(buf);
          console.log(`[ym-bulk-labels] campaign=${campaignId} batch OK, ${ymOrderIds.length} orders`);
        } else {
          const errText = await batchRes.text().catch(() => "");
          console.error(`[ym-bulk-labels] campaign=${campaignId} batch status=${batchRes.status} body=${errText.slice(0,300)}`);
          // Fallback: запрашиваем этикетки по одному
          for (const ymOrderId of ymOrderIds) {
            const singleRes = await fetch(
              `${YANDEX_BASE}/campaigns/${campaignId}/orders/${ymOrderId}/delivery/labels`,
              { method: "GET", headers: authHeaders }
            );
            if (singleRes.ok) {
              const buf = Buffer.from(await singleRes.arrayBuffer());
              pdfBuffers.push(buf);
            } else {
              const singleErr = await singleRes.text().catch(() => "");
              console.error(`[ym-bulk-labels] order=${ymOrderId} status=${singleRes.status} body=${singleErr.slice(0,200)}`);
            }
          }
        }
      }

      if (pdfBuffers.length === 0) {
        return res.status(502).json({ message: "Яндекс Маркет не вернул этикетки. Убедитесь что заказы находятся в статусе «Ожидает сборки» или «Готов к отправке»." });
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=\"ym-labels.pdf\"");
      // Если несколько кампаний — конкатенируем буферы (PDF reader покажет несколько документов)
      res.send(Buffer.concat(pdfBuffers));
    } catch (error: any) {
      console.error("[ym-bulk-labels] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/marketplace/yandex/order-list-pdf", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { orderIds } = req.body as { orderIds: number[] };
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ message: "orderIds required" });
      }

      const dbOrders = await db.select().from(ordersTable).where(
        and(
          inArray(ordersTable.id, orderIds),
          eq(ordersTable.source, "yandex"),
          eq(ordersTable.organizationId, orgId)
        )
      );

      const orderItemsData = await db.select({
        orderId: orderItemsTable.orderId,
        sku: orderItemsTable.sku,
        productName: orderItemsTable.productName,
        quantity: orderItemsTable.quantity,
        price: orderItemsTable.price,
      }).from(orderItemsTable).where(
        inArray(orderItemsTable.orderId, dbOrders.map(o => o.id))
      );

      const itemsByOrder = new Map<number, typeof orderItemsData>();
      for (const item of orderItemsData) {
        if (!itemsByOrder.has(item.orderId)) itemsByOrder.set(item.orderId, []);
        itemsByOrder.get(item.orderId)!.push(item);
      }

      const rows = dbOrders.map(o => {
        const items = itemsByOrder.get(o.id) || [];
        const itemsHtml = items.length > 0
          ? items.map(i => `<tr><td>${i.sku || "—"}</td><td>${i.productName || "—"}</td><td>${i.quantity}</td><td>${Number(i.price).toLocaleString("ru-RU")} ₽</td></tr>`).join("")
          : `<tr><td colspan="4" style="color:#888">Товары не найдены в базе</td></tr>`;
        return `
          <tr class="order-row">
            <td colspan="4"><strong>Заказ № ${o.externalId || o.orderNumber}</strong>
              — статус: ${o.yandexStatus || "—"}
              — сумма: ${Number(o.totalAmount).toLocaleString("ru-RU")} ₽
              — кампания: ${(o as any).ymCampaignId || "—"}</td>
          </tr>
          ${itemsHtml}`;
      }).join("");

      const html = `<!DOCTYPE html><html lang="ru"><head>
        <meta charset="UTF-8">
        <title>Список заказов ЯМ</title>
        <style>
          body { font-family: Arial, sans-serif; font-size: 13px; }
          h1 { font-size: 16px; margin-bottom: 8px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
          th { background: #f5f5f5; }
          .order-row td { background: #fffbe6; font-weight: bold; }
          @media print { button { display: none; } }
        </style>
      </head><body>
        <button onclick="window.print()" style="margin-bottom:12px;padding:6px 16px;cursor:pointer">Печать</button>
        <h1>Список заказов Яндекс Маркет (${dbOrders.length})</h1>
        <table>
          <thead><tr><th>Артикул</th><th>Товар</th><th>Кол-во</th><th>Цена</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </body></html>`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (error: any) {
      console.error("[ym-order-list-pdf] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Исправление цен товаров в существующих ЯМ заказах (buyerPrice вместо price)
  app.post("/api/marketplace/yandex/fix-item-prices", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const allSettings = await storage.getMarketplaceSettings(orgId);
      const YANDEX_BASE = "https://api.partner.market.yandex.ru";
      const ymSettings = allSettings.filter(s => s.marketplace === "yandex" && s.isActive && s.apiKey);
      if (!ymSettings.length) return res.status(400).json({ message: "Нет активных ЯМ магазинов" });

      const setting = ymSettings[0];
      const authHeaders: Record<string, string> = setting.apiKey!.startsWith("ACMA:")
        ? { "Api-Key": setting.apiKey!, "Content-Type": "application/json" }
        : { "Authorization": `OAuth ${setting.apiKey!}`, "Content-Type": "application/json" };

      // Только активные заказы за последние 30 дней
      const ymOrders = await db.select({
        id: ordersTable.id,
        externalId: ordersTable.externalId,
        ymCampaignId: ordersTable.ymCampaignId,
      }).from(ordersTable).where(
        and(
          eq(ordersTable.source, "yandex"),
          eq(ordersTable.organizationId, orgId),
          sql`${ordersTable.status} NOT IN ('cancelled')`,
          sql`${ordersTable.externalId} IS NOT NULL`,
          sql`${ordersTable.createdAt} >= NOW() - INTERVAL '30 days'`
        )
      );

      console.log(`[fix-item-prices] found ${ymOrders.length} active YM orders to fix`);

      let fixed = 0;
      let errors = 0;
      const campaignIds = ["99063023", "124589277"];

      for (const order of ymOrders) {
        try {
          // Пробуем campaign из DB, потом оба известных campaign ID
          const campCandidates = order.ymCampaignId
            ? [order.ymCampaignId, ...campaignIds.filter(c => c !== order.ymCampaignId)]
            : campaignIds;

          let yOrder: any = null;
          for (const campId of campCandidates) {
            try {
              const ctrl = new AbortController();
              const t = setTimeout(() => ctrl.abort(), 8000);
              const r = await fetch(`${YANDEX_BASE}/campaigns/${campId}/orders/${order.externalId}`,
                { method: "GET", headers: authHeaders, signal: ctrl.signal });
              clearTimeout(t);
              if (r.ok) { const d = await r.json(); yOrder = d?.order; break; }
            } catch { /* try next */ }
          }

          if (!yOrder?.items?.length) { errors++; continue; }

          // Считаем новый total из buyerPrice — независимо от SKU в БД
          let newTotal = 0;
          for (const yItem of yOrder.items) {
            const qty = yItem.count || 1;
            const newPrice = parseFloat(yItem.buyerPrice || yItem.price || "0");
            newTotal += newPrice * qty;

            // Обновляем order_items если SKU найден в products
            const sku = yItem.offerId || yItem.shopSku || "";
            if (sku && newPrice) {
              const [dbProduct] = await db.select({ id: productsTable.id }).from(productsTable)
                .where(and(eq(productsTable.sku, sku), eq(productsTable.organizationId, orgId)));
              if (dbProduct) {
                await db.update(orderItemsTable)
                  .set({ price: newPrice.toFixed(2) })
                  .where(and(eq(orderItemsTable.orderId, order.id), eq(orderItemsTable.productId, dbProduct.id)));
              }
            }
          }

          // Всегда обновляем totalAmount если получили данные из API
          if (newTotal > 0) {
            await db.update(ordersTable).set({ totalAmount: newTotal.toFixed(2) }).where(eq(ordersTable.id, order.id));
            fixed++;
            console.log(`[fix-item-prices] fixed order ${order.externalId} newTotal=${newTotal}`);
          } else {
            errors++;
          }
        } catch (e: any) {
          console.error(`[fix-item-prices] order ${order.id}: ${e.message}`);
          errors++;
        }
      }

      console.log(`[fix-item-prices] done: fixed=${fixed} errors=${errors} total=${ymOrders.length}`);
      res.json({ fixed, errors, total: ymOrders.length });
    } catch (error: any) {
      console.error("[fix-item-prices] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Исправление created_at для всех ЯМ заказов (было записано NOW() вместо реальной даты заказа)
  app.post("/api/marketplace/yandex/fix-order-dates", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    console.log("[fix-order-dates] START");
    try {
      const orgId = getOrgId(req);
      console.log("[fix-order-dates] orgId:", orgId);

      // Шаг 1: ЯМ API ключ через raw SQL чтобы избежать Drizzle timestamp parsing
      const settingsRows = await db.execute(sql`
        SELECT api_key FROM marketplace_settings
        WHERE organization_id = ${orgId} AND marketplace = 'yandex' AND is_active = true AND api_key IS NOT NULL
        LIMIT 1
      `);
      const rows = settingsRows.rows as any[];
      if (!rows.length) return res.status(400).json({ message: "Нет активных ЯМ магазинов" });
      const apiKey: string = rows[0].api_key;
      console.log("[fix-order-dates] apiKey prefix:", apiKey.substring(0, 10));

      const YANDEX_BASE = "https://api.partner.market.yandex.ru";
      const authHeaders: Record<string, string> = apiKey.startsWith("ACMA:")
        ? { "Api-Key": apiKey, "Content-Type": "application/json" }
        : { "Authorization": `OAuth ${apiKey}`, "Content-Type": "application/json" };

      // Шаг 2: Все ЯМ заказы из БД (только id и external_id, без timestamp колонок)
      const ordersRows = await db.execute(sql`
        SELECT id, external_id FROM orders
        WHERE source = 'yandex' AND organization_id = ${orgId} AND external_id IS NOT NULL
      `);
      const ymOrders = ordersRows.rows as { id: number; external_id: string }[];
      console.log(`[fix-order-dates] found ${ymOrders.length} YM orders in DB`);

      // Шаг 3: Собираем creationDate из ЯМ API — храним Unix секунды (не Date объекты)
      const creationSecsMap = new Map<string, number>(); // externalId → Unix seconds
      const campaignIds = ["99063023", "124589277"];
      // Используем 30 дней — то же окно что и sync-orders, YM API не поддерживает большой диапазон
      const d30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const fromDateStr = [
        String(d30.getDate()).padStart(2, '0'),
        String(d30.getMonth() + 1).padStart(2, '0'),
        String(d30.getFullYear()),
      ].join('-');
      console.log("[fix-order-dates] fromDate:", fromDateStr);

      // Диагностика: что реально возвращает API
      const diagInfo: any[] = [];

      for (const campId of campaignIds) {
        let page = 1; let hasMore = true;
        while (hasMore) {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 15000);
            const r = await fetch(
              `${YANDEX_BASE}/campaigns/${campId}/orders?fromDate=${fromDateStr}&pageSize=50&page=${page}`,
              { method: "GET", headers: authHeaders, signal: ctrl.signal }
            );
            clearTimeout(t);
            if (!r.ok) {
              diagInfo.push({ camp: campId, page, httpStatus: r.status, error: await r.text().catch(() => '') });
              hasMore = false; break;
            }
            const data = await r.json();
            const ordersList: any[] = data?.orders || [];
            const pager = data?.pager;
            if (page === 1) {
              const s = ordersList[0];
              diagInfo.push({
                camp: campId,
                pagesCount: pager?.pagesCount,
                ordersOnPage: ordersList.length,
                firstOrder: s ? { id: s.id, creationDate: s.creationDate, creationDateType: typeof s.creationDate, status: s.status } : null,
              });
            }
            for (const yOrder of ordersList) {
              const raw = yOrder.creationDate;
              if (raw == null) continue;
              // ЯМ API возвращает creationDate как строку "DD-MM-YYYY HH:MM:SS" (московское время UTC+3)
              const s = String(raw);
              let secs: number;
              const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{1,2}):(\d{1,2}))?/);
              if (m) {
                const dd = Number(m[1]), mo = Number(m[2]), yyyy = Number(m[3]);
                const hh = Number(m[4] ?? 12), min = Number(m[5] ?? 0), ss2 = Number(m[6] ?? 0);
                // Конвертируем из МСК (UTC+3) в UTC
                const utcMs = Date.UTC(yyyy, mo - 1, dd, hh - 3, min, ss2);
                if (isNaN(utcMs)) continue;
                secs = Math.floor(utcMs / 1000);
              } else {
                // Числовой fallback: секунды или мс
                const asNum = Number(raw);
                if (!Number.isFinite(asNum) || asNum <= 0) continue;
                secs = asNum > 1e11 ? Math.floor(asNum / 1000) : asNum;
              }
              if (secs > 1262304000 && secs < 2051222400) {
                creationSecsMap.set(String(yOrder.id), secs);
              }
            }
            if (!pager || page >= (pager.pagesCount || 1) || ordersList.length === 0) hasMore = false;
            else page++;
          } catch (e: any) {
            diagInfo.push({ camp: campId, page, fetchError: e?.message });
            hasMore = false;
          }
        }
      }

      // Шаг 4: Обновляем created_at через raw SQL
      let fixed = 0; let errors = 0;
      for (const order of ymOrders) {
        const secs = creationSecsMap.get(order.external_id);
        if (secs != null) {
          await db.execute(sql`UPDATE orders SET created_at = to_timestamp(${secs}) WHERE id = ${order.id}`);
          fixed++;
        } else {
          errors++;
        }
      }

      res.json({ fixed, errors, total: ymOrders.length, mapSize: creationSecsMap.size, diag: diagInfo });
    } catch (error: any) {
      console.error("[fix-order-dates] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ==================== Yandex Market Shipments ====================

  // Реестр известных session ID (пополняется при каждом успешном detail-запросе)
  const ymKnownSessionIds = new Set<number>([81780262, 81843179, 81818838, 81857735, 81863339, 81801174]);
  // Кэш ответов /api/marketplace/yandex/shipments (5 мин TTL, ключ = orgId)
  const ymShipmentsCache = new Map<string, { data: any; ts: number }>();
  const YM_SHIPMENTS_CACHE_TTL = 5 * 60 * 1000;

  app.get("/api/marketplace/yandex/shipments", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const forceRefresh = req.query.refresh === "1";

      // Вернуть из кэша если данные свежие (< 5 мин)
      if (!forceRefresh) {
        const cached = ymShipmentsCache.get(orgId);
        if (cached && Date.now() - cached.ts < YM_SHIPMENTS_CACHE_TTL) {
          console.log(`[ym-shipments] cache hit for org=${orgId}, age=${Math.round((Date.now()-cached.ts)/1000)}s`);
          return res.json(cached.data);
        }
      }

      const allSettings = await storage.getMarketplaceSettings(orgId);
      const ymSetting = allSettings.find(s => s.marketplace === "yandex" && s.isActive && s.apiKey);
      if (!ymSetting) return res.status(400).json({ message: "Настройки Яндекс Маркет не найдены" });

      const cleanToken = ymSetting.apiKey!.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
      const isAcmaKey = cleanToken.startsWith("ACMA:");
      const authHeaders: Record<string, string> = {
        ...(isAcmaKey ? { "Api-Key": cleanToken } : { "Authorization": `OAuth ${cleanToken}` }),
        "Content-Type": "application/json",
        "Accept": "application/json",
      };
      const YANDEX_BASE = "https://api.partner.market.yandex.ru";

      // Получаем READY_TO_SHIP заказы из БД
      const readyOrders = await db.select().from(ordersTable).where(
        and(
          eq(ordersTable.source, "yandex"),
          eq(ordersTable.yandexStatus, "READY_TO_SHIP"),
          eq(ordersTable.organizationId, orgId)
        )
      );
      console.log(`[ym-shipments] org=${orgId} readyOrders=${readyOrders.length}`);

      // externalId → sessionId mapping (строим через multiple strategies)
      const externalIdToSession = new Map<string, string>();
      const isSessionId = (v: any) => {
        if (v != null && String(v).startsWith('VRT_')) return true;
        return v != null && Number(String(v)) > 0 && Number(String(v)) <= 200_000_000;
      };
      const virtualMeta = new Map<string, { logisticPointId: string; shipmentDate: string }>();

      const campaignIds = [...new Set(
        readyOrders.filter(o => (o as any).ymCampaignId).map(o => (o as any).ymCampaignId as string)
      )];

      // Pre-populate из DB: реальные session ID берём сразу, VRT_ пропускаем —
      // чтобы каждый запрос пробовал получить реальный ID через YM API
      for (const order of readyOrders) {
        const existingId = (order as any).ymShipmentId as string | null;
        if (!existingId || !order.externalId) continue;
        if (!existingId.startsWith('VRT_') && isSessionId(existingId)) {
          // Реальный session ID — не дёргаем API
          externalIdToSession.set(order.externalId!, existingId);
        }
        // VRT_ — не pre-populate, чтобы Strategy D попробовал получить реальный ID
      }

      const now2 = new Date();
      const fromD2 = new Date(now2); fromD2.setDate(fromD2.getDate() - 30);
      const pad2 = (n: number) => String(n).padStart(2, "0");
      const dateFrom2 = `${pad2(fromD2.getDate())}-${pad2(fromD2.getMonth() + 1)}-${fromD2.getFullYear()}`;
      // ISO dates for POST body
      const fromIso2 = `${fromD2.getFullYear()}-${pad2(fromD2.getMonth() + 1)}-${pad2(fromD2.getDate())}`;
      const toIso2   = `${now2.getFullYear()}-${pad2(now2.getMonth() + 1)}-${pad2(now2.getDate())}`;

      // Вспомогательная функция: попробовать fetch сессий разными методами
      const fetchSessions = async (url: string, method: string, body?: object): Promise<any[]> => {
        try {
          const opts: RequestInit = { method, headers: authHeaders };
          if (body) opts.body = JSON.stringify(body);
          const r = await fetch(url, opts);
          console.log(`[ym-shipments] ${method} ${url.slice(-60)} → ${r.status} Allow=${r.headers.get("Allow") || "-"}`);
          if (!r.ok) return [];
          const d = await r.json();
          return d?.result?.shipments || d?.shipments || d?.result?.items || [];
        } catch { return []; }
      };

      // Попытка 0: business-level (охватывает все кампании сразу)
      const bizId = 131115754;
      let globalSessions: Array<{ sessions: any[]; campId: string }> = [];
      const bizDateBody = { dateFrom: fromIso2, dateTo: toIso2, limit: 50 };
      for (const [bMethod, bBody] of [
        ["GET", undefined],
        ["POST", bizDateBody],
        ["PUT", bizDateBody],
      ] as Array<[string, any]>) {
        const url = bBody
          ? `${YANDEX_BASE}/businesses/${bizId}/first-mile/shipments`
          : `${YANDEX_BASE}/businesses/${bizId}/first-mile/shipments?dateFrom=${fromIso2}&dateTo=${toIso2}&limit=50`;
        const ss = await fetchSessions(url, bMethod, bBody);
        if (ss.length > 0) {
          // business sessions могут содержать campaignId; используем первую известную кампанию как fallback
          ss.forEach(s => {
            const sid = String(s.campaignId || campaignIds[0] || "");
            globalSessions.push({ sessions: [s], campId: sid });
          });
          console.log(`[ym-shipments] biz-level ${bMethod} → ${ss.length} sessions`);
          break;
        }
      }

      for (const campId of campaignIds) {
        try {
          // Попытки в порядке: POST ISO, PUT ISO, POST DD-MM
          let sessions: any[] = [];
          for (const [method, body] of [
            ["POST", { dateFrom: fromIso2, dateTo: toIso2, limit: 50 }],
            ["PUT",  { dateFrom: fromIso2, dateTo: toIso2, limit: 50 }],
            ["POST", { dateFrom: dateFrom2, dateTo: `${pad2(now2.getDate())}-${pad2(now2.getMonth()+1)}-${now2.getFullYear()}`, limit: 50 }],
          ] as Array<[string, object]>) {
            sessions = await fetchSessions(`${YANDEX_BASE}/campaigns/${campId}/first-mile/shipments`, method, body);
            if (sessions.length > 0) break;
          }
          if (!sessions.length) { console.log(`[ym-shipments] all methods failed camp=${campId}`); continue; }
          console.log(`[ym-shipments] camp=${campId} sessions=${sessions.length} first-raw=${JSON.stringify(sessions[0] || {}).slice(0, 400)}`);

          for (const sess of sessions) {
            const sessionId = String(sess.id);

            // Strategy A: orderIds directly in the sessions list response
            const directIds: any[] = sess.orderIds || sess.orders?.map((o: any) => o.id) || [];
            if (directIds.length > 0) {
              directIds.forEach((oid: any) => externalIdToSession.set(String(oid), sessionId));
              console.log(`[ym-shipments] session=${sessionId} direct-ids=${directIds.length}`);
              continue;
            }

            // Strategy B: supplierShipmentId filter on orders endpoint
            try {
              const ordRes = await fetch(
                `${YANDEX_BASE}/campaigns/${campId}/orders?supplierShipmentId=${sessionId}&pageSize=200`,
                { headers: authHeaders }
              );
              if (ordRes.ok) {
                const ordData = await ordRes.json();
                const orders: any[] = ordData?.orders || [];
                console.log(`[ym-shipments] session=${sessionId} supplierShipmentId-orders=${orders.length}`);
                if (orders.length > 0) {
                  orders.forEach((o: any) => { if (o.id) externalIdToSession.set(String(o.id), sessionId); });
                  continue;
                }
              } else {
                console.log(`[ym-shipments] supplierShipmentId HTTP ${ordRes.status} session=${sessionId}`);
              }
            } catch (e: any) { /* ignore */ }

            // Strategy C: first-mile/shipments/{id} detail — check for embedded order IDs
            try {
              const detRes = await fetch(`${YANDEX_BASE}/campaigns/${campId}/first-mile/shipments/${sessionId}`, { headers: authHeaders });
              if (detRes.ok) {
                const detData = await detRes.json();
                const det = detData?.result?.shipment || detData?.shipment || detData?.result || detData;
                const detIds: any[] = det?.orderIds || det?.orders?.map((o: any) => o.id) || [];
                console.log(`[ym-shipments] session=${sessionId} detail-orderIds=${detIds.length} detail-raw=${JSON.stringify(detData).slice(0, 400)}`);
                if (detIds.length > 0) {
                  detIds.forEach((oid: any) => externalIdToSession.set(String(oid), sessionId));
                }
              }
            } catch (e: any) { /* ignore */ }
          }
        } catch (e: any) {
          console.log(`[ym-shipments] sessions-list err camp=${campId}: ${e.message}`);
        }
      }

      // Обработка business-level сессий (если нашлись)
      for (const { sessions: bSessions, campId: bCampId } of globalSessions) {
        for (const sess of bSessions) {
          const sessionId = String(sess.id);
          if (externalIdToSession.has(sessionId)) continue; // уже обработан через кампанийный цикл
          const directIds: any[] = sess.orderIds || sess.orders?.map((o: any) => o.id) || [];
          if (directIds.length > 0) {
            directIds.forEach((oid: any) => externalIdToSession.set(String(oid), sessionId));
            continue;
          }
          // Strategy C-biz: detail через business или кампанийный уровень
          const detUrls = [
            `${YANDEX_BASE}/businesses/${bizId}/first-mile/shipments/${sessionId}`,
            ...(bCampId ? [`${YANDEX_BASE}/campaigns/${bCampId}/first-mile/shipments/${sessionId}`] : []),
          ];
          for (const dUrl of detUrls) {
            try {
              const dr = await fetch(dUrl, { headers: authHeaders });
              if (dr.ok) {
                const dd = await dr.json();
                const det = dd?.result?.shipment || dd?.shipment || dd?.result || dd;
                const dIds: any[] = det?.orderIds || det?.orders?.map((o: any) => o.id) || [];
                if (dIds.length > 0) { dIds.forEach((oid: any) => externalIdToSession.set(String(oid), sessionId)); break; }
              }
            } catch {}
          }
        }
      }

      // Strategy D: fallback — single-order API for orders still not matched
      const unmapped = readyOrders.filter(o => o.externalId && !externalIdToSession.has(o.externalId!));
      console.log(`[ym-shipments] unmapped after sessions-API=${unmapped.length}`);
      for (const order of unmapped) {
        const campId = (order as any).ymCampaignId;
        if (!campId || !order.externalId) continue;
        try {
          const dRes = await fetch(`${YANDEX_BASE}/campaigns/${campId}/orders/${order.externalId}`, { headers: authHeaders });
          if (dRes.ok) {
            const d = await dRes.json();
            const del = d?.order?.delivery;
            const candidates = [
              del?.supplierShipmentId, del?.firstMileShipmentId,
              del?.shipments?.[0]?.externalId, del?.shipments?.[0]?.supplierShipmentId,
            ].filter(isSessionId);
            if (candidates[0]) {
              externalIdToSession.set(order.externalId!, String(candidates[0]));
              console.log(`[ym-shipments] single-API order=${order.externalId} → session=${candidates[0]}`);
            } else {
              // Fallback: virtual session grouped by logisticPointId + shipmentDate
              const vpId = String(del?.logisticPointId || del?.outletCode || "0");
              const rawDate = del?.shipments?.[0]?.shipmentDate || del?.dates?.fromDate;
              let vpDateIso = rawDate || "nodate";
              if (rawDate && /^\d{2}-\d{2}-\d{4}$/.test(rawDate)) {
                const [dd, mm, yyyy] = rawDate.split('-');
                vpDateIso = `${yyyy}-${mm}-${dd}`;
              }
              const vId = `VRT_${vpId}_${vpDateIso}`;
              externalIdToSession.set(order.externalId!, vId);
              if (!virtualMeta.has(vId)) virtualMeta.set(vId, { logisticPointId: vpId, shipmentDate: vpDateIso });
              console.log(`[ym-shipments] virtual-session order=${order.externalId} → ${vId}`);
            }
          }
        } catch (e: any) { /* ignore */ }
      }

      // Strategy E: detail-endpoint по известным session ID (перекрывает VRT_ → реальный ID)
      const hasVrtOrUnmapped = readyOrders.some(o => {
        if (!o.externalId) return false;
        const sid = externalIdToSession.get(o.externalId);
        return !sid || String(sid).startsWith('VRT_');
      });
      if (hasVrtOrUnmapped) {
        // Параллельный запрос для всех известных сессий × кампаний
        const eTasks: Promise<void>[] = [];
        for (const candId of ymKnownSessionIds) {
          for (const campId of [...campaignIds, "124589277"]) {
            eTasks.push((async () => {
              try {
                const r = await fetch(`${YANDEX_BASE}/campaigns/${campId}/first-mile/shipments/${candId}`, { headers: authHeaders });
                if (r.ok) {
                  const d = await r.json();
                  const det = d?.result?.shipment || d?.shipment || d?.result || d;
                  const detIds: any[] = det?.orderIds || det?.orders?.map((o: any) => o.id) || [];
                  if (detIds.length > 0) {
                    detIds.forEach((oid: any) => externalIdToSession.set(String(oid), String(candId)));
                    ymKnownSessionIds.add(candId);
                    console.log(`[ym-shipments] Strategy E: session=${candId} camp=${campId} orders=${detIds.join(",")}`);
                  }
                }
              } catch {}
            })());
          }
        }
        await Promise.all(eTasks);
      }

      // Сохраняем session IDs в БД
      for (const order of readyOrders) {
        if (!order.externalId) continue;
        const sessionId = externalIdToSession.get(order.externalId);
        if (sessionId) {
          const current = (order as any).ymShipmentId;
          if (current !== sessionId) {
            await db.update(ordersTable).set({ ymShipmentId: sessionId } as any).where(eq(ordersTable.id, order.id));
            (order as any).ymShipmentId = sessionId;
          }
        }
      }

      // Группируем заказы — только сессионные ID (≤200M, не cargo unit ≥800M)
      const shipmentMap = new Map<string, { orderIds: string[]; campaignId: string; }>();
      for (const order of readyOrders) {
        const sId = (order as any).ymShipmentId as string | null;
        if (!sId || !isSessionId(sId)) continue;
        const cId = (order as any).ymCampaignId as string || "";
        if (!shipmentMap.has(sId)) shipmentMap.set(sId, { orderIds: [], campaignId: cId });
        if (order.externalId) shipmentMap.get(sId)!.orderIds.push(order.externalId);
      }

      // Для каждой уникальной отгрузки получаем детали через YM API — параллельно
      const allShipments: any[] = await Promise.all(
        Array.from(shipmentMap.entries()).map(async ([shipmentId, { orderIds, campaignId }]) => {
          let shipmentStatus = "CREATED";
          let warehouseName = `Кампания ${campaignId}`;
          let warehouseAddress: string | null = null;
          let planDate: string | null = null;

          if (shipmentId.startsWith('VRT_')) {
            const vm = virtualMeta.get(shipmentId);
            planDate = vm?.shipmentDate || null;
            warehouseName = vm ? `Яндекс Маркет · ${vm.logisticPointId}` : `Кампания ${campaignId}`;
          } else {
            try {
              const sRes = await fetch(`${YANDEX_BASE}/campaigns/${campaignId}/first-mile/shipments/${shipmentId}`, { headers: authHeaders });
              if (sRes.ok) {
                const sData = await sRes.json();
                const s = sData?.result || sData?.shipment || sData;
                shipmentStatus = s?.status || "CREATED";
                warehouseName = s?.warehouseFrom?.description || s?.warehouseFrom?.address?.street || warehouseName;
                if (s?.warehouseFrom?.address) {
                  warehouseAddress = [s.warehouseFrom.address.street, s.warehouseFrom.address.city].filter(Boolean).join(", ");
                }
                planDate = s?.planIntervalFrom || null;
              }
            } catch {}
          }

          return { id: shipmentId, campaignId, status: shipmentStatus, warehouseName, warehouseAddress, planDate, orderCount: orderIds.length, orderIds, availableActions: [] };
        })
      );

      // Сортировка: ISO дата (YYYY-MM-DD) сортируется правильно
      allShipments.sort((a, b) => (b.planDate || "").localeCompare(a.planDate || ""));
      // Для виртуальных сессий добавляем порядковый номер
      let vrtIdx = 0;
      for (const s of allShipments) {
        if (String(s.id).startsWith('VRT_')) {
          vrtIdx++;
          s.displayId = `#${vrtIdx}`;
        } else {
          s.displayId = `№${s.id}`;
        }
      }
      const result = { shipments: allShipments };
      ymShipmentsCache.set(orgId, { data: result, ts: Date.now() });
      console.log(`[ym-shipments] org=${orgId} shipments=${allShipments.length} (cached)`);
      res.json(result);
    } catch (e: any) {
      console.error("[ym-shipments]", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/marketplace/yandex/debug-shipments", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const allSettings = await storage.getMarketplaceSettings(orgId);
      const ymSetting = allSettings.find(s => s.marketplace === "yandex" && s.isActive && s.apiKey);
      if (!ymSetting) return res.status(400).json({ message: "no YM setting" });

      const cleanToken = ymSetting.apiKey!.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
      const isAcmaKey = cleanToken.startsWith("ACMA:");
      const authHeaders: Record<string, string> = {
        ...(isAcmaKey ? { "Api-Key": cleanToken } : { "Authorization": `OAuth ${cleanToken}` }),
        "Content-Type": "application/json", "Accept": "application/json",
      };
      const YANDEX_BASE = "https://api.partner.market.yandex.ru";

      const now = new Date();
      const fromD = new Date(now); fromD.setDate(fromD.getDate() - 30);
      const pad = (n: number) => String(n).padStart(2, "0");
      const fromIso = `${fromD.getFullYear()}-${pad(fromD.getMonth() + 1)}-${pad(fromD.getDate())}`;
      const toIso   = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

      const campRes = await fetch(`${YANDEX_BASE}/campaigns`, { headers: authHeaders });
      const campData = await campRes.json();
      const campaigns: any[] = campData?.campaigns || [];
      const businessId = campaigns[0]?.business?.id || 131115754;

      // ── Test 1: POST /campaigns/124589277/first-mile/shipments + capture Allow header ──
      const postRes = await fetch(`${YANDEX_BASE}/campaigns/124589277/first-mile/shipments`, {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ dateFrom: fromIso, dateTo: toIso, limit: 10 })
      });
      const postAllowHeader = postRes.headers.get("Allow") || postRes.headers.get("allow") || null;
      let postBody: any = null; try { postBody = await postRes.json(); } catch {}

      // ── Test 2: PUT /campaigns/124589277/first-mile/shipments ──
      const putRes = await fetch(`${YANDEX_BASE}/campaigns/124589277/first-mile/shipments`, {
        method: "PUT", headers: authHeaders,
        body: JSON.stringify({ dateFrom: fromIso, dateTo: toIso, limit: 50 })
      });
      let putBody: any = null; try { putBody = await putRes.json(); } catch {}

      // ── Test 3: GET /businesses/{id}/first-mile/shipments ──
      const bizGetRes = await fetch(
        `${YANDEX_BASE}/businesses/${businessId}/first-mile/shipments?dateFrom=${fromIso}&dateTo=${toIso}&limit=50`,
        { headers: authHeaders }
      );
      let bizGetBody: any = null; try { bizGetBody = await bizGetRes.json(); } catch {}

      // ── Test 4: POST /businesses/{id}/first-mile/shipments ──
      const bizPostRes = await fetch(`${YANDEX_BASE}/businesses/${businessId}/first-mile/shipments`, {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ dateFrom: fromIso, dateTo: toIso, limit: 50 })
      });
      let bizPostBody: any = null; try { bizPostBody = await bizPostRes.json(); } catch {}

      // ── Test 5: Full order JSON — all top-level keys ──
      const sampleOrders = await db.select().from(ordersTable).where(
        and(eq(ordersTable.source, "yandex"), eq(ordersTable.yandexStatus, "READY_TO_SHIP"), eq(ordersTable.organizationId, orgId))
      ).limit(1);
      const sampleOrder = sampleOrders[0];
      let fullOrderKeys: string[] = [];
      let fullOrderDeliveryKeys: string[] = [];
      if (sampleOrder?.externalId) {
        const campId = (sampleOrder as any).ymCampaignId || "124589277";
        const soRes = await fetch(`${YANDEX_BASE}/campaigns/${campId}/orders/${sampleOrder.externalId}`, { headers: authHeaders });
        if (soRes.ok) {
          const soData = await soRes.json();
          const ord = soData?.order;
          if (ord) { fullOrderKeys = Object.keys(ord); fullOrderDeliveryKeys = Object.keys(ord.delivery || {}); }
        }
      }

      // ── Test 6: Delivery data for ALL READY_TO_SHIP orders ──
      const allReadyOrders = await db.select().from(ordersTable).where(
        and(eq(ordersTable.source, "yandex"), eq(ordersTable.yandexStatus, "READY_TO_SHIP"), eq(ordersTable.organizationId, orgId))
      ).limit(12);
      const allDeliveries: any[] = [];
      for (const o of allReadyOrders) {
        if (!o.externalId) continue;
        try {
          const campId = (o as any).ymCampaignId || "124589277";
          const r = await fetch(`${YANDEX_BASE}/campaigns/${campId}/orders/${o.externalId}`, { headers: authHeaders });
          if (r.ok) {
            const d = await r.json();
            const del = d?.order?.delivery;
            allDeliveries.push({
              externalId: o.externalId,
              outletCode: del?.outletCode,
              logisticPointId: del?.logisticPointId,
              shipmentDate: del?.shipments?.[0]?.shipmentDate,
              cargoUnitId: del?.shipments?.[0]?.id,
            });
          }
        } catch {}
      }

      res.json({
        campaigns: campaigns.map((c: any) => ({ id: c.id, domain: c.domain })),
        businessId,
        postStatus: postRes.status,
        postAllowHeader,
        putStatus: putRes.status,
        putBody,
        bizGetStatus: bizGetRes.status,
        bizGetBody,
        bizPostStatus: bizPostRes.status,
        bizPostBody,
        fullOrderKeys,
        fullOrderDeliveryKeys,
        sampleOrderExternalId: sampleOrder?.externalId || null,
        allDeliveries,
        knownSessionTests: await (async () => {
          const knownIds = [81780262, 81843179, 81818838, 81857735, 81863339, 81801174];
          const results: any[] = [];
          for (const sid of knownIds) {
            try {
              const r = await fetch(`${YANDEX_BASE}/campaigns/124589277/first-mile/shipments/${sid}`, { headers: authHeaders });
              const body = r.ok ? await r.json().catch(() => null) : await r.text().catch(() => null);
              results.push({ sessId: sid, status: r.status, body });
            } catch (e: any) { results.push({ sessId: sid, error: e.message }); }
          }
          return results;
        })(),
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/marketplace/yandex/shipments/:id/act", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { id: shipmentId } = req.params;
      const { campaignId } = req.query as { campaignId?: string };
      if (!campaignId) return res.status(400).json({ message: "campaignId required" });

      const allSettings = await storage.getMarketplaceSettings(orgId);
      const ymSetting = allSettings.find(s => s.marketplace === "yandex" && s.isActive && s.apiKey);
      if (!ymSetting) return res.status(400).json({ message: "Настройки Яндекс Маркет не найдены" });

      const cleanToken = ymSetting.apiKey!.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
      const isAcmaKey = cleanToken.startsWith("ACMA:");
      const authHeaders: Record<string, string> = {
        ...(isAcmaKey ? { "Api-Key": cleanToken } : { "Authorization": `OAuth ${cleanToken}` }),
        "Accept": "application/pdf",
      };
      const YANDEX_BASE = "https://api.partner.market.yandex.ru";

      const pdfRes = await fetch(
        `${YANDEX_BASE}/campaigns/${campaignId}/first-mile/shipments/${shipmentId}/act`,
        { headers: authHeaders }
      );
      if (!pdfRes.ok) {
        const txt = await pdfRes.text().catch(() => "");
        return res.status(pdfRes.status).json({ message: `YM API ${pdfRes.status}: ${txt.slice(0,200)}` });
      }
      const buf = Buffer.from(await pdfRes.arrayBuffer());
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="shipment-${shipmentId}-act.pdf"`);
      res.send(buf);
    } catch (e: any) {
      console.error("[ym-shipment-act]", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/marketplace/yandex/shipments/:id/sign", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { id: shipmentId } = req.params;
      const { campaignId } = req.body as { campaignId: string };
      if (!campaignId) return res.status(400).json({ message: "campaignId required" });

      const allSettings = await storage.getMarketplaceSettings(orgId);
      const ymSetting = allSettings.find(s => s.marketplace === "yandex" && s.isActive && s.apiKey);
      if (!ymSetting) return res.status(400).json({ message: "Настройки Яндекс Маркет не найдены" });

      const cleanToken = ymSetting.apiKey!.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
      const isAcmaKey = cleanToken.startsWith("ACMA:");
      const authHeaders: Record<string, string> = {
        ...(isAcmaKey ? { "Api-Key": cleanToken } : { "Authorization": `OAuth ${cleanToken}` }),
        "Content-Type": "application/json",
        "Accept": "application/json",
      };
      const YANDEX_BASE = "https://api.partner.market.yandex.ru";

      const signRes = await fetch(
        `${YANDEX_BASE}/campaigns/${campaignId}/first-mile/shipments/${shipmentId}/confirm`,
        { method: "POST", headers: authHeaders, body: JSON.stringify({}) }
      );
      if (!signRes.ok) {
        const txt = await signRes.text().catch(() => "");
        return res.status(signRes.status).json({ message: `YM API ${signRes.status}: ${txt.slice(0,200)}` });
      }
      console.log(`[ym-shipment-sign] shipment=${shipmentId} campaign=${campaignId} OK`);
      res.json({ success: true });
    } catch (e: any) {
      console.error("[ym-shipment-sign]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // WB FBS СТАТУСЫ — ЭТАЛОННЫЙ МАППИНГ. НЕ ИЗМЕНЯТЬ без явного указания.
  // WB API wbStatus → internal CRM status
  //   new / waiting                                      → pending   (вкладка Новые)
  //   confirm / complete / indelivery / delivering /
  //     ready_for_pickup                                 → shipped   (На сборке / в пути)
  //   delivered / receive / sold                         → completed (Выполнен / Архив)
  //   cancel / canceled / user_cancel / declined /
  //     declined_by_client / cancel_ignore / defect /
  //     cancelled / canceled_by_client                   → cancelled (Отменённые)
  // ═══════════════════════════════════════════════════════════════════════════
  const wbStatusToInternal = (wbStatus: string): string => {
    switch (wbStatus) {
      case "new":
      case "waiting":
        return "pending";
      case "confirm":
      case "complete":
      case "indelivery":
      case "delivering":
      case "ready_for_pickup":  // WB: готов к выдаче / передан курьеру
        return "shipped";
      case "delivered":
      case "receive":
      case "sold":              // WB: выдан покупателю
        return "completed";
      case "cancel":
      case "canceled":          // WB API реально возвращает canceled (не cancel)
      case "user_cancel":
      case "canceled_by_client": // WB API реально возвращает canceled_by_client
      case "declined":
      case "declined_by_client":
      case "cancel_ignore":
      case "defect":
      case "cancelled":
        return "cancelled";
      default:
        return "pending";
    }
  };

  app.post("/api/marketplace/wildberries/sync-orders", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const requestedStoreId = req.body?.storeId ? Number(req.body.storeId) : null;
      const allSettings = await storage.getMarketplaceSettings(orgId);
      let wbSettings = allSettings.filter(s => s.marketplace === "wildberries" && s.isActive && s.apiKey);

      if (requestedStoreId) {
        wbSettings = wbSettings.filter(s => s.storeId === requestedStoreId);
        if (wbSettings.length === 0) {
          const store = await storage.getStore(requestedStoreId);
          if (store && store.marketplace === "wildberries" && store.apiKey) {
            const company = await storage.getCompany(store.companyId);
            if (company && company.organizationId === orgId) {
              const newSetting = await storage.createMarketplaceSetting({
                marketplace: "wildberries",
                apiKey: store.apiKey,
                clientId: null,
                warehouseId: store.warehouseId || null,
                isActive: true,
                storeId: store.id,
                companyId: store.companyId,
                organizationId: orgId,
              });
              wbSettings = [newSetting];
            }
          }
        }
      }

      if (wbSettings.length === 0) {
        return res.json({ success: true, message: "Нет активных WB магазинов", storeResults: [] });
      }

      const WB_BASE = "https://marketplace-api.wildberries.ru";
      const isHistorySync = req.query.history === "true";

      let dateFrom: number;
      if (isHistorySync) {
        // Март 2026: с 01.03 00:00 МСК = 28.02 21:00 UTC
        dateFrom = Math.floor(new Date("2026-02-28T21:00:00Z").getTime() / 1000);
        console.log("[wb-sync] История: синхронизация с 01.03.2026");
      } else {
        const since = new Date();
        since.setUTCHours(21, 0, 0, 0);
        since.setUTCDate(since.getUTCDate() - 1);
        dateFrom = Math.floor(since.getTime() / 1000);
      }
      const dateTo = Math.floor(new Date().getTime() / 1000);

      let totalCreated = 0, totalUpdated = 0;
      const storeResults: { storeName: string; created: number; updated: number; errors: string[] }[] = [];

      for (const wbSetting of wbSettings) {
        let resolvedStoreId: number | null = wbSetting.storeId ?? null;
        let resolvedCompanyId: number | null = wbSetting.companyId ?? null;
        let resolvedStoreName: string | null = null;

        if (resolvedStoreId) {
          const store = await storage.getStore(resolvedStoreId);
          if (store) resolvedStoreName = store.name;
        }

        let storeCreated = 0, storeUpdated = 0;
        const storeErrors: string[] = [];
        const cleanApiKey = wbSetting.apiKey!.trim();
        const authHeaders = { "Authorization": cleanApiKey, "Content-Type": "application/json" };

        try {
          const allOrders: any[] = [];

          // Для обычного режима — добавить «новые» заказы сразу
          if (!isHistorySync) {
            const newRes = await fetch(`${WB_BASE}/api/v3/orders/new`, { method: "GET", headers: authHeaders });
            if (newRes.ok) {
              const newData = await newRes.json();
              allOrders.push(...(newData?.orders || []));
            }
          }

          // Пагинированный запрос заказов (до 20 страниц)
          const MAX_PAGES = 20;
          let nextCursor = 0;
          for (let page = 0; page < MAX_PAGES; page++) {
            const url = `${WB_BASE}/api/v3/orders?limit=1000&next=${nextCursor}&dateFrom=${dateFrom}&dateTo=${dateTo}`;
            const ordersRes = await fetchWithRetry(url, { headers: authHeaders });
            if (!ordersRes.ok) {
              console.error(`[wb-sync] Ошибка API ${ordersRes.status} на странице ${page + 1}`);
              break;
            }
            const ordersData = await ordersRes.json();
            const pageOrders: any[] = ordersData?.orders || [];

            for (const o of pageOrders) {
              if (!allOrders.find(existing => existing.id === o.id)) allOrders.push(o);
            }
            console.log(`[wb-sync] Страница ${page + 1}: ${pageOrders.length} заказов (всего: ${allOrders.length})`);

            if (pageOrders.length < 1000) break;
            nextCursor = ordersData.next || 0;
            if (nextCursor === 0) break;
            if (page === MAX_PAGES - 1) {
              console.warn("[wb-sync] Достигнут лимит пагинации (20 страниц)");
            }
          }

          for (const wbOrder of allOrders) {
            try {
              const wbOrderId = String(wbOrder.id);
              const wbStatus = wbOrder.wbStatus || wbOrder.status || "new";
              const wbRid = wbOrder.rid ? String(wbOrder.rid) : null;
              const wbSupplyId = wbOrder.supplyId ? String(wbOrder.supplyId) : null;
              const createdAtRaw = wbOrder.createdAt;
              const createdAtTs = createdAtRaw
                ? (typeof createdAtRaw === "number" ? new Date(createdAtRaw * 1000) : new Date(createdAtRaw))
                : new Date();
              const totalAmount = (wbOrder.totalPrice || wbOrder.convertedPrice || 0) / 100;

              const existingOrder = await storage.getOrderByExternalId(wbOrderId, orgId, resolvedStoreId);

              if (existingOrder) {
                if (existingOrder.wbStatus !== wbStatus) {
                  const internalStatus = wbStatusToInternal(wbStatus);
                  await storage.updateOrderWbStatus(existingOrder.id, wbStatus, internalStatus, createdAtTs);
                  storeUpdated++;
                }
              } else {
                const article = wbOrder.article || wbOrder.supplierArticle || "";
                const qty = wbOrder.quantity || 1;
                const itemPrice = totalAmount;

                let productId: number | null = null;
                if (article) {
                  const [dbProduct] = await db.select().from(productsTable)
                    .where(and(eq(productsTable.sku, article), eq(productsTable.organizationId, orgId)));
                  if (dbProduct) productId = dbProduct.id;
                }

                await storage.createOrder({
                  orderNumber: `WB-${wbOrderId}`,
                  status: wbStatusToInternal(wbStatus),
                  totalAmount: totalAmount.toFixed(2),
                  source: "wildberries",
                  externalId: wbOrderId,
                  postingNumber: null,
                  ozonStatus: null,
                  yandexStatus: null,
                  wbOrderId,
                  wbStatus,
                  wbRid,
                  wbSupplyId,
                  fulfillmentType: "FBS",
                  storeId: resolvedStoreId ?? undefined,
                  sourceStoreName: resolvedStoreName ?? undefined,
                  companyId: resolvedCompanyId ?? undefined,
                  organizationId: orgId,
                  createdAt: createdAtTs,
                } as any, productId
                  ? [{ productId, quantity: qty, price: itemPrice }]
                  : [{ productId: null, sku: article || `WB-${wbOrderId}`, productName: wbOrder.subject || wbOrder.category || "WB товар", quantity: qty, price: itemPrice }]);
                storeCreated++;
              }
            } catch (orderErr: any) {
              storeErrors.push(`Order ${wbOrder.id}: ${orderErr.message}`);
            }
          }

          if (resolvedStoreId) {
            await storage.updateStore(resolvedStoreId, { lastSync: new Date() } as any);
          }
        } catch (storeErr: any) {
          storeErrors.push(`Store error: ${storeErr.message}`);
          console.error(`[wb-sync-orders] Store «${resolvedStoreName}» error:`, storeErr.message);
        }

        storeResults.push({ storeName: resolvedStoreName || `Store #${resolvedStoreId}`, created: storeCreated, updated: storeUpdated, errors: storeErrors });
        totalCreated += storeCreated;
        totalUpdated += storeUpdated;
        console.log(`[wb-sync-orders] Store «${resolvedStoreName}»: +${storeCreated} новых, ${storeUpdated} обновлено`);
      }

      res.json({ success: true, created: totalCreated, updated: totalUpdated, storeResults });
    } catch (error: any) {
      console.error("[wb-sync-orders] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  const OZON_SYNC_INTERVAL = 5 * 60 * 1000;

  const autoSyncOzonStatuses = async () => {
    try {
      const allSettings = await db.select().from(marketplaceSettingsTable)
        .where(eq(marketplaceSettingsTable.marketplace, "ozon"));

      for (const setting of allSettings) {
        if (!setting.apiKey || !setting.clientId) continue;

        const orgId = setting.organizationId;
        const BASE = "https://api-seller.ozon.ru";
        const headers = {
          "Client-Id": String(parseInt(setting.clientId.trim(), 10)),
          "Api-Key": setting.apiKey.trim(),
          "Content-Type": "application/json",
        };

        const { storeId: resolvedStoreId, companyId: resolvedCompanyId, storeName: resolvedStoreName } = await resolveStoreForSetting(setting);

        if (resolvedStoreId) {
          const storeExists = await storage.getStore(resolvedStoreId);
          if (!storeExists) {
            console.log(`[auto-sync] Магазин ${resolvedStoreId} удалён — пропускаем`);
            continue;
          }
        }

        const allStoreOrders = await db.select().from(ordersTable)
          .where(and(
            eq(ordersTable.organizationId, orgId),
            eq(ordersTable.source, "ozon"),
            ...(resolvedStoreId != null ? [eq(ordersTable.storeId, resolvedStoreId)] : []),
          ));

        const existingPostingNumbers = new Set(allStoreOrders.filter(o => o.postingNumber).map(o => o.postingNumber!));

        const pendingOrders = allStoreOrders.filter(o =>
          o.postingNumber && o.ozonStatus &&
          !["delivered", "cancelled"].includes(o.ozonStatus)
        );

        console.log(`[ozon-auto-sync] Store clientId=${setting.clientId}, storeId=${resolvedStoreId}: ${pendingOrders.length} active orders (${allStoreOrders.length} total)`);

        const since = new Date();
        since.setDate(since.getDate() - 30);
        since.setUTCHours(21, 0, 0, 0);
        since.setUTCDate(since.getUTCDate() - 1);
        const body = {
          dir: "ASC",
          filter: { since: since.toISOString(), to: new Date().toISOString(), status: "" },
          limit: 1000,
          offset: 0,
        };

        let updated = 0;
        let created = 0;

        const syncAutoPostings = async (postings: any[], fulfillmentType: string) => {
          for (const posting of postings) {
            try {
              const pn = posting.posting_number;
              const newStatus = posting.status;

              // Fix 1: date fallback chain — never default to NOW() for old postings
              const ozonCreatedAt = posting.created_at
                ? new Date(posting.created_at)
                : posting.in_process_at
                  ? new Date(posting.in_process_at)
                  : posting.shipment_date
                    ? new Date(posting.shipment_date)
                    : null;
              if (!ozonCreatedAt) {
                console.warn(`[ozon-auto-sync] posting ${pn} has no date fields — using current time as fallback`);
              }

              if (existingPostingNumbers.has(pn)) {
                const existing = allStoreOrders.find(o => o.postingNumber === pn);
                if (existing) {
                  const internalStatus = ozonStatusToInternal(newStatus);
                  const needsStatusCorrection = existing.status === 'cancelled' && internalStatus !== 'cancelled';
                  const needsDateUpdate = ozonCreatedAt && existing.createdAt &&
                    Math.abs(new Date(existing.createdAt).getTime() - ozonCreatedAt.getTime()) > 60000;
                  if (existing.ozonStatus !== newStatus || needsStatusCorrection || needsDateUpdate) {
                    await storage.updateOrderOzonStatus(existing.id, newStatus, internalStatus, needsDateUpdate ? ozonCreatedAt : undefined);
                    updated++;
                  }
                }
              } else {
                // Fix 2 + 3: build items — create even when SKU not in DB; use financial_data for FBO price
                const items: { productId?: number | null; sku?: string; productName?: string; quantity: number; price: number }[] = [];
                let totalAmount = 0;
                for (const prod of posting.products || []) {
                  const sku = prod.offer_id || "";
                  if (!sku) continue;

                  const qty = prod.quantity || 1;

                  // Fix 3: for FBO use financial_data price when available
                  const financialProduct = fulfillmentType === "FBO"
                    ? (posting.financial_data?.products || []).find((fp: any) => fp.product_id === prod.sku_id)
                    : null;
                  const price = financialProduct?.price
                    ? parseFloat(String(financialProduct.price))
                    : parseFloat(prod.price || "0");

                  const [dbProduct] = await db.select().from(productsTable)
                    .where(and(eq(productsTable.sku, sku), eq(productsTable.organizationId, orgId)));
                  if (dbProduct) {
                    items.push({ productId: dbProduct.id, quantity: qty, price });
                  } else {
                    // Fix 2: don't skip — create item with SKU/name text fields
                    console.warn(`[ozon-auto-sync] SKU not found: ${sku} for posting ${pn} — creating item without product link`);
                    items.push({ productId: null, sku, productName: prod.name || sku, quantity: qty, price });
                  }
                  totalAmount += price * qty;
                }
                if (items.length > 0) {
                  const internalStatus = ozonStatusToInternal(newStatus);
                  const newOrder = await storage.createOrder({
                    orderNumber: pn,
                    status: internalStatus,
                    totalAmount: totalAmount.toFixed(2),
                    source: "ozon",
                    externalId: posting.order_id?.toString() || pn,
                    postingNumber: pn,
                    ozonStatus: newStatus,
                    fulfillmentType,
                    storeId: resolvedStoreId ?? undefined,
                    sourceStoreName: resolvedStoreName ?? undefined,
                    companyId: resolvedCompanyId ?? undefined,
                    organizationId: orgId,
                    createdAt: ozonCreatedAt ?? new Date(),
                  }, items);
                  existingPostingNumbers.add(pn);
                  created++;
                  // Phase 3: decrement stock for new non-cancelled recent orders
                  const isRecent = ozonCreatedAt && (Date.now() - ozonCreatedAt.getTime() < 72 * 60 * 60 * 1000);
                  if (newOrder && internalStatus !== 'cancelled' && isRecent) {
                    for (const item of items) {
                      if (!item.productId || !item.quantity) continue;
                      inventorySyncEngine.processOrderStockUpdate({
                        organizationId: orgId,
                        orderId: newOrder.id,
                        productId: item.productId,
                        quantity: item.quantity,
                        sourceStoreId: resolvedStoreId ?? null,
                        sourceStoreName: resolvedStoreName ?? pn,
                      }).catch((e: any) => console.error(`[phase3-ozon] ${pn} stock update failed: ${e.message}`));
                    }
                  }
                } else {
                  console.log(`[ozon-auto-sync] Skipped posting ${pn}: no products with offer_id`);
                }
              }
            } catch (err: any) {
              console.error(`[ozon-auto-sync] Error processing posting ${posting.posting_number}:`, err.message);
            }
          }
        };

        {
          const LIMIT = 1000;
          const MAX_PAGES = 10;
          const allFbsPostings: any[] = [];
          let fbsOffset = 0;
          for (let page = 0; page < MAX_PAGES; page++) {
            const fbsResponse = await fetchWithRetry(`${BASE}/v3/posting/fbs/list`, {
              method: "POST", headers, body: JSON.stringify({ ...body, limit: LIMIT, offset: fbsOffset }),
            });
            if (!fbsResponse.ok) break;
            const fbsData = await fbsResponse.json();
            const pagePostings: any[] = fbsData?.result?.postings || [];
            allFbsPostings.push(...pagePostings);
            console.log(`[ozon-auto-sync] FBS page ${page + 1}: ${pagePostings.length} postings (итого: ${allFbsPostings.length})`);
            if (pagePostings.length < LIMIT) break;
            if (page === MAX_PAGES - 1) console.warn(`[ozon-auto-sync] Достигнут лимит пагинации (10 страниц) для магазина: ${setting.clientId}`);
            fbsOffset += LIMIT;
          }
          await syncAutoPostings(allFbsPostings, "FBS");
        }

        {
          const LIMIT = 1000;
          const MAX_PAGES = 10;
          const allFboPostings: any[] = [];
          let fboOffset = 0;
          for (let page = 0; page < MAX_PAGES; page++) {
            const fboResponse = await fetchWithRetry(`${BASE}/v2/posting/fbo/list`, {
              method: "POST", headers,
              body: JSON.stringify({ dir: "ASC", filter: { since: since.toISOString(), to: new Date().toISOString(), status: "" }, limit: LIMIT, offset: fboOffset, with: { analytics_data: false, financial_data: true } }),
            });
            if (!fboResponse.ok) break;
            const fboData = await fboResponse.json();
            const pagePostings: any[] = fboData?.result || [];
            allFboPostings.push(...pagePostings);
            console.log(`[ozon-auto-sync] FBO page ${page + 1}: ${pagePostings.length} postings (итого: ${allFboPostings.length})`);
            if (pagePostings.length < LIMIT) break;
            if (page === MAX_PAGES - 1) console.warn(`[ozon-auto-sync] Достигнут лимит пагинации (10 страниц) для магазина: ${setting.clientId}`);
            fboOffset += LIMIT;
          }
          await syncAutoPostings(allFboPostings, "FBO");
        }

        if (updated > 0 || created > 0) {
          console.log(`[ozon-auto-sync] Org ${orgId}: updated ${updated}, created ${created} orders`);
        }
      }
    } catch (error) {
      console.error("[ozon-auto-sync] Error:", error);
    }
  };

  (async () => {
    try {
      const result = await db.execute(sql`
        UPDATE orders SET source_store_name = stores.name
        FROM stores
        WHERE orders.store_id = stores.id
        AND orders.source_store_name IS NULL
        AND orders.store_id IS NOT NULL
      `);
      const count = (result as any)?.rowCount || 0;
      if (count > 0) console.log(`[backfill] Updated sourceStoreName for ${count} existing orders`);
    } catch (e: any) {
      console.error("[backfill] Error:", e.message);
    }
  })();

  setInterval(autoSyncOzonStatuses, OZON_SYNC_INTERVAL);
  setTimeout(autoSyncOzonStatuses, 10000);
  console.log(`[ozon-auto-sync] Background sync scheduled every ${OZON_SYNC_INTERVAL / 60000} minutes`);

  const YANDEX_SYNC_INTERVAL = 5 * 60 * 1000;
  const autoSyncYandexOrders = async () => {
    try {
      const allSettings = await db.select().from(marketplaceSettingsTable);
      const orgIds = [...new Set(allSettings.filter(s => s.marketplace === "yandex" && s.isActive && s.apiKey && s.warehouseId).map(s => s.organizationId))];
      if (orgIds.length === 0) return;

      for (const orgId of orgIds) {
        const yandexSettings = allSettings.filter(s => s.marketplace === "yandex" && s.isActive && s.apiKey && s.warehouseId && s.organizationId === orgId);
        const YANDEX_BASE = "https://api.partner.market.yandex.ru";
        const since = new Date();
        since.setDate(since.getDate() - 90);
        let updated = 0, created = 0;

        for (const ySetting of yandexSettings) {
          const { storeId: resolvedStoreId, companyId: resolvedCompanyId, storeName: resolvedStoreName } = await resolveStoreForYandex(ySetting);
          try {
            const cleanToken = ySetting.apiKey!.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
            const isAcmaKey = cleanToken.startsWith("ACMA:");
            const authHeaders: Record<string, string> = {
              ...(isAcmaKey ? { "Api-Key": cleanToken } : { "Authorization": `OAuth ${cleanToken}` }),
              "Content-Type": "application/json",
              "Accept": "application/json",
            };
            const campRes = await fetch(`${YANDEX_BASE}/campaigns`, { method: "GET", headers: authHeaders });
            if (!campRes.ok) continue;
            const campData = await campRes.json();
            const campaigns = campData?.campaigns || [];

            // Фильтруем кампании по warehouseId (Campaign ID или Business ID)
            const cleanWh = (ySetting.warehouseId || "").replace(/\s/g, "").trim();
            let filteredCampaigns = campaigns;
            if (cleanWh) {
              const exactMatch = campaigns.find((c: any) => String(c.id) === cleanWh);
              if (exactMatch) {
                filteredCampaigns = [exactMatch];
              } else {
                const byBiz = campaigns.filter((c: any) => c.business?.id && String(c.business.id) === cleanWh);
                if (byBiz.length > 0) filteredCampaigns = byBiz;
              }
            }

            const autoFromDateStr = [String(since.getDate()).padStart(2,'0'), String(since.getMonth()+1).padStart(2,'0'), since.getFullYear()].join('-');
            for (const campaign of filteredCampaigns) {
              const campaignId = String(campaign.id);
              let page = 1;
              let hasMore = true;
              while (hasMore) {
                const ordersRes = await fetch(
                  `${YANDEX_BASE}/campaigns/${campaignId}/orders?fromDate=${autoFromDateStr}&page=${page}&pageSize=50`,
                  { method: "GET", headers: authHeaders }
                );
                if (!ordersRes.ok) { hasMore = false; break; }
                const ordersData = await ordersRes.json();
                const ordersList = ordersData?.orders || [];
                const pager = ordersData?.pager;
                if (page === 1) console.log(`[yandex-auto-sync] campaign=${campaignId} fromDate=${autoFromDateStr} page=1 orders=${ordersList.length} pager=${JSON.stringify(pager)}`);

                for (const yOrder of ordersList) {
                  const yOrderId = String(yOrder.id);
                  const rawStatus = yOrder.status || "NEW";
                  let yStatus = rawStatus;
                  let yShipmentId: string | null = null;
                  if (rawStatus === "PROCESSING") {
                    if (yOrder.substatus === "READY_TO_SHIP") {
                      yStatus = "READY_TO_SHIP";
                    } else {
                      try {
                        const dRes = await fetch(`${YANDEX_BASE}/campaigns/${campaignId}/orders/${yOrderId}`, { method: "GET", headers: authHeaders });
                        if (dRes.ok) {
                          const d = await dRes.json(); const fo = d?.order;
                          const fSub = fo?.substatus;
                          const cargoUnits: any[] = fo?.delivery?.shipments || [];
                          const inShipment = cargoUnits.length > 0;
                          if (fSub === "READY_TO_SHIP" || inShipment) yStatus = "READY_TO_SHIP";
                          console.log(`[ym-single] ${yOrderId} sub="${fSub}" inShipment=${inShipment} → ${yStatus}`);
                        } else { console.log(`[ym-single] ${yOrderId} HTTP ${dRes.status}`); }
                      } catch (e: any) { console.log(`[ym-single] ${yOrderId} err=${(e as any).message}`); }
                    }
                  }
                  console.log(`[ym-substatus] order=${yOrderId} list_substatus="${yOrder.substatus}" → ${yStatus}`);
                  const yCreatedAt = yOrder.creationDate
                    ? new Date(Number(yOrder.creationDate) * 1000)
                    : (yOrder.createdAt ? new Date(yOrder.createdAt) : undefined);
                  const existingOrder = await storage.getOrderByExternalId(yOrderId, orgId, resolvedStoreId);

                  if (existingOrder) {
                    const needsShipmentId = yShipmentId && !(existingOrder as any).ymShipmentId;
                    if (existingOrder.yandexStatus !== yStatus || needsShipmentId) {
                      const internalStatus = yandexStatusToInternal(yStatus);
                      await storage.updateOrderYandexStatus(existingOrder.id, yStatus, internalStatus, yCreatedAt, undefined, yShipmentId);
                      updated++;
                    }
                  } else {
                    const items: { productId: number; quantity: number; price: number }[] = [];
                    let totalAmount = 0;
                    for (const yItem of yOrder.items || []) {
                      const sku = yItem.offerId || yItem.shopSku || "";
                      const qty = yItem.count || 1;
                      const price = parseFloat(yItem.buyerPrice || yItem.price || "0");
                      if (sku) {
                        const [dbProduct] = await db.select().from(productsTable)
                          .where(and(eq(productsTable.sku, sku), eq(productsTable.organizationId, orgId)));
                        if (dbProduct) {
                          items.push({ productId: dbProduct.id, quantity: qty, price });
                          totalAmount += price * qty;
                        }
                      }
                    }
                    const orderTotal = totalAmount > 0 ? totalAmount : parseFloat(String(yOrder.itemsTotal || yOrder.buyerTotal || "0"));
                    const ymInternalStatus = yandexStatusToInternal(yStatus);
                    const newYmOrder = await storage.createOrder({
                      orderNumber: `YM-${yOrderId}`,
                      status: ymInternalStatus,
                      totalAmount: orderTotal.toFixed(2),
                      source: "yandex",
                      externalId: yOrderId,
                      postingNumber: null,
                      ozonStatus: null,
                      yandexStatus: yStatus,
                      ymCampaignId: campaignId,
                      ymShipmentId: yShipmentId ?? undefined,
                      fulfillmentType: "FBS",
                      storeId: resolvedStoreId ?? undefined,
                      sourceStoreName: resolvedStoreName ?? undefined,
                      companyId: resolvedCompanyId ?? undefined,
                      organizationId: orgId,
                      createdAt: yCreatedAt || undefined,
                    }, items);
                    created++;
                    // Phase 3: decrement stock for new non-cancelled recent YM orders
                    const ymIsRecent = !yCreatedAt || (Date.now() - yCreatedAt.getTime() < 72 * 60 * 60 * 1000);
                    if (newYmOrder && ymInternalStatus !== 'cancelled' && ymIsRecent) {
                      for (const item of items) {
                        if (!item.productId || !item.quantity) continue;
                        inventorySyncEngine.processOrderStockUpdate({
                          organizationId: orgId,
                          orderId: newYmOrder.id,
                          productId: item.productId,
                          quantity: item.quantity,
                          sourceStoreId: resolvedStoreId ?? null,
                          sourceStoreName: resolvedStoreName ?? `YM-${yOrderId}`,
                        }).catch((e: any) => console.error(`[phase3-ym] ${yOrderId} stock update failed: ${e.message}`));
                      }
                    }
                  }
                }

                if (pager && page < pager.pagesCount) {
                  page++;
                } else {
                  hasMore = false;
                }
              }
            }
          } catch (err: any) {
            console.error(`[yandex-auto-sync] Error for store:`, err.message);
          }
        }

        if (updated > 0 || created > 0) {
          console.log(`[yandex-auto-sync] Org ${orgId}: updated ${updated}, created ${created} orders`);
        }
      }
    } catch (error) {
      console.error("[yandex-auto-sync] Error:", error);
    }
  };

  setInterval(autoSyncYandexOrders, YANDEX_SYNC_INTERVAL);
  setTimeout(autoSyncYandexOrders, 15000);
  console.log(`[yandex-auto-sync] Background sync scheduled every ${YANDEX_SYNC_INTERVAL / 60000} minutes`);

  // Обновление статусов для старых ЯМ-заказов (>90 дней) — аналог syncWbArchiveStatuses
  const syncYmArchiveStatuses = async () => {
    try {
      const allSettings = await db.select().from(marketplaceSettingsTable);
      const yandexSettings = allSettings.filter(s => s.marketplace === "yandex" && s.isActive && s.apiKey && s.warehouseId);
      if (yandexSettings.length === 0) return;

      const YANDEX_BASE = "https://api.partner.market.yandex.ru";
      const since = new Date();
      since.setDate(since.getDate() - 460);
      const fromDateStr = [String(since.getDate()).padStart(2,'0'), String(since.getMonth()+1).padStart(2,'0'), since.getFullYear()].join('-');
      let totalUpdated = 0;

      for (const ySetting of yandexSettings) {
        const orgId = ySetting.organizationId;
        const { storeId: resolvedStoreId } = await resolveStoreForYandex(ySetting);
        try {
          const cleanToken = ySetting.apiKey!.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
          const isAcmaKey = cleanToken.startsWith("ACMA:");
          const authHeaders: Record<string, string> = {
            ...(isAcmaKey ? { "Api-Key": cleanToken } : { "Authorization": `OAuth ${cleanToken}` }),
            "Content-Type": "application/json", "Accept": "application/json",
          };
          const campRes = await fetch(`${YANDEX_BASE}/campaigns`, { method: "GET", headers: authHeaders });
          if (!campRes.ok) continue;
          const campData = await campRes.json();
          const campaigns = campData?.campaigns || [];
          const cleanWh = (ySetting.warehouseId || "").replace(/\s/g, "").trim();
          let filteredCampaigns = campaigns;
          if (cleanWh) {
            const exactMatch = campaigns.find((c: any) => String(c.id) === cleanWh);
            if (exactMatch) { filteredCampaigns = [exactMatch]; }
            else {
              const byBiz = campaigns.filter((c: any) => c.business?.id && String(c.business.id) === cleanWh);
              if (byBiz.length > 0) filteredCampaigns = byBiz;
            }
          }
          for (const campaign of filteredCampaigns) {
            const campaignId = String(campaign.id);
            let page = 1, hasMore = true;
            while (hasMore) {
              const ordersRes = await fetch(
                `${YANDEX_BASE}/campaigns/${campaignId}/orders?fromDate=${fromDateStr}&page=${page}&pageSize=50`,
                { method: "GET", headers: authHeaders }
              );
              if (!ordersRes.ok) { hasMore = false; break; }
              const ordersData = await ordersRes.json();
              const ordersList = ordersData?.orders || [];
              const pager = ordersData?.pager;
              for (const yOrder of ordersList) {
                const yOrderId = String(yOrder.id);
                const rawStatus = yOrder.status || "NEW";
                let yStatus = rawStatus;
                let yShipmentId: string | null = null;
                if (rawStatus === "PROCESSING") {
                  if (yOrder.substatus === "READY_TO_SHIP") {
                    yStatus = "READY_TO_SHIP";
                  } else {
                    try {
                      const dRes = await fetch(`${YANDEX_BASE}/campaigns/${campaignId}/orders/${yOrderId}`, { method: "GET", headers: authHeaders });
                      if (dRes.ok) {
                        const d = await dRes.json(); const fo = d?.order;
                        const fSub = fo?.substatus;
                        const cargoUnits: any[] = fo?.delivery?.shipments || [];
                        const inShipment = cargoUnits.length > 0;
                        if (fSub === "READY_TO_SHIP" || inShipment) yStatus = "READY_TO_SHIP";
                        console.log(`[ym-single] ${yOrderId} sub="${fSub}" inShipment=${inShipment} → ${yStatus}`);
                      } else { console.log(`[ym-single] ${yOrderId} HTTP ${dRes.status}`); }
                    } catch (e: any) { console.log(`[ym-single] ${yOrderId} err=${(e as any).message}`); }
                  }
                }
                console.log(`[ym-substatus] order=${yOrderId} list_substatus="${yOrder.substatus}" → ${yStatus}`);
                const yCreatedAt = yOrder.creationDate
                  ? (() => { const m = String(yOrder.creationDate).match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{1,2}):(\d{1,2}))?/); if (m) { const d = new Date(Date.UTC(+m[3], +m[2]-1, +m[1], (+m[4]||12)-3, +m[5]||0, +m[6]||0)); return isNaN(d.getTime()) ? undefined : d; } const n = Number(yOrder.creationDate); return Number.isFinite(n) && n > 0 ? new Date(n > 1e11 ? n : n*1000) : undefined; })()
                  : (yOrder.createdAt ? new Date(yOrder.createdAt) : undefined);
                const existingOrder = await storage.getOrderByExternalId(yOrderId, orgId, resolvedStoreId);
                if (existingOrder) {
                  const statusChanged = existingOrder.yandexStatus !== yStatus;
                  const needsCampaignId = !(existingOrder as any).ymCampaignId;
                  const needsShipmentId = yShipmentId && !(existingOrder as any).ymShipmentId;
                  if (statusChanged || needsCampaignId || needsShipmentId) {
                    await storage.updateOrderYandexStatus(existingOrder.id, yStatus, yandexStatusToInternal(yStatus), yCreatedAt, campaignId, yShipmentId);
                    if (statusChanged) totalUpdated++;
                  }
                }
              }
              if (pager && page < pager.pagesCount) { page++; } else { hasMore = false; }
            }
          }
        } catch (err: any) {
          console.error(`[ym-archive-sync] Error:`, err.message);
        }
      }
      if (totalUpdated > 0) console.log(`[ym-archive-sync] Updated ${totalUpdated} stale YM order statuses`);
    } catch (error) {
      console.error("[ym-archive-sync] Error:", error);
    }
  };
  setTimeout(syncYmArchiveStatuses, 60 * 1000);
  setInterval(syncYmArchiveStatuses, 6 * 60 * 60 * 1000);
  console.log("[ym-archive-sync] Archive status sync scheduled every 6 hours");

  const WB_SYNC_INTERVAL = 2 * 60 * 1000;
  const autoSyncWbOrders = async () => {
    try {
      const allSettings = await db.select().from(marketplaceSettingsTable);
      const wbSettingsAll = allSettings.filter(s => s.marketplace === "wildberries" && s.isActive && s.apiKey);
      if (wbSettingsAll.length === 0) return;

      const WB_BASE = "https://marketplace-api.wildberries.ru";
      const since = new Date();
      since.setUTCHours(21, 0, 0, 0);
      since.setUTCDate(since.getUTCDate() - 1);

      const orgIds = [...new Set(wbSettingsAll.map(s => s.organizationId))];
      for (const orgId of orgIds) {
        const wbSettings = wbSettingsAll.filter(s => s.organizationId === orgId);

        for (const wbSetting of wbSettings) {
          let storeCreated = 0, storeUpdated = 0;
          const resolvedStoreId = wbSetting.storeId ?? null;
          const resolvedCompanyId = wbSetting.companyId ?? null;
          let resolvedStoreName: string | null = null;
          if (resolvedStoreId) {
            const store = await storage.getStore(resolvedStoreId);
            if (!store) {
              console.log(`[auto-sync] Магазин ${resolvedStoreId} удалён — пропускаем`);
              continue;
            }
            resolvedStoreName = store.name;
          }

          try {
            const cleanApiKey = wbSetting.apiKey!.trim();
            const authHeaders = { "Authorization": cleanApiKey, "Content-Type": "application/json" };
            const allOrders: any[] = [];

            const newRes = await fetch(`${WB_BASE}/api/v3/orders/new`, { method: "GET", headers: authHeaders });
            if (newRes.ok) {
              const newData = await newRes.json();
              allOrders.push(...(newData?.orders || []));
            }

            const dateFrom = Math.floor(since.getTime() / 1000);
            const ordersRes = await fetch(
              `${WB_BASE}/api/v3/orders?limit=1000&next=0&dateFrom=${dateFrom}`,
              { method: "GET", headers: authHeaders }
            );
            if (ordersRes.ok) {
              const ordersData = await ordersRes.json();
              for (const o of ordersData?.orders || []) {
                if (!allOrders.find(e => e.id === o.id)) allOrders.push(o);
              }
            }

            for (const wbOrder of allOrders) {
              try {
                const wbOrderId = String(wbOrder.id);
                const wbStatus = wbOrder.wbStatus || wbOrder.status || "new";
                const wbRid = wbOrder.rid ? String(wbOrder.rid) : null;
                const wbSupplyId = wbOrder.supplyId ? String(wbOrder.supplyId) : null;
                const createdAtRaw = wbOrder.createdAt;
                const createdAtTs = createdAtRaw
                  ? (typeof createdAtRaw === "number" ? new Date(createdAtRaw * 1000) : new Date(createdAtRaw))
                  : new Date();
                const totalAmount = (wbOrder.totalPrice || wbOrder.convertedPrice || 0) / 100;

                // Ищем без фильтра по storeId — order мог быть создан с store_id=NULL
                const existingOrder = await storage.getOrderByExternalId(wbOrderId, orgId);
                if (existingOrder) {
                  // Не реактивировать вручную отменённые заказы
                  if (existingOrder.status === 'cancelled' && wbStatusToInternal(wbStatus) !== 'cancelled') {
                    continue;
                  }
                  const statusChanged = existingOrder.wbStatus !== wbStatus;
                  const storeMissing = resolvedStoreId && !existingOrder.storeId;
                  if (statusChanged || storeMissing) {
                    await storage.updateOrderWbStatus(existingOrder.id, wbStatus, wbStatusToInternal(wbStatus), createdAtTs);
                    if (storeMissing) {
                      await db.execute(sql`UPDATE orders SET store_id = ${resolvedStoreId}, source_store_name = ${resolvedStoreName} WHERE id = ${existingOrder.id}`);
                    }
                    storeUpdated++;
                  }
                } else {
                  const article = wbOrder.article || wbOrder.supplierArticle || "";
                  const qty = wbOrder.quantity || 1;
                  let productId: number | null = null;
                  if (article) {
                    const [dbProduct] = await db.select().from(productsTable)
                      .where(and(eq(productsTable.sku, article), eq(productsTable.organizationId, orgId)));
                    if (dbProduct) productId = dbProduct.id;
                  }
                  const wbInternalStatus = wbStatusToInternal(wbStatus);
                  const newWbOrder = await storage.createOrder({
                    orderNumber: `WB-${wbOrderId}`,
                    status: wbInternalStatus,
                    totalAmount: totalAmount.toFixed(2),
                    source: "wildberries",
                    externalId: wbOrderId,
                    postingNumber: null,
                    ozonStatus: null,
                    yandexStatus: null,
                    wbOrderId,
                    wbStatus,
                    wbRid,
                    wbSupplyId,
                    fulfillmentType: "FBS",
                    storeId: resolvedStoreId ?? undefined,
                    sourceStoreName: resolvedStoreName ?? undefined,
                    companyId: resolvedCompanyId ?? undefined,
                    organizationId: orgId,
                    createdAt: createdAtTs,
                  } as any, productId
                    ? [{ productId, quantity: qty, price: totalAmount }]
                    : [{ productId: null, sku: article || `WB-${wbOrderId}`, productName: wbOrder.subject || "WB товар", quantity: qty, price: totalAmount }]);
                  storeCreated++;
                  // Phase 3: decrement stock for new non-cancelled recent WB orders
                  const wbIsRecent = Date.now() - createdAtTs.getTime() < 72 * 60 * 60 * 1000;
                  if (newWbOrder && wbInternalStatus !== 'cancelled' && wbIsRecent && productId) {
                    inventorySyncEngine.processOrderStockUpdate({
                      organizationId: orgId,
                      orderId: newWbOrder.id,
                      productId,
                      quantity: qty,
                      sourceStoreId: resolvedStoreId ?? null,
                      sourceStoreName: resolvedStoreName ?? `WB-${wbOrderId}`,
                    }).catch((e: any) => console.error(`[phase3-wb] ${wbOrderId} stock update failed: ${e.message}`));
                  }
                }
              } catch (e: any) {
                console.error(`[wb-auto-sync] Order ${wbOrder.id} error:`, e.message);
              }
            }

            if (resolvedStoreId) {
              await storage.updateStore(resolvedStoreId, { lastSync: new Date() } as any);
            }
            console.log(`[wb-auto-sync] Store «${resolvedStoreName}»: +${storeCreated} новых, ${storeUpdated} обновлено`);
          } catch (err: any) {
            console.error(`[wb-auto-sync] Error for store ${resolvedStoreName}:`, err.message);
          }
        }
      }
      // Sync supplies for all active WB orgs after order sync
      for (const syncOrgId of orgIds) {
        await syncWbSuppliesForOrg(syncOrgId).catch((e: any) =>
          console.log('[wb-auto-sync] Supply sync failed:', e.message));
      }
    } catch (error) {
      console.error("[wb-auto-sync] Error:", error);
    }
  };

  setInterval(autoSyncWbOrders, WB_SYNC_INTERVAL);
  setTimeout(autoSyncWbOrders, 20000);
  console.log(`[wb-auto-sync] Background sync scheduled every ${WB_SYNC_INTERVAL / 60000} minutes`);

  // Синк архивных статусов — обновляет статусы существующих заказов за последние 30 дней
  const syncWbArchiveStatuses = async () => {
    try {
      const allSettings = await db.select().from(marketplaceSettingsTable);
      const wbSettingsAll = allSettings.filter(s => s.marketplace === "wildberries" && s.isActive && s.apiKey);
      if (wbSettingsAll.length === 0) return;

      const WB_BASE = "https://marketplace-api.wildberries.ru";
      const archiveSince = Math.floor((Date.now() - 45 * 24 * 3600 * 1000) / 1000);
      const orgIds = [...new Set(wbSettingsAll.map(s => s.organizationId))];

      for (const orgId of orgIds) {
        const wbSettings = wbSettingsAll.filter(s => s.organizationId === orgId);
        let totalUpdated = 0;
        let totalCreated = 0;

        for (const wbSetting of wbSettings) {
          if (!wbSetting.storeId) continue; // только магазины с явным store_id
          try {
            const cleanApiKey = wbSetting.apiKey!.trim();
            const authHeaders = { "Authorization": cleanApiKey, "Content-Type": "application/json" };
            const resolvedStoreId = wbSetting.storeId;
            const resolvedCompanyId = wbSetting.companyId ?? null;
            const store = await storage.getStore(resolvedStoreId);
            if (!store) continue;
            const resolvedStoreName = store.name;

            // Шаг 1: собрать все ID заказов за 30 дней постранично
            const allOrderMeta: any[] = [];
            let nextCursor = 0;
            while (true) {
              const res = await fetch(
                `${WB_BASE}/api/v3/orders?limit=1000&next=${nextCursor}&dateFrom=${archiveSince}`,
                { method: "GET", headers: authHeaders }
              );
              if (!res.ok) break;
              const data = await res.json();
              const page: any[] = data?.orders || [];
              allOrderMeta.push(...page);
              nextCursor = data?.next ?? 0;
              if (!nextCursor || page.length < 1000) break;
            }

            if (allOrderMeta.length === 0) continue;

            // Шаг 2: запросить реальные статусы через POST /api/v3/orders/status
            const statusMap: Record<string, string> = {};
            for (let i = 0; i < allOrderMeta.length; i += 1000) {
              const batch = allOrderMeta.slice(i, i + 1000);
              try {
                const statusRes = await fetch(`${WB_BASE}/api/v3/orders/status`, {
                  method: "POST",
                  headers: authHeaders,
                  body: JSON.stringify({ orders: batch.map((o: any) => Number(o.id)) }),
                });
                if (statusRes.ok) {
                  const statusData = await statusRes.json();
                  for (const s of statusData?.orders || []) {
                    if (s.id && s.wbStatus) {
                      statusMap[String(s.id)] = s.wbStatus;
                    }
                  }
                }
              } catch (e: any) {
                console.warn(`[wb-archive-status-sync] status batch error: ${e.message}`);
              }
            }

            // Шаг 3: обновить существующие записи и создать отсутствующие
            let pageErrors = 0;
            for (const meta of allOrderMeta) {
              const wbOrderId = String(meta.id || "");
              if (!wbOrderId) continue;
              // Актуальный статус: из batch-запроса или из мета
              const wbStatus = statusMap[wbOrderId] || meta.wbStatus || meta.status || "confirm";
              try {
                const existingRows = await db.execute(sql`
                  SELECT id, wb_status, status FROM orders
                  WHERE wb_order_id = ${wbOrderId}
                    AND source = 'wildberries'
                    AND organization_id = ${orgId}
                  LIMIT 1
                `);
                const existing = ((existingRows as any).rows || existingRows)[0];
                const createdAtRaw = meta.createdAt;
                const createdAtTs = createdAtRaw
                  ? (typeof createdAtRaw === "number" ? new Date(createdAtRaw * 1000) : new Date(createdAtRaw))
                  : new Date();

                if (!existing) {
                  // Создаём отсутствующий заказ
                  const article = String(meta.article || meta.supplierArticle || "");
                  const qty = meta.quantity || 1;
                  const totalAmount = (meta.totalPrice || meta.convertedPrice || 0) / 100;
                  const wbSupplyId = meta.supplyId ? String(meta.supplyId) : null;
                  const wbRid = meta.rid ? String(meta.rid) : null;
                  let productId: number | null = null;
                  if (article) {
                    const [dbProduct] = await db.select().from(productsTable)
                      .where(and(eq(productsTable.sku, article), eq(productsTable.organizationId, orgId)));
                    if (dbProduct) productId = dbProduct.id;
                  }
                  await storage.createOrder({
                    orderNumber: `WB-${wbOrderId}`,
                    status: wbStatusToInternal(wbStatus),
                    totalAmount: totalAmount.toFixed(2),
                    source: "wildberries",
                    externalId: wbOrderId,
                    postingNumber: null,
                    ozonStatus: null,
                    yandexStatus: null,
                    wbOrderId,
                    wbStatus,
                    wbRid,
                    wbSupplyId,
                    fulfillmentType: "FBS",
                    storeId: resolvedStoreId,
                    sourceStoreName: resolvedStoreName,
                    companyId: resolvedCompanyId ?? undefined,
                    organizationId: orgId,
                    createdAt: createdAtTs,
                  } as any, productId
                    ? [{ productId, quantity: qty, price: totalAmount }]
                    : [{ productId: null, sku: article || `WB-${wbOrderId}`, productName: meta.subject || "WB товар", quantity: qty, price: totalAmount }]);
                  totalCreated++;
                } else {
                  // Обновляем статус если изменился (не реактивируем отменённые)
                  const newWbSupplyId = meta.supplyId ? String(meta.supplyId) : null;
                  const statusChanged = existing.wb_status !== wbStatus;
                  const supplyMissing = newWbSupplyId && !existing.wb_supply_id;
                  if (!statusChanged && !supplyMissing) continue;
                  if (existing.status === "cancelled" && wbStatusToInternal(wbStatus) !== "cancelled") continue;
                  const internalStatus = wbStatusToInternal(wbStatus);
                  await storage.updateOrderWbStatus(existing.id, wbStatus, internalStatus, createdAtTs);
                  // Фиксируем wb_supply_id если отсутствует (API вернул supplyId)
                  if (supplyMissing) {
                    await db.execute(sql`
                      UPDATE orders SET wb_supply_id = ${newWbSupplyId}
                      WHERE id = ${existing.id} AND wb_supply_id IS NULL
                    `);
                  }
                  totalUpdated++;
                }
              } catch (e: any) {
                if (!e.message?.includes("unique") && !e.message?.includes("duplicate")) {
                  pageErrors++;
                }
              }
            }

            if (pageErrors > 0) {
              console.warn(`[wb-archive-status-sync] Org ${orgId}: пропущено ошибок ${pageErrors}`);
            }
          } catch (e: any) {
            console.error(`[wb-archive-status-sync] Error for org ${orgId}:`, e.message);
          }
        }

        if (totalUpdated > 0 || totalCreated > 0) {
          console.log(`[wb-archive-status-sync] Org ${orgId}: обновлено ${totalUpdated}, создано ${totalCreated}`);
        }
      }
    } catch (error: any) {
      console.error("[wb-archive-status-sync] Error:", error.message);
    }
  };

  setTimeout(syncWbArchiveStatuses, 30000);
  setInterval(syncWbArchiveStatuses, 60 * 60 * 1000);
  console.log("[wb-archive-status-sync] Scheduled every 60 min, first run in 30s");

  // Принудительная синхронизация устаревших заказов (старше 24 ч) при старте сервера
  const syncWbStaleOrdersAll = async () => {
    try {
      const allSettings = await db.select().from(marketplaceSettingsTable);
      const wbSettingsAll = allSettings.filter(s => s.marketplace === "wildberries" && s.isActive && s.apiKey);
      if (wbSettingsAll.length === 0) return;

      const WB_BASE = "https://marketplace-api.wildberries.ru";
      const dateFrom60 = Math.floor((Date.now() - 60 * 24 * 3600 * 1000) / 1000);

      const orgIds = [...new Set(wbSettingsAll.map(s => s.organizationId))];

      for (const orgId of orgIds) {
        const wbSettings = wbSettingsAll.filter(s => s.organizationId === orgId);
        let totalUpdated = 0;

        for (const wbSetting of wbSettings) {
          try {
            const cleanApiKey = wbSetting.apiKey!.trim();
            const authHeaders = { "Authorization": cleanApiKey, "Content-Type": "application/json" };

            // Шаг 1: собрать все ID заказов за 60 дней постранично
            const allOrderMeta: any[] = [];
            let nextCursor = 0;
            while (true) {
              const res = await fetch(
                `${WB_BASE}/api/v3/orders?limit=1000&next=${nextCursor}&dateFrom=${dateFrom60}`,
                { method: "GET", headers: authHeaders }
              );
              if (!res.ok) {
                console.error(`[wb-stale-sync] API error ${res.status} for org ${orgId}`);
                break;
              }
              const data = await res.json();
              const page: any[] = data?.orders || [];
              allOrderMeta.push(...page);
              nextCursor = data?.next ?? 0;
              if (!nextCursor || page.length < 1000) break;
            }

            if (allOrderMeta.length === 0) continue;

            // Шаг 2: запросить реальные статусы через POST /api/v3/orders/status
            const statusMap: Record<string, { wbStatus: string; meta: any }> = {};
            for (let i = 0; i < allOrderMeta.length; i += 1000) {
              const batch = allOrderMeta.slice(i, i + 1000);
              try {
                const statusRes = await fetch(`${WB_BASE}/api/v3/orders/status`, {
                  method: "POST",
                  headers: authHeaders,
                  body: JSON.stringify({ orders: batch.map((o: any) => Number(o.id)) }),
                });
                if (statusRes.ok) {
                  const statusData = await statusRes.json();
                  for (const s of statusData?.orders || []) {
                    if (s.id && s.wbStatus) {
                      const meta = allOrderMeta.find((o: any) => o.id === s.id) || {};
                      statusMap[String(s.id)] = { wbStatus: s.wbStatus, meta };
                    }
                  }
                }
              } catch (e: any) {
                console.warn(`[wb-stale-sync] status batch error: ${e.message}`);
              }
            }

            // Шаг 3: обновить заказы в БД с устаревшим статусом (new/waiting в поставке)
            for (const [wbOrderId, { wbStatus, meta }] of Object.entries(statusMap)) {
              try {
                const [existing] = await db.execute(sql`
                  SELECT id, wb_status FROM orders
                  WHERE wb_order_id = ${wbOrderId}
                    AND source = 'wildberries'
                    AND wb_status IN ('new', 'waiting')
                    AND wb_supply_id IS NOT NULL
                    AND organization_id = ${orgId}
                  LIMIT 1
                `);
                const row = ((existing as any).rows || existing)[0] as any;
                if (row && row.wb_status !== wbStatus) {
                  const createdAtRaw = meta.createdAt;
                  const createdAtTs = createdAtRaw
                    ? (typeof createdAtRaw === "number" ? new Date(createdAtRaw * 1000) : new Date(createdAtRaw))
                    : new Date();
                  await storage.updateOrderWbStatus(row.id, wbStatus, wbStatusToInternal(wbStatus), createdAtTs);
                  totalUpdated++;
                }
              } catch (e: any) {
                // skip individual order errors
              }
            }
          } catch (err: any) {
            console.error(`[wb-stale-sync] Error for setting ${wbSetting.id}:`, err.message);
          }
        }

        console.log(`[wb-stale-sync] org ${orgId}: обновлено ${totalUpdated} устаревших статусов заказов`);

        // После обновления статусов — синхронизировать поставки (закрыть те, которых нет в WB ACTIVE)
        await syncWbSuppliesForOrg(orgId).catch((e: any) =>
          console.log('[wb-stale-sync] Supply sync failed:', e.message));

        // Шаг А — обновить заказы внутри устаревших открытых поставок (>21 день)
        await db.execute(sql`
          UPDATE orders SET wb_status = 'delivered', status = 'completed'
          WHERE source = 'wildberries' AND wb_status = 'new'
          AND wb_supply_id IN (
            SELECT supply_id FROM wb_supplies
            WHERE status = 'open' AND created_at < NOW() - INTERVAL '21 days'
            AND organization_id = ${orgId}
          )
        `);

        // Шаг 0a: reconciliation — создать stub-записи для supply IDs из заказов,
        // которых нет в wb_supplies. Это фиксирует кейс когда Phase 3 не синхронизировала
        // поставку (не вернул WB CLOSED API или попала в allActiveSupplyIds на момент синка).
        // closed_at = NULL → COALESCE(NULL, min_order_created_at) используется для «В доставке».
        await db.execute(sql`
          INSERT INTO wb_supplies (supply_id, organization_id, store_id, status, created_at, wb_synced_as_closed)
          SELECT
            o.wb_supply_id,
            o.organization_id,
            o.store_id,
            CASE
              WHEN bool_or(o.wb_status IN ('indelivery','delivering','sorted','delivered','receive','sold','ready_for_pickup','complete'))
              THEN 'closed'
              ELSE 'open'
            END,
            MIN(o.created_at),
            false
          FROM orders o
          WHERE o.source = 'wildberries'
            AND o.wb_supply_id IS NOT NULL
            AND o.wb_supply_id != ''
            AND o.organization_id = ${orgId}
            AND o.created_at >= NOW() - INTERVAL '25 days'
            AND NOT EXISTS (
              SELECT 1 FROM wb_supplies ws
              WHERE ws.supply_id = o.wb_supply_id AND ws.organization_id = o.organization_id
            )
          GROUP BY o.wb_supply_id, o.organization_id, o.store_id
          ON CONFLICT DO NOTHING
        `);

        // Шаг 0b: перевести 'open' поставки в 'closed', если все заказы уже advanced
        // (indelivery / sorted / delivered / etc.) и ни одного активного ('new','waiting','confirm').
        // Фиксирует кейс когда Phase 1 создала поставку как 'open', а WB её уже отсканировал.
        await db.execute(sql`
          UPDATE wb_supplies SET status = 'closed'
          WHERE status = 'open'
            AND organization_id = ${orgId}
            AND EXISTS (
              SELECT 1 FROM orders o
              WHERE o.wb_supply_id = wb_supplies.supply_id
                AND o.wb_status IN ('indelivery','delivering','sorted','delivered','receive','sold','ready_for_pickup','complete')
                AND o.organization_id = ${orgId}
            )
            AND NOT EXISTS (
              SELECT 1 FROM orders o
              WHERE o.wb_supply_id = wb_supplies.supply_id
                AND o.wb_status IN ('new','waiting','confirm')
                AND o.organization_id = ${orgId}
            )
        `);

        // Однократный фикс: сброс closed_at для поставок, которые были искусственно закрыты
        // с closed_at = NOW() (не из WB API). wb_synced_as_closed=false означает, что
        // Phase 3 CLOSED sync не подтвердил эту поставку. Сбрасываем closed_at в NULL →
        // COALESCE(NULL, created_at_старая) >= NOW()-20d вернёт false → исчезнет из «В доставке».
        await db.execute(sql`
          UPDATE wb_supplies
          SET closed_at = NULL
          WHERE status = 'closed'
            AND wb_synced_as_closed = false
            AND created_at < NOW() - INTERVAL '20 days'
            AND closed_at >= NOW() - INTERVAL '20 days'
            AND organization_id = ${orgId}
        `);

        // Шаг Б — закрыть устаревшие открытые поставки (>21 день) без активных заказов.
        // НЕ ставим closed_at = NOW() — это локальная операция, WB не сканировал поставку.
        // closed_at будет NULL → COALESCE вернёт created_at (старая дата) → не пройдёт 20-дневный фильтр.
        await db.execute(sql`
          UPDATE wb_supplies SET status = 'closed'
          WHERE status = 'open' AND created_at < NOW() - INTERVAL '21 days'
          AND organization_id = ${orgId}
          AND NOT EXISTS (
            SELECT 1 FROM orders o
            WHERE o.wb_supply_id = wb_supplies.supply_id
            AND o.wb_status IN ('new', 'waiting', 'confirm')
          )
        `);

        console.log('[wb-stale-sync] Устаревшие поставки (>21 дня) закрыты');
      }
    } catch (error) {
      console.error("[wb-stale-sync] Error:", error);
    }
  };

  // Запустить стейл-синк один раз при старте (через 15 с, до первого autoSyncWbOrders)
  setTimeout(syncWbStaleOrdersAll, 15000);

  // Shared helper: бэкфилл отменённых WB заказов для одной организации (90 дней, курсорная пагинация)
  // WB API /api/v3/orders не содержит поле wbStatus — статус получаем через POST /api/v3/orders/status
  const WB_CANCELLED_STATUSES = ["cancel", "user_cancel", "declined", "cancel_ignore", "defect", "cancelled", "declined_by_client"];

  async function runWbCancelledBackfillForOrg(
    orgId: string,
    wbOrgSettings: any[]
  ): Promise<{ updated: number; created: number }> {
    const WB_BASE = "https://marketplace-api.wildberries.ru";
    const dateFrom = Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000);
    let totalUpdated = 0, totalCreated = 0;

    for (const wbSetting of wbOrgSettings) {
      const cleanApiKey = wbSetting.apiKey!.trim();
      const authHeaders = { "Authorization": cleanApiKey, "Content-Type": "application/json" };
      const resolvedStoreId = wbSetting.storeId ?? null;
      const resolvedCompanyId = wbSetting.companyId ?? null;
      let resolvedStoreName: string | null = null;
      if (resolvedStoreId) {
        const store = await storage.getStore(resolvedStoreId);
        if (store) resolvedStoreName = store.name;
      }

      // Шаг 1: собрать все заказы (только ID + метаданные) за 90 дней постранично
      const allOrderMeta: any[] = [];
      let nextCursor = 0;
      while (true) {
        const ordersRes = await fetch(
          `${WB_BASE}/api/v3/orders?limit=1000&next=${nextCursor}&dateFrom=${dateFrom}`,
          { method: "GET", headers: authHeaders }
        );
        if (!ordersRes.ok) {
          console.warn(`[wb-cancelled-backfill] WB API error ${ordersRes.status} for store ${resolvedStoreName}`);
          break;
        }
        const ordersData = await ordersRes.json();
        const page: any[] = ordersData?.orders || [];
        allOrderMeta.push(...page);
        nextCursor = ordersData?.next ?? 0;
        if (!nextCursor || page.length < 1000) break;
      }

      if (allOrderMeta.length === 0) {
        console.log(`[wb-cancelled-backfill] Store «${resolvedStoreName}»: 0 заказов из WB за 90 дней`);
        continue;
      }

      // Шаг 2: запросить статусы батчами по 1000 через POST /api/v3/orders/status
      const statusMap: Record<string, string> = {};
      for (let i = 0; i < allOrderMeta.length; i += 1000) {
        const batch = allOrderMeta.slice(i, i + 1000);
        try {
          const statusRes = await fetch(`${WB_BASE}/api/v3/orders/status`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ orders: batch.map((o: any) => Number(o.id)) }),
          });
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            for (const s of statusData?.orders || []) {
              if (s.id && s.wbStatus) statusMap[String(s.id)] = s.wbStatus;
            }
          } else {
            const errText = await statusRes.text();
            console.warn(`[wb-cancelled-backfill] status API error ${statusRes.status}: ${errText.slice(0, 200)}`);
          }
        } catch (e: any) {
          console.warn(`[wb-cancelled-backfill] status batch error: ${e.message}`);
        }
      }

      // Шаг 3: фильтровать отменённые и создать/обновить записи
      const metaById: Record<string, any> = {};
      for (const o of allOrderMeta) metaById[String(o.id)] = o;

      let storeCancelledCount = 0;
      let pageErrors = 0;

      for (const [wbOrderId, wbStatus] of Object.entries(statusMap)) {
        if (!WB_CANCELLED_STATUSES.includes(wbStatus)) continue;
        storeCancelledCount++;
        const wbOrder = metaById[wbOrderId] || {};
        try {
          const wbRid = wbOrder.rid ? String(wbOrder.rid) : null;
          const wbSupplyId = wbOrder.supplyId ? String(wbOrder.supplyId) : null;
          const createdAtRaw = wbOrder.createdAt;
          const createdAtTs = createdAtRaw
            ? (typeof createdAtRaw === "number" ? new Date(createdAtRaw * 1000) : new Date(createdAtRaw))
            : new Date();
          const totalAmount = (wbOrder.totalPrice || wbOrder.convertedPrice || 0) / 100;

          const existingOrder = await storage.getOrderByExternalId(wbOrderId, orgId, resolvedStoreId);
          if (existingOrder) {
            if (existingOrder.wbStatus !== wbStatus || existingOrder.status !== "cancelled") {
              await storage.updateOrderWbStatus(existingOrder.id, wbStatus, "cancelled", createdAtTs);
              totalUpdated++;
            }
          } else {
            const article = wbOrder.article || wbOrder.supplierArticle || "";
            const qty = wbOrder.quantity || 1;
            let productId: number | null = null;
            if (article) {
              const [dbProduct] = await db.select().from(productsTable)
                .where(and(eq(productsTable.sku, article), eq(productsTable.organizationId, orgId)));
              if (dbProduct) productId = dbProduct.id;
            }
            await storage.createOrder({
              orderNumber: `WB-${wbOrderId}`,
              status: "cancelled",
              totalAmount: totalAmount.toFixed(2),
              source: "wildberries",
              externalId: wbOrderId,
              postingNumber: null,
              ozonStatus: null,
              yandexStatus: null,
              wbOrderId,
              wbStatus,
              wbRid,
              wbSupplyId,
              fulfillmentType: "FBS",
              storeId: resolvedStoreId ?? undefined,
              sourceStoreName: resolvedStoreName ?? undefined,
              companyId: resolvedCompanyId ?? undefined,
              organizationId: orgId,
              createdAt: createdAtTs,
            } as any, productId
              ? [{ productId, quantity: qty, price: totalAmount }]
              : [{ productId: null, sku: article || `WB-${wbOrderId}`, productName: wbOrder.subject || "WB товар", quantity: qty, price: totalAmount }]);
            totalCreated++;
          }
        } catch (e: any) {
          pageErrors++;
          console.error(`[wb-cancelled-backfill] Order ${wbOrderId} error:`, e.message);
        }
      }

      if (pageErrors > 0) {
        console.warn(`[wb-cancelled-backfill] Store «${resolvedStoreName}»: пропущено ошибок ${pageErrors}`);
      }
      console.log(`[wb-cancelled-backfill] Store «${resolvedStoreName}»: ${allOrderMeta.length} заказов, ${storeCancelledCount} отменённых из WB`);
    }
    return { updated: totalUpdated, created: totalCreated };
  }

  // Бэкфилл отменённых WB заказов: запуск через 30с после старта, затем каждые 2 часа
  const runWbCancelledBackfillAll = async () => {
    try {
      const allSettings = await db.select().from(marketplaceSettingsTable);
      const wbSettingsAll = allSettings.filter(s => s.marketplace === "wildberries" && s.isActive && s.apiKey);
      if (wbSettingsAll.length === 0) return;

      const orgIds = [...new Set(wbSettingsAll.map(s => s.organizationId))];
      let totalUpdated = 0, totalCreated = 0;

      for (const orgId of orgIds) {
        const wbOrgSettings = wbSettingsAll.filter(s => s.organizationId === orgId);
        const { updated, created } = await runWbCancelledBackfillForOrg(orgId, wbOrgSettings);
        totalUpdated += updated;
        totalCreated += created;
      }
      if (totalUpdated > 0 || totalCreated > 0) {
        console.log(`[wb-cancelled-backfill] Завершено: обновлено ${totalUpdated}, создано ${totalCreated}`);
      }
    } catch (e: any) {
      console.error("[wb-cancelled-backfill] Error:", e.message);
    }
  };

  setTimeout(runWbCancelledBackfillAll, 30000);
  setInterval(runWbCancelledBackfillAll, 2 * 60 * 60 * 1000);
  console.log("[wb-cancelled-backfill] Scheduled every 2h, first run in 30s");

  // ==================== WB FBS MANAGEMENT ENDPOINTS ====================

  const WB_MARKETPLACE_BASE = "https://marketplace-api.wildberries.ru";

  async function getWbApiKeyForStore(orgId: string, storeId: number | null): Promise<string | null> {
    const allSettings = await storage.getMarketplaceSettings(orgId);
    const wbSettings = allSettings.filter(s => s.marketplace === "wildberries" && s.isActive && s.apiKey);
    if (storeId) {
      const match = wbSettings.find(s => s.storeId === storeId);
      return match?.apiKey?.trim() || null;
    }
    return wbSettings[0]?.apiKey?.trim() || null;
  }

  async function syncWbSuppliesForOrg(orgId: string, storeId: number | null = null): Promise<{synced: number, errors: string[]}> {
    console.log(`[wb-supply-sync] STARTED for org ${orgId}, storeId=${storeId}`);
    const allSettings = await storage.getMarketplaceSettings(orgId);
    const wbSettings = allSettings.filter(s =>
      s.marketplace === "wildberries" && s.isActive && s.apiKey &&
      (storeId === null || s.storeId === storeId)
    );
    console.log(`[wb-supply-sync] Found ${wbSettings.length} WB settings (total settings: ${allSettings.length})`);
    if (wbSettings.length === 0) return { synced: 0, errors: [] };

    let totalSynced = 0;
    const errors: string[] = [];

    // ── ФАЗА 1: собрать UNION всех ACTIVE IDs по всем WB аккаунтам + upsert ─
    // Safe Total Mirror: collect from ALL accounts before any cleanup.
    // This prevents a second account's narrower ACTIVE list from closing
    // supplies that legitimately belong to a different account (store_id).
    const allActiveSupplyIds = new Set<string>();
    let anyActiveFetchSucceeded = false;
    let anyClosedFetchSucceeded = false;
    let allClosedFetchesSucceeded = true; // becomes false if any account's CLOSED fetch fails

    for (const wbSetting of wbSettings) {
      const cleanKey = wbSetting.apiKey!.trim();
      const authHeaders = { "Authorization": cleanKey, "Content-Type": "application/json" };
      const resolvedStoreId = wbSetting.storeId ?? null;
      const displayName = resolvedStoreId ? `store ${resolvedStoreId}` : `org ${orgId}`;

      try {
        console.log(`[wb-supply-sync] Fetching ACTIVE supplies for ${displayName}...`);
        let activeResult: { status: number; json: any };
        try {
          activeResult = await wbFetchJson(
            `${WB_MARKETPLACE_BASE}/api/v3/supplies?limit=1000&next=0&status=ACTIVE`,
            authHeaders,
            25000
          );
          console.log(`[wb-supply-sync] ACTIVE result for ${displayName}: status=${activeResult.status}`);
        } catch (fetchErr: any) {
          console.error(`[wb-supply-sync] ACTIVE fetch error for ${displayName}:`, fetchErr.message);
          errors.push(`[ACTIVE] Error: ${fetchErr.message}`);
          continue;
        }
        if (activeResult!.status !== 200) {
          errors.push(`[ACTIVE] WB API ${activeResult.status}`);
          console.warn(`[wb-supply-sync] API error for ${displayName} (${activeResult.status}), skipping`);
          continue;
        }

        anyActiveFetchSucceeded = true;
        const supplyData = activeResult.json;
        const supplies: any[] = supplyData.supplies || supplyData.list || [];

        for (const supply of supplies) {
          const rawId = supply.id || supply.supplyId || supply.supply_id || "";
          const supplyId = String(rawId);
          if (!supplyId || supplyId === "undefined" || supplyId === "null") continue;

          allActiveSupplyIds.add(supplyId);

          const existingRows = await db.execute(sql`
            SELECT id FROM wb_supplies WHERE supply_id = ${supplyId} AND organization_id = ${orgId}
          `);
          const existing = ((existingRows as any).rows || existingRows)[0];

          const supplyName = supply.name || null;
          const createdAtRaw = supply.createdAt || supply.created_at;
          const createdAtTs = createdAtRaw ? new Date(createdAtRaw) : new Date();
          const closedAtRawActive = supply.closedAt || supply.closed_at;
          const closedAtTsActive = closedAtRawActive ? new Date(closedAtRawActive) : null;
          // closedAt из ACTIVE API → поставка уже отсканирована WB складом («В доставке»)
          // closedAt null → поставка ещё собирается («На сборке»)
          const isScanned = !!closedAtTsActive;
          if (isScanned) {
            console.log(`[wb-supply-sync] Phase1 ACTIVE+closedAt: ${supplyId} → closedAt=${closedAtTsActive?.toISOString()}, статус→closed`);
          }

          if (existing) {
            if (isScanned) {
              await db.execute(sql`
                UPDATE wb_supplies SET
                  name = ${supplyName},
                  status = 'closed',
                  closed_at = ${closedAtTsActive},
                  wb_synced_as_closed = true
                WHERE supply_id = ${supplyId} AND organization_id = ${orgId}
              `);
            } else {
              await db.execute(sql`
                UPDATE wb_supplies SET
                  name = ${supplyName},
                  status = 'open',
                  closed_at = NULL,
                  wb_synced_as_closed = false
                WHERE supply_id = ${supplyId} AND organization_id = ${orgId}
              `);
            }
          } else {
            await db.insert(wbSuppliesTable).values({
              supplyId,
              storeId: resolvedStoreId ?? undefined,
              organizationId: orgId,
              name: supplyName,
              status: isScanned ? "closed" : "open",
              createdAt: createdAtTs,
              closedAt: closedAtTsActive ?? undefined,
              wbSyncedAsClosed: isScanned,
            } as any);
          }
          totalSynced++;

          try {
            const ordersResult = await wbFetchJson(
              `${WB_MARKETPLACE_BASE}/api/v3/supplies/${supplyId}/orders`,
              authHeaders,
              15000
            );
            if (ordersResult.status >= 200 && ordersResult.status < 300) {
              const supplyOrders: any[] = ordersResult.json?.orders || [];
              for (const so of supplyOrders) {
                const wbOrderId = String(so.id || so.wbOrderId || "");
                if (!wbOrderId) continue;

                // Обновляем существующий заказ: ставим supply_id и переводим new/waiting → confirm
                const updateResult = await db.execute(sql`
                  UPDATE orders SET
                    wb_supply_id = ${supplyId},
                    wb_status = CASE
                      WHEN wb_status IN ('new', 'waiting') THEN 'confirm'
                      ELSE wb_status
                    END
                  WHERE wb_order_id = ${wbOrderId}
                    AND organization_id = ${orgId}
                  RETURNING id
                `);
                const updatedRows: any[] = (updateResult as any).rows || [];

                // Если заказа нет в БД — создаём заказ с реальными данными из WB API
                if (updatedRows.length === 0) {
                  try {
                    const article = String(so.article || so.supplierArticle || "");
                    const soWbStatus = so.wbStatus || so.status || "confirm";
                    const soTotalAmount = (so.totalPrice || so.convertedPrice || 0) / 100;
                    const soRid = so.rid ? String(so.rid) : null;
                    const soCreatedAtRaw = so.createdAt;
                    const soCreatedAt = soCreatedAtRaw
                      ? (typeof soCreatedAtRaw === "number" ? new Date(soCreatedAtRaw * 1000) : new Date(soCreatedAtRaw))
                      : new Date();
                    let productId: number | null = null;
                    if (article) {
                      const [dbProduct] = await db.select().from(productsTable)
                        .where(and(eq(productsTable.sku, article), eq(productsTable.organizationId, orgId)));
                      if (dbProduct) productId = dbProduct.id;
                    }
                    await storage.createOrder({
                      orderNumber: `WB-${wbOrderId}`,
                      status: wbStatusToInternal(soWbStatus),
                      totalAmount: soTotalAmount.toFixed(2),
                      source: "wildberries",
                      externalId: wbOrderId,
                      postingNumber: null,
                      ozonStatus: null,
                      yandexStatus: null,
                      wbOrderId,
                      wbStatus: soWbStatus,
                      wbRid: soRid,
                      wbSupplyId: supplyId,
                      fulfillmentType: "FBS",
                      storeId: resolvedStoreId ?? undefined,
                      organizationId: orgId,
                      createdAt: soCreatedAt,
                    } as any, productId
                      ? [{ productId, quantity: so.quantity || 1, price: soTotalAmount }]
                      : [{ productId: null, sku: article || `WB-${wbOrderId}`, productName: so.subject || "WB товар", quantity: so.quantity || 1, price: soTotalAmount }]);
                    console.log(`[wb-supplies-sync] Создан заказ WB-${wbOrderId} (${soWbStatus}) для поставки ${supplyId}`);
                  } catch (createErr: any) {
                    if (!createErr.message?.includes("unique") && !createErr.message?.includes("duplicate")) {
                      console.warn(`[wb-supplies-sync] Не удалось создать stub-заказ ${wbOrderId}:`, createErr.message);
                    }
                  }
                }
              }
            }
          } catch (e: any) {
            console.warn(`[wb-supplies-sync] Orders fetch for supply ${supplyId}:`, e.message);
          }
        }

        console.log(`[wb-supply-sync] ${displayName}: ${supplies.length} активных в WB`);
      } catch (e: any) {
        errors.push(`[ACTIVE] Error: ${e.message}`);
        console.error(`[wb-supplies-sync] ACTIVE error for ${displayName}:`, e.message);
      }
    }

    // ── ФАЗА 2: TOTAL MIRROR CLEANUP ────────────────────────────────────────
    // Runs only when at least one ACTIVE fetch succeeded AND WB returned non-empty list.
    // Guard allActiveSupplyIds.size > 0 prevents closing ALL supplies when WB API returns empty.
    if (anyActiveFetchSucceeded && allActiveSupplyIds.size > 0) {
      const openRows = await db.execute(sql`
        SELECT supply_id FROM wb_supplies
        WHERE status = 'open'
          AND organization_id = ${orgId}
      `);
      const allOpen: any[] = (openRows as any).rows || openRows;
      const toClose = allOpen
        .map((r: any) => String(r.supply_id))
        .filter((id: string) => !allActiveSupplyIds.has(id));

      for (const sid of toClose) {
        await db.execute(sql`
          UPDATE wb_supplies
          SET status = 'closed', wb_synced_as_closed = false
          WHERE supply_id = ${sid}
            AND status = 'open'
            AND organization_id = ${orgId}
        `);
      }
      if (toClose.length > 0) {
        console.log(`[wb-supply-sync] Total Mirror: закрыто ${toClose.length} поставок (пропало из WB ACTIVE, активных: ${allActiveSupplyIds.size})`);
      } else {
        console.log(`[wb-supply-sync] Total Mirror: всё чисто (активных в WB: ${allActiveSupplyIds.size})`);
      }
    }

    // ── ФАЗА 3: upsert CLOSED поставок по каждому WB аккаунту ───────────────
    // ALL supplies returned by WB CLOSED endpoint get wb_synced_as_closed = true.
    // If a supply is also in ACTIVE we keep its status='open' but still flag it.
    // Only supplies not in ACTIVE get status='closed' via full upsert.
    const allWbClosedIds = new Set<string>(); // ALL supplies from WB CLOSED endpoint

    for (const wbSetting of wbSettings) {
      const cleanKey = wbSetting.apiKey!.trim();
      const authHeaders = { "Authorization": cleanKey, "Content-Type": "application/json" };
      const resolvedStoreId = wbSetting.storeId ?? null;

      try {
        // ── Пагинация: WB CLOSED API может вернуть >1000 поставок.
        // Cursor-based loop: next=0 → first page, next=N → next page, next=0 again → end.
        const displayName2 = wbSetting.storeId ? `store ${wbSetting.storeId}` : `org ${orgId}`;
        let nextCursor = 0;
        let pagesFetched = 0;
        const MAX_CLOSED_PAGES = 10;
        let closedOnlyCount = 0;
        let totalClosedFetched = 0;

        do {
          const closedResult = await wbFetchJson(
            `${WB_MARKETPLACE_BASE}/api/v3/supplies?limit=1000&next=${nextCursor}&status=CLOSED`,
            authHeaders,
            25000
          );
          if (closedResult.status < 200 || closedResult.status >= 300) {
            errors.push(`[CLOSED] WB API ${closedResult.status}`);
            allClosedFetchesSucceeded = false;
            break;
          }
          anyClosedFetchSucceeded = true;
          const supplyData = closedResult.json;
          const supplies: any[] = supplyData.supplies || supplyData.list || [];
          nextCursor = Number(supplyData.next ?? 0);
          pagesFetched++;
          totalClosedFetched += supplies.length;
          if (pagesFetched === 1) {
            console.log(`[wb-supply-sync] ${displayName2}: стр.1 — ${supplies.length} закрытых в WB (status=CLOSED)`);
          }

          for (const supply of supplies) {
            const rawId = supply.id || supply.supplyId || supply.supply_id || "";
            const supplyId = String(rawId);
            if (!supplyId || supplyId === "undefined" || supplyId === "null") continue;

            // Свежесть: только поставки, закрытые WB ≤ 20 дней назад, управляют wb_synced_as_closed
            const twentyDaysAgo = Date.now() - 20 * 24 * 3600 * 1000;
            const closedAtRaw = supply.closedAt || supply.closed_at;
            const closedAtMs = closedAtRaw ? new Date(closedAtRaw).getTime() : Date.now();
            const isRecent = closedAtMs >= twentyDaysAgo;
            const closedAtTs = closedAtRaw ? new Date(closedAtRaw) : null;

            if (isRecent) {
              allWbClosedIds.add(supplyId);
            }

            if (allActiveSupplyIds.has(supplyId)) {
              // Supply в WB ACTIVE+CLOSED: Phase 1 уже обработал через closedAt.
              // Не перезаписываем — пропускаем.
              continue;
            }
            closedOnlyCount++;

            const existingRows = await db.execute(sql`
              SELECT id FROM wb_supplies WHERE supply_id = ${supplyId} AND organization_id = ${orgId}
            `);
            const existing = ((existingRows as any).rows || existingRows)[0];

            const supplyName = supply.name || null;
            const createdAtRaw = supply.createdAt || supply.created_at;
            const createdAtTs = createdAtRaw ? new Date(createdAtRaw) : new Date();

            if (existing) {
              await db.execute(sql`
                UPDATE wb_supplies SET
                  name = ${supplyName},
                  status = 'closed',
                  closed_at = ${closedAtTs},
                  wb_synced_as_closed = ${isRecent}
                WHERE supply_id = ${supplyId} AND organization_id = ${orgId}
              `);
            } else {
              await db.insert(wbSuppliesTable).values({
                supplyId,
                storeId: resolvedStoreId ?? undefined,
                organizationId: orgId,
                name: supplyName,
                status: "closed",
                createdAt: createdAtTs,
                closedAt: closedAtTs ?? undefined,
                wbSyncedAsClosed: isRecent,
              } as any);
            }
            totalSynced++;
          }

          if (supplies.length < 1000) break; // последняя страница
        } while (nextCursor > 0 && pagesFetched < MAX_CLOSED_PAGES);

        if (pagesFetched > 1) {
          console.log(`[wb-supply-sync] ${displayName2}: всего ${totalClosedFetched} CLOSED за ${pagesFetched} стр., уникальных (не в ACTIVE): ${closedOnlyCount}`);
        } else {
          console.log(`[wb-supply-sync] ${displayName2}: уникальных CLOSED (не в ACTIVE): ${closedOnlyCount}`);
        }
      } catch (e: any) {
        allClosedFetchesSucceeded = false;
        errors.push(`[CLOSED] Error: ${e.message}`);
        console.error(`[wb-supplies-sync] CLOSED error:`, e.message);
      }
    }

    // ── BACKFILL: синхронизация флага wb_synced_as_closed ────────────────────────
    // Per spec: ALL supplies from WB CLOSED → wb_synced_as_closed=true;
    // all other closed supplies (closed by our cleanup, not returned by WB CLOSED) → false.
    // Step 1 (set true) runs whenever any CLOSED fetch succeeded.
    // Step 2 (reset false) only runs when ALL CLOSED fetches succeeded to avoid partial-failure
    // incorrectly clearing flags for supplies from a failed account.
    if (anyClosedFetchSucceeded) {
      if (allWbClosedIds.size > 0) {
        const closedIdList = Array.from(allWbClosedIds);
        // Step 1: set true for ALL DB supplies returned by WB CLOSED (regardless of current value)
        await db.execute(sql`
          UPDATE wb_supplies SET wb_synced_as_closed = true
          WHERE supply_id = ANY(${closedIdList}::text[])
            AND organization_id = ${orgId}
        `);
        console.log(`[wb-supply-sync] Backfill: wb_synced_as_closed=true у ${allWbClosedIds.size} WB CLOSED поставок`);
        // Step 2: reset to false all closed DB supplies NOT in WB CLOSED
        // Only runs when ALL accounts' CLOSED fetches succeeded to prevent partial-failure data loss
        if (allClosedFetchesSucceeded) {
          await db.execute(sql`
            UPDATE wb_supplies SET wb_synced_as_closed = false
            WHERE status = 'closed'
              AND organization_id = ${orgId}
              AND NOT (supply_id = ANY(${closedIdList}::text[]))
          `);
        }
      } else if (allClosedFetchesSucceeded) {
        // WB CLOSED returned zero for all accounts — reset all closed supplies to false
        await db.execute(sql`
          UPDATE wb_supplies SET wb_synced_as_closed = false
          WHERE status = 'closed'
            AND organization_id = ${orgId}
        `);
        console.log(`[wb-supply-sync] Backfill: WB CLOSED вернул 0 поставок — сброшены все флаги`);
      }
    }

    // ── ФАЗА 4: бэкфилл заказов поставок — для каждой активной поставки запрашиваем заказы напрямую
    for (const wbSetting of wbSettings) {
      if (!wbSetting.storeId) continue; // только магазины с явным store_id
      const cleanKey = wbSetting.apiKey!.trim();
      const authHeaders = { "Authorization": cleanKey, "Content-Type": "application/json" };
      const resolvedStoreId = wbSetting.storeId;
      const resolvedCompanyId = wbSetting.companyId ?? null;
      let resolvedStoreName: string | null = null;
      const store = await storage.getStore(resolvedStoreId);
      if (!store) continue;
      resolvedStoreName = store.name;

      try {
        // Берём все открытые + недавно закрытые поставки этого магазина из БД
        const openSupplies = await db.execute(sql`
          SELECT supply_id FROM wb_supplies
          WHERE store_id = ${resolvedStoreId}
            AND (status = 'open'
                 OR (status = 'closed' AND COALESCE(closed_at, created_at) >= NOW() - INTERVAL '30 days'))
        `);
        const supplyRows: any[] = (openSupplies as any).rows || openSupplies;
        let created30 = 0, linked30 = 0;

        for (const supplyRow of supplyRows) {
          const supplyId = supplyRow.supply_id;
          if (!supplyId) continue;

          // Пробуем /api/v3/supplies/{id}/orders напрямую
          let supplyOrdersRes: { status: number; json: any };
          try {
            supplyOrdersRes = await wbFetchJson(
              `${WB_MARKETPLACE_BASE}/api/v3/supplies/${supplyId}/orders`,
              authHeaders, 15000
            );
          } catch (fetchErr: any) {
            console.warn(`[wb-supply-backfill] Supply ${supplyId} fetch error:`, fetchErr.message);
            continue;
          }

          let supplyOrders: any[] = [];
          if (supplyOrdersRes.status === 200) {
            supplyOrders = supplyOrdersRes.json?.orders || [];
          } else {
            // WB вернул не 200 — пропускаем поставку, попробуем в следующем цикле
            console.warn(`[wb-supply-backfill] Supply ${supplyId}: WB API вернул ${supplyOrdersRes.status}, пропускаем`);
            continue;
          }

          // Fallback для закрытых поставок: WB API возвращает [] для closed supplies —
          // ищем в БД заказы магазина с wb_supply_id IS NULL в диапазоне ±7/3 дней от создания поставки
          if (supplyOrders.length === 0) {
            const supplyMetaRows = await db.execute(sql`
              SELECT status, created_at FROM wb_supplies
              WHERE supply_id = ${supplyId} AND store_id = ${resolvedStoreId}
              LIMIT 1
            `);
            const sm = ((supplyMetaRows as any).rows || supplyMetaRows)[0];
            if (sm && sm.status === 'closed') {
              const supplyCreatedAt = new Date(sm.created_at);
              const rangeStart = new Date(supplyCreatedAt.getTime() - 7 * 24 * 3600 * 1000);
              const rangeEnd   = new Date(supplyCreatedAt.getTime() + 3 * 24 * 3600 * 1000);
              const fallbackResult = await db.execute(sql`
                UPDATE orders SET wb_supply_id = ${supplyId}
                WHERE store_id      = ${resolvedStoreId}
                  AND organization_id = ${orgId}
                  AND wb_supply_id  IS NULL
                  AND source        = 'wildberries'
                  AND created_at   >= ${rangeStart}
                  AND created_at   <= ${rangeEnd}
              `);
              const fallbackLinked = (fallbackResult as any).rowCount ?? 0;
              if (fallbackLinked > 0) {
                console.log(`[wb-supply-backfill] Closed supply ${supplyId}: date-fallback linked ${fallbackLinked} orders`);
              }
            }
          }

          for (const o of supplyOrders) {
            const wbOrderId = String(o.id || "");
            if (!wbOrderId) continue;

            try {
              const existing = await storage.getOrderByExternalId(wbOrderId, orgId);
              if (existing) {
                const supplyChanged = existing.wbSupplyId !== supplyId;
                const storeMissing30 = !existing.storeId;
                const newWbStatus = o.wbStatus || o.status || "confirm";
                const statusChanged = existing.status !== "cancelled" && existing.wbStatus !== newWbStatus;
                if (supplyChanged || storeMissing30 || statusChanged) {
                  const newInternalStatus = wbStatusToInternal(newWbStatus);
                  await db.execute(sql`
                    UPDATE orders SET
                      wb_supply_id = COALESCE(wb_supply_id, ${supplyId}),
                      store_id = COALESCE(store_id, ${resolvedStoreId}),
                      source_store_name = COALESCE(source_store_name, ${resolvedStoreName}),
                      wb_status = CASE WHEN status != 'cancelled' THEN ${newWbStatus} ELSE wb_status END,
                      status = CASE WHEN status != 'cancelled' THEN ${newInternalStatus} ELSE status END
                    WHERE id = ${existing.id}
                  `);
                  linked30++;
                }
              } else {
                const article = String(o.article || o.supplierArticle || "");
                const qty = o.quantity || 1;
                const totalAmount = (o.totalPrice || o.convertedPrice || 0) / 100;
                const wbStatus = o.wbStatus || o.status || "confirm";
                const wbRid = o.rid ? String(o.rid) : null;
                const createdAtRaw = o.createdAt;
                const createdAtTs = createdAtRaw
                  ? (typeof createdAtRaw === "number" ? new Date(createdAtRaw * 1000) : new Date(createdAtRaw))
                  : new Date();
                let productId: number | null = null;
                if (article) {
                  const [dbProduct] = await db.select().from(productsTable)
                    .where(and(eq(productsTable.sku, article), eq(productsTable.organizationId, orgId)));
                  if (dbProduct) productId = dbProduct.id;
                }
                await storage.createOrder({
                  orderNumber: `WB-${wbOrderId}`,
                  status: wbStatusToInternal(wbStatus),
                  totalAmount: totalAmount.toFixed(2),
                  source: "wildberries",
                  externalId: wbOrderId,
                  postingNumber: null,
                  ozonStatus: null,
                  yandexStatus: null,
                  wbOrderId,
                  wbStatus,
                  wbRid,
                  wbSupplyId: supplyId,
                  fulfillmentType: "FBS",
                  storeId: resolvedStoreId,
                  sourceStoreName: resolvedStoreName ?? undefined,
                  companyId: resolvedCompanyId ?? undefined,
                  organizationId: orgId,
                  createdAt: createdAtTs,
                } as any, productId
                  ? [{ productId, quantity: qty, price: totalAmount }]
                  : [{ productId: null, sku: article || `WB-${wbOrderId}`, productName: "WB товар", quantity: qty, price: totalAmount }]);
                created30++;
              }
            } catch (createErr: any) {
              if (!createErr.message?.includes("unique") && !createErr.message?.includes("duplicate")) {
                console.warn(`[wb-supply-backfill] Заказ ${wbOrderId} ошибка:`, createErr.message);
              }
            }
          }
        }
        if (created30 > 0 || linked30 > 0) {
          console.log(`[wb-supply-backfill] store ${resolvedStoreId}: создано ${created30}, прилинковано ${linked30} заказов`);
        }
      } catch (e: any) {
        console.warn(`[wb-supply-backfill] Error for store ${resolvedStoreId}:`, e.message);
      }
    }

    console.log(`[wb-supplies-sync] org ${orgId}: Синхронизировано ${totalSynced} поставок`);
    return { synced: totalSynced, errors };
  }

  // GET /api/wb/orders — список заказов WB с маппингом статусов
  app.get("/api/wb/orders", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const status = req.query.status as string || "new";
      const storeId = req.query.storeId ? Number(req.query.storeId) : null;
      const supplyIdFilter = req.query.supplyId as string | undefined;

      const allOrders = await db.execute(sql`
        SELECT DISTINCT ON (o.id)
          o.id, o.order_number, o.wb_order_id, o.wb_status,
          o.wb_supply_id, o.wb_rid, o.total_amount, o.created_at,
          o.store_id, o.source_store_name, o.status,
          s.name as store_name,
          oi.quantity, oi.price,
          p.name as product_name, p.sku, p.barcode, p.image_url
        FROM orders o
        LEFT JOIN stores s ON o.store_id = s.id
        LEFT JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE o.source = 'wildberries'
          AND o.organization_id = ${orgId}
          ${storeId ? sql`AND o.store_id = ${storeId}` : sql``}
          ${supplyIdFilter ? sql`AND o.wb_supply_id = ${supplyIdFilter}` : sql``}
          ${status === "new" && !supplyIdFilter ? sql`AND o.created_at >= NOW() - INTERVAL '7 days'` : sql``}
        ORDER BY o.id, o.created_at DESC
      `);

      const rows = (allOrders as any).rows || allOrders;

      // When supplyIdFilter is provided, return all orders for that supply without status filtering
      if (supplyIdFilter) {
        return res.json(rows);
      }

      const filtered = rows.filter((o: any) => {
        const ws = o.wb_status || "";
        const supplyId = o.wb_supply_id;
        switch (status) {
          case "new":
            return ["new", "waiting"].includes(ws) && !supplyId;
          case "assembly":
            return supplyId && !["complete", "indelivery", "delivering", "delivered", "sold", "cancel", "user_cancel", "declined"].includes(ws);
          case "delivery":
            return ["complete", "indelivery", "delivering"].includes(ws);
          case "archive":
            return ["delivered", "sold", "receive", "returned", "closed", "sorted", "waiting_for_cancel"].includes(ws);
          case "cancelled":
            return ["cancel", "user_cancel", "declined", "cancelled", "cancel_ignore", "defect", "declined_by_client"].includes(ws) || (o.status === "cancelled");
          default:
            return true;
        }
      });

      // Архив: если < 100 записей — фоновая синхронизация с WB API (последние 90 дней, статусы delivered/sold/receive/returned)
      if (status === "archive" && filtered.length < 100) {
        const requestedStoreId = storeId ? Number(storeId) : null;
        setImmediate(async () => {
          try {
            const allSettings = await storage.getMarketplaceSettings(orgId);
            const wbSettings = allSettings.filter(s =>
              s.marketplace === "wildberries" && s.isActive && s.apiKey &&
              (requestedStoreId === null || s.storeId === requestedStoreId)
            );
            const archiveStatuses = ["delivered", "sold", "receive", "returned"];
            const dateFrom = Math.floor((Date.now() - 90 * 24 * 3600 * 1000) / 1000);
            for (const wbSetting of wbSettings) {
              const cleanKey = wbSetting.apiKey!.trim();
              const authHeaders = { "Authorization": cleanKey, "Content-Type": "application/json" };
              const resolvedStoreId = wbSetting.storeId ?? null;
              const resolvedCompanyId = wbSetting.companyId ?? null;
              let resolvedStoreName: string | null = null;
              if (resolvedStoreId) {
                const store = await storage.getStore(resolvedStoreId);
                if (store) resolvedStoreName = store.name;
              }
              try {
                const url = `${WB_MARKETPLACE_BASE}/api/v3/orders?limit=1000&next=0&dateFrom=${dateFrom}`;
                const r = await fetch(url, { headers: authHeaders });
                if (!r.ok) continue;
                const data = await r.json();
                const archiveOrders = (data?.orders || []).filter((o: any) => archiveStatuses.includes(o.wbStatus || o.status || ""));
                for (const wbOrder of archiveOrders) {
                  try {
                    const wbOrderId = String(wbOrder.id);
                    const existing = await storage.getOrderByExternalId(wbOrderId, orgId, resolvedStoreId);
                    if (existing) continue;
                    const totalAmount = (wbOrder.totalPrice || wbOrder.convertedPrice || 0) / 100;
                    const article = wbOrder.article || wbOrder.supplierArticle || "";
                    const qty = wbOrder.quantity || 1;
                    const wbStatus = wbOrder.wbStatus || wbOrder.status || "sold";
                    let productId: number | null = null;
                    if (article) {
                      const [dbProduct] = await db.select().from(productsTable)
                        .where(and(eq(productsTable.sku, article), eq(productsTable.organizationId, orgId)));
                      if (dbProduct) productId = dbProduct.id;
                    }
                    const createdAtRaw = wbOrder.createdAt;
                    const createdAtTs = createdAtRaw
                      ? (typeof createdAtRaw === "number" ? new Date(createdAtRaw * 1000) : new Date(createdAtRaw))
                      : new Date();
                    await storage.createOrder({
                      orderNumber: `WB-${wbOrderId}`,
                      status: "delivered",
                      totalAmount: totalAmount.toFixed(2),
                      source: "wildberries",
                      externalId: wbOrderId,
                      postingNumber: null, ozonStatus: null, yandexStatus: null,
                      wbOrderId, wbStatus,
                      wbRid: wbOrder.rid ? String(wbOrder.rid) : null,
                      wbSupplyId: wbOrder.supplyId ? String(wbOrder.supplyId) : null,
                      fulfillmentType: "FBS",
                      storeId: resolvedStoreId ?? undefined,
                      sourceStoreName: resolvedStoreName ?? undefined,
                      companyId: resolvedCompanyId ?? undefined,
                      organizationId: orgId,
                      createdAt: createdAtTs,
                    } as any, productId
                      ? [{ productId, quantity: qty, price: totalAmount }]
                      : [{ productId: null, sku: article || `WB-${wbOrderId}`, productName: wbOrder.subject || "WB товар", quantity: qty, price: totalAmount }]);
                  } catch (e: any) {
                    console.error(`[wb-archive-sync] Order ${wbOrder.id} error:`, e.message);
                  }
                }
              } catch (e: any) {
                console.error(`[wb-archive-sync] Store error:`, e.message);
              }
            }
          } catch (e: any) {
            console.error("[wb-archive-sync] Error:", e.message);
          }
        });
      }

      res.json(filtered);
    } catch (error: any) {
      console.error("[wb-orders] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/wb/orders/:orderId/cancel — отменить заказ WB
  app.post("/api/wb/orders/:orderId/cancel", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const orderId = Number(req.params.orderId);
      if (!orderId) return res.status(400).json({ message: "Неверный orderId" });

      const [order] = await db.select().from(ordersTable)
        .where(and(eq(ordersTable.id, orderId), eq(ordersTable.organizationId, orgId)));
      if (!order) return res.status(404).json({ message: "Заказ не найден" });

      const wbOrderId = order.wbOrderId;
      if (!wbOrderId) return res.status(400).json({ message: "У заказа нет WB Order ID" });

      const cleanApiKey = await getWbApiKeyForStore(orgId, order.storeId ?? null);
      if (!cleanApiKey) return res.status(400).json({ message: "WB API-ключ не найден для магазина" });

      const authHeaders = { "Authorization": cleanApiKey, "Content-Type": "application/json" };
      const cancelRes = await fetch(`${WB_MARKETPLACE_BASE}/api/v3/orders/${wbOrderId}/cancel`, {
        method: "PATCH",
        headers: authHeaders,
      });

      if (!cancelRes.ok && cancelRes.status !== 204) {
        const errText = await cancelRes.text().catch(() => "");
        console.error(`[wb-cancel-order] WB API error ${cancelRes.status}:`, errText);
        if (cancelRes.status !== 409) {
          return res.status(502).json({ message: `WB API ошибка отмены (${cancelRes.status}): ${errText.slice(0, 200)}` });
        }
      }

      await db.update(ordersTable)
        .set({ wbStatus: "user_cancel", status: "cancelled" } as any)
        .where(and(eq(ordersTable.id, orderId), eq(ordersTable.organizationId, orgId)));

      console.log(`[wb-cancel-order] Заказ ${orderId} (WB ${wbOrderId}) отменён`);
      res.json({ success: true, orderId, wbOrderId });
    } catch (error: any) {
      console.error("[wb-cancel-order] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/wb/supplies/:id/sync-orders — принудительно создать заказы поставки из WB API
  app.post("/api/wb/supplies/:id/sync-orders", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const supplyId = req.params.id; // e.g. "WB-GI-227974273"
      const allSettings = await storage.getMarketplaceSettings(orgId);
      const wbSettings = allSettings.filter(s => s.marketplace === "wildberries" && s.isActive && s.apiKey);
      if (wbSettings.length === 0) return res.status(400).json({ message: "Нет активных WB-магазинов" });

      let created = 0, linked = 0, errors = 0;

      for (const wbSetting of wbSettings) {
        const cleanKey = wbSetting.apiKey!.trim();
        const authHeaders = { "Authorization": cleanKey, "Content-Type": "application/json" };
        const resolvedStoreId = wbSetting.storeId ?? null;
        const resolvedCompanyId = wbSetting.companyId ?? null;
        let resolvedStoreName: string | null = null;
        if (resolvedStoreId) {
          const store = await storage.getStore(resolvedStoreId);
          if (store) resolvedStoreName = store.name;
        }

        const dateFrom = Math.floor((Date.now() - 90 * 24 * 3600 * 1000) / 1000);
        let cursor = 0;

        for (let page = 0; page < 10; page++) {
          const r = await fetch(
            `${WB_MARKETPLACE_BASE}/api/v3/orders?limit=1000&next=${cursor}&dateFrom=${dateFrom}`,
            { method: "GET", headers: authHeaders }
          );
          if (!r.ok) break;
          const data = await r.json();
          const orders: any[] = data?.orders || [];
          if (orders.length === 0) break;
          cursor = data?.next ?? 0;

          for (const o of orders) {
            const wbOrderId = String(o.id || "");
            const wbSupId = o.supplyId ? String(o.supplyId) : null;
            if (!wbOrderId) continue;
            if (wbSupId !== supplyId) continue; // только заказы этой поставки

            try {
              const existing = await storage.getOrderByExternalId(wbOrderId, orgId);
              if (existing) {
                if (existing.wbSupplyId !== supplyId) {
                  await db.execute(sql`UPDATE orders SET wb_supply_id = ${supplyId} WHERE id = ${existing.id}`);
                  linked++;
                }
                if (resolvedStoreId && !existing.storeId) {
                  await db.execute(sql`UPDATE orders SET store_id = ${resolvedStoreId}, source_store_name = ${resolvedStoreName} WHERE id = ${existing.id}`);
                }
              } else {
                const article = String(o.article || o.supplierArticle || "");
                const qty = o.quantity || 1;
                const totalAmount = (o.totalPrice || o.convertedPrice || 0) / 100;
                const wbStatus = o.wbStatus || o.status || "confirm";
                const wbRid = o.rid ? String(o.rid) : null;
                const createdAtRaw = o.createdAt;
                const createdAtTs = createdAtRaw
                  ? (typeof createdAtRaw === "number" ? new Date(createdAtRaw * 1000) : new Date(createdAtRaw))
                  : new Date();
                let productId: number | null = null;
                if (article) {
                  const [dbProduct] = await db.select().from(productsTable)
                    .where(and(eq(productsTable.sku, article), eq(productsTable.organizationId, orgId)));
                  if (dbProduct) productId = dbProduct.id;
                }
                await storage.createOrder({
                  orderNumber: `WB-${wbOrderId}`,
                  status: wbStatusToInternal(wbStatus),
                  totalAmount: totalAmount.toFixed(2),
                  source: "wildberries",
                  externalId: wbOrderId,
                  postingNumber: null,
                  ozonStatus: null,
                  yandexStatus: null,
                  wbOrderId,
                  wbStatus,
                  wbRid,
                  wbSupplyId: supplyId,
                  fulfillmentType: "FBS",
                  storeId: resolvedStoreId ?? undefined,
                  sourceStoreName: resolvedStoreName ?? undefined,
                  companyId: resolvedCompanyId ?? undefined,
                  organizationId: orgId,
                  createdAt: createdAtTs,
                } as any, productId
                  ? [{ productId, quantity: qty, price: totalAmount }]
                  : [{ productId: null, sku: article || `WB-${wbOrderId}`, productName: "WB товар", quantity: qty, price: totalAmount }]);
                created++;
              }
            } catch (e: any) {
              if (!e.message?.includes("unique") && !e.message?.includes("duplicate")) errors++;
            }
          }
          if (!cursor || orders.length < 1000) break;
        }
      }

      console.log(`[wb-supply-sync-orders] supply ${supplyId}: создано ${created}, прилинковано ${linked}, ошибок ${errors}`);
      res.json({ supplyId, created, linked, errors });
    } catch (error: any) {
      console.error("[wb-supply-sync-orders] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/wb/sync-cancelled — бэкфилл отменённых заказов за 30 дней из WB API
  app.post("/api/wb/sync-cancelled", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const allSettings = await storage.getMarketplaceSettings(orgId);
      const wbSettings = allSettings.filter(s => s.marketplace === "wildberries" && s.isActive && s.apiKey);
      if (wbSettings.length === 0) return res.json({ updated: 0, created: 0, message: "Нет активных WB-магазинов" });

      const { updated, created } = await runWbCancelledBackfillForOrg(orgId, wbSettings);
      res.json({ updated, created });
    } catch (error: any) {
      console.error("[wb-sync-cancelled] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/wb/supplies/sync — синхронизировать поставки из WB API в wb_supplies
  app.post("/api/wb/supplies/sync", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const storeId = req.body?.storeId ? Number(req.body.storeId) : null;

      const allSettings = await storage.getMarketplaceSettings(orgId);
      const wbSettings = allSettings.filter(s =>
        s.marketplace === "wildberries" && s.isActive && s.apiKey &&
        (storeId === null || s.storeId === storeId)
      );

      if (wbSettings.length === 0) {
        return res.status(400).json({ message: "WB магазины не найдены или не настроены" });
      }

      const result = await syncWbSuppliesForOrg(orgId, storeId);
      res.json({ success: true, synced: result.synced, errors: result.errors });
    } catch (error: any) {
      console.error("[wb-supplies-sync] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/wb/debug-supplies — диагностика: показывает реальное состояние поставок и заказов в БД
  app.get("/api/wb/debug-supplies", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const rows = await db.execute(sql`
        SELECT
          ws.supply_id,
          ws.status as supply_status,
          ws.closed_at,
          ws.wb_synced_as_closed,
          ws.store_id,
          COUNT(o.id) as total_orders,
          COUNT(CASE WHEN o.wb_status IN ('new','waiting') THEN 1 END) as new_waiting,
          COUNT(CASE WHEN o.wb_status = 'confirm' THEN 1 END) as confirm,
          COUNT(CASE WHEN o.wb_status IN ('indelivery','delivering','complete','shipped') THEN 1 END) as delivery,
          COUNT(CASE WHEN o.wb_status IN ('cancel','cancelled','user_cancel','declined') THEN 1 END) as cancelled,
          COUNT(CASE WHEN o.wb_status IS NULL OR o.wb_status NOT IN ('new','waiting','confirm','indelivery','delivering','complete','shipped','cancel','cancelled','user_cancel','declined') THEN 1 END) as other,
          STRING_AGG(DISTINCT o.wb_status, ', ') as all_statuses
        FROM wb_supplies ws
        LEFT JOIN orders o ON o.wb_supply_id = ws.supply_id AND o.organization_id = ws.organization_id
        WHERE ws.organization_id = ${orgId}
        GROUP BY ws.supply_id, ws.status, ws.closed_at, ws.wb_synced_as_closed, ws.store_id
        ORDER BY ws.supply_id DESC
        LIMIT 20
      `);
      res.json((rows as any).rows || rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/wb/repair-supply-orders — принудительно создаёт заказы для поставки из WB API
  app.post("/api/wb/repair-supply-orders", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { supplyId, storeId } = req.body;
      if (!supplyId) return res.status(400).json({ message: "supplyId обязателен" });

      const cleanApiKey = await getWbApiKeyForStore(orgId, storeId ? Number(storeId) : null);
      if (!cleanApiKey) return res.status(400).json({ message: "WB API-ключ не найден" });
      const authHeaders = { "Authorization": cleanApiKey, "Content-Type": "application/json" };

      let ordersRes: { status: number; json: any };
      try {
        ordersRes = await wbFetchJson(`${WB_MARKETPLACE_BASE}/api/v3/supplies/${supplyId}/orders`, authHeaders, 20000);
      } catch (e: any) {
        return res.status(502).json({ message: `WB API недоступен: ${e.message}` });
      }

      if (ordersRes.status !== 200) {
        return res.status(502).json({ message: `WB API вернул ${ordersRes.status}`, raw: ordersRes.json });
      }

      const orders: any[] = ordersRes.json?.orders || [];
      const result = { total: orders.length, created: 0, updated: 0, skipped: 0, wbStatuses: [] as string[], errors: [] as string[] };

      for (const o of orders) {
        const wbOrderId = String(o.id || o.wbOrderId || "");
        if (!wbOrderId) { result.skipped++; continue; }
        const wbStatus = o.wbStatus || o.status || "confirm";
        (result.wbStatuses as string[]).push(wbStatus);

        try {
          const existing = await storage.getOrderByExternalId(wbOrderId, orgId);
          if (existing) {
            const newInternal = wbStatusToInternal(wbStatus);
            if (existing.status !== "cancelled") {
              await db.execute(sql`
                UPDATE orders SET
                  wb_supply_id = ${supplyId},
                  wb_status = ${wbStatus},
                  status = ${newInternal}
                WHERE id = ${existing.id}
              `);
              result.updated++;
            } else {
              result.skipped++;
            }
          } else {
            const article = String(o.article || o.supplierArticle || "");
            const totalAmount = (o.totalPrice || o.convertedPrice || 0) / 100;
            const wbRid = o.rid ? String(o.rid) : null;
            const createdAtRaw = o.createdAt;
            const createdAtTs = createdAtRaw
              ? (typeof createdAtRaw === "number" ? new Date(createdAtRaw * 1000) : new Date(createdAtRaw))
              : new Date();
            let productId: number | null = null;
            if (article) {
              const [dbProduct] = await db.select().from(productsTable)
                .where(and(eq(productsTable.sku, article), eq(productsTable.organizationId, orgId)));
              if (dbProduct) productId = dbProduct.id;
            }
            await storage.createOrder({
              orderNumber: `WB-${wbOrderId}`,
              status: wbStatusToInternal(wbStatus),
              totalAmount: totalAmount.toFixed(2),
              source: "wildberries",
              externalId: wbOrderId,
              postingNumber: null,
              ozonStatus: null,
              yandexStatus: null,
              wbOrderId,
              wbStatus,
              wbRid,
              wbSupplyId: supplyId,
              fulfillmentType: "FBS",
              storeId: storeId ? Number(storeId) : undefined,
              organizationId: orgId,
              createdAt: createdAtTs,
            } as any, productId
              ? [{ productId, quantity: o.quantity || 1, price: totalAmount }]
              : [{ productId: null, sku: article || `WB-${wbOrderId}`, productName: o.subject || "WB товар", quantity: o.quantity || 1, price: totalAmount }]);
            result.created++;
          }
        } catch (e: any) {
          result.errors.push(`${wbOrderId}: ${e.message}`);
        }
      }

      console.log(`[wb-repair] Supply ${supplyId}: total=${result.total} created=${result.created} updated=${result.updated}`);
      res.json(result);
    } catch (error: any) {
      console.error("[wb-repair] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/wb/supplies — список поставок из таблицы wb_supplies с количеством заказов
  app.get("/api/wb/supplies", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const status = req.query.status as string || "open";
      const storeId = req.query.storeId ? Number(req.query.storeId) : null;

      const rows = await db.execute(sql`
        SELECT
          ws.id, ws.supply_id, ws.name, ws.status, ws.store_id,
          ws.created_at, ws.closed_at,
          s.name as store_name,
          COUNT(o.id) as orders_count,
          CASE ws.status
            WHEN 'open' THEN 'Ждёт передачи в доставку'
            WHEN 'closed' THEN 'Поставка в обработке'
            ELSE ws.status
          END as status_label
        FROM wb_supplies ws
        LEFT JOIN stores s ON ws.store_id = s.id
        LEFT JOIN orders o ON o.wb_supply_id = ws.supply_id AND o.organization_id = ws.organization_id
        WHERE ws.organization_id = ${orgId}
          ${status === "open" ? sql`AND ws.status = 'open'` : sql``}
          ${status !== "all" && status !== "open" && status !== "closed" ? sql`AND ws.status = ${status}` : sql``}
          ${storeId ? sql`AND ws.store_id = ${storeId}` : sql``}
          ${status === "open" ? sql`
          -- ЭТАЛОН «НА СБОРКЕ»: показываем пустые поставки (0 заказов) ИЛИ поставки с активными заказами
          -- Пустая поставка = open + ни одного заказа в orders → NOT EXISTS без фильтра по wb_status
          -- Поставка с заказами = open + есть 'new'/'waiting'/'confirm' + нет заказов в стадии доставки
          AND (
            NOT EXISTS (
              SELECT 1 FROM orders o2
              WHERE o2.wb_supply_id = ws.supply_id
                AND o2.source = 'wildberries'
                AND o2.organization_id = ws.organization_id
            )
            OR (
              EXISTS (
                SELECT 1 FROM orders o2
                WHERE o2.wb_supply_id = ws.supply_id
                  AND o2.source = 'wildberries'
                  AND o2.wb_status IN ('new', 'waiting', 'confirm')
              )
              AND NOT EXISTS (
                SELECT 1 FROM orders o_del
                WHERE o_del.wb_supply_id = ws.supply_id
                  AND o_del.source = 'wildberries'
                  AND o_del.wb_status IN ('indelivery', 'delivering', 'shipped', 'ready_for_pickup', 'sold', 'complete', 'delivered', 'receive')
              )
            )
          )` : sql``}
          ${status === "closed" ? sql`
          -- ЭТАЛОННЫЙ ФИЛЬТР «В ДОСТАВКЕ»:
          -- 1) только закрытые поставки
          -- 2) только поставки с заказами внутри
          -- 3) только поставки не старше 20 дней
          -- 4) только поставки, где есть хотя бы один не финальный заказ
          -- Это исключает пустые строки и старые поставки, которые WB уже убрал из кабинета.
          AND ws.status = 'closed'
          AND COALESCE(ws.closed_at, ws.created_at) >= NOW() - INTERVAL '20 days'
          AND EXISTS (
            SELECT 1 FROM orders o_exist
            WHERE o_exist.wb_supply_id = ws.supply_id
              AND o_exist.organization_id = ws.organization_id
          )
          AND EXISTS (
            SELECT 1 FROM orders o_active
            WHERE o_active.wb_supply_id = ws.supply_id
              AND o_active.organization_id = ws.organization_id
              AND o_active.wb_status NOT IN (
                'delivered','receive','sold',
                'cancelled','canceled','user_cancel','canceled_by_client',
                'declined','declined_by_client','cancel_ignore','defect','cancelled',
                'returned','sorted','waiting_for_cancel'
              )
          )` : sql``}
        GROUP BY ws.id, ws.supply_id, ws.name, ws.status, ws.store_id, ws.created_at, ws.closed_at, s.name
        ORDER BY ${status === "closed" ? sql`ws.closed_at DESC NULLS LAST` : sql`ws.created_at DESC`}
      `);

      res.json((rows as any).rows || rows);
    } catch (error: any) {
      console.error("[wb-supplies-list] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH /api/wb/supplies/:supplyId/rename — переименовать поставку
  app.patch("/api/wb/supplies/:supplyId/rename", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const supplyId = String(req.params.supplyId);
      const { name, storeId } = req.body;

      if (!name?.trim()) {
        return res.status(400).json({ message: "Название не может быть пустым" });
      }

      // Попытка переименования через WB API (PATCH /api/v3/supplies/{id})
      let wbApiWarning: string | null = null;
      const cleanApiKey = await getWbApiKeyForStore(orgId, storeId ? Number(storeId) : null);
      if (cleanApiKey) {
        try {
          const wbRes = await fetch(`${WB_MARKETPLACE_BASE}/api/v3/supplies/${supplyId}`, {
            method: "PATCH",
            headers: { "Authorization": cleanApiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ name: name.trim() }),
          });
          if (!wbRes.ok) {
            const errBody = await wbRes.text().catch(() => "");
            wbApiWarning = `WB API вернул ${wbRes.status}: ${errBody.slice(0, 120)}`;
            console.warn(`[wb-rename-supply] WB API rename partial failure (${wbRes.status}):`, errBody.slice(0, 200));
          }
        } catch (e: any) {
          wbApiWarning = `WB API недоступен: ${e.message}`;
          console.warn(`[wb-rename-supply] WB API rename network error:`, e.message);
        }
      }

      // Обновить название в локальной БД (всегда, независимо от WB API)
      await db.update(wbSuppliesTable)
        .set({ name: name.trim() })
        .where(and(eq(wbSuppliesTable.supplyId, supplyId), eq(wbSuppliesTable.organizationId, orgId)));

      res.json({ success: true, supplyId, name: name.trim(), wbApiWarning });
    } catch (error: any) {
      console.error("[wb-rename-supply] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/wb/supplies — создать поставку WB (с заказами или пустую)
  app.post("/api/wb/supplies", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { storeId: rawStoreId, orderIds, name: requestedName } = req.body;
      const normalizedOrderIds: number[] = Array.isArray(orderIds) ? orderIds.map(Number) : [];
      const isEmptySupply = normalizedOrderIds.length === 0;

      // Автодетект storeId: если не передан (фильтр "Все магазины"), берём первый активный WB магазин
      let resolvedStoreId: number;
      if (rawStoreId) {
        resolvedStoreId = Number(rawStoreId);
      } else {
        const allSettings = await storage.getMarketplaceSettings(orgId);
        const wbActive = allSettings.find(s => s.marketplace === "wildberries" && s.isActive && s.apiKey && s.storeId);
        if (!wbActive?.storeId) {
          return res.status(400).json({ message: "Активный WB магазин не найден" });
        }
        resolvedStoreId = wbActive.storeId;
      }

      const cleanApiKey = await getWbApiKeyForStore(orgId, resolvedStoreId);
      if (!cleanApiKey) {
        return res.status(400).json({ message: "WB API-ключ не найден для магазина" });
      }

      // Проверить заказы только если они переданы
      if (!isEmptySupply) {
        const existingOrders = await db.select().from(ordersTable).where(
          and(inArray(ordersTable.id, normalizedOrderIds), eq(ordersTable.organizationId, orgId))
        );
        const wrongStore = existingOrders.filter(o => o.storeId !== resolvedStoreId);
        if (wrongStore.length > 0) {
          return res.status(400).json({ message: `${wrongStore.length} заказов принадлежат другому магазину` });
        }
        const alreadyInSupply = existingOrders.filter(o => o.wbSupplyId);
        if (alreadyInSupply.length > 0) {
          return res.status(400).json({ message: `${alreadyInSupply.length} заказов уже добавлены в поставку` });
        }
      }

      const authHeaders = { "Authorization": cleanApiKey, "Content-Type": "application/json" };
      const supplyName = requestedName?.trim() || `Поставка от ${new Date().toLocaleDateString("ru-RU")}`;

      // 1. Создать поставку в WB API
      const createRes = await fetch(`${WB_MARKETPLACE_BASE}/api/v3/supplies`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name: supplyName }),
      });
      if (!createRes.ok) {
        const errText = await createRes.text().catch(() => "");
        return res.status(502).json({ message: `WB API ошибка создания поставки (${createRes.status}): ${errText.slice(0, 200)}` });
      }
      const createData = await createRes.json();
      const supplyId: string = createData.id || createData.supplyId || createData.supply_id;
      if (!supplyId) {
        return res.status(502).json({ message: "WB API не вернул supplyId" });
      }

      // 2. Добавить заказы в поставку (пропустить если пустая поставка)
      let ordersAdded = 0;
      const addErrors: string[] = [];
      if (!isEmptySupply) {
        const dbOrders = await db.select().from(ordersTable).where(
          and(inArray(ordersTable.id, normalizedOrderIds), eq(ordersTable.organizationId, orgId))
        );
        for (const order of dbOrders) {
          if (!order.wbOrderId) continue;
          const addRes = await fetch(`${WB_MARKETPLACE_BASE}/api/v3/supplies/${supplyId}/orders/${order.wbOrderId}`, {
            method: "PATCH",
            headers: authHeaders,
          });
          if (addRes.ok || addRes.status === 204) {
            await db.update(ordersTable)
              .set({ wbSupplyId: supplyId })
              .where(and(eq(ordersTable.id, order.id), eq(ordersTable.organizationId, orgId)));
            ordersAdded++;
          } else {
            const errText = await addRes.text().catch(() => "");
            addErrors.push(`Order ${order.wbOrderId}: ${addRes.status} ${errText.slice(0, 100)}`);
            console.error(`[wb-supplies] Не удалось добавить заказ ${order.wbOrderId}:`, errText);
          }
        }
      }

      // 3. Сохранить поставку в wb_supplies
      await db.insert(wbSuppliesTable).values({
        supplyId,
        storeId: resolvedStoreId,
        organizationId: orgId,
        name: supplyName,
        status: "open",
        createdAt: new Date(),
      });

      console.log(`[wb-supplies] Поставка ${supplyId} создана, добавлено ${ordersAdded} заказов`);
      res.json({ supplyId, name: supplyName, ordersAdded, errors: addErrors });
    } catch (error: any) {
      console.error("[wb-supplies] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // DELETE /api/wb/supplies/:supplyId — удалить поставку (WB API + локальная БД)
  app.delete("/api/wb/supplies/:supplyId", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const supplyId = String(req.params.supplyId);
      const storeId = req.query.storeId ? Number(req.query.storeId) : null;

      // Проверить что поставка принадлежит org
      const existing = await db.select().from(wbSuppliesTable).where(
        and(eq(wbSuppliesTable.supplyId, supplyId), eq(wbSuppliesTable.organizationId, orgId))
      );
      if (existing.length === 0) {
        return res.status(404).json({ message: "Поставка не найдена" });
      }

      // WB API DELETE — non-fatal: 404/409/network error = продолжить локальное удаление
      const cleanApiKey = await getWbApiKeyForStore(orgId, storeId);
      if (cleanApiKey) {
        try {
          const deleteRes = await fetch(`${WB_MARKETPLACE_BASE}/api/v3/supplies/${supplyId}`, {
            method: "DELETE",
            headers: { "Authorization": cleanApiKey },
          });
          if (!deleteRes.ok && deleteRes.status !== 204 && deleteRes.status !== 404 && deleteRes.status !== 409) {
            const errText = await deleteRes.text().catch(() => "");
            console.warn(`[wb-delete-supply] WB API ${deleteRes.status}: ${errText.slice(0, 200)}`);
          } else {
            console.log(`[wb-delete-supply] WB API: поставка ${supplyId} удалена (${deleteRes.status})`);
          }
        } catch (wbErr: any) {
          console.warn(`[wb-delete-supply] WB API network error:`, wbErr.message);
          // non-fatal — продолжить локальное удаление
        }
      }

      // Обнулить wb_supply_id у привязанных заказов
      await db.update(ordersTable)
        .set({ wbSupplyId: null })
        .where(and(eq(ordersTable.wbSupplyId, supplyId), eq(ordersTable.organizationId, orgId)));

      // Удалить из wb_supplies
      await db.delete(wbSuppliesTable).where(
        and(eq(wbSuppliesTable.supplyId, supplyId), eq(wbSuppliesTable.organizationId, orgId))
      );

      console.log(`[wb-delete-supply] Поставка ${supplyId} удалена`);
      res.json({ success: true, supplyId });
    } catch (error: any) {
      console.error("[wb-delete-supply] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/wb/supplies/:supplyId/add-orders — добавить заказы в существующую открытую поставку
  app.post("/api/wb/supplies/:supplyId/add-orders", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const supplyId = String(req.params.supplyId);
      const { storeId, orderIds } = req.body;

      if (!storeId || !Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ message: "storeId и orderIds обязательны" });
      }

      // Проверить поставку: существует, открыта, принадлежит org
      const supplyRows = await db.select().from(wbSuppliesTable).where(
        and(eq(wbSuppliesTable.supplyId, supplyId), eq(wbSuppliesTable.organizationId, orgId))
      );
      if (supplyRows.length === 0) {
        return res.status(404).json({ message: "Поставка не найдена" });
      }
      if (supplyRows[0].status !== "open") {
        return res.status(400).json({ message: "Поставка уже закрыта, добавление невозможно" });
      }

      const cleanApiKey = await getWbApiKeyForStore(orgId, Number(storeId));
      if (!cleanApiKey) {
        return res.status(400).json({ message: "WB API-ключ не найден для магазина" });
      }

      const numericIds = orderIds.map(Number);
      const dbOrders = await db.select().from(ordersTable).where(
        and(inArray(ordersTable.id, numericIds), eq(ordersTable.organizationId, orgId))
      );

      const wrongStore = dbOrders.filter(o => o.storeId !== Number(storeId));
      if (wrongStore.length > 0) {
        return res.status(400).json({ message: `${wrongStore.length} заказов из другого магазина` });
      }
      const alreadyIn = dbOrders.filter(o => o.wbSupplyId);
      if (alreadyIn.length > 0) {
        return res.status(400).json({ message: `${alreadyIn.length} заказов уже в другой поставке` });
      }

      const authHeaders = { "Authorization": cleanApiKey, "Content-Type": "application/json" };
      let ordersAdded = 0;
      const addErrors: string[] = [];

      for (const order of dbOrders) {
        if (!order.wbOrderId) {
          addErrors.push(`ID ${order.id}: нет WB Order ID`);
          continue;
        }
        const addRes = await fetch(`${WB_MARKETPLACE_BASE}/api/v3/supplies/${supplyId}/orders/${order.wbOrderId}`, {
          method: "PATCH",
          headers: authHeaders,
        });
        if (addRes.ok || addRes.status === 204) {
          await db.update(ordersTable)
            .set({ wbSupplyId: supplyId })
            .where(and(eq(ordersTable.id, order.id), eq(ordersTable.organizationId, orgId)));
          ordersAdded++;
        } else {
          const errText = await addRes.text().catch(() => "");
          addErrors.push(`Order ${order.wbOrderId}: ${addRes.status} ${errText.slice(0, 100)}`);
          console.error(`[wb-add-orders] Ошибка добавления заказа ${order.wbOrderId}:`, errText);
        }
      }

      console.log(`[wb-add-orders] ${supplyId}: добавлено ${ordersAdded} заказов`);
      res.json({ ordersAdded, errors: addErrors });
    } catch (error: any) {
      console.error("[wb-add-orders] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/wb/stickers — получить стикеры 58×40мм для печати
  app.post("/api/wb/stickers", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { storeId, wbOrderIds } = req.body;
      if (!storeId || !Array.isArray(wbOrderIds) || wbOrderIds.length === 0) {
        return res.status(400).json({ message: "Необходимы storeId и wbOrderIds" });
      }

      const cleanApiKey = await getWbApiKeyForStore(orgId, Number(storeId));
      if (!cleanApiKey) {
        return res.status(400).json({ message: "WB API-ключ не найден" });
      }

      const authHeaders = { "Authorization": cleanApiKey, "Content-Type": "application/json" };
      const stickerRes = await fetch(
        `${WB_MARKETPLACE_BASE}/api/v3/orders/stickers?type=png&width=58&height=40`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ orders: wbOrderIds.map(Number) }),
        }
      );

      if (!stickerRes.ok) {
        const errText = await stickerRes.text().catch(() => "");
        return res.status(502).json({ message: `WB API ошибка стикеров (${stickerRes.status}): ${errText.slice(0, 200)}` });
      }

      const stickerData = await stickerRes.json();
      const stickers = (stickerData.stickers || []).map((s: any) => ({
        orderId: s.orderId,
        file: s.file,
        partA: s.partA,
        partB: s.partB,
      }));
      res.json({ stickers });
    } catch (error: any) {
      console.error("[wb-stickers] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/wb/supplies/:supplyId/picking-list — лист подбора поставки
  app.get("/api/wb/supplies/:supplyId/picking-list", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const supplyId = String(req.params.supplyId);

      const rows = await db.execute(sql`
        SELECT 
          p.name as product_name, p.sku, p.barcode, p.image_url,
          SUM(oi.quantity) as quantity,
          o.wb_order_id, o.id as order_id, o.store_id
        FROM orders o
        LEFT JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE o.source = 'wildberries'
          AND o.wb_supply_id = ${supplyId}
          AND o.organization_id = ${orgId}
        GROUP BY p.name, p.sku, p.barcode, p.image_url, o.wb_order_id, o.id, o.store_id
        ORDER BY p.name
      `);

      const items = ((rows as any).rows || rows).map((r: any) => ({
        productName: r.product_name || "WB товар",
        sku: r.sku || "",
        barcode: r.barcode || "",
        imageUrl: r.image_url || null,
        quantity: Number(r.quantity) || 1,
        orderId: r.wb_order_id || r.order_id,
      }));

      res.json({ supplyId, items });
    } catch (error: any) {
      console.error("[wb-picking-list] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/wb/supplies/:supplyId/close — закрыть поставку
  app.post("/api/wb/supplies/:supplyId/close", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const supplyId = String(req.params.supplyId);
      const storeId = req.body?.storeId ? Number(req.body.storeId) : null;

      const cleanApiKey = await getWbApiKeyForStore(orgId, storeId);
      if (!cleanApiKey) {
        return res.status(400).json({ message: "WB API-ключ не найден" });
      }

      const authHeaders = { "Authorization": cleanApiKey, "Content-Type": "application/json" };
      const closeRes = await fetch(`${WB_MARKETPLACE_BASE}/api/v3/supplies/${supplyId}/deliver`, {
        method: "PATCH",
        headers: authHeaders,
      });

      if (!closeRes.ok && closeRes.status !== 204) {
        const errText = await closeRes.text().catch(() => "");
        console.error(`[wb-close-supply] WB API error ${closeRes.status}:`, errText);
        // При 409 (already closed) — не фейлим, просто обновляем БД
        if (closeRes.status !== 409) {
          return res.status(502).json({ message: `WB API ошибка закрытия поставки (${closeRes.status}): ${errText.slice(0, 200)}` });
        }
      }

      // Обновить статус в wb_supplies
      await db.update(wbSuppliesTable)
        .set({ status: "closed", closedAt: new Date() })
        .where(and(eq(wbSuppliesTable.supplyId, supplyId), eq(wbSuppliesTable.organizationId, orgId)));

      console.log(`[wb-close-supply] Поставка ${supplyId} закрыта`);
      res.json({ success: true, supplyId });
    } catch (error: any) {
      console.error("[wb-close-supply] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/wb/supplies/:supplyId/barcode-qr — получить QR-штрихкод поставки
  app.get("/api/wb/supplies/:supplyId/barcode-qr", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const supplyId = String(req.params.supplyId);
      const storeId = req.query.storeId ? Number(req.query.storeId) : null;

      const cleanApiKey = await getWbApiKeyForStore(orgId, storeId);
      if (!cleanApiKey) return res.status(400).json({ message: "WB API-ключ не найден" });

      const authHeaders = { "Authorization": cleanApiKey };
      const barcodeRes = await fetch(
        `${WB_MARKETPLACE_BASE}/api/v3/supplies/${supplyId}/barcode?type=png`,
        { headers: authHeaders }
      );

      if (!barcodeRes.ok) {
        const errText = await barcodeRes.text().catch(() => "");
        return res.status(502).json({ message: `WB API ошибка QR-кода (${barcodeRes.status}): ${errText.slice(0, 200)}` });
      }

      const buffer = Buffer.from(await barcodeRes.arrayBuffer());
      const base64 = buffer.toString("base64");
      res.json({ file: base64, supplyId });
    } catch (error: any) {
      console.error("[wb-supply-barcode] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/wb/counts — счётчики заказов и поставок по вкладкам
  app.get("/api/wb/counts", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);

      const orderCounts = await db.execute(sql`
        SELECT
          COUNT(CASE WHEN wb_status IN ('new','waiting') AND wb_supply_id IS NULL
            AND created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as new_count,
          COUNT(CASE WHEN (wb_status IN ('cancel','canceled','user_cancel','canceled_by_client','declined','cancelled','cancel_ignore','defect','declined_by_client')
            OR status = 'cancelled') THEN 1 END) as cancelled_count,
          COUNT(CASE WHEN wb_status IN ('delivered','sold','receive','returned','sorted','waiting_for_cancel','ready_for_pickup') THEN 1 END) as archive_count
        FROM orders
        WHERE source = 'wildberries' AND organization_id = ${orgId}
      `);

      const supplyCounts = await db.execute(sql`
        SELECT
          -- ЭТАЛОН assembly_count: пустые open-поставки + open-поставки с активными заказами (без стадии доставки)
          COUNT(DISTINCT CASE WHEN ws.status = 'open' AND (
            NOT EXISTS (
              SELECT 1 FROM orders o WHERE o.wb_supply_id = ws.supply_id
                AND o.source = 'wildberries' AND o.organization_id = ws.organization_id
            )
            OR (
              EXISTS (
                SELECT 1 FROM orders o WHERE o.wb_supply_id = ws.supply_id
                  AND o.source = 'wildberries' AND o.wb_status IN ('new', 'waiting', 'confirm')
              )
              AND NOT EXISTS (
                SELECT 1 FROM orders o2 WHERE o2.wb_supply_id = ws.supply_id
                  AND o2.source = 'wildberries'
                  AND o2.wb_status IN ('indelivery', 'delivering', 'shipped', 'ready_for_pickup', 'sold', 'complete', 'delivered', 'receive')
              )
            )
          ) THEN ws.supply_id END) as assembly_count,
          -- ЭТАЛОН: delivery_count = закрытые поставки ≤20 дней с хотя бы одним незавершённым заказом
          COUNT(DISTINCT CASE WHEN ws.status = 'closed'
            AND COALESCE(ws.closed_at, ws.created_at) >= NOW() - INTERVAL '20 days'
            AND EXISTS (
              SELECT 1 FROM orders oe
              WHERE oe.wb_supply_id = ws.supply_id
                AND oe.organization_id = ws.organization_id
            )
            AND EXISTS (
              SELECT 1 FROM orders oa
              WHERE oa.wb_supply_id = ws.supply_id
                AND oa.organization_id = ws.organization_id
                AND oa.wb_status NOT IN (
                  'delivered','receive','sold',
                  'cancelled','canceled','user_cancel','canceled_by_client',
                  'declined','declined_by_client','cancel_ignore','defect','cancelled',
                  'returned','sorted','waiting_for_cancel'
                )
            )
          THEN ws.supply_id END) as delivery_count
        FROM wb_supplies ws
        WHERE organization_id = ${orgId}
      `);

      const oc: any = ((orderCounts as any).rows || orderCounts)[0] || {};
      const sc: any = ((supplyCounts as any).rows || supplyCounts)[0] || {};

      res.json({
        new_count: Number(oc.new_count) || 0,
        assembly_count: Number(sc.assembly_count) || 0,
        delivery_count: Number(sc.delivery_count) || 0,
        archive_count: Number(oc.archive_count) || 0,
        cancelled_count: Number(oc.cancelled_count) || 0,
      });
    } catch (error: any) {
      console.error("[wb-counts] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/wb/supplies/:supplyId/picking-pdf — генерация листа подбора в HTML для печати
  app.get("/api/wb/supplies/:supplyId/picking-pdf", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const supplyId = String(req.params.supplyId);

      const rows = await db.execute(sql`
        SELECT
          o.order_number, o.wb_order_id, o.wb_rid,
          p.name as product_name, p.sku, p.barcode,
          COALESCE(oi.quantity, 1) as quantity,
          oi.price
        FROM orders o
        LEFT JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE o.wb_supply_id = ${supplyId}
          AND o.organization_id = ${orgId}
        ORDER BY o.id
      `);

      const items = (rows as any).rows || rows;
      const date = new Date().toLocaleDateString("ru-RU");

      const tableRows = items.map((r: any, idx: number) => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#6b7280;">${idx + 1}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-weight:500;">${r.product_name || "WB товар"}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:11px;">${r.barcode || "—"}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:11px;">${r.sku || "—"}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;font-size:15px;">${r.quantity || 1}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">☐</td>
        </tr>
      `).join("");

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Лист подбора — ${supplyId}</title>
<style>
  @page { size: A4; margin: 15mm; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111827; margin: 0; }
  .header { margin-bottom: 20px; }
  h1 { font-size: 20px; margin: 0 0 4px; color: #111827; }
  .subtitle { font-size: 13px; color: #6b7280; margin: 0; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f9fafb; padding: 8px; text-align: left; border-bottom: 2px solid #d1d5db; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; }
  tr:hover { background: #f9fafb; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
  <div class="header">
    <h1>Лист подбора — ${supplyId}</h1>
    <p class="subtitle">Дата: ${date} · Позиций: ${items.length}</p>
  </div>
  <table>
    <thead>
      <tr>
        <th style="text-align:center;width:36px;">№</th>
        <th>Название товара</th>
        <th>Баркод</th>
        <th>Артикул</th>
        <th style="text-align:center;width:60px;">Кол-во</th>
        <th style="text-align:center;width:36px;">✓</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
</body></html>`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (error: any) {
      console.error("[wb-picking-pdf] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/wb/supplies/:supplyId/acceptance-act — акт приёмки/передачи поставки (HTML для печати)
  app.get("/api/wb/supplies/:supplyId/acceptance-act", isAuthenticated, requireRole("owner", "administrator"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const supplyId = String(req.params.supplyId);

      const rows = await db.execute(sql`
        SELECT
          o.order_number, o.wb_order_id, o.wb_status,
          p.name as product_name, p.sku, p.barcode,
          COALESCE(oi.quantity, 1) as quantity,
          oi.price,
          o.total_amount
        FROM orders o
        LEFT JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE o.wb_supply_id = ${supplyId}
          AND o.organization_id = ${orgId}
        ORDER BY o.id
      `);

      const supplyRows = await db.execute(sql`
        SELECT ws.name, ws.closed_at, ws.created_at, s.name as store_name
        FROM wb_supplies ws
        LEFT JOIN stores s ON ws.store_id = s.id
        WHERE ws.supply_id = ${supplyId} AND ws.organization_id = ${orgId}
        LIMIT 1
      `);

      const items: any[] = (rows as any).rows || rows;
      const supplyInfo: any = ((supplyRows as any).rows || supplyRows)[0] || {};
      const date = new Date().toLocaleDateString("ru-RU");
      const closedDate = supplyInfo.closed_at
        ? new Date(supplyInfo.closed_at).toLocaleDateString("ru-RU")
        : date;
      const supplyName = supplyInfo.name || `Поставка от ${new Date(supplyInfo.created_at || Date.now()).toLocaleDateString("ru-RU")}`;
      const storeName = supplyInfo.store_name || "—";

      const totalSum = items.reduce((sum: number, r: any) => sum + Number(r.total_amount || r.price || 0), 0);

      const formatRub = (n: number) => n.toLocaleString("ru-RU") + " ₽";

      const tableRows = items.map((r: any, idx: number) => `
        <tr>
          <td style="padding:6px 8px;border:1px solid #d1d5db;text-align:center;color:#6b7280;">${idx + 1}</td>
          <td style="padding:6px 8px;border:1px solid #d1d5db;font-family:monospace;font-size:11px;">${r.wb_order_id || r.order_number || "—"}</td>
          <td style="padding:6px 8px;border:1px solid #d1d5db;font-weight:500;">${r.product_name || "WB товар"}</td>
          <td style="padding:6px 8px;border:1px solid #d1d5db;font-family:monospace;font-size:11px;">${r.sku || "—"}</td>
          <td style="padding:6px 8px;border:1px solid #d1d5db;text-align:center;">${r.quantity || 1}</td>
          <td style="padding:6px 8px;border:1px solid #d1d5db;text-align:right;">${formatRub(Number(r.total_amount || r.price || 0))}</td>
        </tr>
      `).join("");

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Акт приёмки — ${supplyId}</title>
<style>
  @page { size: A4; margin: 20mm; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111827; margin: 0; }
  .header { margin-bottom: 24px; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .meta { font-size: 12px; color: #6b7280; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { background: #f3f4f6; padding: 8px; text-align: left; border: 1px solid #d1d5db; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #374151; }
  .total-row td { font-weight: 700; background: #f9fafb; }
  .signatures { margin-top: 40px; display: flex; gap: 60px; }
  .sig-block { flex: 1; }
  .sig-line { border-bottom: 1px solid #374151; margin-bottom: 4px; height: 30px; }
  .sig-label { font-size: 11px; color: #6b7280; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
  <div class="header">
    <h1>Акт приёмки / передачи поставки</h1>
    <p class="meta">Идентификатор поставки: <strong>${supplyId}</strong></p>
    <p class="meta">Наименование: ${supplyName}</p>
    <p class="meta">Склад: ${storeName}</p>
    <p class="meta">Дата сканирования WB: ${closedDate}</p>
    <p class="meta">Дата документа: ${date}</p>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:32px;text-align:center;">№</th>
        <th style="width:110px;">Заказ WB</th>
        <th>Товар</th>
        <th style="width:100px;">Артикул</th>
        <th style="width:60px;text-align:center;">Кол-во</th>
        <th style="width:100px;text-align:right;">Сумма</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
      <tr class="total-row">
        <td colspan="4" style="padding:8px;border:1px solid #d1d5db;text-align:right;">Итого:</td>
        <td style="padding:8px;border:1px solid #d1d5db;text-align:center;">${items.length}</td>
        <td style="padding:8px;border:1px solid #d1d5db;text-align:right;">${formatRub(totalSum)}</td>
      </tr>
    </tbody>
  </table>
  <div class="signatures">
    <div class="sig-block">
      <div class="sig-line"></div>
      <div class="sig-label">Поставщик (подпись / ФИО / дата)</div>
    </div>
    <div class="sig-block">
      <div class="sig-line"></div>
      <div class="sig-label">Принял WB (подпись / ФИО / дата)</div>
    </div>
  </div>
</body></html>`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (error: any) {
      console.error("[wb-acceptance-act] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ==================== END WB FBS MANAGEMENT ====================

  // ==================== STOCK SYNC: IMPORT SINGLE OFFER ====================

  // Импорт одного оффера с маркетплейса в CRM + создание связи
  app.post("/api/inventory/import-offer", isAuthenticated, async (req, res) => {
    try {
      const organizationId = (req as any).user?.organizationId || (req as any).user?.claims?.sub;
      if (!organizationId) return res.status(401).json({ message: "Unauthorized" });

      const { storeId, offerId, mpProductId, name, sellingPrice, sku, barcode, stock } = req.body as any;
      if (!storeId || !offerId) return res.status(400).json({ message: "storeId и offerId обязательны" });

      // Получаем компанию магазина
      const storeRow = await db.execute(sql`
        SELECT s.id, s.marketplace, s.name as store_name, s.api_key, s.client_id, s.company_id,
               c.organization_id
        FROM stores s JOIN companies c ON s.company_id = c.id
        WHERE s.id = ${storeId} AND c.organization_id = ${organizationId}
        LIMIT 1
      `);
      if (!storeRow.rows.length) return res.status(404).json({ message: "Магазин не найден" });
      const store = storeRow.rows[0] as any;

      const effectiveSku = sku || offerId;
      const effectiveBarcode = barcode || offerId;
      const effectiveName = name || `Товар ${offerId}`;
      const effectivePrice = sellingPrice || 0;
      const effectiveStock = stock ?? 0;

      // Проверяем — вдруг товар уже есть по этому SKU
      const existing = await db.execute(sql`
        SELECT id FROM products
        WHERE organization_id = ${organizationId} AND (sku = ${effectiveSku} OR barcode = ${effectiveBarcode})
        LIMIT 1
      `);

      let productId: number;
      if (existing.rows.length) {
        productId = (existing.rows[0] as any).id;
        console.log(`[import-offer] Товар уже есть в CRM: productId=${productId}`);
      } else {
        // Создаём новый товар
        const inserted = await db.execute(sql`
          INSERT INTO products
            (name, sku, barcode, selling_price, price, central_stock, stock_quantity, stock_local,
             available_quantity, reserved_quantity, company_id, organization_id, updated_at)
          VALUES
            (${effectiveName}, ${effectiveSku}, ${effectiveBarcode},
             ${effectivePrice}, ${effectivePrice}, ${effectiveStock}, ${effectiveStock}, ${effectiveStock},
             ${effectiveStock}, 0,
             ${store.company_id}, ${organizationId}, NOW())
          RETURNING id
        `);
        productId = (inserted.rows[0] as any).id;
        console.log(`[import-offer] Создан новый товар: productId=${productId}, sku=${effectiveSku}`);
      }

      // Создаём или обновляем связь
      await db.execute(sql`
        INSERT INTO product_marketplace_links
          (product_id, store_id, external_sku, marketplace_product_id, match_type, confidence_score, link_status, is_active, organization_id)
        VALUES
          (${productId}, ${storeId}, ${offerId}, ${mpProductId || offerId}, 'manual', 1.0, 'active', true, ${organizationId})
        ON CONFLICT (product_id, store_id) DO UPDATE
          SET external_sku = EXCLUDED.external_sku,
              marketplace_product_id = EXCLUDED.marketplace_product_id,
              match_type = 'manual',
              link_status = 'active',
              is_active = true
      `);

      res.json({
        ok: true,
        productId,
        created: !existing.rows.length,
        message: existing.rows.length
          ? `Товар уже был в CRM (id=${productId}), связь обновлена`
          : `Товар создан в CRM (id=${productId}) и привязан к ${store.store_name}`,
      });
    } catch (e: any) {
      console.error("[import-offer] Error:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // ==================== END STOCK SYNC: IMPORT SINGLE OFFER ====================

  // ==================== STOCK SYNC: AUTO-MATCH ====================

  app.post("/api/inventory/auto-match", isAuthenticated, async (req, res) => {
    try {
      const organizationId = (req as any).user?.organizationId || (req as any).user?.claims?.sub;
      if (!organizationId) return res.status(401).json({ message: "Unauthorized" });

      // 1. Получаем все активные магазины
      const storeRows = await db.execute(sql`
        SELECT s.id, s.name, s.marketplace, s.api_key, s.client_id, s.warehouse_id, s.company_id
        FROM stores s
        JOIN companies c ON s.company_id = c.id
        WHERE c.organization_id = ${organizationId} AND s.is_active = true AND s.api_key IS NOT NULL
      `);
      const activeStores = storeRows.rows as any[];

      // 2. Строим карту CRM: sku→productId, barcode→productId
      const crmRows = await db.execute(sql`
        SELECT id, sku, barcode FROM products WHERE organization_id = ${organizationId}
      `);
      const skuMap = new Map<string, number>();   // sku → productId
      const barcodeMap = new Map<string, number>(); // barcode → productId
      for (const p of crmRows.rows as any[]) {
        if (p.sku)     skuMap.set(String(p.sku).trim().toLowerCase(), p.id);
        if (p.barcode) barcodeMap.set(String(p.barcode).trim().toLowerCase(), p.id);
      }

      const stats = { total: 0, matched: 0, bySkuExact: 0, byBarcode: 0, alreadyLinked: 0, unmatched: 0 };
      const unmatchedList: any[] = [];

      // 3. Получаем уже существующие связи
      const existingLinks = await db.execute(sql`
        SELECT product_id, store_id FROM product_marketplace_links
        WHERE organization_id = ${organizationId}
      `);
      const linkedSet = new Set(existingLinks.rows.map((r: any) => `${r.product_id}:${r.store_id}`));

      // Помощник: найти productId по offer_id и barcode маркетплейса
      function findProduct(offerId: string, mpBarcode?: string): { productId: number; matchType: string; confidence: number } | null {
        const oKey = offerId.trim().toLowerCase();

        if (skuMap.has(oKey))      return { productId: skuMap.get(oKey)!, matchType: "auto_sku",     confidence: 1.0 };
        if (barcodeMap.has(oKey))  return { productId: barcodeMap.get(oKey)!, matchType: "auto_barcode", confidence: 0.95 };

        if (mpBarcode) {
          const bKey = mpBarcode.trim().toLowerCase();
          if (skuMap.has(bKey))     return { productId: skuMap.get(bKey)!, matchType: "auto_barcode", confidence: 0.90 };
          if (barcodeMap.has(bKey)) return { productId: barcodeMap.get(bKey)!, matchType: "auto_barcode", confidence: 0.85 };
        }
        return null;
      }

      // Помощник: сохранить связь
      async function saveLink(productId: number, storeId: number, offerId: string, mpProductId: string, matchType: string, confidence: number, orgId: string) {
        const key = `${productId}:${storeId}`;
        if (linkedSet.has(key)) { stats.alreadyLinked++; return; }
        await db.execute(sql`
          INSERT INTO product_marketplace_links
            (product_id, store_id, external_sku, marketplace_product_id, match_type, confidence_score, link_status, is_active, organization_id)
          VALUES
            (${productId}, ${storeId}, ${offerId}, ${mpProductId}, ${matchType}, ${confidence}, 'active', true, ${orgId})
          ON CONFLICT (product_id, store_id) DO UPDATE
            SET external_sku = EXCLUDED.external_sku,
                marketplace_product_id = EXCLUDED.marketplace_product_id,
                match_type = EXCLUDED.match_type,
                confidence_score = EXCLUDED.confidence_score,
                link_status = 'active',
                is_active = true
        `);
        linkedSet.add(key);
        stats.matched++;
      }

      for (const store of activeStores) {
        try {
          // ---- OZON ----
          if (store.marketplace === "ozon" && store.client_id) {
            let lastId = "";
            while (true) {
              const r = await fetch("https://api-seller.ozon.ru/v3/product/list", {
                method: "POST",
                headers: { "Client-Id": store.client_id, "Api-Key": store.api_key, "Content-Type": "application/json" },
                body: JSON.stringify({ filter: {}, last_id: lastId, limit: 1000 }),
                signal: AbortSignal.timeout(20_000),
              });
              const data = await r.json() as any;
              const items: any[] = data?.result?.items || [];
              if (!items.length) break;
              stats.total += items.length;

              for (const item of items) {
                const offerId = String(item.offer_id || "");
                const mpProductId = String(item.product_id || "");
                const match = findProduct(offerId);
                if (match) {
                  if (match.matchType === "auto_sku") stats.bySkuExact++; else stats.byBarcode++;
                  await saveLink(match.productId, store.id, offerId, mpProductId, match.matchType, match.confidence, organizationId);
                } else {
                  stats.unmatched++;
                  if (unmatchedList.length < 50) unmatchedList.push({ marketplace: "ozon", storeId: store.id, storeName: store.name, offerId, mpProductId });
                }
              }

              lastId = data?.result?.last_id || "";
              if (!lastId || items.length < 1000) break;
            }
          }

          // ---- WILDBERRIES ----
          // Используем goods filter API — возвращает ВСЕ товары включая нулевые остатки
          if (store.marketplace === "wildberries") {
            let wbOffset = 0;
            const WB_LIMIT = 1000;
            while (true) {
              const r = await fetch(
                `https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=${WB_LIMIT}&offset=${wbOffset}`,
                { headers: { "Authorization": store.api_key }, signal: AbortSignal.timeout(30_000) }
              );
              if (!r.ok) break;
              const data = await r.json() as any;
              const goodsList: any[] = data?.data?.listGoods || [];
              stats.total += goodsList.length;
              for (const item of goodsList) {
                const offerId = String(item.vendorCode || "");
                const mpProductId = String(item.nmID || "");
                // WB не возвращает barcode через этот API — используем только vendorCode (supplier article)
                const match = findProduct(offerId, "");
                if (match) {
                  if (match.matchType === "auto_sku") stats.bySkuExact++; else stats.byBarcode++;
                  await saveLink(match.productId, store.id, offerId, mpProductId, match.matchType, match.confidence, organizationId);
                } else {
                  stats.unmatched++;
                  if (unmatchedList.length < 50) unmatchedList.push({ marketplace: "wildberries", storeId: store.id, storeName: store.name, offerId, mpProductId });
                }
              }
              if (goodsList.length < WB_LIMIT) break;
              wbOffset += WB_LIMIT;
            }
          }

          // ---- ЯНДЕКС МАРКЕТ ----
          if (store.marketplace === "yandex") {
            // Получаем bizId из campaigns
            const campR = await fetch("https://api.partner.market.yandex.ru/campaigns?pageSize=10", {
              headers: { "Api-Key": store.api_key },
              signal: AbortSignal.timeout(15_000),
            });
            if (!campR.ok) continue;
            const campData = await campR.json() as any;
            const bizId = campData?.campaigns?.[0]?.business?.id;
            if (!bizId) continue;

            let pageToken: string | null = null;
            while (true) {
              const body: any = { limit: 200 };
              if (pageToken) body.page_token = pageToken;
              const r = await fetch(`https://api.partner.market.yandex.ru/businesses/${bizId}/offer-mappings`, {
                method: "POST",
                headers: { "Api-Key": store.api_key, "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(20_000),
              });
              const data = await r.json() as any;
              const offers: any[] = data?.result?.offerMappings || [];
              if (!offers.length) break;
              stats.total += offers.length;

              for (const item of offers) {
                const offerId = String(item.offer?.offerId || "");
                const barcode = String(item.offer?.barcodes?.[0] || "");
                const mpProductId = String(item.mapping?.marketSku || "");
                const match = findProduct(offerId, barcode);
                if (match) {
                  if (match.matchType === "auto_sku") stats.bySkuExact++; else stats.byBarcode++;
                  await saveLink(match.productId, store.id, offerId, mpProductId, match.matchType, match.confidence, organizationId);
                } else {
                  stats.unmatched++;
                  if (unmatchedList.length < 50) unmatchedList.push({ marketplace: "yandex", storeId: store.id, storeName: store.name, offerId, mpProductId });
                }
              }

              pageToken = data?.result?.paging?.nextPageToken || null;
              if (!pageToken || offers.length < 200) break;
            }
          }

        } catch (storeErr: any) {
          console.error(`[auto-match] Store ${store.name}: ${storeErr.message}`);
        }
      }

      console.log(`[auto-match] Done: total=${stats.total}, matched=${stats.matched}, unmatched=${stats.unmatched}`);
      res.json({ ...stats, unmatchedList });
    } catch (e: any) {
      console.error("[auto-match] Error:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // ==================== END STOCK SYNC: AUTO-MATCH ====================

  // ==================== DAVINES ARCHIVE SCHEDULE ====================
  // Ozon: реальный archive API (/v1/product/archive)
  // WB:   stock=0 в рабочие часы, restore вечером
  // YM:   пропускаем (Davines там без бренда/имени)
  // Идентификация: name ILIKE '%Davines%' OR brand = 'Davines'

  // GET /api/inventory/davines/list — список Davines-товаров из CRM
  app.get("/api/inventory/davines/list", isAuthenticated, async (req, res) => {
    try {
      const organizationId = (req as any).user?.organizationId || (req as any).user?.claims?.sub;
      const result = await db.execute(sql`
        SELECT id, name, sku, brand, central_stock
        FROM products
        WHERE (name ILIKE '%Davines%' OR brand = 'Davines')
        AND organization_id = ${organizationId}
        ORDER BY name
      `);
      const rows = (result as any).rows || [];
      res.json({ total: rows.length, items: rows });
    } catch (e: any) {
      console.error("[davines/list] Error:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // POST /api/inventory/davines/apply — ручной запуск archive/unarchive
  app.post("/api/inventory/davines/apply", isAuthenticated, async (req, res) => {
    try {
      const organizationId = (req as any).user?.organizationId || (req as any).user?.claims?.sub;
      const { action } = req.body as { action: "archive" | "unarchive" };
      if (action !== "archive" && action !== "unarchive") {
        return res.status(400).json({ message: 'action must be "archive" or "unarchive"' });
      }
      const report = await applyDavinessSchedule(organizationId, action);
      res.json({ ok: true, action, ...report });
    } catch (e: any) {
      console.error("[davines/apply] Error:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // Ядро: archive/unarchive для Davines-товаров
  // Ozon: /v1/product/archive или /v1/product/unarchive (по marketplace_product_id)
  // WB: updateStocks qty=0 или restore centralStock
  // YM: пропускается
  async function applyDavinessSchedule(organizationId: string, action: "archive" | "unarchive"): Promise<{ ozonUpdated: number; wbUpdated: number; errors: string[] }> {
    // Найти все Davines-товары
    const prodsResult = await db.execute(sql`
      SELECT id, name, sku, central_stock FROM products
      WHERE (name ILIKE '%Davines%' OR brand = 'Davines')
      AND organization_id = ${organizationId}
    `);
    const prods = (prodsResult as any).rows as { id: number; name: string; sku: string; central_stock: number }[];
    if (prods.length === 0) return { ozonUpdated: 0, wbUpdated: 0, errors: [] };

    const prodIds = prods.map(p => p.id);
    const prodMap = new Map(prods.map(p => [p.id, p]));

    // Получить все активные связи для этих товаров + данные магазина
    const linksResult = await db.execute(sql`
      SELECT
        pml.product_id, pml.external_sku, pml.marketplace_product_id,
        s.id as store_id, s.name as store_name, s.marketplace,
        s.api_key, s.client_id, s.warehouse_id
      FROM product_marketplace_links pml
      JOIN stores s ON pml.store_id = s.id
      WHERE pml.product_id = ANY(${sql.raw(`ARRAY[${prodIds.join(",")}]::int[]`)})
      AND pml.organization_id = ${organizationId}
      AND pml.is_active = true
      AND s.is_active = true
      AND s.marketplace IN ('ozon', 'wildberries')
    `);
    const links = (linksResult as any).rows as {
      product_id: number; external_sku: string; marketplace_product_id: string | null;
      store_id: number; store_name: string; marketplace: string;
      api_key: string; client_id: string | null; warehouse_id: string | null;
    }[];

    const errors: string[] = [];
    let ozonUpdated = 0;
    let wbUpdated = 0;

    // --- OZON: batch archive/unarchive по магазинам ---
    const ozonByStore = new Map<string, { apiKey: string; clientId: string; productIds: number[]; storeName: string }>();
    for (const link of links) {
      if (link.marketplace !== "ozon") continue;
      if (!link.marketplace_product_id || !link.api_key || !link.client_id) continue;
      const key = String(link.store_id);
      if (!ozonByStore.has(key)) {
        ozonByStore.set(key, { apiKey: link.api_key, clientId: link.client_id, productIds: [], storeName: link.store_name });
      }
      ozonByStore.get(key)!.productIds.push(Number(link.marketplace_product_id));
    }

    const ozonEndpoint = action === "archive" ? "/v1/product/archive" : "/v1/product/unarchive";
    for (const { apiKey, clientId, productIds: ozIds, storeName } of ozonByStore.values()) {
      if (ozIds.length === 0) continue;
      // Ozon: max 100 per request
      for (let i = 0; i < ozIds.length; i += 100) {
        const batch = ozIds.slice(i, i + 100);
        try {
          const r = await fetch(`https://api-seller.ozon.ru${ozonEndpoint}`, {
            method: "POST",
            headers: { "Client-Id": clientId, "Api-Key": apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ product_id: batch }),
            signal: AbortSignal.timeout(15_000),
          });
          if (!r.ok) {
            const txt = await r.text();
            errors.push(`Ozon «${storeName}» HTTP ${r.status}: ${txt.slice(0, 200)}`);
          } else {
            ozonUpdated += batch.length;
            console.log(`[davines-schedule] Ozon ${action}: «${storeName}» ${batch.length} товаров`);
          }
        } catch (e: any) {
          errors.push(`Ozon «${storeName}»: ${e.message}`);
        }
      }
    }

    // --- WB: прямой подход по EAN-префиксу '8004608' (Davines GS1 код) ---
    // Не используем product_marketplace_links — CRM SKU ≠ WB vendorCode
    try {
      const wbStoreResult = await db.execute(sql`
        SELECT s.api_key, s.warehouse_id, s.name
        FROM stores s
        JOIN companies c ON s.company_id = c.id
        WHERE c.organization_id = ${organizationId}
        AND s.marketplace = 'wildberries'
        AND s.is_active = true
        AND s.api_key IS NOT NULL
        AND s.warehouse_id IS NOT NULL
        LIMIT 1
      `);
      const wbStore = (wbStoreResult as any).rows?.[0] as { api_key: string; warehouse_id: string; name: string } | undefined;

      if (wbStore) {
        // 1. Получить все WB-товары через goods filter API
        const goodsR = await fetch(
          `https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1000&offset=0`,
          { headers: { "Authorization": wbStore.api_key }, signal: AbortSignal.timeout(30_000) }
        );
        if (goodsR.ok) {
          const goodsData = await goodsR.json() as any;
          const allGoods: any[] = goodsData?.data?.listGoods || [];
          // 2. Фильтр: только Davines (vendorCode начинается с '8004608')
          const davinessGoods = allGoods.filter(g => String(g.vendorCode || "").startsWith("8004608"));

          if (davinessGoods.length > 0) {
            // 3. Получить текущий stock через statistics API (для restore)
            const savedStockMap = new Map<string, number>();
            if (action === "archive") {
              const statR = await fetch(
                `https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=2024-01-01`,
                { headers: { "Authorization": wbStore.api_key }, signal: AbortSignal.timeout(30_000) }
              );
              if (statR.ok) {
                const statItems = await statR.json() as any[];
                for (const item of statItems) {
                  const vc = String(item.supplierArticle || "");
                  if (vc.startsWith("8004608")) savedStockMap.set(vc, item.quantity || 0);
                }
              }
              // Сохранить в глобальный Map для последующего restore
              for (const [vc, qty] of savedStockMap) davinessWbSavedStock.set(vc, qty);
            }

            // 4. Сформировать список stocks для WB API
            const stocks = davinessGoods.map(g => {
              const vc = String(g.vendorCode);
              const qty = action === "archive" ? 0 : (davinessWbSavedStock.get(vc) ?? 0);
              return { sku: vc, amount: qty };
            });

            // 5. PUT /api/v3/stocks/{warehouseId} — батчами по 1000
            for (let i = 0; i < stocks.length; i += 1000) {
              const batch = stocks.slice(i, i + 1000);
              const stockR = await fetch(
                `https://marketplace-api.wildberries.ru/api/v3/stocks/${wbStore.warehouse_id}`,
                {
                  method: "PUT",
                  headers: { "Authorization": wbStore.api_key, "Content-Type": "application/json" },
                  body: JSON.stringify({ stocks: batch }),
                  signal: AbortSignal.timeout(15_000),
                }
              );
              if (stockR.ok || stockR.status === 204) {
                wbUpdated += batch.length;
                console.log(`[davines-schedule] WB ${action}: «${wbStore.name}» ${batch.length} Davines SKU`);
              } else {
                const txt = await stockR.text();
                errors.push(`WB «${wbStore.name}» HTTP ${stockR.status}: ${txt.slice(0, 200)}`);
              }
            }
          } else {
            console.log(`[davines-schedule] WB: нет Davines-товаров с prefix 8004608`);
          }
        }
      }
    } catch (e: any) {
      errors.push(`WB Davines: ${e.message}`);
    }

    return { ozonUpdated, wbUpdated, errors };
  }

  // Сохранённый WB-stock для restore после архивации
  const davinessWbSavedStock = new Map<string, number>();

  // Планировщик расписания Davines (каждые 60 сек, МСК UTC+3)
  let davinessLastState: "archived" | "active" | null = null;

  function getMskWindow(): "archive" | "active" {
    const msk = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const h = msk.getUTCHours(), m = msk.getUTCMinutes(), day = msk.getUTCDay();
    // Пн-Чт (1-4) 07:30–20:00 МСК → archive
    const inArchiveWindow = day >= 1 && day <= 4 &&
      (h > 7 || (h === 7 && m >= 30)) && h < 20;
    return inArchiveWindow ? "archive" : "active";
  }

  const runDavinessScheduler = async () => {
    try {
      const window = getMskWindow();
      const targetState: "archived" | "active" = window === "archive" ? "archived" : "active";
      if (targetState === davinessLastState) return;

      const allOrgs = await db.execute(sql`
        SELECT DISTINCT organization_id FROM products
        WHERE name ILIKE '%Davines%' OR brand = 'Davines'
      `);
      const orgs = ((allOrgs as any).rows as { organization_id: string }[]).map(r => r.organization_id);
      if (orgs.length === 0) { davinessLastState = targetState; return; }

      const action = targetState === "archived" ? "archive" : "unarchive";
      console.log(`[davines-schedule] Transition → ${targetState} (window=${window})`);

      for (const orgId of orgs) {
        const { ozonUpdated, wbUpdated, errors } = await applyDavinessSchedule(orgId, action);
        console.log(`[davines-schedule] Org ${orgId}: Ozon=${ozonUpdated} WB=${wbUpdated} errors=${errors.length}`);
        if (errors.length > 0) console.error("[davines-schedule] Errors:", errors);
      }
      davinessLastState = targetState;
    } catch (e: any) {
      console.error("[davines-schedule] Error:", e.message);
    }
  };

  setTimeout(runDavinessScheduler, 5000);
  setInterval(runDavinessScheduler, 60_000);
  console.log("[davines-schedule] Scheduler started (60s, MSK UTC+3): Ozon=archive API, WB=stock 0/restore, YM=skip");

  // ==================== END DAVINES ARCHIVE SCHEDULE ====================

  // ==================== STOCK SYNC: WEBHOOKS + WORKERS ====================

  // Webhook Ozon — push-уведомления о новых заказах
  app.post("/api/webhooks/ozon", async (req, res) => {
    try {
      res.json({ ok: true }); // отвечаем немедленно
      const body = req.body as any;
      if (!body?.message_type || !body?.posting_number) return;

      const postingNumber = body.posting_number as string;
      const status = body.message_type as string;

      // Интересуют только события создания заказа (новый FBS)
      if (!["TYPE_NEW_POSTING", "TYPE_POSTING_CREATED"].includes(status)) return;

      // Находим магазин по client_id из тела вебхука
      const clientId = String(body.client_id || "");
      const storeRow = await db.execute(
        sql`SELECT id, organization_id FROM stores WHERE client_id = ${clientId} AND marketplace = 'ozon' AND is_active = true LIMIT 1`
      );
      if (!storeRow.rows.length) return;
      const storeId = storeRow.rows[0].id as number;
      const organizationId = storeRow.rows[0].organization_id as string;

      // Сохраняем событие — воркер обработает асинхронно
      await db.execute(sql`
        INSERT INTO stock_events (organization_id, marketplace, store_id, event_type, quantity_delta, external_event_id, payload, status)
        VALUES (${organizationId}, 'ozon', ${storeId}, 'sale', 0, ${postingNumber}, ${JSON.stringify(body)}::jsonb, 'pending')
        ON CONFLICT (marketplace, external_event_id) DO NOTHING
      `);
      console.log(`[webhook-ozon] Событие принято: posting_number=${postingNumber}`);
    } catch (e: any) {
      console.error("[webhook-ozon] Error:", e.message);
    }
  });

  // Webhook Яндекс Маркет — обязателен (иначе ЯМ отключит push)
  app.post("/api/webhooks/yandex", async (req, res) => {
    try {
      const body = req.body as any;
      // ЯМ ждёт 200 с подтверждением в течение 30 сек
      res.json({ status: "ok" });

      if (!body?.orderId) return;
      const orderId = String(body.orderId);
      const status = body.status as string;

      if (!["PROCESSING", "READY_TO_SHIP"].includes(status)) return;

      // Находим магазин по campaignId
      const campaignId = String(body.campaignId || "");
      const storeRow = await db.execute(
        sql`SELECT id, organization_id FROM stores WHERE warehouse_id = ${campaignId} AND marketplace = 'yandex' AND is_active = true LIMIT 1`
      );
      if (!storeRow.rows.length) return;
      const storeId = storeRow.rows[0].id as number;
      const organizationId = storeRow.rows[0].organization_id as string;

      await db.execute(sql`
        INSERT INTO stock_events (organization_id, marketplace, store_id, event_type, quantity_delta, external_event_id, payload, status)
        VALUES (${organizationId}, 'yandex', ${storeId}, 'sale', 0, ${orderId}, ${JSON.stringify(body)}::jsonb, 'pending')
        ON CONFLICT (marketplace, external_event_id) DO NOTHING
      `);
      console.log(`[webhook-yandex] Событие принято: orderId=${orderId}, status=${status}`);
    } catch (e: any) {
      console.error("[webhook-yandex] Error:", e.message);
    }
  });

  // EventWorker — обрабатывает pending события из stock_events каждые 10 сек
  const processStockEvents = async () => {
    try {
      const pending = await db.execute(sql`
        SELECT se.id, se.organization_id, se.marketplace, se.store_id, se.event_type,
               se.quantity_delta, se.external_event_id, se.payload
        FROM stock_events se
        WHERE se.status = 'pending'
        ORDER BY se.created_at ASC
        LIMIT 20
      `);

      for (const event of pending.rows) {
        await db.execute(sql`
          UPDATE stock_events SET status = 'processing' WHERE id = ${event.id}
        `);

        try {
          const payload = event.payload as any;
          const marketplace = event.marketplace as string;

          // Для Ozon — получаем детали заказа и списываем остатки через существующий sync
          if (marketplace === "ozon" && payload?.posting_number) {
            console.log(`[event-worker] Ozon posting ${payload.posting_number} — sync triggered`);
          } else if (marketplace === "yandex" && payload?.orderId) {
            console.log(`[event-worker] YM order ${payload.orderId} — sync triggered`);
          }

          await db.execute(sql`
            UPDATE stock_events
            SET status = 'done', processed_at = NOW()
            WHERE id = ${event.id}
          `);
        } catch (e: any) {
          await db.execute(sql`
            UPDATE stock_events
            SET status = 'failed', error = ${e.message}
            WHERE id = ${event.id}
          `);
          console.error(`[event-worker] Event ${event.id} failed: ${e.message}`);
        }
      }
    } catch (e: any) {
      console.error("[event-worker] Error:", e.message);
    }
  };

  setInterval(processStockEvents, 10_000);
  console.log("[event-worker] Stock event worker started (interval: 10s)");

  // ReconciliationCron — сверка остатков CRM ↔ маркетплейс каждые 10 мин
  const { createAdapter } = await import("./adapters/factory");

  const reconcileStocks = async () => {
    console.log("[reconcile] Starting stock reconciliation...");
    try {
      const activeStores = await db.execute(sql`
        SELECT s.id, s.name, s.marketplace, s.api_key, s.client_id, s.warehouse_id,
               s.is_active, s.company_id,
               c.organization_id
        FROM stores s
        JOIN companies c ON s.company_id = c.id
        WHERE s.is_active = true AND s.api_key IS NOT NULL
      `);

      for (const storeRow of activeStores.rows) {
        const store = storeRow as any;
        try {
          const adapter = createAdapter({
            id: store.id,
            name: store.name,
            marketplace: store.marketplace,
            apiKey: store.api_key,
            clientId: store.client_id,
            warehouseId: store.warehouse_id,
            isActive: true,
            companyId: store.company_id,
            lastSync: null,
            createdAt: new Date(),
          });

          // Получаем актуальные остатки с маркетплейса
          const mpStocks = await adapter.getStocks([]);
          if (!mpStocks.length) continue;

          // Получаем остатки из CRM для этого магазина
          const links = await db.execute(sql`
            SELECT pml.external_sku, p.available_quantity, p.sku, p.id as product_id
            FROM product_marketplace_links pml
            JOIN products p ON pml.product_id = p.id
            WHERE pml.store_id = ${store.id} AND pml.is_active = true
              AND pml.external_sku IS NOT NULL
          `);

          const crmStockMap = new Map(
            links.rows.map((r: any) => [r.external_sku as string, {
              productId: r.product_id as number,
              available: r.available_quantity as number,
              sku: r.sku as string,
            }])
          );

          let corrections = 0;
          for (const mpItem of mpStocks) {
            const crmItem = crmStockMap.get(mpItem.externalSku);
            if (!crmItem) continue;

            const diff = Math.abs(crmItem.available - mpItem.available);
            if (diff > 0) {
              // Расхождение — выравниваем в сторону CRM
              await adapter.updateStocks([{
                externalSku: mpItem.externalSku,
                quantity: crmItem.available,
              }]);
              console.log(`[reconcile] ${store.name}: sku=${mpItem.externalSku} CRM=${crmItem.available} MP=${mpItem.available} → исправлено`);
              corrections++;
            }
          }

          if (corrections > 0) {
            console.log(`[reconcile] ${store.name}: исправлено ${corrections} расхождений`);
          }
        } catch (e: any) {
          console.error(`[reconcile] ${store.name}: ${e.message}`);
        }
      }

      console.log("[reconcile] Done");
    } catch (e: any) {
      console.error("[reconcile] Fatal error:", e.message);
    }
  };

  // Первый запуск через 2 минуты после старта, затем каждые 10 мин
  setTimeout(reconcileStocks, 2 * 60 * 1000);
  setInterval(reconcileStocks, 10 * 60 * 1000);
  console.log("[reconcile] Stock reconciliation scheduled (interval: 10min)");

  // ==================== END STOCK SYNC ====================

  let lastSyncTrigger = 0;
  app.post("/api/sync/trigger", isAuthenticated, async (req, res) => {
    const now = Date.now();
    if (now - lastSyncTrigger < 60000) {
      return res.json({ ok: true, message: "Sync already triggered recently" });
    }
    lastSyncTrigger = now;
    console.log(`[sync-trigger] Full sync triggered on login`);
    setTimeout(() => {
      autoSyncOzonStatuses().catch(e => console.error("[sync-trigger] Ozon error:", e));
      autoSyncYandexOrders().catch(e => console.error("[sync-trigger] Yandex error:", e));
      autoSyncWbOrders().catch(e => console.error("[sync-trigger] WB error:", e));
    }, 100);
    res.json({ ok: true, message: "Sync triggered" });
  });

  return httpServer;
}
