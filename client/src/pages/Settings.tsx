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
import { insertMarketplaceSettingsSchema, type InsertMarketplaceSetting, type InsertTaxSetting, type SyncHistoryEntry, type Store } from "@shared/schema";
import { RefreshCw, CheckCircle2, Calculator, Percent, Truck, History } from "lucide-react";
import { useEffect } from "react";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

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
      toast({ title: "Синхронизация запущена", description: "Полная синхронизация всех маркетплейсов" });
      queryClient.invalidateQueries({ queryKey: ["/api/sync-history"] });
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
      toast({ title: "Синхронизация запущена", description: "Синхронизация магазина запущена" });
      queryClient.invalidateQueries({ queryKey: ["/api/sync-history"] });
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
                {syncHistory.map((entry) => (
                  <TableRow key={entry.id} data-testid={`row-sync-${entry.id}`}>
                    <TableCell data-testid={`text-sync-date-${entry.id}`}>
                      {entry.createdAt
                        ? format(new Date(entry.createdAt), "dd MMM yyyy, HH:mm", { locale: ru })
                        : "—"}
                    </TableCell>
                    <TableCell data-testid={`text-sync-store-${entry.id}`}>
                      {entry.details || "—"}
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
                ))}
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
