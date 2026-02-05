import { Layout } from "@/components/Layout";
import { useMarketplaceSettings, useSaveMarketplaceSettings, useSyncAllMarketplaces } from "@/hooks/use-marketplace";
import { useTaxSettings, useSaveTaxSettings } from "@/hooks/use-tax-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertMarketplaceSettingsSchema, type InsertMarketplaceSetting, type InsertTaxSetting } from "@shared/schema";
import { RefreshCw, CheckCircle2, Calculator, Percent, Truck } from "lucide-react";
import { useEffect } from "react";
import { z } from "zod";

export default function Settings() {
  const { data: settings } = useMarketplaceSettings();
  const { data: taxSettings, isLoading: taxLoading } = useTaxSettings();
  const { mutate: syncAll, isPending: isSyncing } = useSyncAllMarketplaces();
  const { mutate: saveTax, isPending: savingTax } = useSaveTaxSettings();

  const ozonSettings = settings?.find(s => s.marketplace === "ozon");
  const wbSettings = settings?.find(s => s.marketplace === "wildberries");

  return (
    <Layout>
      <div className="space-y-8 max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Настройки</h1>
            <p className="text-muted-foreground mt-2 text-lg">Интеграции и налоговые параметры</p>
          </div>
          <Button onClick={() => syncAll()} disabled={isSyncing} variant="outline">
            <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? "animate-spin" : ""}`} />
            Синхронизировать всё
          </Button>
        </div>

        {/* Tax Settings Card */}
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
      </div>
    </Layout>
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
