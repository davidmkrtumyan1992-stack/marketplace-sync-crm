import { Layout } from "@/components/Layout";
import { useMarketplaceSettings, useSaveMarketplaceSettings, useSyncAllMarketplaces } from "@/hooks/use-marketplace";
import { useTaxSettings, useSaveTaxSettings } from "@/hooks/use-tax-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertMarketplaceSettingsSchema, type InsertMarketplaceSetting, type InsertTaxSetting, type SyncHistoryEntry, type Store, type StockSyncLogEntry, type InventorySyncSetting } from "@shared/schema";
import { RefreshCw, CheckCircle2, Calculator, Percent, Truck, History, Shield, XCircle, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { formatNumber } from "@/lib/format";
import { getMarketplaceStyle, detectMarketplaceFromName } from "@/lib/marketplace";

const ACTION_LABELS: Record<string, string> = {
  stock_sync: "Синхронизация остатков",
  order_status_push: "Статус заказа",
};

export default function Settings() {
  const { data: settings } = useMarketplaceSettings();
  const { data: taxSettings, isLoading: taxLoading } = useTaxSettings();
  const { mutate: syncAll, isPending: isSyncing } = useSyncAllMarketplaces();
  const { mutate: saveTax, isPending: savingTax } = useSaveTaxSettings();

  const ozonSettings = settings?.find((s: any) => s.marketplace === "ozon");
  const wbSettings = settings?.find((s: any) => s.marketplace === "wildberries");

  return (
    <Layout>
      <div className="space-y-8 max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Настройки</h1>
            <p className="text-muted-foreground mt-2 text-lg">Интеграции и налоговые параметры</p>
          </div>
          <Button onClick={() => syncAll()} disabled={isSyncing} variant="outline" data-testid="button-sync-all-header">
            <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? "animate-spin" : ""}`} />
            Синхронизировать всё
          </Button>
        </div>

        <Tabs defaultValue="settings">
          <TabsList>
            <TabsTrigger value="settings" data-testid="tab-settings">Настройки</TabsTrigger>
            <TabsTrigger value="safety-stock" data-testid="tab-safety-stock">Резервный остаток</TabsTrigger>
            <TabsTrigger value="sync-log" data-testid="tab-sync-log">Лог синхронизации</TabsTrigger>
            <TabsTrigger value="sync-history" data-testid="tab-sync-history">Синхронизация</TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="space-y-6 mt-6">
            <TaxSettingsCard 
              settings={taxSettings || undefined} 
              isLoading={taxLoading}
              onSave={saveTax}
              isSaving={savingTax}
            />

            <div className="grid gap-6">
              <MarketplaceCard 
                title="Ozon" 
                marketplace="ozon"
                description="Синхронизация товаров и заказов через Ozon Seller API."
                existingSettings={ozonSettings}
                logoColor="text-blue-600"
              />
              
              <MarketplaceCard 
                title="Wildberries" 
                marketplace="wildberries"
                description="Подключите ваш партнёрский аккаунт WB через API ключ."
                existingSettings={wbSettings}
                logoColor="text-purple-600"
              />
            </div>
          </TabsContent>

          <TabsContent value="safety-stock" className="mt-6">
            <SafetyStockSection />
          </TabsContent>

          <TabsContent value="sync-log" className="mt-6">
            <StockSyncLogSection />
          </TabsContent>

          <TabsContent value="sync-history" className="mt-6">
            <SyncHistorySection />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

function SyncHistorySection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: syncSettings } = useQuery<InventorySyncSetting>({
    queryKey: ["/api/inventory-sync/settings"],
  });

  const demoMode = syncSettings?.demoMode ?? false;

  const toggleDemoMutation = useMutation({
    mutationFn: async (newDemoMode: boolean) => {
      await apiRequest("POST", "/api/inventory-sync/settings", {
        defaultSafetyStock: syncSettings?.defaultSafetyStock ?? 2,
        syncEnabled: syncSettings?.syncEnabled ?? true,
        demoMode: newDemoMode,
      });
      return newDemoMode;
    },
    onSuccess: (newDemoMode: boolean) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-sync/settings"] });
      toast({
        title: newDemoMode ? "Демо-режим включён" : "Демо-режим выключен",
        description: newDemoMode ? "API-запросы будут имитироваться без обращения к маркетплейсам" : "API-запросы будут отправляться на реальные серверы",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const { data: syncHistory, isLoading } = useQuery<SyncHistoryEntry[]>({
    queryKey: ["/api/sync-history"],
  });

  const { data: stores } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  const { mutate: syncAll, isPending: isSyncingAll } = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/marketplace/sync");
    },
    onSuccess: () => {
      const msg = demoMode ? "[ДЕМО] Синхронизация завершена" : "Полная синхронизация всех маркетплейсов";
      toast({ title: "Синхронизация запущена", description: msg });
      queryClient.invalidateQueries({ queryKey: ["/api/sync-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-sync/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-sync/logs"] });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const { mutate: syncStore, isPending: isSyncingStore } = useMutation({
    mutationFn: async (storeId: number) => {
      await apiRequest("POST", `/api/marketplace/sync-store/${storeId}`);
    },
    onSuccess: () => {
      const msg = demoMode ? "[ДЕМО] Синхронизация магазина завершена" : "Синхронизация магазина запущена";
      toast({ title: "Синхронизация запущена", description: msg });
      queryClient.invalidateQueries({ queryKey: ["/api/sync-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-sync/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-sync/logs"] });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6" data-testid="section-sync-history">
      <Card>
        <CardHeader className="bg-muted/50 border-b">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-card rounded-lg border shadow-sm text-amber-500">
                <RefreshCw className="w-6 h-6" />
              </div>
              <div>
                <CardTitle>Демо-режим</CardTitle>
                <CardDescription>
                  В демо-режиме API-запросы к маркетплейсам имитируются без обращения к реальным серверам
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {demoMode && (
                <Badge variant="outline" className="text-amber-600 border-amber-400" data-testid="badge-demo-active">
                  Демо
                </Badge>
              )}
              <Switch
                checked={demoMode}
                onCheckedChange={(val) => toggleDemoMutation.mutate(val)}
                disabled={toggleDemoMutation.isPending}
                data-testid="switch-demo-mode"
              />
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="bg-muted/50 border-b">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-card rounded-lg border shadow-sm text-primary">
                <History className="w-6 h-6" />
              </div>
              <div>
                <CardTitle>История синхронизации</CardTitle>
                <CardDescription>Журнал операций синхронизации с маркетплейсами</CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {stores && stores.length > 0 && stores.map((store) => (
                <Button
                  key={store.id}
                  variant="outline"
                  size="sm"
                  disabled={isSyncingStore}
                  onClick={() => syncStore(store.id)}
                  data-testid={`button-sync-store-${store.id}`}
                >
                  <RefreshCw className={`w-3 h-3 mr-1 ${isSyncingStore ? "animate-spin" : ""}`} />
                  {store.name}
                </Button>
              ))}
              <Button onClick={() => syncAll()} disabled={isSyncingAll} data-testid="button-sync-all">
                <RefreshCw className={`w-4 h-4 mr-2 ${isSyncingAll ? "animate-spin" : ""}`} />
                Синхронизировать всё
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
          ) : !syncHistory || syncHistory.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Нет записей синхронизации</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Магазин</TableHead>
                  <TableHead>Действие</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Детали</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {syncHistory.map((entry) => {
                  const store = stores?.find((s) => s.id === entry.storeId);
                  const mpKey = store?.marketplace || detectMarketplaceFromName(entry.details || "");
                  const mpStyle = mpKey ? getMarketplaceStyle(mpKey) : null;

                  return (
                    <TableRow key={entry.id} data-testid={`row-sync-${entry.id}`}>
                      <TableCell data-testid={`text-sync-date-${entry.id}`}>
                        {entry.createdAt
                          ? format(new Date(entry.createdAt), "dd MMM yyyy, HH:mm", { locale: ru })
                          : "—"}
                      </TableCell>
                      <TableCell data-testid={`text-sync-store-${entry.id}`}>
                        <div className="flex items-center gap-2">
                          {mpStyle && (
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded"
                              style={{ backgroundColor: mpStyle.bg, color: mpStyle.color }}
                              data-testid={`badge-sync-marketplace-${entry.id}`}
                            >
                              {mpStyle.label}
                            </span>
                          )}
                          <span className="truncate max-w-[180px]">{store?.name || entry.details || "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell data-testid={`text-sync-action-${entry.id}`}>
                        {ACTION_LABELS[entry.action] || entry.action}
                      </TableCell>
                      <TableCell data-testid={`text-sync-status-${entry.id}`}>
                        <Badge
                          variant={entry.status === "success" ? "default" : "destructive"}
                          className={entry.status === "success" ? "bg-green-600 text-white no-default-hover-elevate no-default-active-elevate" : ""}
                        >
                          {entry.status === "success" ? "Успешно" : "Ошибка"}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`text-sync-details-${entry.id}`}>
                        {entry.itemsCount != null && entry.itemsCount > 0
                          ? `${entry.itemsCount} элементов`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const taxFormSchema = z.object({
  taxSystem: z.enum(["usn_6", "usn_15"]),
  defaultLogisticsCost: z.coerce.number(),
  defaultMarketplaceCommission: z.coerce.number(),
});

function TaxSettingsCard({ 
  settings, 
  isLoading, 
  onSave, 
  isSaving 
}: { 
  settings?: any; 
  isLoading: boolean; 
  onSave: (data: InsertTaxSetting) => void; 
  isSaving: boolean;
}) {
  const form = useForm<z.infer<typeof taxFormSchema>>({
    resolver: zodResolver(taxFormSchema),
    defaultValues: {
      taxSystem: "usn_6",
      defaultLogisticsCost: 100,
      defaultMarketplaceCommission: 15,
    }
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        taxSystem: settings.taxSystem || "usn_6",
        defaultLogisticsCost: Number(settings.defaultLogisticsCost) || 100,
        defaultMarketplaceCommission: Number(settings.defaultMarketplaceCommission) || 15,
      });
    }
  }, [settings, form]);

  const onSubmit = (data: z.infer<typeof taxFormSchema>) => {
    onSave({
      taxSystem: data.taxSystem,
      defaultLogisticsCost: data.defaultLogisticsCost.toString(),
      defaultMarketplaceCommission: data.defaultMarketplaceCommission.toString(),
    } as InsertTaxSetting);
  };

  return (
    <Card className="dashboard-card overflow-hidden">
      <CardHeader className="bg-muted/50 border-b">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-card rounded-lg border shadow-sm text-primary">
            <Calculator className="w-6 h-6" />
          </div>
          <div>
            <CardTitle>Налоговые настройки</CardTitle>
            <CardDescription>Система налогообложения и базовые расходы</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        {isLoading ? (
          <div className="text-center py-4 text-muted-foreground">Загрузка...</div>
        ) : (
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-4">
              <Label className="text-base font-medium">Система налогообложения</Label>
              <RadioGroup 
                value={form.watch("taxSystem")} 
                onValueChange={(val) => form.setValue("taxSystem", val as "usn_6" | "usn_15")}
                className="grid gap-3"
              >
                <div className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-muted cursor-pointer">
                  <RadioGroupItem value="usn_6" id="usn_6" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="usn_6" className="font-medium cursor-pointer">
                      УСН «Доходы» 6%
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Налог = Выручка × 6%. Простая схема без учёта расходов.
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-muted cursor-pointer">
                  <RadioGroupItem value="usn_15" id="usn_15" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="usn_15" className="font-medium cursor-pointer">
                      УСН «Доходы минус Расходы» 15%
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Налог = (Выручка − Расходы) × 15%. Минимум 1% от выручки.
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Truck className="w-4 h-4" />
                  Логистика по умолчанию, ₽
                </Label>
                <Input 
                  type="number" 
                  step="0.01"
                  {...form.register("defaultLogisticsCost")} 
                  placeholder="100"
                />
                <p className="text-xs text-muted-foreground">За единицу товара</p>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Percent className="w-4 h-4" />
                  Комиссия маркетплейса, %
                </Label>
                <Input 
                  type="number" 
                  step="0.1"
                  {...form.register("defaultMarketplaceCommission")} 
                  placeholder="15"
                />
                <p className="text-xs text-muted-foreground">Средняя комиссия</p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Сохранение..." : "Сохранить настройки"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function MarketplaceCard({ 
  title, 
  marketplace, 
  description, 
  existingSettings,
  logoColor 
}: { 
  title: string; 
  marketplace: string; 
  description: string;
  existingSettings?: any;
  logoColor: string;
}) {
  const { mutate, isPending } = useSaveMarketplaceSettings();
  
  const form = useForm({
    defaultValues: {
      marketplace,
      apiKey: "",
      clientId: "",
      warehouseId: "",
      isActive: true,
    }
  });

  useEffect(() => {
    if (existingSettings) {
      form.reset({
        marketplace,
        apiKey: existingSettings.apiKey,
        clientId: existingSettings.clientId || "",
        warehouseId: existingSettings.warehouseId || "",
        isActive: existingSettings.isActive,
      });
    }
  }, [existingSettings, form, marketplace]);

  const onSubmit = (data: any) => {
    mutate(data as InsertMarketplaceSetting);
  };

  return (
    <Card className="dashboard-card overflow-hidden">
      <CardHeader className="bg-muted/50 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 bg-card rounded-lg border shadow-sm ${logoColor}`}>
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor={`${marketplace}-active`} className="text-sm text-muted-foreground">Активен</Label>
            <Switch 
              id={`${marketplace}-active`}
              checked={form.watch("isActive")}
              onCheckedChange={(val) => form.setValue("isActive", val)}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid gap-2">
            <Label>API ключ</Label>
            <Input type="password" {...form.register("apiKey")} placeholder="Ваш API ключ" />
            {form.formState.errors.apiKey && <span className="text-xs text-red-500">{form.formState.errors.apiKey.message}</span>}
          </div>
          
          {marketplace === "ozon" && (
            <div className="grid gap-2">
              <Label>Client ID</Label>
              <Input {...form.register("clientId")} placeholder="Client ID" />
            </div>
          )}

          {marketplace === "wildberries" && (
            <div className="grid gap-2">
              <Label>Warehouse ID (ID склада)</Label>
              <Input {...form.register("warehouseId")} placeholder="ID склада WB" />
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Сохранение..." : "Сохранить настройки"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SafetyStockSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: syncSettings, isLoading } = useQuery<InventorySyncSetting>({
    queryKey: ["/api/inventory-sync/settings"],
  });

  const [defaultSafetyStock, setDefaultSafetyStock] = useState(2);
  const [syncEnabled, setSyncEnabled] = useState(true);

  useEffect(() => {
    if (syncSettings) {
      setDefaultSafetyStock(syncSettings.defaultSafetyStock ?? 2);
      setSyncEnabled(syncSettings.syncEnabled ?? true);
    }
  }, [syncSettings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/inventory-sync/settings", {
        defaultSafetyStock,
        syncEnabled,
      });
    },
    onSuccess: () => {
      toast({ title: "Сохранено", description: "Настройки резервного остатка обновлены" });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-sync/settings"] });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6" data-testid="section-safety-stock">
      <Card>
        <CardHeader className="bg-muted/50 border-b">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-card rounded-lg border shadow-sm text-primary">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <CardTitle>Резервный остаток</CardTitle>
              <CardDescription>
                Когда остаток товара достигает резервного уровня, маркетплейсам отправляется 0 единиц для предотвращения пересортицы
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="text-center py-4 text-muted-foreground">Загрузка...</div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <Label className="text-base font-medium">Автоматическая синхронизация</Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    При создании заказа остатки автоматически обновляются на всех маркетплейсах
                  </p>
                </div>
                <Switch
                  checked={syncEnabled}
                  onCheckedChange={setSyncEnabled}
                  data-testid="switch-sync-enabled"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-base font-medium flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Резервный остаток по умолчанию (шт.)
                </Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={defaultSafetyStock}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setDefaultSafetyStock(isNaN(val) ? 0 : Math.max(0, Math.min(100, val)));
                  }}
                  className="max-w-[200px]"
                  data-testid="input-default-safety-stock"
                />
                <p className="text-sm text-muted-foreground">
                  Применяется ко всем товарам, у которых не задан индивидуальный резервный остаток.
                  Рекомендуется: 2-5 шт.
                </p>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  data-testid="button-save-safety-stock"
                >
                  {saveMutation.isPending ? "Сохранение..." : "Сохранить настройки"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StockSyncLogSection() {
  const { toast } = useToast();
  const [limit, setLimit] = useState(50);

  const { data: syncLogs, isLoading, isError } = useQuery<StockSyncLogEntry[]>({
    queryKey: [`/api/inventory-sync/logs?limit=${limit}`],
  });

  return (
    <div className="space-y-6" data-testid="section-stock-sync-log">
      <Card>
        <CardHeader className="bg-muted/50 border-b">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-card rounded-lg border shadow-sm text-primary">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <CardTitle>Лог синхронизации остатков</CardTitle>
                <CardDescription>Подробная история всех операций синхронизации между складами и маркетплейсами</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground whitespace-nowrap">Показать:</Label>
              <Button
                variant={limit === 50 ? "default" : "outline"}
                size="sm"
                onClick={() => setLimit(50)}
                data-testid="button-log-limit-50"
              >
                50
              </Button>
              <Button
                variant={limit === 100 ? "default" : "outline"}
                size="sm"
                onClick={() => setLimit(100)}
                data-testid="button-log-limit-100"
              >
                100
              </Button>
              <Button
                variant={limit === 200 ? "default" : "outline"}
                size="sm"
                onClick={() => setLimit(200)}
                data-testid="button-log-limit-200"
              >
                200
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
          ) : isError ? (
            <div className="text-center py-8 text-destructive">Ошибка загрузки логов синхронизации</div>
          ) : !syncLogs || syncLogs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Нет записей синхронизации</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Товар</TableHead>
                    <TableHead>Артикул</TableHead>
                    <TableHead>Действие</TableHead>
                    <TableHead className="text-right">Было</TableHead>
                    <TableHead className="text-right">Стало</TableHead>
                    <TableHead className="text-right">Изменение</TableHead>
                    <TableHead>Буфер</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Детали</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {syncLogs.map((log) => (
                    <TableRow key={log.id} data-testid={`row-stock-sync-log-${log.id}`}>
                      <TableCell className="whitespace-nowrap text-xs" data-testid={`text-log-date-${log.id}`}>
                        {log.createdAt
                          ? format(new Date(log.createdAt), "dd.MM.yy HH:mm", { locale: ru })
                          : "—"}
                      </TableCell>
                      <TableCell className="font-medium max-w-[180px] truncate" data-testid={`text-log-product-${log.id}`}>
                        {log.productName || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs" data-testid={`text-log-sku-${log.id}`}>
                        {log.sku || "—"}
                      </TableCell>
                      <TableCell className="text-xs" data-testid={`text-log-action-${log.id}`}>
                        {log.action === "order_stock_decrement" ? "Заказ" : log.action === "manual_sync" ? "Ручная" : log.action}
                      </TableCell>
                      <TableCell className="text-right tabular-nums" data-testid={`text-log-prev-stock-${log.id}`}>
                        {formatNumber(log.previousStock)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums" data-testid={`text-log-new-stock-${log.id}`}>
                        {formatNumber(log.newStock)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums" data-testid={`text-log-qty-change-${log.id}`}>
                        <span className={log.quantityChanged < 0 ? "text-destructive" : "text-green-600 dark:text-green-400"}>
                          {log.quantityChanged > 0 ? "+" : ""}{formatNumber(log.quantityChanged)}
                        </span>
                      </TableCell>
                      <TableCell data-testid={`text-log-safety-${log.id}`}>
                        {log.safetyStockTriggered && (
                          <Badge variant="outline" className="text-amber-600 border-amber-400">
                            <Shield className="w-3 h-3 mr-1" />
                            Да
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell data-testid={`text-log-status-${log.id}`}>
                        {log.status === "success" ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        ) : log.status === "partial" ? (
                          <RefreshCw className="w-4 h-4 text-amber-500" />
                        ) : (
                          <XCircle className="w-4 h-4 text-destructive" />
                        )}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground" data-testid={`text-log-details-${log.id}`}>
                        {log.details || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
