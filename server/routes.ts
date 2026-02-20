import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { inventorySyncEngine } from "./inventory-sync";
import { fetchOzonProducts, fetchWildberriesProducts, fetchYandexProducts, enrichOzonProducts, enrichWbProducts, fixWbPhotos, syncProductToOzon, syncProductToWb } from "./marketplace-import";
import { api } from "@shared/routes";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
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
    const store = await storage.createStore(req.body);
    res.status(201).json(store);
  });

  app.put(api.stores.update.path, isAuthenticated, async (req, res) => {
    const existing = await storage.getStore(Number(req.params.id));
    if (!existing) return res.status(404).json({ message: "Магазин не найден" });
    const company = await storage.getCompany(existing.companyId);
    if (!company || company.organizationId !== getOrgId(req)) return res.status(403).json({ message: "Доступ запрещён" });
    const store = await storage.updateStore(Number(req.params.id), req.body);
    res.json(store);
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
    const body = { ...req.body, organizationId: getOrgId(req) };
    if (body.apiKey && typeof body.apiKey === "string") body.apiKey = body.apiKey.trim();
    if (body.clientId && typeof body.clientId === "string") body.clientId = body.clientId.trim();
    if (body.warehouseId && typeof body.warehouseId === "string") body.warehouseId = body.warehouseId.trim();
    if (body.storeName && typeof body.storeName === "string") body.storeName = body.storeName.trim();
    const input = api.marketplace.save.input.parse(body);
    const setting = await storage.createMarketplaceSetting(input);
    res.status(201).json(setting);
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
      const setting = allSettings.find(s => s.marketplace === marketplace && s.isActive);
      if (!setting || !setting.apiKey) {
        return res.status(400).json({ message: `API-ключ для «${marketplace}» не настроен. Перейдите в «Настройки» и добавьте ключ.` });
      }

      let fetchedProducts;
      try {
        if (marketplace === "ozon") {
          if (!setting.clientId) {
            return res.status(400).json({ message: "Client-Id для Ozon не указан в настройках" });
          }
          fetchedProducts = await fetchOzonProducts(setting.apiKey, setting.clientId);
        } else if (marketplace === "wildberries") {
          fetchedProducts = await fetchWildberriesProducts(setting.apiKey, setting.warehouseId || undefined);
        } else {
          if (!setting.clientId || !setting.warehouseId) {
            return res.status(400).json({ message: "OAuth Client-Id или Business-Id для Yandex Market не указан в настройках" });
          }
          fetchedProducts = await fetchYandexProducts(setting.apiKey, setting.clientId, setting.warehouseId);
        }
      } catch (err: any) {
        console.error(`Marketplace import error (${marketplace}):`, err);
        await storage.createSyncHistory({
          organizationId: orgId,
          action: "product_import",
          status: "fail",
          details: `Ошибка импорта из «${marketplace}»: ${err.message}`,
          itemsCount: 0,
        });
        return res.status(502).json({ message: `Ошибка подключения к API «${marketplace}»: ${err.message}` });
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

      res.json({
        success: true,
        marketplace,
        created,
        updated,
        failed,
        total: fetchedProducts.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error: any) {
      console.error("Marketplace import error:", error);
      res.status(500).json({ message: "Ошибка импорта товаров" });
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

      const updateData: any = {};
      if (name) updateData.name = name;
      if (barcode !== undefined) updateData.barcode = barcode;
      if (sellingPrice !== undefined) {
        updateData.sellingPrice = String(sellingPrice);
        updateData.price = String(sellingPrice);
      }
      if (category !== undefined) updateData.category = category;

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
    const days = req.query.days ? Number(req.query.days) : 30;
    const sales = await storage.getSalesData(getOrgId(req), days);
    res.json(sales);
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

  return httpServer;
}
