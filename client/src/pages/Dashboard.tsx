import { useState, useMemo } from "react";
import { Layout } from "@/components/Layout";
import { useProducts } from "@/hooks/use-products";
import { useOrders } from "@/hooks/use-orders";
import { useKPI } from "@/hooks/use-kpi";
import { useRole } from "@/hooks/use-role";
import { useQuery } from "@tanstack/react-query";
import { Package, Warehouse, TrendingUp, Coins, ArrowUpRight, Building2, Store, ShoppingCart, ExternalLink, Database, AlertTriangle, RefreshCw, CheckCircle2, XCircle, Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatQuantity, formatNumber } from "@/lib/format";
import type { DashboardKPI, LowStockProduct, SalesDataPoint, SyncStatusSummary } from "@shared/schema";
import { Link } from "wouter";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const CHART_COLORS = ['#0FC2C0', '#0CABA8', '#008F8C', '#015958'];

const MARKETPLACE_STYLES: Record<string, { label: string; bg: string; color: string }> = {
  ozon: { label: "Ozon", bg: "#005BFF", color: "#FFFFFF" },
  wb: { label: "Wildberries", bg: "#CB11AB", color: "#FFFFFF" },
  yandex: { label: "Yandex Market", bg: "#FFCC00", color: "#000000" },
};

