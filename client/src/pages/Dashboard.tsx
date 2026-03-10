import { useState, useMemo, useCallback } from "react";
import { Layout } from "@/components/Layout";
import { useProducts } from "@/hooks/use-products";
import { useOrders } from "@/hooks/use-orders";
import { useKPI } from "@/hooks/use-kpi";
import { useRole } from "@/hooks/use-role";
import { useQuery } from "@tanstack/react-query";
import { Package, Warehouse, TrendingUp, Coins, ArrowUpRight, Building2, Store, ShoppingCart, ExternalLink, Database, AlertTriangle, RefreshCw, CheckCircle2, XCircle, Shield, CalendarDays, Boxes, Calendar as CalendarIcon, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatQuantity, formatNumber } from "@/lib/format";
import { getMarketplaceStyle } from "@/lib/marketplace";
import type { DashboardKPI, LowStockProduct, SalesDataPoint, SalesResponse, SyncStatusSummary, MarketplaceBreakdown } from "@shared/schema";
import { Link } from "wouter";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from "recharts";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, subDays, startOfMonth } from "date-fns";
import { ru } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { api } from "@shared/routes";

const CHART_COLORS = ['#0FC2C0', '#0CABA8', '#008F8C', '#015958'];

const MARKETPLACE_COLORS: Record<string, string> = {
  ozon: "#005bff",
  yandex: "#ffcc00",
  wildberries: "#cb11ab",
  other: "#6b7280",
};

