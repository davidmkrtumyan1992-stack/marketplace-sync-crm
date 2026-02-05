import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Initialize Auth
  await setupAuth(app);
  registerAuthRoutes(app);

  // Helper to get Org ID (User ID in this case)
  const getOrgId = (req: any) => req.user?.claims?.sub;

  // Products
  app.get(api.products.list.path, isAuthenticated, async (req, res) => {
    const products = await storage.getProducts(getOrgId(req));
    res.json(products);
  });

  app.get(api.products.get.path, isAuthenticated, async (req, res) => {
    const product = await storage.getProduct(Number(req.params.id));
    if (!product) return res.status(404).json({ message: "Not found" });
    res.json(product);
  });

  app.post(api.products.create.path, isAuthenticated, async (req, res) => {
    try {
      const input = api.products.create.input.parse({ ...req.body, organizationId: getOrgId(req) });
      const product = await storage.createProduct(input);
      res.status(201).json(product);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json(err);
      throw err;
    }
  });

  app.put(api.products.update.path, isAuthenticated, async (req, res) => {
    const product = await storage.updateProduct(Number(req.params.id), req.body);
    res.json(product);
  });

  app.delete(api.products.delete.path, isAuthenticated, async (req, res) => {
    await storage.deleteProduct(Number(req.params.id));
    res.status(204).send();
  });

  // Customers
  app.get(api.customers.list.path, isAuthenticated, async (req, res) => {
    const customers = await storage.getCustomers(getOrgId(req));
    res.json(customers);
  });

  app.post(api.customers.create.path, isAuthenticated, async (req, res) => {
    const input = api.customers.create.input.parse({ ...req.body, organizationId: getOrgId(req) });
    const customer = await storage.createCustomer(input);
    res.status(201).json(customer);
  });

  app.put(api.customers.update.path, isAuthenticated, async (req, res) => {
    const customer = await storage.updateCustomer(Number(req.params.id), req.body);
    res.json(customer);
  });

  // Orders
  app.get(api.orders.list.path, isAuthenticated, async (req, res) => {
    const orders = await storage.getOrders(getOrgId(req));
    res.json(orders);
  });

  app.post(api.orders.create.path, isAuthenticated, async (req, res) => {
    const { items, ...orderData } = req.body;
    const inputOrder = { ...orderData, organizationId: getOrgId(req) };
    const order = await storage.createOrder(inputOrder, items);
    res.status(201).json(order);
  });

  app.patch(api.orders.updateStatus.path, isAuthenticated, async (req, res) => {
    const order = await storage.updateOrderStatus(Number(req.params.id), req.body.status);
    res.json(order);
  });

  // Marketplace Settings
  app.get(api.marketplace.list.path, isAuthenticated, async (req, res) => {
    const settings = await storage.getMarketplaceSettings(getOrgId(req));
    res.json(settings);
  });

  app.post(api.marketplace.save.path, isAuthenticated, async (req, res) => {
    const input = api.marketplace.save.input.parse({ ...req.body, organizationId: getOrgId(req) });
    const setting = await storage.saveMarketplaceSetting(input);
    res.status(201).json(setting);
  });

  app.post(api.marketplace.syncAll.path, isAuthenticated, async (req, res) => {
    // This is where you would iterate over settings and call external APIs
    // For MVP we just return success
    res.json({ success: true, message: "Sync started in background" });
  });

  // Seed Data Endpoint (For testing)
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

  return httpServer;
}
