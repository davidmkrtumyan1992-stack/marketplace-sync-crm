import { Layout } from "@/components/Layout";
import { useMarketplaceSettings, useSaveMarketplaceSettings, useSyncAllMarketplaces } from "@/hooks/use-marketplace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertMarketplaceSettingsSchema, type InsertMarketplaceSetting } from "@shared/schema";
import { RefreshCw, CheckCircle2 } from "lucide-react";
import { useEffect } from "react";

export default function Settings() {
  const { data: settings } = useMarketplaceSettings();
  const { mutate: syncAll, isPending: isSyncing } = useSyncAllMarketplaces();

  const ozonSettings = settings?.find(s => s.marketplace === "ozon");
  const wbSettings = settings?.find(s => s.marketplace === "wildberries");

  return (
    <Layout>
      <div className="space-y-8 max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Integrations</h2>
            <p className="text-muted-foreground mt-1">Connect your marketplaces to sync inventory.</p>
          </div>
          <Button onClick={() => syncAll()} disabled={isSyncing} variant="outline">
            <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? "animate-spin" : ""}`} />
            Sync All Now
          </Button>
        </div>

        <div className="grid gap-6">
          <MarketplaceCard 
            title="Ozon" 
            marketplace="ozon"
            description="Sync products and orders with Ozon Seller API."
            existingSettings={ozonSettings}
            logoColor="text-blue-600"
          />
          
          <MarketplaceCard 
            title="Wildberries" 
            marketplace="wildberries"
            description="Connect your WB partner account via API Key."
            existingSettings={wbSettings}
            logoColor="text-purple-600"
          />
        </div>
      </div>
    </Layout>
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
  
  const form = useForm<InsertMarketplaceSetting>({
    resolver: zodResolver(insertMarketplaceSettingsSchema),
    defaultValues: {
      marketplace,
      organizationId: "1",
      apiKey: "",
      clientId: "",
      isActive: true,
    }
  });

  useEffect(() => {
    if (existingSettings) {
      form.reset({
        marketplace,
        organizationId: existingSettings.organizationId,
        apiKey: existingSettings.apiKey,
        clientId: existingSettings.clientId || "",
        isActive: existingSettings.isActive,
      });
    }
  }, [existingSettings, form, marketplace]);

  const onSubmit = (data: InsertMarketplaceSetting) => {
    mutate(data);
  };

  return (
    <Card className="dashboard-card overflow-hidden">
      <CardHeader className="bg-slate-50/50 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 bg-white rounded-lg border shadow-sm ${logoColor}`}>
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor={`${marketplace}-active`} className="text-sm text-muted-foreground">Active</Label>
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
            <Label>API Key</Label>
            <Input type="password" {...form.register("apiKey")} placeholder="Your API Key" />
            {form.formState.errors.apiKey && <span className="text-xs text-red-500">{form.formState.errors.apiKey.message}</span>}
          </div>
          
          {marketplace === "ozon" && (
            <div className="grid gap-2">
              <Label>Client ID</Label>
              <Input {...form.register("clientId")} placeholder="Client ID" />
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save Configuration"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
