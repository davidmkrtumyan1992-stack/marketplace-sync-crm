import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { inventorySyncEngine } from "./inventory-sync";
import { fetchOzonProducts, fetchWildberriesProducts, fetchYandexProducts, enrichOzonProducts, enrichWbProducts, fixWbPhotos, syncProductToOzon, syncProductToWb } from "./marketplace-import";
import { api } from "@shared/routes";
import { marketplaceSettings as marketplaceSettingsTable, products as productsTable, orders as ordersTable, productMarketplaceLinks } from "@shared/schema";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { db } from "./db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

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
          const testRes = await fetch("https://api-seller.ozon.ru/v3/product/list", {
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
          const testRes = await fetch("https://common-api.wildberries.ru/api/v1/warehouses", {
            method: "GET",
            headers: {
              "Authorization": apiKey,
              "Content-Type": "application/json",
            },
          });
          if (!testRes.ok) {
            if (testRes.status === 401 || testRes.status === 403) {
              return res.json({ success: false, message: "Неверный API-ключ Wildberries" });
            }
            const errText = await testRes.text().catch(() => "");
            return res.json({ success: false, message: `Ошибка WB API (${testRes.status}): ${errText.slice(0, 200) || "Нет деталей"}` });
          }
          return res.json({ success: true, message: "Подключение к Wildberries успешно" });
        } catch (error: any) {
          return res.json({ success: false, message: `Ошибка сети: ${error.message}` });
        }
      }

      return res.json({ success: false, message: "Неизвестный маркетплейс" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/stores/:id", isAuthenticated, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await storage.getStore(id);
      if (!existing) return res.status(404).json({ message: "Магазин не найден" });
      const company = await storage.getCompany(existing.companyId);
      if (!company || company.organizationId !== getOrgId(req)) return res.status(403).json({ message: "Доступ запрещён" });
      await storage.deleteStore(id);
      res.json({ success: true });
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
            const ozonRes = await fetch("https://api-seller.ozon.ru/v1/product/import/prices", {
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
          const ozonRes = await fetch("https://api-seller.ozon.ru/v3/product/info", {
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

      const infoRes = await fetch("https://api-seller.ozon.ru/v3/product/info", {
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
        const commRes = await fetch("https://api-seller.ozon.ru/v1/category/commission", {
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
    const orgId = getOrgId(req);
    const productsList = await storage.getProducts(orgId);
    const expensesList = await storage.getExpenses(orgId);
    const taxSetting = await storage.getTaxSettings(orgId);
    const taxRate = Number(taxSetting?.taxRate || 7) / 100;

    let totalRevenue = 0, totalCost = 0;
    for (const p of productsList) {
      totalRevenue += p.stockQuantity * Number(p.sellingPrice || p.price || 0);
      totalCost += p.stockQuantity * Number(p.purchasePrice || 0);
    }
    const totalExpenses = expensesList.reduce((s, e) => s + Number(e.amount), 0);
    const tax = totalRevenue * taxRate;
    const profit = totalRevenue - totalCost - totalExpenses - tax;

    const ws = XLSX.utils.json_to_sheet([
      { "Показатель": "Выручка", "Сумма": totalRevenue },
      { "Показатель": "Себестоимость", "Сумма": totalCost },
      { "Показатель": "Расходы", "Сумма": totalExpenses },
      { "Показатель": `Налог (${(taxRate * 100).toFixed(0)}%)`, "Сумма": tax },
      { "Показатель": "Прибыль", "Сумма": profit },
      {},
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

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const storeResults: { storeName: string; storeId: number | null; created: number; updated: number; skippedNoSku: number; error?: string }[] = [];

      for (const ozonSetting of ozonSettings) {
        const { storeId: resolvedStoreId, companyId: resolvedCompanyId, storeName: resolvedStoreName } = await resolveStoreForSetting(ozonSetting);
        const displayName = resolvedStoreName || ozonSetting.storeName || `Client ${ozonSetting.clientId}`;
        let storeCreated = 0;
        let storeUpdated = 0;
        let storeSkippedNoSku = 0;
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
            const ozonCreatedAt = posting.created_at ? new Date(posting.created_at) : undefined;
            const existingOrder = await storage.getOrderByPostingNumber(postingNumber, orgId, resolvedStoreId);

            if (existingOrder) {
              const internalStatus = ozonStatusToInternal(ozonStatus);
              const needsStatusUpdate = existingOrder.ozonStatus !== ozonStatus;
              const needsDateUpdate = ozonCreatedAt && existingOrder.createdAt &&
                Math.abs(new Date(existingOrder.createdAt).getTime() - ozonCreatedAt.getTime()) > 60000;
              if (needsStatusUpdate || needsDateUpdate) {
                await storage.updateOrderOzonStatus(existingOrder.id, ozonStatus, internalStatus, needsDateUpdate ? ozonCreatedAt : undefined);
                updated++;
                storeUpdated++;
              } else {
                skipped++;
              }
              continue;
            }

            const items: { productId: number; quantity: number; price: number }[] = [];
            let totalAmount = 0;

            for (const prod of posting.products || []) {
              const sku = prod.offer_id || "";
              const qty = prod.quantity || 1;
              const price = parseFloat(prod.price || "0");

              if (sku) {
                const [dbProduct] = await db.select().from(productsTable)
                  .where(and(eq(productsTable.sku, sku), eq(productsTable.organizationId, orgId)));

                if (dbProduct) {
                  items.push({ productId: dbProduct.id, quantity: qty, price });
                  totalAmount += price * qty;
                }
              }
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
                createdAt: ozonCreatedAt || undefined,
              }, items);
              created++;
              storeCreated++;
            } else {
              storeSkippedNoSku++;
            }
          }
        };

        const fbsResponse = await fetch(`${BASE}/v3/posting/fbs/list`, {
          method: "POST", headers, body: JSON.stringify(body),
        });
        if (fbsResponse.ok) {
          const fbsData = await fbsResponse.json();
          const fbsPostings = fbsData?.result?.postings || [];
          console.log(`[ozon-sync-orders] Store «${displayName}» FBS: ${fbsPostings.length} postings`);
          await syncPostings(fbsPostings, "FBS");
        } else {
          const errText = await fbsResponse.text().catch(() => "");
          const errMsg = fbsResponse.status === 401 || fbsResponse.status === 403
            ? `Ошибка авторизации для магазина «${displayName}» (код ${fbsResponse.status})`
            : `Ошибка API для магазина «${displayName}» (код ${fbsResponse.status})`;
          console.error(`[ozon-sync-orders] Store «${displayName}» FBS API error ${fbsResponse.status}: ${errText}`);
          storeError = errMsg;
        }

        const fboResponse = await fetch(`${BASE}/v2/posting/fbo/list`, {
          method: "POST", headers, body: JSON.stringify({ dir: "ASC", filter: { since: since.toISOString(), to: new Date().toISOString(), status: "" }, limit: 50, offset: 0, with: { analytics_data: false, financial_data: false } }),
        });
        if (fboResponse.ok) {
          const fboData = await fboResponse.json();
          const fboPostings = fboData?.result || [];
          console.log(`[ozon-sync-orders] Store «${displayName}» FBO: ${fboPostings.length} postings`);
          await syncPostings(fboPostings, "FBO");
        } else {
          const errText = await fboResponse.text().catch(() => "");
          if (!storeError) {
            storeError = fboResponse.status === 401 || fboResponse.status === 403
              ? `Ошибка авторизации для магазина «${displayName}» (код ${fboResponse.status})`
              : `Ошибка API для магазина «${displayName}» (код ${fboResponse.status})`;
          }
          console.error(`[ozon-sync-orders] Store «${displayName}» FBO API error ${fboResponse.status}: ${errText}`);
        }

        storeResults.push({ storeName: displayName, storeId: resolvedStoreId, created: storeCreated, updated: storeUpdated, skippedNoSku: storeSkippedNoSku, error: storeError });
      }

      console.log(`[ozon-sync-orders] Sync complete: created=${created}, updated=${updated}, skipped=${skipped}`);
      res.json({ success: true, created, updated, skipped, storeResults });
    } catch (error: any) {
      console.error("[ozon-sync-orders] Error:", error);
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
      const getPostingRes = await fetch(`${BASE}/v3/posting/fbs/get`, {
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

      const response = await fetch(`${BASE}/v3/posting/fbs/ship`, {
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

      const response = await fetch(`${BASE}/v2/posting/fbs/cancel`, {
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

      const createRes = await fetch(`${BASE}/v2/posting/fbs/package-label/create`, {
        method: "POST",
        headers,
        body: JSON.stringify({ posting_number: [order.postingNumber] }),
      });

      if (!createRes.ok) {
        const errText = await createRes.text().catch(() => "");
        console.error(`[ozon-label] Create API error ${createRes.status}:`, errText.slice(0, 500));
        const fallbackRes = await fetch(`${BASE}/v2/posting/fbs/package-label`, {
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
        const directRes = await fetch(`${BASE}/v2/posting/fbs/package-label`, {
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
        const getRes = await fetch(`${BASE}/v1/posting/fbs/package-label/get`, {
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

      const createRes = await fetch(`${BASE}/v2/posting/fbs/package-label/create`, {
        method: "POST",
        headers,
        body: JSON.stringify({ posting_number: postingNumbers }),
      });

      if (!createRes.ok) {
        const fallbackRes = await fetch(`${BASE}/v2/posting/fbs/package-label`, {
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
        const directRes = await fetch(`${BASE}/v2/posting/fbs/package-label`, {
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
        const getRes = await fetch(`${BASE}/v1/posting/fbs/package-label/get`, {
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

        const fbsResponse = await fetch(`${BASE}/v3/posting/fbs/list`, {
          method: "POST", headers, body: JSON.stringify(body),
        });
        if (fbsResponse.ok) {
          const fbsData = await fbsResponse.json();
          for (const p of (fbsData?.result?.postings || [])) {
            allPostings.set(p.posting_number, p);
          }
        }

        const fboResponse = await fetch(`${BASE}/v2/posting/fbo/list`, {
          method: "POST", headers,
          body: JSON.stringify({ ...body, with: { analytics_data: false, financial_data: false } }),
        });
        if (fboResponse.ok) {
          const fboData = await fboResponse.json();
          for (const p of (fboData?.result || [])) {
            allPostings.set(p.posting_number, p);
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
          const needsDateUpdate = ozonCreatedAt && order.createdAt &&
            Math.abs(new Date(order.createdAt).getTime() - ozonCreatedAt.getTime()) > 60000;

          if (needsStatusUpdate || needsDateUpdate) {
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
      since.setDate(since.getDate() - 30);

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
            while (hasMore) {
              const yandexStatuses = ['NEW', 'PROCESSING', 'READY_TO_SHIP', 'DELIVERY', 'PICKUP', 'DELIVERED', 'CANCELLED', 'RETURNED'];
              const statusParams = yandexStatuses.map(s => `status=${s}`).join('&');
              const ordersRes = await fetch(
                `${YANDEX_BASE}/campaigns/${campaignId}/orders?${statusParams}&fromDate=${since.toISOString().split("T")[0]}&page=${page}&pageSize=50`,
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

              for (const yOrder of ordersList) {
                const yOrderId = String(yOrder.id);
                const yStatus = yOrder.status || "NEW";
                const yCreatedAt = yOrder.createdAt ? new Date(yOrder.createdAt) : undefined;

                const existingOrder = await storage.getOrderByExternalId(yOrderId, orgId, resolvedStoreId);

                if (existingOrder) {
                  const internalStatus = yandexStatusToInternal(yStatus);
                  if (existingOrder.yandexStatus !== yStatus) {
                    await storage.updateOrderYandexStatus(existingOrder.id, yStatus, internalStatus, yCreatedAt);
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
                  const price = parseFloat(yItem.price || yItem.buyerPrice || "0");

                  if (sku) {
                    const [dbProduct] = await db.select().from(productsTable)
                      .where(and(eq(productsTable.sku, sku), eq(productsTable.organizationId, orgId)));
                    if (dbProduct) {
                      items.push({ productId: dbProduct.id, quantity: qty, price });
                      totalAmount += price * qty;
                    }
                  }
                }

                if (items.length > 0) {
                  const internalStatus = yandexStatusToInternal(yStatus);
                  await storage.createOrder({
                    orderNumber: `YM-${yOrderId}`,
                    status: internalStatus,
                    totalAmount: totalAmount.toFixed(2),
                    source: "yandex",
                    externalId: yOrderId,
                    postingNumber: null,
                    ozonStatus: null,
                    yandexStatus: yStatus,
                    fulfillmentType: "FBS",
                    storeId: resolvedStoreId ?? undefined,
                    sourceStoreName: resolvedStoreName ?? undefined,
                    companyId: resolvedCompanyId ?? undefined,
                    organizationId: orgId,
                    createdAt: yCreatedAt || undefined,
                  }, items);
                  created++;
                  storeCreated++;
                } else {
                  storeSkippedNoSku++;
                }
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
              const ozonCreatedAt = posting.created_at ? new Date(posting.created_at) : undefined;

              if (existingPostingNumbers.has(pn)) {
                const existing = allStoreOrders.find(o => o.postingNumber === pn);
                if (existing && existing.ozonStatus !== newStatus) {
                  const internalStatus = ozonStatusToInternal(newStatus);
                  const needsDateUpdate = ozonCreatedAt && existing.createdAt &&
                    Math.abs(new Date(existing.createdAt).getTime() - ozonCreatedAt.getTime()) > 60000;
                  await storage.updateOrderOzonStatus(existing.id, newStatus, internalStatus, needsDateUpdate ? ozonCreatedAt : undefined);
                  updated++;
                }
              } else {
                const items: { productId: number; quantity: number; price: number }[] = [];
                let totalAmount = 0;
                for (const prod of posting.products || []) {
                  const sku = prod.offer_id || "";
                  const qty = prod.quantity || 1;
                  const price = parseFloat(prod.price || "0");
                  if (sku) {
                    const [dbProduct] = await db.select().from(productsTable)
                      .where(and(eq(productsTable.sku, sku), eq(productsTable.organizationId, orgId)));
                    if (dbProduct) {
                      items.push({ productId: dbProduct.id, quantity: qty, price });
                      totalAmount += price * qty;
                    }
                  }
                }
                if (items.length > 0) {
                  const internalStatus = ozonStatusToInternal(newStatus);
                  await storage.createOrder({
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
                    createdAt: ozonCreatedAt || undefined,
                  }, items);
                  existingPostingNumbers.add(pn);
                  created++;
                } else {
                  console.log(`[ozon-auto-sync] Skipped posting ${pn}: no matching SKUs in DB`);
                }
              }
            } catch (err: any) {
              console.error(`[ozon-auto-sync] Error processing posting ${posting.posting_number}:`, err.message);
            }
          }
        };

        const fbsResponse = await fetch(`${BASE}/v3/posting/fbs/list`, {
          method: "POST", headers, body: JSON.stringify(body),
        });
        if (fbsResponse.ok) {
          const fbsData = await fbsResponse.json();
          const fbsPostings = fbsData?.result?.postings || [];
          await syncAutoPostings(fbsPostings, "FBS");
        }

        const fboResponse = await fetch(`${BASE}/v2/posting/fbo/list`, {
          method: "POST", headers,
          body: JSON.stringify({ dir: "ASC", filter: { since: since.toISOString(), to: new Date().toISOString(), status: "" }, limit: 1000, offset: 0, with: { analytics_data: false, financial_data: false } }),
        });
        if (fboResponse.ok) {
          const fboData = await fboResponse.json();
          const fboPostings = fboData?.result || [];
          await syncAutoPostings(fboPostings, "FBO");
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
        since.setDate(since.getDate() - 7);
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

            for (const campaign of campaigns) {
              const campaignId = String(campaign.id);
              let page = 1;
              let hasMore = true;
              while (hasMore) {
                const yandexStatuses = ['NEW', 'PROCESSING', 'READY_TO_SHIP', 'DELIVERY', 'PICKUP', 'DELIVERED', 'CANCELLED', 'RETURNED'];
                const statusParams = yandexStatuses.map(s => `status=${s}`).join('&');
                const ordersRes = await fetch(
                  `${YANDEX_BASE}/campaigns/${campaignId}/orders?${statusParams}&fromDate=${since.toISOString().split("T")[0]}&page=${page}&pageSize=50`,
                  { method: "GET", headers: authHeaders }
                );
                if (!ordersRes.ok) { hasMore = false; break; }
                const ordersData = await ordersRes.json();
                const ordersList = ordersData?.orders || [];
                const pager = ordersData?.pager;

                for (const yOrder of ordersList) {
                  const yOrderId = String(yOrder.id);
                  const yStatus = yOrder.status || "NEW";
                  const yCreatedAt = yOrder.createdAt ? new Date(yOrder.createdAt) : undefined;
                  const existingOrder = await storage.getOrderByExternalId(yOrderId, orgId, resolvedStoreId);

                  if (existingOrder) {
                    if (existingOrder.yandexStatus !== yStatus) {
                      const internalStatus = yandexStatusToInternal(yStatus);
                      await storage.updateOrderYandexStatus(existingOrder.id, yStatus, internalStatus, yCreatedAt);
                      updated++;
                    }
                  } else {
                    const items: { productId: number; quantity: number; price: number }[] = [];
                    let totalAmount = 0;
                    for (const yItem of yOrder.items || []) {
                      const sku = yItem.offerId || yItem.shopSku || "";
                      const qty = yItem.count || 1;
                      const price = parseFloat(yItem.price || yItem.buyerPrice || "0");
                      if (sku) {
                        const [dbProduct] = await db.select().from(productsTable)
                          .where(and(eq(productsTable.sku, sku), eq(productsTable.organizationId, orgId)));
                        if (dbProduct) {
                          items.push({ productId: dbProduct.id, quantity: qty, price });
                          totalAmount += price * qty;
                        }
                      }
                    }
                    if (items.length > 0) {
                      await storage.createOrder({
                        orderNumber: `YM-${yOrderId}`,
                        status: yandexStatusToInternal(yStatus),
                        totalAmount: totalAmount.toFixed(2),
                        source: "yandex",
                        externalId: yOrderId,
                        postingNumber: null,
                        ozonStatus: null,
                        yandexStatus: yStatus,
                        fulfillmentType: "FBS",
                        storeId: resolvedStoreId ?? undefined,
                        sourceStoreName: resolvedStoreName ?? undefined,
                        companyId: resolvedCompanyId ?? undefined,
                        organizationId: orgId,
                        createdAt: yCreatedAt || undefined,
                      }, items);
                      created++;
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
    }, 100);
    res.json({ ok: true, message: "Sync triggered" });
  });

  return httpServer;
}