export default function Dashboard() {
  const { data: products } = useProducts();
  const { data: kpi, isLoading: kpiLoading } = useKPI();
  const { canSeePurchasePrice, canSeePnL } = useRole();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: lowStockProducts } = useQuery<LowStockProduct[]>({
    queryKey: ["/api/analytics/low-stock"],
  });

  const { data: salesData } = useQuery<SalesDataPoint[]>({
    queryKey: ["/api/analytics/sales"],
  });

  const { data: syncStatus } = useQuery<SyncStatusSummary>({
    queryKey: ["/api/inventory-sync/status"],
    refetchInterval: 15000,
  });

  const [salesFilter, setSalesFilter] = useState<string>("all");

  const companyNames = useMemo(() => {
    if (!salesData) return [];
    const names = new Set<string>();
    salesData.forEach((p) => {
      if (p.companyName) names.add(p.companyName);
    });
    return Array.from(names);
  }, [salesData]);

  const chartData = useMemo(() => {
    if (!salesData) return [];
    const filtered = salesFilter === "all"
      ? salesData
      : salesData.filter((p) => p.companyName === salesFilter);

    const grouped: Record<string, number> = {};
    filtered.forEach((p) => {
      grouped[p.date] = (grouped[p.date] || 0) + p.revenue;
    });

    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, revenue]) => ({ date, revenue }));
  }, [salesData, salesFilter]);

  const seedMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/seed"),
    onSuccess: () => {
      toast({ title: "Готово", description: "Демо-данные успешно созданы" });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kpi"] });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось создать демо-данные", variant: "destructive" });
    },
  });

  const hasCompanies = kpi?.companies && kpi.companies.length > 0;
  const totalProducts = products?.length || 0;

  return (
    <Layout>
      <div className="space-y-8 pb-8">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
          <div>
            <h1
              className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-foreground via-foreground to-primary bg-clip-text"
              data-testid="text-welcome"
            >
              Панель управления
            </h1>
            <p className="text-muted-foreground mt-2 text-lg">
              Единый склад и сводка по магазинам
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Link href="/orders">
              <Button data-testid="button-dashboard-direct-sale">
                <Store className="w-4 h-4 mr-2" />
                Прямая продажа
              </Button>
            </Link>
            {!hasCompanies && totalProducts === 0 && (
              <Button
                onClick={() => seedMutation.mutate()}
                disabled={seedMutation.isPending}
                className="premium-button"
                data-testid="button-seed-data"
              >
                <Database className="w-4 h-4 mr-2" />
                {seedMutation.isPending ? "Создание..." : "Создать демо-данные"}
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="kpi-card hover-elevate" data-testid="card-total-stock">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                    Общий остаток
                  </p>
                  <p className="text-3xl font-extrabold tracking-tight">
                    {kpiLoading ? "..." : formatNumber(kpi?.totalStock || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-3">шт. на центральном складе</p>
                </div>
                <div className="icon-box icon-box-lg">
                  <Package className="w-7 h-7 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          {canSeePnL && (
            <Card className="kpi-card hover-elevate" data-testid="card-capitalization">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                      Капитализация
                    </p>
                    <p className="text-3xl font-extrabold tracking-tight">
                      {kpiLoading ? "..." : formatCurrency(kpi?.capitalization || 0)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-3">по закупочной цене</p>
                  </div>
                  <div className="icon-box icon-box-lg">
                    <Coins className="w-7 h-7 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="kpi-card hover-elevate" data-testid="card-revenue">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                    Ожидаемая выручка
                  </p>
                  <p className="text-3xl font-extrabold tracking-tight">
                    {kpiLoading ? "..." : formatCurrency(kpi?.expectedRevenue || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-3">по продажной цене</p>
                </div>
                <div className="icon-box icon-box-lg">
                  <TrendingUp className="w-7 h-7 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          {canSeePnL && (
            <Card className="stat-card-premium hover-elevate" data-testid="card-profit">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p
                      className="text-sm font-medium uppercase tracking-wide"
                      style={{ color: "hsl(175 30% 70%)" }}
                    >
                      Прогноз прибыли
                    </p>
                    <p className="stat-number mt-2">
                      {kpiLoading ? "..." : formatCurrency(kpi?.expectedProfit || 0)}
                    </p>
                    <p className="text-xs mt-3" style={{ color: "hsl(175 20% 55%)" }}>
                      с учётом 7% налога
                    </p>
                  </div>
                  <div
                    className="icon-box icon-box-lg"
                    style={{
                      background:
                        "linear-gradient(135deg, hsl(175 98% 41% / 0.3) 0%, hsl(175 85% 35% / 0.2) 100%)",
                    }}
                  >
                    <ArrowUpRight className="w-7 h-7 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {syncStatus && (syncStatus.totalSyncsToday > 0 || syncStatus.lastSyncAt) && (
          <Card className="kpi-card" data-testid="card-sync-status">
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="icon-box" style={{ background: "hsl(175 98% 41% / 0.15)" }}>
                  <RefreshCw className="w-5 h-5 text-primary" />
                </div>
                <CardTitle className="text-lg font-bold">
                  Статус синхронизации
                </CardTitle>
              </div>
              {syncStatus.lastSyncStatus && (
                <Badge
                  variant={syncStatus.lastSyncStatus === "success" ? "default" : "destructive"}
                  data-testid="badge-sync-status"
                >
                  {syncStatus.lastSyncStatus === "success" ? "Успешно" : syncStatus.lastSyncStatus === "partial" ? "Частично" : "Ошибка"}
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex items-center gap-3">
                  <RefreshCw className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Синхронизаций сегодня</p>
                    <p className="text-lg font-bold" data-testid="text-sync-total-today">{formatNumber(syncStatus.totalSyncsToday)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Успешных</p>
                    <p className="text-lg font-bold text-green-600 dark:text-green-400" data-testid="text-sync-success">{formatNumber(syncStatus.successCount)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <XCircle className="w-4 h-4 text-destructive" />
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">С ошибками</p>
                    <p className="text-lg font-bold text-destructive" data-testid="text-sync-fail">{formatNumber(syncStatus.failCount)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Shield className="w-4 h-4 text-amber-500" />
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Резервный остаток</p>
                    <p className="text-lg font-bold text-amber-600 dark:text-amber-400" data-testid="text-sync-safety">{formatNumber(syncStatus.safetyStockTriggeredCount)}</p>
                  </div>
                </div>
              </div>
              {syncStatus.lastSyncAt && (
                <p className="text-xs text-muted-foreground mt-4" data-testid="text-last-sync-time">
                  Последняя синхронизация: {new Date(syncStatus.lastSyncAt).toLocaleString("ru-RU")}
                </p>
              )}
              {syncStatus.recentLogs && syncStatus.recentLogs.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Последние события</p>
                  {syncStatus.recentLogs.slice(0, 3).map((log: any) => (
                    <div key={log.id} className="flex items-start gap-2 text-xs p-2 rounded-md bg-muted/50" data-testid={`row-sync-log-${log.id}`}>
                      {log.status === "success" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-green-500 shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 mt-0.5 text-destructive shrink-0" />
                      )}
                      <span className="text-foreground">{log.details}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {lowStockProducts && lowStockProducts.length > 0 && (
          <div data-testid="section-low-stock">
            <Card className="border-destructive/30 bg-destructive/5 dark:bg-destructive/10">
              <CardHeader className="flex flex-row items-center gap-3 pb-4 flex-wrap">
                <div className="icon-box" style={{ background: "hsl(0 84% 60% / 0.15)" }}>
                  <AlertTriangle className="w-5 h-5 text-destructive" />
                </div>
                <CardTitle className="text-lg font-bold text-destructive">
                  Критический остаток
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-destructive/20">
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Товар</th>
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Компания</th>
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Артикул</th>
                        <th className="text-right py-2 font-medium text-muted-foreground">Остаток</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lowStockProducts.map((product) => (
                        <tr
                          key={product.id}
                          className="border-b border-destructive/10 last:border-0"
                          data-testid={`row-low-stock-${product.id}`}
                        >
                          <td className="py-2 pr-4 font-medium">{product.name}</td>
                          <td className="py-2 pr-4 text-muted-foreground">{product.companyName}</td>
                          <td className="py-2 pr-4 text-muted-foreground font-mono text-xs">{product.sku}</td>
                          <td className="py-2 text-right font-bold text-destructive">
                            {formatNumber(product.stockQuantity)} шт.
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {kpi?.companies && kpi.companies.length > 0 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold tracking-tight" data-testid="text-companies-header">
              Компании
            </h2>

            {kpi.companies.map((company, companyIndex) => (
              <Card
                key={company.id}
                className="kpi-card"
                data-testid={`card-company-${company.id}`}
              >
                <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4 flex-wrap">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div
                      className="icon-box"
                      style={{ background: CHART_COLORS[companyIndex % CHART_COLORS.length] + "20" }}
                    >
                      <Building2
                        className="w-5 h-5"
                        style={{ color: CHART_COLORS[companyIndex % CHART_COLORS.length] }}
                      />
                    </div>
                    <div>
                      <CardTitle className="text-xl font-bold" data-testid={`text-company-name-${company.id}`}>
                        {company.name}
                      </CardTitle>
                      {company.inn && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          ИНН: {company.inn}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="counter-badge" data-testid={`badge-company-stock-${company.id}`}>
                      <Warehouse className="w-3.5 h-3.5" />
                      {formatNumber(company.totalStock)} шт.
                    </div>
                    {canSeePurchasePrice && (
                      <div className="counter-badge" data-testid={`badge-company-value-${company.id}`}>
                        <Coins className="w-3.5 h-3.5" />
                        {formatCurrency(company.totalValue)}
                      </div>
                    )}
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {company.stores.map((store) => {
                      const mpStyle = MARKETPLACE_STYLES[store.marketplace] || {
                        label: store.marketplace,
                        bg: CHART_COLORS[0],
                        color: "#FFFFFF",
                      };

                      return (
                        <Card
                          key={store.id}
                          className="hover-elevate"
                          data-testid={`card-store-${store.id}`}
                        >
                          <CardContent className="pt-5 pb-5">
                            <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
                              <div className="flex items-center gap-2">
                                <div className="icon-box">
                                  <Store className="w-4 h-4 text-primary" />
                                </div>
                                <span
                                  className="text-xs font-bold px-2.5 py-1 rounded-md"
                                  style={{
                                    backgroundColor: mpStyle.bg,
                                    color: mpStyle.color,
                                  }}
                                  data-testid={`badge-marketplace-${store.id}`}
                                >
                                  {mpStyle.label}
                                </span>
                              </div>
                            </div>

                            <p
                              className="text-sm font-semibold truncate mb-3"
                              data-testid={`text-store-name-${store.id}`}
                            >
                              {store.name}
                            </p>

                            <div className="flex items-center gap-3 mb-4 flex-wrap">
                              <div
                                className="flex items-center gap-1.5 text-sm"
                                data-testid={`text-store-stock-${store.id}`}
                              >
                                <Package className="w-4 h-4 text-muted-foreground" />
                                <span className="font-medium">
                                  {formatNumber(store.productCount)}
                                </span>
                                <span className="text-muted-foreground">шт.</span>
                              </div>
                              <div
                                className="flex items-center gap-1.5 text-sm"
                                data-testid={`text-store-orders-${store.id}`}
                              >
                                <ShoppingCart className="w-4 h-4 text-muted-foreground" />
                                <span className="counter-badge">
                                  {store.pendingOrders}
                                </span>
                                {store.pendingOrders > 0 && (
                                  <span
                                    className="inline-block w-2.5 h-2.5 rounded-full animate-pulse"
                                    style={{ backgroundColor: "#ef4444", boxShadow: "0 0 6px 2px rgba(239,68,68,0.4)" }}
                                    data-testid={`indicator-pending-${store.id}`}
                                  />
                                )}
                                <span className="text-muted-foreground">в обработке</span>
                              </div>
                            </div>

                            <Link href={`/orders?store=${store.id}`}>
                              <Button
                                variant="outline"
                                className="w-full"
                                data-testid={`button-store-orders-${store.id}`}
                              >
                                <ExternalLink className="w-4 h-4 mr-2" />
                                Быстрый доступ
                              </Button>
                            </Link>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {salesData && salesData.length > 0 && (
          <div className="space-y-4" data-testid="section-sales-chart">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <h2 className="text-2xl font-bold tracking-tight">
                Выручка за последние 30 дней
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant={salesFilter === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSalesFilter("all")}
                  data-testid="button-sales-filter-all"
                >
                  Все
                </Button>
                {companyNames.map((name) => (
                  <Button
                    key={name}
                    variant={salesFilter === name ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSalesFilter(name)}
                    data-testid={`button-sales-filter-${name}`}
                  >
                    {name}
                  </Button>
                ))}
              </div>
            </div>
            <Card className="kpi-card">
              <CardContent className="pt-6">
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(175 15% 88%)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v: string) => {
                        const parts = v.split("-");
                        return parts.length >= 3 ? `${parts[2]}.${parts[1]}` : v;
                      }}
                    />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v: number) => formatNumber(v)}
                    />
                    <Tooltip
                      formatter={(value: number) => [formatCurrency(value), "Выручка"]}
                      labelFormatter={(label: string) => {
                        const parts = label.split("-");
                        return parts.length >= 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : label;
                      }}
                      contentStyle={{
                        borderRadius: "8px",
                        border: "1px solid hsl(175 15% 88%)",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      stroke="#0FC2C0"
                      strokeWidth={2.5}
                      dot={{ fill: "#0CABA8", r: 3 }}
                      activeDot={{ fill: "#0FC2C0", r: 5, strokeWidth: 2, stroke: "#fff" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        )}

        {!hasCompanies && !kpiLoading && totalProducts === 0 && (
          <Card className="kpi-card" data-testid="card-empty-state">
            <CardContent className="py-16 flex flex-col items-center justify-center gap-4">
              <div className="icon-box icon-box-lg">
                <Building2 className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-lg font-semibold text-muted-foreground">
                Нет данных для отображения
              </p>
              <p className="text-sm text-muted-foreground">
                Создайте демо-данные, чтобы увидеть панель управления в действии
              </p>
              <Button
                onClick={() => seedMutation.mutate()}
                disabled={seedMutation.isPending}
                className="premium-button mt-2"
                data-testid="button-seed-data-empty"
              >
                <Database className="w-4 h-4 mr-2" />
                {seedMutation.isPending ? "Создание..." : "Создать демо-данные"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
