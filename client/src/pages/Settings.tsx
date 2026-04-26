import { Layout } from "@/components/Layout";
import { useMarketplaceSettings, useSaveMarketplaceSettings, useUpdateMarketplaceSetting, useDeleteMarketplaceSetting, useSyncAllMarketplaces } from "@/hooks/use-marketplace";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { type InsertMarketplaceSetting, type InsertTaxSetting, type SyncHistoryEntry, type Store, type StockSyncLogEntry, type InventorySyncSetting, type MarketplaceSetting, type Company } from "@shared/schema";
import { RefreshCw, CheckCircle2, Calculator, Percent, Truck, History, Shield, XCircle, FileText, Plus, Pencil, Trash2, Store as StoreIcon, Wifi, WifiOff, Building2, Loader2, PlugZap, Eye, EyeOff, Copy, Download, Link2 } from "lucide-react";
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

const MARKETPLACE_OPTIONS = [
  { value: "ozon", label: "Ozon", color: "#005BFF" },
  { value: "wildberries", label: "Wildberries", color: "#CB11AB" },
  { value: "yandex", label: "Yandex Market", color: "#FFCC00" },
];

export default function Settings() {
  const { data: settings, isLoading: settingsLoading } = useMarketplaceSettings();
  const { data: taxSettings, isLoading: taxLoading } = useTaxSettings();
  const { mutate: syncAll, isPending: isSyncing } = useSyncAllMarketplaces();
  const { mutate: saveTax, isPending: savingTax } = useSaveTaxSettings();
  const [showAddStore, setShowAddStore] = useState(false);
  const [showAddCompany, setShowAddCompany] = useState(false);

  const { data: companiesList } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  return (
    <Layout>
      <div className="space-y-8 max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Настройки</h1>
            <p className="text-muted-foreground mt-2 text-lg">Компании, интеграции и налоговые параметры</p>
          </div>
          <Button onClick={() => syncAll()} disabled={isSyncing} variant="outline" data-testid="button-sync-all-header">
            <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? "animate-spin" : ""}`} />
            Синхронизировать всё
          </Button>
        </div>

        <Tabs defaultValue="companies">
          <TabsList>
            <TabsTrigger value="companies" data-testid="tab-companies">Компании</TabsTrigger>
            <TabsTrigger value="settings" data-testid="tab-settings">Налоги</TabsTrigger>
            <TabsTrigger value="safety-stock" data-testid="tab-safety-stock">Резервный остаток</TabsTrigger>
            <TabsTrigger value="sync-log" data-testid="tab-sync-log">Лог синхронизации</TabsTrigger>
            <TabsTrigger value="sync-history" data-testid="tab-sync-history">Синхронизация</TabsTrigger>
          </TabsList>

          <TabsContent value="companies" className="space-y-6 mt-6">
            <CompaniesSection
              companies={companiesList || []}
              onAddCompany={() => setShowAddCompany(true)}
              onAddStore={() => setShowAddStore(true)}
            />
          </TabsContent>

          <TabsContent value="settings" className="space-y-6 mt-6">
            <TaxSettingsCard 
              settings={taxSettings || undefined} 
              isLoading={taxLoading}
              onSave={saveTax}
              isSaving={savingTax}
            />
          </TabsContent>

          <TabsContent value="safety-stock" className="mt-6">
            <SafetyStockSection />
          </TabsContent>

          <TabsContent value="sync-log" className="mt-6">
            <StockSyncLogSection />
          </TabsContent>

          <TabsContent value="sync-history" className="mt-6 space-y-6">
            <PullMarketplaceStocksCard />
            <SyncHistorySection />
          </TabsContent>
        </Tabs>
      </div>

      {showAddCompany && (
        <AddCompanyDialog onClose={() => setShowAddCompany(false)} />
      )}

      {showAddStore && (
        <AddStoreDialog companies={companiesList || []} onClose={() => setShowAddStore(false)} />
      )}
    </Layout>
  );
}

function CompaniesSection({ companies, onAddCompany, onAddStore }: { companies: Company[]; onAddCompany: () => void; onAddStore: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [deletingCompany, setDeletingCompany] = useState<Company | null>(null);

  const deleteCompanyMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/companies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kpi"] });
      toast({ title: "Удалено", description: "Компания и все её магазины удалены" });
      setDeletingCompany(null);
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-card rounded-lg border shadow-sm text-primary">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Компании и магазины</h2>
            <p className="text-sm text-muted-foreground">Управление юрлицами и подключёнными маркетплейсами</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onAddCompany} data-testid="button-add-company">
            <Building2 className="w-4 h-4 mr-2" />
            Добавить компанию
          </Button>
          <Button onClick={onAddStore} data-testid="button-add-store" disabled={companies.length === 0}>
            <Plus className="w-4 h-4 mr-2" />
            Добавить магазин
          </Button>
        </div>
      </div>

      {companies.length === 0 ? (
        <Card className="dashboard-card">
          <CardContent className="py-12 text-center">
            <Building2 className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-lg font-semibold mb-2">Нет компаний</p>
            <p className="text-sm text-muted-foreground mb-6">Создайте компанию (ИП или ООО), чтобы привязать к ней магазины маркетплейсов</p>
            <Button onClick={onAddCompany} data-testid="button-add-company-empty">
              <Building2 className="w-4 h-4 mr-2" />
              Создать компанию
            </Button>
          </CardContent>
        </Card>
      ) : (
        companies.map((company) => (
          <CompanyCard
            key={company.id}
            company={company}
            onEdit={() => setEditingCompany(company)}
            onDelete={() => setDeletingCompany(company)}
          />
        ))
      )}

      {editingCompany && (
        <EditCompanyDialog company={editingCompany} onClose={() => setEditingCompany(null)} />
      )}

      <AlertDialog open={!!deletingCompany} onOpenChange={(open) => !open && setDeletingCompany(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить компанию?</AlertDialogTitle>
            <AlertDialogDescription>
              Компания «{deletingCompany?.name}» и все привязанные к ней магазины будут удалены. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-company">Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingCompany && deleteCompanyMutation.mutate(deletingCompany.id)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete-company"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CompanyCard({ company, onEdit, onDelete }: { company: Company; onEdit: () => void; onDelete: () => void }) {
  const { data: storesList } = useQuery<Store[]>({
    queryKey: ["/api/companies", company.id, "stores"],
    queryFn: async () => {
      const res = await fetch(`/api/companies/${company.id}/stores`);
      if (!res.ok) throw new Error("Failed to fetch stores");
      return res.json();
    },
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [deletingStore, setDeletingStore] = useState<Store | null>(null);
  const [editingStore, setEditingStore] = useState<Store | null>(null);

  const deleteStoreMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/stores/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", company.id, "stores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kpi"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wb/supplies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wb/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wb/counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Удалено", description: "Магазин и все связанные данные удалены" });
      setDeletingStore(null);
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  return (
    <>
      <Card className="dashboard-card overflow-hidden" data-testid={`card-company-settings-${company.id}`}>
        <CardHeader className="bg-muted/50 border-b">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-card rounded-lg border shadow-sm text-primary">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-lg" data-testid={`text-company-name-settings-${company.id}`}>{company.name}</CardTitle>
                {company.inn && (
                  <CardDescription>ИНН: {company.inn}</CardDescription>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={onEdit} data-testid={`button-edit-company-${company.id}`}>
                <Pencil className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={onDelete} data-testid={`button-delete-company-${company.id}`}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!storesList || storesList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <StoreIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Нет подключённых магазинов</p>
            </div>
          ) : (
            <div className="divide-y">
              {storesList.map((store) => {
                const mpStyle = getMarketplaceStyle(store.marketplace);
                const hasApiKey = !!store.apiKey && store.apiKey.length > 3;
                const isConnected = hasApiKey && store.isActive;

                return (
                  <div key={store.id} className="flex items-center justify-between gap-4 p-4 hover:bg-muted/30 transition-colors" data-testid={`store-row-${store.id}`}>
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: mpStyle.bg }}
                      >
                        <StoreIcon className="w-5 h-5" style={{ color: mpStyle.color }} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate" data-testid={`text-store-name-${store.id}`}>
                            {store.name}
                          </span>
                          <Badge
                            className="text-[10px] font-bold shrink-0"
                            style={{ backgroundColor: mpStyle.bg, color: mpStyle.color }}
                            data-testid={`badge-store-marketplace-${store.id}`}
                          >
                            {mpStyle.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          {isConnected ? (
                            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                              <Wifi className="w-3 h-3" />
                              Подключён
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <WifiOff className="w-3 h-3" />
                              {!hasApiKey ? "API-ключ не задан" : "Неактивен"}
                            </span>
                          )}
                          {store.marketplace === "ozon" && store.clientId && (
                            <span className="text-xs text-muted-foreground">Client ID: {store.clientId}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      <Button variant="ghost" size="icon" onClick={() => setEditingStore(store)} data-testid={`button-edit-store-${store.id}`}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setDeletingStore(store)} data-testid={`button-delete-store-${store.id}`}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {editingStore && (
        <EditStoreDialog store={editingStore} companyId={company.id} onClose={() => setEditingStore(null)} />
      )}

      <AlertDialog open={!!deletingStore} onOpenChange={(open) => !open && setDeletingStore(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить магазин?</AlertDialogTitle>
            <AlertDialogDescription>
              Магазин «{deletingStore?.name}» будет удалён из компании «{company.name}». Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-store">Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingStore && deleteStoreMutation.mutate(deletingStore.id)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete-store"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const companyFormSchema = z.object({
  name: z.string().min(1, "Название обязательно"),
  inn: z.string().optional(),
});

function AddCompanyDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof companyFormSchema>>({
    resolver: zodResolver(companyFormSchema),
    defaultValues: { name: "", inn: "" },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof companyFormSchema>) => {
      const res = await apiRequest("POST", "/api/companies", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kpi"] });
      toast({ title: "Создано", description: "Компания добавлена" });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md w-[95vw] sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Добавить компанию
          </DialogTitle>
          <DialogDescription>Создайте юридическое лицо (ИП или ООО)</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
          <div className="space-y-2">
            <Label>Название</Label>
            <Input {...form.register("name")} placeholder="Например: ИП Иванов" data-testid="input-company-name" />
            {form.formState.errors.name && (
              <span className="text-xs text-destructive">{form.formState.errors.name.message}</span>
            )}
          </div>
          <div className="space-y-2">
            <Label>ИНН (опционально)</Label>
            <Input {...form.register("inn")} placeholder="1234567890" data-testid="input-company-inn" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Отмена</Button>
            <Button type="submit" disabled={createMutation.isPending} data-testid="button-save-company">
              {createMutation.isPending ? "Сохранение..." : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditCompanyDialog({ company, onClose }: { company: Company; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof companyFormSchema>>({
    resolver: zodResolver(companyFormSchema),
    defaultValues: { name: company.name, inn: company.inn || "" },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: z.infer<typeof companyFormSchema>) => {
      const res = await apiRequest("PUT", `/api/companies/${company.id}`, data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kpi"] });
      toast({ title: "Сохранено", description: "Компания обновлена" });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md w-[95vw] sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-5 h-5" />
            Редактировать компанию
          </DialogTitle>
          <DialogDescription>Изменить данные компании</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((data) => updateMutation.mutate(data))} className="space-y-4">
          <div className="space-y-2">
            <Label>Название</Label>
            <Input {...form.register("name")} data-testid="input-edit-company-name" />
            {form.formState.errors.name && (
              <span className="text-xs text-destructive">{form.formState.errors.name.message}</span>
            )}
          </div>
          <div className="space-y-2">
            <Label>ИНН</Label>
            <Input {...form.register("inn")} data-testid="input-edit-company-inn" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Отмена</Button>
            <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save-edit-company">
              {updateMutation.isPending ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const CYRILLIC_REGEX = /[А-Яа-яЁё]/;
const ASCII_ONLY_REGEX = /^[\x00-\x7F]*$/;
const DIGITS_ONLY_REGEX = /^\d+$/;

const storeFormBaseSchema = z.object({
  storeName: z.string().min(1, "Название обязательно"),
  marketplace: z.enum(["ozon", "wildberries", "yandex"]),
  apiKey: z.string().min(1, "API-ключ обязателен"),
  clientId: z.string().optional(),
  warehouseId: z.string().optional(),
  isActive: z.boolean(),
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const storeRefinement = (data: z.infer<typeof storeFormBaseSchema>, ctx: z.RefinementCtx) => {
  if (data.marketplace === "ozon") {
    if (!data.clientId || data.clientId.trim() === "") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Client ID обязателен для Ozon", path: ["clientId"] });
    } else if (!DIGITS_ONLY_REGEX.test(data.clientId.trim())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Client ID должен содержать только цифры", path: ["clientId"] });
    }
    if (data.apiKey && data.apiKey.trim() !== "" && !UUID_REGEX.test(data.apiKey.trim())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "API-ключ Ozon должен быть в формате UUID (например, a1b2c3d4-e5f6-7890-abcd-ef1234567890)", path: ["apiKey"] });
    }
  }
  if (data.marketplace === "yandex") {
    if (CYRILLIC_REGEX.test(data.apiKey) || !ASCII_ONLY_REGEX.test(data.apiKey)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Поле должно содержать только латинские буквы и цифры", path: ["apiKey"] });
    }
    if (data.warehouseId && data.warehouseId.trim() !== "") {
      if (!DIGITS_ONLY_REGEX.test(data.warehouseId.trim())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Business ID должен содержать только цифры", path: ["warehouseId"] });
      }
    } else {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Business ID обязателен для Yandex Market", path: ["warehouseId"] });
    }
  }
};

const storeFormSchema = storeFormBaseSchema.superRefine(storeRefinement);

const addStoreFormSchema = storeFormBaseSchema.extend({
  companyId: z.string().min(1, "Выберите компанию"),
}).superRefine((data, ctx) => storeRefinement(data, ctx));

function EditStoreDialog({ store, companyId, onClose }: { store: Store; companyId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const marketplace = store.marketplace;
  const [connectionStatus, setConnectionStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  const copyToClipboard = (value: string, label: string) => {
    navigator.clipboard.writeText(value).then(() => {
      toast({ title: `${label} скопирован` });
    });
  };

  const form = useForm<z.infer<typeof storeFormSchema>>({
    resolver: zodResolver(storeFormSchema),
    defaultValues: {
      storeName: store.name,
      marketplace: store.marketplace as "ozon" | "wildberries" | "yandex",
      apiKey: store.apiKey || "",
      clientId: store.clientId || "",
      warehouseId: store.warehouseId || "",
      isActive: store.isActive ?? true,
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: z.infer<typeof storeFormSchema>) => {
      const sanitize = (s: string) => s.replace(/[^\x00-\x7F]/g, "").trim();
      const apiKey = data.marketplace === "yandex" ? sanitize(data.apiKey) : data.apiKey.trim();

      const payload: any = {
        name: data.storeName.trim(),
        apiKey,
        isActive: data.isActive,
      };
      if (data.marketplace === "ozon" && data.clientId) {
        payload.clientId = data.clientId.trim();
      }
      if (data.marketplace === "wildberries" && data.warehouseId) {
        payload.warehouseId = data.warehouseId.trim();
      }
      if (data.marketplace === "yandex" && data.warehouseId) {
        payload.warehouseId = sanitize(data.warehouseId);
      }

      const res = await apiRequest("PUT", `/api/stores/${store.id}`, payload);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "stores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kpi"] });
      toast({ title: "Сохранено", description: "Магазин обновлён" });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/stores/${store.id}/test-connection`, {
        apiKey: form.getValues("apiKey"),
        clientId: form.getValues("clientId"),
        warehouseId: form.getValues("warehouseId"),
      });
      return await res.json();
    },
    onSuccess: (data: { success: boolean; message: string }) => {
      setConnectionStatus(data);
    },
    onError: (error: Error) => {
      setConnectionStatus({ success: false, message: error.message });
    },
  });

  const selectedMp = MARKETPLACE_OPTIONS.find(m => m.value === marketplace);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md w-[95vw] sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-5 h-5" />
            Редактировать магазин
          </DialogTitle>
          <DialogDescription>Изменить настройки подключения магазина</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((data) => updateMutation.mutate(data))} className="space-y-4">
          <div className="space-y-2">
            <Label>Маркетплейс</Label>
            <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/50">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: selectedMp?.color }} />
              <span className="text-sm font-medium">{selectedMp?.label}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Название магазина</Label>
            <Input
              {...form.register("storeName")}
              data-testid="input-edit-store-name"
            />
            {form.formState.errors.storeName && (
              <span className="text-xs text-destructive">{form.formState.errors.storeName.message}</span>
            )}
          </div>

          <div className="space-y-2">
            <Label>API-ключ</Label>
            <div className="relative flex items-center gap-2">
              <Input
                type={showApiKey ? "text" : "password"}
                {...form.register("apiKey")}
                placeholder={marketplace === "wildberries" ? "eyJ... (JWT-токен WB)" : "API ключ"}
                data-testid="input-edit-api-key"
                className="pr-10 flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-8 h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setShowApiKey((v) => !v)}
                tabIndex={-1}
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => copyToClipboard(form.getValues("apiKey"), "API-ключ")}
                tabIndex={-1}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            {form.formState.errors.apiKey && (
              <span className="text-xs text-destructive">{form.formState.errors.apiKey.message}</span>
            )}
          </div>

          {marketplace === "ozon" && (
            <div className="space-y-2">
              <Label>Client ID</Label>
              <div className="flex items-center gap-2">
                <Input {...form.register("clientId")} placeholder="Client ID" data-testid="input-edit-client-id" className="flex-1" />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => copyToClipboard(form.getValues("clientId"), "Client ID")}
                  tabIndex={-1}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              {form.formState.errors.clientId && (
                <span className="text-xs text-destructive">{form.formState.errors.clientId.message}</span>
              )}
            </div>
          )}

          {marketplace === "wildberries" && (
            <div className="space-y-2">
              <Label>ID склада (опционально)</Label>
              <Input {...form.register("warehouseId")} placeholder="ID склада WB" data-testid="input-edit-warehouse-id" />
            </div>
          )}

          {marketplace === "yandex" && (
            <div className="space-y-2">
              <Label>ID кампании (Campaign ID)</Label>
              <Input {...form.register("warehouseId")} placeholder="Например: 216691427" data-testid="input-edit-warehouse-id" />
              <p className="text-[10px] text-muted-foreground mt-1 italic">Используйте ID кампании (из раздела Настройки API в ЛК Яндекса)</p>
              {form.formState.errors.warehouseId && (
                <span className="text-xs text-destructive">{form.formState.errors.warehouseId.message}</span>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Switch
              checked={form.watch("isActive")}
              onCheckedChange={(val) => form.setValue("isActive", val)}
              data-testid="switch-edit-store-active"
            />
            <Label className="text-sm text-muted-foreground">Активен</Label>
          </div>

          <div className="border rounded-lg p-3 space-y-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => { setConnectionStatus(null); testConnectionMutation.mutate(); }}
              disabled={testConnectionMutation.isPending}
              data-testid="button-test-connection"
            >
              {testConnectionMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <PlugZap className="w-4 h-4 mr-2" />
              )}
              Проверить подключение
            </Button>
            {connectionStatus && (
              <div className={`flex items-start gap-2 text-sm ${connectionStatus.success ? "text-green-600 dark:text-green-400" : "text-destructive"}`} data-testid="text-connection-result">
                {connectionStatus.success ? (
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                )}
                <span>{connectionStatus.message}</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-edit-store">
              Отмена
            </Button>
            <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save-edit-store">
              {updateMutation.isPending ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddStoreDialog({ companies, onClose }: { companies: Company[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [marketplace, setMarketplace] = useState<string>("ozon");
  const [companyId, setCompanyId] = useState<string>(companies.length > 0 ? String(companies[0].id) : "");

  const form = useForm<z.infer<typeof addStoreFormSchema>>({
    resolver: zodResolver(addStoreFormSchema),
    defaultValues: {
      storeName: "",
      marketplace: "ozon",
      apiKey: "",
      clientId: "",
      warehouseId: "",
      isActive: true,
      companyId: companyId,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof addStoreFormSchema>) => {
      const sanitize = (s: string) => s.replace(/[^\x00-\x7F]/g, "").trim();
      const apiKey = data.marketplace === "yandex" ? sanitize(data.apiKey) : data.apiKey.trim();

      const payload: any = {
        storeName: data.storeName.trim(),
        marketplace: data.marketplace,
        apiKey,
        isActive: data.isActive,
        companyId: Number(data.companyId),
      };
      if (data.marketplace === "ozon" && data.clientId) {
        payload.clientId = data.clientId.trim();
      }
      if (data.marketplace === "wildberries" && data.warehouseId) {
        payload.warehouseId = data.warehouseId.trim();
      }
      if (data.marketplace === "yandex" && data.warehouseId) {
        payload.warehouseId = sanitize(data.warehouseId);
      }

      const res = await apiRequest("POST", "/api/marketplace/settings", payload);
      return await res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kpi"] });
      if (data?.autoSyncStarted) {
        toast({ title: "Магазин добавлен", description: "Импорт товаров запущен автоматически. Это может занять пару минут." });
      } else {
        toast({ title: "Сохранено", description: "Магазин добавлен" });
      }
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const handleMarketplaceChange = (val: string) => {
    setMarketplace(val);
    form.setValue("marketplace", val as "ozon" | "wildberries" | "yandex");
  };

  const selectedMp = MARKETPLACE_OPTIONS.find(m => m.value === marketplace);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md w-[95vw] sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Добавить магазин
          </DialogTitle>
          <DialogDescription>Подключите новый аккаунт маркетплейса к компании</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
          <div className="space-y-2">
            <Label>Компания</Label>
            <Select value={companyId} onValueChange={(val) => { setCompanyId(val); form.setValue("companyId", val); }}>
              <SelectTrigger data-testid="select-company">
                <SelectValue placeholder="Выберите компанию" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}{c.inn ? ` (ИНН: ${c.inn})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.companyId && (
              <span className="text-xs text-destructive">{form.formState.errors.companyId.message}</span>
            )}
          </div>

          <div className="space-y-2">
            <Label>Маркетплейс</Label>
            <Select value={marketplace} onValueChange={handleMarketplaceChange}>
              <SelectTrigger data-testid="select-marketplace">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MARKETPLACE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: opt.color }} />
                      {opt.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Название магазина</Label>
            <Input
              {...form.register("storeName")}
              placeholder={`Например: Лаура — ${selectedMp?.label || "Ozon"}`}
              data-testid="input-store-name"
            />
            {form.formState.errors.storeName && (
              <span className="text-xs text-destructive">{form.formState.errors.storeName.message}</span>
            )}
          </div>

          <div className="space-y-2">
            <Label>API-ключ</Label>
            <Input
              type="password"
              {...form.register("apiKey")}
              placeholder={marketplace === "wildberries" ? "eyJ... (JWT-токен WB)" : "API ключ"}
              data-testid="input-api-key"
            />
            {form.formState.errors.apiKey && (
              <span className="text-xs text-destructive">{form.formState.errors.apiKey.message}</span>
            )}
          </div>

          {marketplace === "ozon" && (
            <div className="space-y-2">
              <Label>Client ID</Label>
              <Input {...form.register("clientId")} placeholder="Client ID" data-testid="input-client-id" />
              {form.formState.errors.clientId && (
                <span className="text-xs text-destructive">{form.formState.errors.clientId.message}</span>
              )}
            </div>
          )}

          {marketplace === "wildberries" && (
            <div className="space-y-2">
              <Label>ID склада (опционально)</Label>
              <Input {...form.register("warehouseId")} placeholder="ID склада WB" data-testid="input-warehouse-id" />
            </div>
          )}

          {marketplace === "yandex" && (
            <div className="space-y-2">
              <Label>ID кампании (Campaign ID)</Label>
              <Input {...form.register("warehouseId")} placeholder="Например: 216691427" data-testid="input-warehouse-id" />
              <p className="text-[10px] text-muted-foreground mt-1 italic">Используйте ID кампании (из раздела Настройки API в ЛК Яндекса)</p>
              {form.formState.errors.warehouseId && (
                <span className="text-xs text-destructive">{form.formState.errors.warehouseId.message}</span>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Switch
              checked={form.watch("isActive")}
              onCheckedChange={(val) => form.setValue("isActive", val)}
              data-testid="switch-new-store-active"
            />
            <Label className="text-sm text-muted-foreground">Активен</Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-add-store">
              Отмена
            </Button>
            <Button type="submit" disabled={createMutation.isPending} data-testid="button-save-new-store">
              {createMutation.isPending ? "Сохранение..." : "Добавить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PullMarketplaceStocksCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isPulling, setIsPulling] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [isCreatingLinks, setIsCreatingLinks] = useState(false);
  const [linkResult, setLinkResult] = useState<{ total: number; created: number } | null>(null);

  const { data: stats, refetch: refetchStats } = useQuery<{
    total: string; with_links: string; without_links: string;
    with_links_and_stock: string; with_links_no_stock: string;
  }>({ queryKey: ["/api/inventory/link-stats"] });

  const handlePull = async (force = false) => {
    setIsPulling(true);
    try {
      const res = await apiRequest("POST", `/api/inventory/pull-marketplace-stocks${force ? "?force=true" : ""}`);
      const data = await res.json();
      setLastResult(data);
      if (data.ok) {
        queryClient.invalidateQueries({ queryKey: ["/api/products"] });
        refetchStats();
        const storesSummary = data.stores
          .filter((s: any) => s.matched > 0)
          .map((s: any) => `${s.store}: ${s.matched}`)
          .join(", ");
        toast({
          title: "Остатки импортированы",
          description: `Обновлено товаров: ${data.updated}${storesSummary ? ` (${storesSummary})` : ""}`,
        });
      } else {
        toast({ title: "Ошибка", description: data.error || "Что-то пошло не так", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setIsPulling(false);
    }
  };

  const handleCreateLinks = async () => {
    setIsCreatingLinks(true);
    try {
      const res = await apiRequest("POST", "/api/inventory/create-all-links");
      const data = await res.json();
      setLinkResult(data);
      if (data.ok) {
        queryClient.invalidateQueries({ queryKey: ["/api/products"] });
        refetchStats();
        toast({
          title: "Связи созданы",
          description: `Найдено ${data.total} товаров без связей, создано для ${data.created}`,
        });
      } else {
        toast({ title: "Ошибка", description: data.error || "Что-то пошло не так", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setIsCreatingLinks(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="w-5 h-5" />
          Импорт остатков с маркетплейсов
        </CardTitle>
        <CardDescription>
          Разовая инициализация: заберёт текущие остатки с Ozon, Яндекс Маркет и WB
          и запишет их как актуальный остаток склада в CRM. Используйте при первом подключении.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {stats && (
          <div className="grid grid-cols-2 gap-3 text-sm p-3 rounded-lg bg-muted/50">
            <div>
              <p className="text-muted-foreground">Всего товаров</p>
              <p className="text-xl font-semibold">{stats.total}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Имеют связи</p>
              <p className="text-xl font-semibold text-green-500">{stats.with_links}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Без связей</p>
              <p className="text-xl font-semibold text-destructive">{stats.without_links}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Со связями и остатком</p>
              <p className="text-xl font-semibold">{stats.with_links_and_stock}</p>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => handlePull(false)} disabled={isPulling} className="gap-2">
            {isPulling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {isPulling ? "Импорт..." : "Импортировать остатки с маркетплейсов"}
          </Button>
          <Button onClick={() => handlePull(true)} disabled={isPulling} variant="secondary" className="gap-2">
            {isPulling ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Синхронизировать точно с маркетплейсами
          </Button>
          <Button onClick={handleCreateLinks} disabled={isCreatingLinks} variant="outline" className="gap-2">
            {isCreatingLinks ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            {isCreatingLinks ? "Создаём связи..." : "Создать связи для всех товаров"}
          </Button>
        </div>
        {lastResult && (
          <div className="text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Результат: обновлено {lastResult.updated} товаров</p>
            {lastResult.stores?.map((s: any) => (
              <p key={s.store}>
                {s.store}: получено {s.fetched ?? "–"}, совпало {s.matched ?? "–"}
                {s.error && <span className="text-destructive"> — {s.error}</span>}
              </p>
            ))}
          </div>
        )}
        {linkResult && (
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              Связи: найдено {linkResult.total} товаров без привязки, создано для {linkResult.created}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
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
                          className={entry.status === "success" ? "bg-green-600 text-white" : ""}
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
  taxSystem: z.enum(["usn_6", "usn_15", "custom"]),
  taxRate: z.coerce.number().min(0).max(100).optional(),
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
      taxRate: 6,
      defaultLogisticsCost: 100,
      defaultMarketplaceCommission: 15,
    }
  });

  const TAX_OPTIONS = [
    { value: "usn_6", label: "УСН «Доходы» 6%", description: "Налог = Выручка × 6%. Простая схема без учёта расходов.", rate: 6 },
    { value: "usn_15", label: "УСН «Доходы минус Расходы» 15%", description: "Налог = (Выручка − Расходы) × 15%. Минимум 1% от выручки.", rate: 15 },
    { value: "custom", label: "Своя ставка", description: "Установите произвольный процент налога", rate: null },
  ];

  useEffect(() => {
    if (settings) {
      let taxSystem = settings.taxSystem || "usn_6";
      let taxRate = Number(settings.taxRate) || 6;
      if (taxRate !== 6 && taxRate !== 15) {
        taxSystem = "custom";
      } else if (taxRate === 6) {
        taxSystem = "usn_6";
      } else if (taxRate === 15) {
        taxSystem = "usn_15";
      }
      form.reset({
        taxSystem,
        taxRate,
        defaultLogisticsCost: Number(settings.defaultLogisticsCost) || 100,
        defaultMarketplaceCommission: Number(settings.defaultMarketplaceCommission) || 15,
      });
    }
  }, [settings, form]);

  const onSubmit = (data: z.infer<typeof taxFormSchema>) => {
    const effectiveRate = data.taxSystem === "custom" ? data.taxRate : (data.taxSystem === "usn_6" ? 6 : 15);
    onSave({
      taxSystem: data.taxSystem,
      taxRate: effectiveRate?.toString() || "6",
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
                onValueChange={(val) => {
                  form.setValue("taxSystem", val as "usn_6" | "usn_15" | "custom");
                  const opt = TAX_OPTIONS.find(o => o.value === val);
                  if (opt?.rate !== null) {
                    form.setValue("taxRate", opt!.rate);
                  }
                }}
                className="grid gap-3"
              >
                {TAX_OPTIONS.map(opt => (
                  <div key={opt.value} className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-muted cursor-pointer">
                    <RadioGroupItem value={opt.value} id={opt.value} className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor={opt.value} className="font-medium cursor-pointer">
                        {opt.label}
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        {opt.description}
                      </p>
                    </div>
                  </div>
                ))}
              </RadioGroup>

              {form.watch("taxSystem") === "custom" && (
                <div className="mt-4 p-4 bg-muted/50 border rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <Label htmlFor="customRate" className="text-sm font-medium mb-2 block">
                        Введите налоговую ставку
                      </Label>
                      <div className="flex items-center gap-2 max-w-xs">
                        <Input 
                          id="customRate"
                          type="number" 
                          min="0" 
                          max="100" 
                          step="0.1"
                          placeholder="например 2 или 17.5"
                          {...form.register("taxRate", { valueAsNumber: true })}
                          className="flex-1"
                        />
                        <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">%</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
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
  const [limit, setLimit] = useState(50);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const { data: syncStatus } = useQuery<any>({
    queryKey: ["/api/inventory-sync/status"],
    refetchInterval: 30_000,
  });

  const { data: syncLogs, isLoading, isError } = useQuery<StockSyncLogEntry[]>({
    queryKey: [`/api/inventory-sync/logs?limit=${limit}`],
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6" data-testid="section-stock-sync-log">

      {/* Статус-карточка */}
      {syncStatus && (
        <Card>
          <CardContent className="pt-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold">{syncStatus.totalSyncsToday ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">Сегодня</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{syncStatus.successCount ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">Успешно</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{syncStatus.partialCount ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">Частично</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-destructive">{syncStatus.failCount ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">Ошибки</p>
              </div>
            </div>
            {syncStatus.lastSyncAt && (
              <p className="text-xs text-muted-foreground text-center mt-3">
                Последняя: {new Date(syncStatus.lastSyncAt).toLocaleString("ru-RU")} · обновляется каждые 30 сек
              </p>
            )}
          </CardContent>
        </Card>
      )}

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
                  {syncLogs.map((log) => {
                    const syncResults: any[] = Array.isArray((log as any).syncResults) ? (log as any).syncResults : [];
                    const isExpanded = expandedRow === log.id;
                    const actionLabel = log.action === "order_stock_decrement" ? "Заказ"
                      : log.action === "manual_sync" ? "Ручная"
                      : log.action === "demo_sync" ? "Демо"
                      : log.action;
                    return (
                      <>
                        <TableRow
                          key={log.id}
                          className={syncResults.length > 0 ? "cursor-pointer hover:bg-muted/50" : ""}
                          onClick={() => syncResults.length > 0 && setExpandedRow(isExpanded ? null : log.id)}
                          data-testid={`row-stock-sync-log-${log.id}`}
                        >
                          <TableCell className="whitespace-nowrap text-xs" data-testid={`text-log-date-${log.id}`}>
                            {log.createdAt ? format(new Date(log.createdAt), "dd.MM.yy HH:mm", { locale: ru }) : "—"}
                          </TableCell>
                          <TableCell className="font-medium max-w-[180px] truncate" data-testid={`text-log-product-${log.id}`}>
                            {log.productName || "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs" data-testid={`text-log-sku-${log.id}`}>
                            {log.sku || "—"}
                          </TableCell>
                          <TableCell className="text-xs" data-testid={`text-log-action-${log.id}`}>
                            {actionLabel}
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
                            {syncResults.length > 0 ? (
                              <span className="text-primary underline-offset-2 underline">
                                {syncResults.length} магазинов {isExpanded ? "▲" : "▼"}
                              </span>
                            ) : log.details || "—"}
                          </TableCell>
                        </TableRow>
                        {isExpanded && syncResults.length > 0 && (
                          <TableRow key={`${log.id}-expanded`} className="bg-muted/30">
                            <TableCell colSpan={10} className="py-2 px-4">
                              <div className="flex flex-wrap gap-2">
                                {syncResults.map((r: any, i: number) => (
                                  <div key={i} className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border ${r.status === "success" ? "border-green-400/50 bg-green-500/10 text-green-700 dark:text-green-400" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>
                                    {r.status === "success"
                                      ? <CheckCircle2 className="w-3 h-3" />
                                      : <XCircle className="w-3 h-3" />}
                                    <span className="font-medium">{r.storeName}</span>
                                    <span className="opacity-70">({r.marketplace})</span>
                                    {r.status === "success"
                                      ? <span>→ {r.sentStock} шт.</span>
                                      : <span className="opacity-80">{r.error?.slice(0, 40)}</span>}
                                  </div>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