const MARKETPLACE_LABELS: Record<string, string> = {
  ozon: "Ozon",
  yandex: "Yandex Market",
  wildberries: "Wildberries",
  other: "Прочее",
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

  const { data: storesList } = useQuery<any[]>({
    queryKey: [api.stores.list.path],
  });

  const { data: syncStatus } = useQuery<SyncStatusSummary>({
    queryKey: ["/api/inventory-sync/status"],
    refetchInterval: 60000,
  });

  const today = useMemo(() => new Date(), []);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: today,
    to: today,
  });
  const [datePreset, setDatePreset] = useState<string>("today");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [lowStockOpen, setLowStockOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [activeBarIndex, setActiveBarIndex] = useState<number | null>(null);

  const applyPreset = useCallback((preset: string) => {
    setDatePreset(preset);
    const now = new Date();
    switch (preset) {
      case "today":
        setDateRange({ from: now, to: now });
        break;
      case "yesterday":
        const y = subDays(now, 1);
        setDateRange({ from: y, to: y });
        break;
      case "7days":
        setDateRange({ from: subDays(now, 6), to: now });
        break;
      case "month":
        setDateRange({ from: startOfMonth(now), to: now });
        break;
    }
  }, []);

  const salesQueryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (dateRange?.from) params.set("from", format(dateRange.from, "yyyy-MM-dd"));
    if (dateRange?.to) params.set("to", format(dateRange.to, "yyyy-MM-dd"));
    if (storeFilter !== "all") params.set("storeId", storeFilter);
    return params.toString();
  }, [dateRange, storeFilter]);

  const { data: salesResponse } = useQuery<SalesResponse>({
    queryKey: ["/api/analytics/sales", salesQueryParams],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/sales?${salesQueryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch sales");
      return res.json();
    },
    staleTime: 0,
  });

  const chartData = useMemo(() => {
    if (!salesResponse?.data) return [];
    const grouped: Record<string, number> = {};
    salesResponse.data.forEach((p) => {
      grouped[p.date] = (grouped[p.date] || 0) + p.revenue;
    });
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, revenue]) => ({ date, revenue }));
  }, [salesResponse]);

  const totalRevenue = salesResponse?.totalRevenue ?? 0;
  const totalOrders = salesResponse?.totalOrders ?? 0;

  const donutData = useMemo(() => {
    const breakdown = salesResponse?.marketplaceBreakdown;
    if (!breakdown) return [];
    return (["ozon", "yandex", "wildberries", "other"] as const)
      .filter(key => breakdown[key] > 0)
      .map(key => ({
        name: MARKETPLACE_LABELS[key],
        value: breakdown[key],
        color: MARKETPLACE_COLORS[key],
        key,
      }));
  }, [salesResponse]);

  const dateRangeLabel = useMemo(() => {
    if (!dateRange?.from) return "Выберите период";
    if (!dateRange.to || dateRange.from.toDateString() === dateRange.to.toDateString()) {
      return format(dateRange.from, "d MMMM yyyy", { locale: ru });
    }
    return `${format(dateRange.from, "d MMM", { locale: ru })} — ${format(dateRange.to, "d MMM yyyy", { locale: ru })}`;
  }, [dateRange]);

  const handleExport = useCallback(() => {
    const params = new URLSearchParams();
    if (dateRange?.from) params.set("from", format(dateRange.from, "yyyy-MM-dd"));
    if (dateRange?.to) params.set("to", format(dateRange.to, "yyyy-MM-dd"));
    if (storeFilter !== "all") params.set("storeId", storeFilter);
    window.open(`/api/export/sales?${params.toString()}`, "_blank");
  }, [dateRange, storeFilter]);

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
          <Card className="kpi-card" data-testid="card-total-stock">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                    Общий остаток
                  </p>
                  <p className="text-3xl font-extrabold tracking-tight">
                    {kpiLoading ? "..." : formatNumber(kpi?.totalStock || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-3">шт. на центральном складе</p>
                </div>
                <div className="icon-box icon-box-lg shrink-0">
                  <Package className="w-7 h-7 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          {canSeePnL && (
            <Card className="kpi-card" data-testid="card-capitalization">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                      Капитализация
                    </p>
                    <p className="text-3xl font-extrabold tracking-tight">
                      {kpiLoading ? "..." : formatCurrency(kpi?.capitalization || 0)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-3">по закупочной цене</p>
                  </div>
                  <div className="icon-box icon-box-lg shrink-0">
                    <Coins className="w-7 h-7 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="kpi-card" data-testid="card-revenue">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                    Ожидаемая выручка
                  </p>
                  <p className="text-3xl font-extrabold tracking-tight truncate">
                    {kpiLoading ? "..." : formatCurrency(kpi?.expectedRevenue || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-3">по продажной цене</p>
                </div>
                <div className="icon-box icon-box-lg shrink-0">
                  <TrendingUp className="w-7 h-7 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          {canSeePnL && (
            <Card className="stat-card-premium" data-testid="card-profit">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-sm font-medium uppercase tracking-wide"
                      style={{ color: "hsl(175 30% 70%)" }}
                    >
                      Прогноз прибыли
                    </p>
                    <p className="stat-number mt-2 truncate whitespace-nowrap">
                      {kpiLoading ? "..." : formatCurrency(kpi?.expectedProfit || 0)}
                    </p>
                    <p className="text-xs mt-3" style={{ color: "hsl(175 20% 55%)" }}>
                      с учётом 7% налога
                    </p>
                  </div>
                  <div
                    className="icon-box icon-box-lg shrink-0"
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

        {kpi?.today && (
          <div className="grid gap-6 sm:grid-cols-3">
            <Card className="kpi-card" data-testid="card-active-items">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                      Товаров
                    </p>
                    <p className="text-3xl font-extrabold tracking-tight" data-testid="text-active-items">
                      {formatNumber(kpi.today.itemsCount)} <span className="text-lg font-semibold text-muted-foreground">шт.</span>
                    </p>
                  </div>
                  <div className="icon-box icon-box-lg shrink-0">
                    <Boxes className="w-7 h-7 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="kpi-card" data-testid="card-active-orders">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                      Заказы
                    </p>
                    <p className="text-3xl font-extrabold tracking-tight" data-testid="text-active-orders">
                      {formatNumber(kpi.today.ordersCount)} <span className="text-lg font-semibold text-muted-foreground">в обработке</span>
                    </p>
                  </div>
                  <div className="icon-box icon-box-lg shrink-0">
                    <CalendarDays className="w-7 h-7 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="kpi-card" data-testid="card-active-revenue">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                      Выручка
                    </p>
                    <p className="text-3xl font-extrabold tracking-tight" data-testid="text-active-revenue">
                      {formatCurrency(kpi.today.revenue)}
                    </p>
                  </div>
                  <div className="icon-box icon-box-lg shrink-0">
                    <TrendingUp className="w-7 h-7 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

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
            <Card
              className="border-destructive/30 bg-destructive/5 dark:bg-destructive/10 cursor-pointer transition-colors duration-150 hover:bg-destructive/10 dark:hover:bg-destructive/15"
              onClick={() => setLowStockOpen(true)}
              data-testid="card-low-stock-summary"
            >
              <CardContent className="py-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="icon-box" style={{ background: "hsl(0 84% 60% / 0.15)" }}>
                      <AlertTriangle className="w-5 h-5 text-destructive" />
                    </div>
                    <div>
                      <p className="text-lg font-bold text-destructive">Критический остаток</p>
                      <p className="text-sm text-muted-foreground">
                        {lowStockProducts.length} {lowStockProducts.length === 1 ? "товар" : lowStockProducts.length < 5 ? "товара" : "товаров"} с остатком менее 10 шт.
                      </p>
                    </div>
                  </div>
                  <Badge variant="destructive" className="text-base px-3 py-1" data-testid="badge-low-stock-count">
                    {lowStockProducts.length}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Dialog open={lowStockOpen} onOpenChange={setLowStockOpen}>
              <DialogContent className="max-w-2xl w-[95vw] sm:w-full max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="w-5 h-5" />
                    Критический остаток — {lowStockProducts.length} {lowStockProducts.length === 1 ? "товар" : lowStockProducts.length < 5 ? "товара" : "товаров"}
                  </DialogTitle>
                  <DialogDescription>
                    Товары с остатком менее 10 единиц на центральном складе
                  </DialogDescription>
                </DialogHeader>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-destructive/20">
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Товар</th>
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
                          <td className="py-2 pr-4 text-muted-foreground font-mono text-xs">{product.sku}</td>
                          <td className="py-2 text-right font-bold text-destructive">
                            {formatNumber(product.stockQuantity)} шт.
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {kpi?.companies && kpi.companies.length === 0 && (
          <Card className="kpi-card" data-testid="card-empty-companies">
            <CardContent className="py-12 text-center">
              <Building2 className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
              <p className="text-lg font-semibold mb-2">Нет компаний</p>
              <p className="text-sm text-muted-foreground mb-6">Создайте компанию и добавьте магазины для начала работы</p>
              <Link href="/settings">
                <Button data-testid="button-go-settings">Перейти в настройки</Button>
              </Link>
            </CardContent>
          </Card>
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
                      const mpStyle = getMarketplaceStyle(store.marketplace);

                      return (
                        <Card
                          key={store.id}
                          className=""
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

                            <div className="flex flex-col gap-2 mb-4">
                              <div className="flex items-center gap-3 flex-wrap">
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
                                    {store.activeOrdersCount}
                                  </span>
                                  {store.activeOrdersCount > 0 && (
                                    <span
                                      className="inline-block w-2.5 h-2.5 rounded-full animate-pulse"
                                      style={{ backgroundColor: "#ef4444", boxShadow: "0 0 6px 2px rgba(239,68,68,0.4)" }}
                                      data-testid={`indicator-pending-${store.id}`}
                                    />
                                  )}
                                  <span className="text-muted-foreground">в обработке</span>
                                </div>
                              </div>
                              <div
                                className="flex items-center gap-1.5 text-sm"
                                data-testid={`text-store-revenue-${store.id}`}
                              >
                                <Coins className="w-4 h-4 text-muted-foreground" />
                                <span className="font-semibold" style={{ color: store.activeOrdersRevenue > 0 ? "hsl(142 71% 45%)" : undefined }}>
                                  {formatCurrency(store.activeOrdersRevenue)}
                                </span>
                                <span className="text-muted-foreground">выручка</span>
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

        <div className="space-y-5" data-testid="section-sales-chart">
          <Card className="kpi-card overflow-hidden">
            <CardContent className="p-6 sm:p-8">
              <div className="flex flex-col gap-6">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-1">Выручка</p>
                    <p className="text-4xl sm:text-5xl font-extrabold tracking-tight" data-testid="text-total-revenue">
                      {formatCurrency(totalRevenue)}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">{dateRangeLabel}</p>
                    <p className="text-xs text-muted-foreground/60 mt-0.5 font-mono" data-testid="text-debug-orders">
                      Total DB Orders: {totalOrders}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-0.5">
                      {[
                        { key: "today", label: "Сегодня" },
                        { key: "yesterday", label: "Вчера" },
                        { key: "7days", label: "7 дней" },
                        { key: "month", label: "Месяц" },
                      ].map((p) => (
                        <Button
                          key={p.key}
                          variant={datePreset === p.key ? "default" : "ghost"}
                          size="sm"
                          className="h-7 px-3 text-xs"
                          onClick={() => applyPreset(p.key)}
                          data-testid={`button-preset-${p.key}`}
                        >
                          {p.label}
                        </Button>
                      ))}
                    </div>

                    <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 gap-1.5" data-testid="button-calendar">
                          <CalendarIcon className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Период</span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="end">
                        <Calendar
                          mode="range"
                          selected={dateRange}
                          onSelect={(range) => {
                            setDateRange(range);
                            setDatePreset("");
                            if (range?.from && range?.to) setCalendarOpen(false);
                          }}
                          numberOfMonths={2}
                          locale={ru}
                        />
                      </PopoverContent>
                    </Popover>

                    <Select value={storeFilter} onValueChange={setStoreFilter}>
                      <SelectTrigger className="h-8 w-[160px] text-xs" data-testid="select-store-filter">
                        <Store className="w-3.5 h-3.5 mr-1 shrink-0" />
                        <SelectValue placeholder="Все магазины" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Все магазины</SelectItem>
                        {storesList?.map((s: any) => (
                          <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={handleExport}
                      data-testid="button-export-sales"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Excel</span>
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6" style={{ minHeight: 280 }}>
                  <div className="lg:col-span-3 w-full">
                    {chartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart
                          data={chartData}
                          barCategoryGap="20%"
                          onMouseMove={(state: any) => {
                            if (state?.activeTooltipIndex !== undefined) {
                              setActiveBarIndex(state.activeTooltipIndex);
                            }
                          }}
                          onMouseLeave={() => setActiveBarIndex(null)}
                        >
                          <defs>
                            <linearGradient id="barGradientActive" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#ec4899" stopOpacity={0.95} />
                              <stop offset="100%" stopColor="#a855f7" stopOpacity={0.85} />
                            </linearGradient>
                            <linearGradient id="barGradientInactive" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.15} />
                              <stop offset="100%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.08} />
                            </linearGradient>
                          </defs>
                          <XAxis
                            dataKey="date"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                            tickFormatter={(v: string) => {
                              const parts = v.split("-");
                              return parts.length >= 3 ? `${parts[2]}.${parts[1]}` : v;
                            }}
                          />
                          <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                            tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}к` : String(v)}
                            width={45}
                          />
                          <Tooltip
                            cursor={false}
                            formatter={(value: number) => [formatCurrency(value), "Выручка"]}
                            labelFormatter={(label: string) => {
                              const parts = label.split("-");
                              return parts.length >= 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : label;
                            }}
                            contentStyle={{
                              borderRadius: "12px",
                              border: "none",
                              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                              padding: "10px 14px",
                              background: "hsl(var(--popover))",
                              color: "hsl(var(--popover-foreground))",
                            }}
                          />
                          <Bar dataKey="revenue" radius={[8, 8, 4, 4]} maxBarSize={48}>
                            {chartData.map((_, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={activeBarIndex === index ? "url(#barGradientActive)" : "url(#barGradientInactive)"}
                                style={{ transition: "fill 0.2s ease", cursor: "pointer" }}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">
                        Нет данных за выбранный период
                      </div>
                    )}
                  </div>

                  <div className="lg:col-span-2 flex flex-col items-center justify-center" data-testid="section-marketplace-donut">
                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">По маркетплейсам</p>
                    {donutData.length > 0 ? (
                      <>
                        <ResponsiveContainer width="100%" height={200}>
                          <PieChart>
                            <Pie
                              data={donutData}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius="55%"
                              outerRadius="85%"
                              paddingAngle={3}
                              strokeWidth={0}
                            >
                              {donutData.map((entry, index) => (
                                <Cell key={`donut-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(value: number) => [formatCurrency(value, true), ""]}
                              contentStyle={{
                                borderRadius: "12px",
                                border: "none",
                                boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                                padding: "10px 14px",
                                background: "hsl(var(--popover))",
                                color: "hsl(var(--popover-foreground))",
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="flex flex-col gap-2 mt-2 w-full px-4" data-testid="donut-legend">
                          {donutData.map((entry) => (
                            <div key={entry.key} className="flex items-center justify-between gap-3" data-testid={`donut-legend-${entry.key}`}>
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                                <span className="text-sm font-medium">{entry.name}</span>
                              </div>
                              <span className="text-sm font-semibold tabular-nums">{formatCurrency(entry.value, true)}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
                        Нет данных
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

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
