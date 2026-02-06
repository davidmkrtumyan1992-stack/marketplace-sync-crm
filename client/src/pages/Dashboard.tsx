import { Layout } from "@/components/Layout";
import { useProducts } from "@/hooks/use-products";
import { useOrders } from "@/hooks/use-orders";
import { useKPI } from "@/hooks/use-kpi";
import { Package, Warehouse, TrendingUp, Coins, ArrowUpRight, Building2, Store, ShoppingCart, ExternalLink, Database } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatQuantity, formatNumber } from "@/lib/format";
import type { DashboardKPI } from "@shared/schema";
import { Link } from "wouter";

const CHART_COLORS = ['#0FC2C0', '#0CABA8', '#008F8C', '#015958'];

const MARKETPLACE_STYLES: Record<string, { label: string; bg: string; color: string }> = {
  ozon: { label: "Ozon", bg: "#005BFF", color: "#FFFFFF" },
  wb: { label: "Wildberries", bg: "#CB11AB", color: "#FFFFFF" },
  yandex: { label: "Yandex Market", bg: "#FFCC00", color: "#000000" },
};

export default function Dashboard() {
  const { data: products } = useProducts();
  const { data: kpi, isLoading: kpiLoading } = useKPI();
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
              Сводка по всем компаниям и магазинам
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
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
                  <p className="text-xs text-muted-foreground mt-3">шт. на всех складах</p>
                </div>
                <div className="icon-box icon-box-lg">
                  <Package className="w-7 h-7 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

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
        </div>

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
                    <div className="counter-badge" data-testid={`badge-company-value-${company.id}`}>
                      <Coins className="w-3.5 h-3.5" />
                      {formatCurrency(company.totalValue)}
                    </div>
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
