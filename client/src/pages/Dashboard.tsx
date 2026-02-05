import { Layout } from "@/components/Layout";
import { useProducts } from "@/hooks/use-products";
import { useOrders } from "@/hooks/use-orders";
import { useKPI } from "@/hooks/use-kpi";
import { Package, Warehouse, TrendingUp, Coins, Database, ShoppingCart, Users, ArrowUpRight, BarChart3 } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatQuantity } from "@/lib/format";
import { Customer } from "@shared/schema";

const COLORS = ['#f59e0b', '#d97706', '#b45309'];

export default function Dashboard() {
  const { data: products } = useProducts();
  const { data: orders } = useOrders();
  const { data: kpi, isLoading: kpiLoading } = useKPI();
  const { data: customers } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
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
    }
  });

  const totalProducts = products?.length || 0;
  const totalOrders = orders?.length || 0;
  const totalCustomers = customers?.length || 0;
  const lowStock = products?.filter(p => p.stockQuantity < 10).length || 0;

  const pieData = kpi ? [
    { name: "Склад", value: kpi.stockDistribution.local },
    { name: "Ozon", value: kpi.stockDistribution.ozon },
    { name: "WB", value: kpi.stockDistribution.wb },
  ].filter(d => d.value > 0) : [];

  const barData = kpi ? [
    { name: "Склад", value: kpi.stockDistribution.local },
    { name: "Ozon", value: kpi.stockDistribution.ozon },
    { name: "WB", value: kpi.stockDistribution.wb },
  ] : [];

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card p-3 border border-border rounded-xl shadow-lg">
          <p className="text-sm font-semibold">{payload[0].name}</p>
          <p className="text-lg font-bold text-primary">{formatQuantity(payload[0].value)} шт.</p>
        </div>
      );
    }
    return null;
  };

  return (
    <Layout>
      <div className="space-y-8 pb-8">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
          <div>
            <h1 className="text-4xl font-bold tracking-tight" data-testid="text-welcome">
              Добро пожаловать
            </h1>
            <p className="text-muted-foreground mt-2 text-lg">Управление складом и продажами</p>
          </div>
          
          <div className="flex items-center gap-3 flex-wrap">
            {totalProducts === 0 && (
              <Button 
                onClick={() => seedMutation.mutate()} 
                disabled={seedMutation.isPending}
                className="shadow-lg"
                data-testid="button-seed-data"
              >
                <Database className="w-4 h-4 mr-2" />
                {seedMutation.isPending ? "Создание..." : "Создать демо-данные"}
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <span className="yellow-badge">
            Товаров: {totalProducts}
          </span>
          <span className="yellow-badge">
            Заказов: {totalOrders}
          </span>
          <span className="yellow-badge">
            Клиентов: {totalCustomers}
          </span>
          {lowStock > 0 && (
            <span className="bg-destructive/20 text-destructive px-3 py-1.5 rounded-full text-sm font-medium">
              Мало на складе: {lowStock}
            </span>
          )}
        </div>

        <div className="flex items-center justify-end gap-6">
          <div className="flex items-center gap-2" data-testid="stat-products">
            <Package className="w-5 h-5 text-muted-foreground" />
            <span className="text-3xl font-bold">{totalProducts}</span>
            <span className="text-sm text-muted-foreground">Товаров</span>
          </div>
          <div className="flex items-center gap-2" data-testid="stat-orders">
            <ShoppingCart className="w-5 h-5 text-muted-foreground" />
            <span className="text-3xl font-bold">{totalOrders}</span>
            <span className="text-sm text-muted-foreground">Заказов</span>
          </div>
          <div className="flex items-center gap-2" data-testid="stat-customers">
            <Users className="w-5 h-5 text-muted-foreground" />
            <span className="text-3xl font-bold">{totalCustomers}</span>
            <span className="text-sm text-muted-foreground">Клиентов</span>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="kpi-card col-span-1 warm-gradient" data-testid="card-capitalization">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Капитализация</p>
                  <p className="text-3xl font-bold tracking-tight">
                    {kpiLoading ? "..." : formatCurrency(kpi?.capitalization || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">По закупочной цене</p>
                </div>
                <div className="p-3 bg-primary/20 rounded-xl">
                  <Coins className="w-6 h-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="kpi-card col-span-1" data-testid="card-revenue">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Ожидаемая выручка</p>
                  <p className="text-3xl font-bold tracking-tight">
                    {kpiLoading ? "..." : formatCurrency(kpi?.expectedRevenue || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">По продажной цене</p>
                </div>
                <div className="p-3 bg-accent/30 rounded-xl">
                  <TrendingUp className="w-6 h-6 text-accent-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="dark-card col-span-1" data-testid="card-profit">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-sidebar-foreground/70 mb-2">Прогноз прибыли</p>
                  <p className="text-3xl font-bold tracking-tight text-sidebar-foreground">
                    {kpiLoading ? "..." : formatCurrency(kpi?.expectedProfit || 0)}
                  </p>
                  <p className="text-xs text-sidebar-foreground/60 mt-2">С учётом налогов и комиссий</p>
                </div>
                <div className="p-3 bg-sidebar-accent/20 rounded-xl">
                  <ArrowUpRight className="w-6 h-6 text-sidebar-accent" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-7">
          <Card className="lg:col-span-4 kpi-card" data-testid="card-stock-chart">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg font-semibold">Распределение остатков</CardTitle>
              <BarChart3 className="w-5 h-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {barData.length > 0 ? (
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                      <XAxis 
                        dataKey="name" 
                        axisLine={false} 
                        tickLine={false}
                        tick={{ fill: 'hsl(var(--muted-foreground))' }}
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false}
                        tick={{ fill: 'hsl(var(--muted-foreground))' }}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar 
                        dataKey="value" 
                        fill="hsl(var(--primary))" 
                        radius={[8, 8, 0, 0]}
                        maxBarSize={60}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-muted-foreground">
                  Нет данных для отображения
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-3 kpi-card" data-testid="card-stock-pie">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-semibold">Доля каналов</CardTitle>
            </CardHeader>
            <CardContent>
              {pieData.length > 0 ? (
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex justify-center gap-6 -mt-4">
                    {pieData.map((entry, index) => (
                      <div key={entry.name} className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        <span className="text-sm text-muted-foreground">{entry.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-muted-foreground">
                  Нет данных
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="kpi-card" data-testid="card-stock-local">
            <CardContent className="pt-6">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">На складе</p>
                  <p className="text-3xl font-bold mt-1">
                    {kpiLoading ? "..." : formatQuantity(kpi?.stockDistribution.local || 0)}
                  </p>
                </div>
                <div className="p-3 bg-primary/10 rounded-xl">
                  <Warehouse className="h-6 w-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="kpi-card" data-testid="card-stock-ozon">
            <CardContent className="pt-6">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Ozon</p>
                  <p className="text-3xl font-bold mt-1">
                    {kpiLoading ? "..." : formatQuantity(kpi?.stockDistribution.ozon || 0)}
                  </p>
                </div>
                <div className="px-3 py-2 bg-orange-100 text-orange-700 rounded-xl text-sm font-bold">
                  OZON
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="kpi-card" data-testid="card-stock-wb">
            <CardContent className="pt-6">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Wildberries</p>
                  <p className="text-3xl font-bold mt-1">
                    {kpiLoading ? "..." : formatQuantity(kpi?.stockDistribution.wb || 0)}
                  </p>
                </div>
                <div className="px-3 py-2 bg-purple-100 text-purple-700 rounded-xl text-sm font-bold">
                  WB
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {products && products.filter(p => p.stockQuantity < 10).length > 0 && (
          <Card className="kpi-card border-l-4 border-l-destructive" data-testid="card-low-stock">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Package className="w-5 h-5 text-destructive" />
                Низкий остаток
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {products.filter(p => p.stockQuantity < 10).slice(0, 6).map(product => (
                  <div 
                    key={product.id} 
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-xl"
                    data-testid={`low-stock-item-${product.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-xl bg-card flex items-center justify-center flex-shrink-0 border border-border">
                        <Package className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-none truncate">{product.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">{product.sku}</p>
                      </div>
                    </div>
                    <div className="text-sm font-bold text-destructive flex-shrink-0 ml-2">
                      {product.stockQuantity} шт.
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
