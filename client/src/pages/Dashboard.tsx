import { Layout } from "@/components/Layout";
import { useProducts } from "@/hooks/use-products";
import { useOrders } from "@/hooks/use-orders";
import { useKPI } from "@/hooks/use-kpi";
import { Package, Warehouse, TrendingUp, Coins, Database, ArrowUpRight, BarChart3 } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatQuantity } from "@/lib/format";
import { Customer } from "@shared/schema";

const CHART_COLORS = ['#0FC2C0', '#0CABA8', '#008F8C'];

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
  const lowStock = products?.filter(p => p.stockQuantity < 10).length || 0;

  const pieData = kpi ? [
    { name: "Склад", value: kpi.stockDistribution.local, color: CHART_COLORS[0] },
    { name: "Ozon", value: kpi.stockDistribution.ozon, color: CHART_COLORS[1] },
    { name: "WB", value: kpi.stockDistribution.wb, color: CHART_COLORS[2] },
  ].filter(d => d.value > 0) : [];

  const barData = kpi ? [
    { name: "Склад", value: kpi.stockDistribution.local, fill: CHART_COLORS[0] },
    { name: "Ozon", value: kpi.stockDistribution.ozon, fill: CHART_COLORS[1] },
    { name: "WB", value: kpi.stockDistribution.wb, fill: CHART_COLORS[2] },
  ] : [];

  const totalStock = (kpi?.stockDistribution.local || 0) + (kpi?.stockDistribution.ozon || 0) + (kpi?.stockDistribution.wb || 0);

  const CustomBarTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="glass-card p-4">
          <p className="text-sm font-semibold text-foreground">{payload[0].payload.name}</p>
          <p className="text-2xl font-bold text-primary">{formatQuantity(payload[0].value)} шт.</p>
        </div>
      );
    }
    return null;
  };

  const renderCustomBarLabel = (props: any) => {
    const { x, y, width, value } = props;
    return (
      <text 
        x={x + width / 2} 
        y={y - 10} 
        fill="hsl(var(--foreground))" 
        textAnchor="middle" 
        fontSize={14}
        fontWeight={700}
      >
        {formatQuantity(value)}
      </text>
    );
  };

  return (
    <Layout>
      <div className="space-y-8 pb-8">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-foreground via-foreground to-primary bg-clip-text" data-testid="text-welcome">
              Добро пожаловать
            </h1>
            <p className="text-muted-foreground mt-2 text-lg">Управление складом и продажами</p>
          </div>
          
          <div className="flex items-center gap-3 flex-wrap">
            {totalProducts === 0 && (
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

        {lowStock > 0 && (
          <div className="teal-badge inline-flex items-center gap-2">
            <Package className="w-4 h-4" />
            Мало на складе: {lowStock} товаров
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="kpi-card hover-elevate" data-testid="card-capitalization">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wide">Капитализация</p>
                  <p className="text-4xl font-extrabold tracking-tight">
                    {kpiLoading ? "..." : formatCurrency(kpi?.capitalization || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-3">По закупочной цене</p>
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
                  <p className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wide">Ожидаемая выручка</p>
                  <p className="text-4xl font-extrabold tracking-tight">
                    {kpiLoading ? "..." : formatCurrency(kpi?.expectedRevenue || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-3">По продажной цене</p>
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
                  <p className="text-sm font-medium uppercase tracking-wide" style={{ color: 'hsl(175 30% 70%)' }}>
                    Прогноз прибыли
                  </p>
                  <p className="stat-number mt-2">
                    {kpiLoading ? "..." : formatCurrency(kpi?.expectedProfit || 0)}
                  </p>
                  <p className="text-xs mt-3" style={{ color: 'hsl(175 20% 55%)' }}>С учётом налогов и комиссий</p>
                </div>
                <div className="icon-box icon-box-lg" style={{ background: 'linear-gradient(135deg, hsl(175 98% 41% / 0.3) 0%, hsl(175 85% 35% / 0.2) 100%)' }}>
                  <ArrowUpRight className="w-7 h-7 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-7">
          <Card className="lg:col-span-4 kpi-card" data-testid="card-stock-chart">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-xl font-bold">Распределение остатков</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">Количество товаров по каналам</p>
              </div>
              <div className="counter-badge">
                {formatQuantity(totalStock)} шт.
              </div>
            </CardHeader>
            <CardContent>
              {barData.length > 0 ? (
                <div className="chart-container">
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} margin={{ top: 30, right: 30, left: 20, bottom: 20 }}>
                        <XAxis 
                          dataKey="name" 
                          axisLine={false} 
                          tickLine={false}
                          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 13, fontWeight: 500 }}
                        />
                        <YAxis 
                          axisLine={false} 
                          tickLine={false}
                          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                        />
                        <Tooltip content={<CustomBarTooltip />} cursor={{ fill: 'hsl(var(--muted) / 0.3)' }} />
                        <Bar 
                          dataKey="value" 
                          radius={[12, 12, 0, 0]}
                          maxBarSize={80}
                          label={renderCustomBarLabel}
                        >
                          {barData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  
                  <div className="flex justify-center gap-6 mt-4 pt-4 border-t border-border/50">
                    {barData.map((entry, index) => (
                      <div key={entry.name} className="flex flex-col items-center gap-1">
                        <div 
                          className="w-4 h-4 rounded-lg shadow-lg" 
                          style={{ backgroundColor: entry.fill, boxShadow: `0 4px 14px -3px ${entry.fill}40` }}
                        />
                        <span className="text-sm font-medium">{entry.name}</span>
                        <span className="counter-badge text-xs px-2 py-1">{formatQuantity(entry.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>Нет данных для отображения</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-3 kpi-card" data-testid="card-stock-pie">
            <CardHeader className="pb-2">
              <CardTitle className="text-xl font-bold">Доля каналов</CardTitle>
              <p className="text-sm text-muted-foreground">Процентное распределение</p>
            </CardHeader>
            <CardContent>
              {pieData.length > 0 ? (
                <div className="chart-container">
                  <div className="h-[260px] relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={70}
                          outerRadius={100}
                          paddingAngle={4}
                          dataKey="value"
                          strokeWidth={0}
                        >
                          {pieData.map((entry, index) => (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={entry.color}
                              style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.1))' }}
                            />
                          ))}
                        </Pie>
                        <Tooltip 
                          content={<CustomBarTooltip />}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="text-center">
                        <p className="text-3xl font-extrabold">{formatQuantity(totalStock)}</p>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Всего</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex flex-col gap-3 mt-4 pt-4 border-t border-border/50">
                    {pieData.map((entry) => {
                      const percent = totalStock > 0 ? ((entry.value / totalStock) * 100).toFixed(0) : 0;
                      return (
                        <div key={entry.name} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div 
                              className="w-4 h-4 rounded-lg" 
                              style={{ backgroundColor: entry.color, boxShadow: `0 4px 14px -3px ${entry.color}40` }}
                            />
                            <span className="text-sm font-medium">{entry.name}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-bold">{formatQuantity(entry.value)} шт.</span>
                            <span className="counter-badge text-xs px-2 py-1">{percent}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="h-[260px] flex items-center justify-center text-muted-foreground">
                  Нет данных
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="kpi-card hover-elevate group" data-testid="card-stock-local">
            <CardContent className="pt-6">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">На складе</p>
                  <div className="flex items-baseline gap-2 mt-2">
                    <p className="text-4xl font-extrabold">
                      {kpiLoading ? "..." : formatQuantity(kpi?.stockDistribution.local || 0)}
                    </p>
                    <span className="text-muted-foreground">шт.</span>
                  </div>
                </div>
                <div className="icon-box icon-box-lg group-hover:scale-110 transition-transform duration-300" style={{ background: CHART_COLORS[0] + '20' }}>
                  <Warehouse className="h-7 w-7" style={{ color: CHART_COLORS[0] }} />
                </div>
              </div>
              <div className="mt-4 h-2 rounded-full overflow-hidden bg-muted">
                <div 
                  className="h-full rounded-full transition-all duration-500"
                  style={{ 
                    width: totalStock > 0 ? `${((kpi?.stockDistribution.local || 0) / totalStock) * 100}%` : '0%',
                    background: `linear-gradient(90deg, ${CHART_COLORS[0]}, ${CHART_COLORS[1]})`
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="kpi-card hover-elevate group" data-testid="card-stock-ozon">
            <CardContent className="pt-6">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Ozon</p>
                  <div className="flex items-baseline gap-2 mt-2">
                    <p className="text-4xl font-extrabold">
                      {kpiLoading ? "..." : formatQuantity(kpi?.stockDistribution.ozon || 0)}
                    </p>
                    <span className="text-muted-foreground">шт.</span>
                  </div>
                </div>
                <div 
                  className="px-4 py-2 rounded-xl text-sm font-bold group-hover:scale-110 transition-transform duration-300"
                  style={{ background: CHART_COLORS[1] + '20', color: CHART_COLORS[1] }}
                >
                  OZON
                </div>
              </div>
              <div className="mt-4 h-2 rounded-full overflow-hidden bg-muted">
                <div 
                  className="h-full rounded-full transition-all duration-500"
                  style={{ 
                    width: totalStock > 0 ? `${((kpi?.stockDistribution.ozon || 0) / totalStock) * 100}%` : '0%',
                    background: CHART_COLORS[1]
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="kpi-card hover-elevate group" data-testid="card-stock-wb">
            <CardContent className="pt-6">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Wildberries</p>
                  <div className="flex items-baseline gap-2 mt-2">
                    <p className="text-4xl font-extrabold">
                      {kpiLoading ? "..." : formatQuantity(kpi?.stockDistribution.wb || 0)}
                    </p>
                    <span className="text-muted-foreground">шт.</span>
                  </div>
                </div>
                <div 
                  className="px-4 py-2 rounded-xl text-sm font-bold group-hover:scale-110 transition-transform duration-300"
                  style={{ background: CHART_COLORS[2] + '20', color: CHART_COLORS[2] }}
                >
                  WB
                </div>
              </div>
              <div className="mt-4 h-2 rounded-full overflow-hidden bg-muted">
                <div 
                  className="h-full rounded-full transition-all duration-500"
                  style={{ 
                    width: totalStock > 0 ? `${((kpi?.stockDistribution.wb || 0) / totalStock) * 100}%` : '0%',
                    background: CHART_COLORS[2]
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {products && products.filter(p => p.stockQuantity < 10).length > 0 && (
          <Card className="kpi-card" data-testid="card-low-stock" style={{ borderLeft: '4px solid hsl(var(--destructive))' }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-xl font-bold flex items-center gap-3">
                <div className="p-2 rounded-xl bg-destructive/10">
                  <Package className="w-5 h-5 text-destructive" />
                </div>
                Низкий остаток
                <span className="counter-badge ml-auto" style={{ background: 'hsl(var(--destructive))' }}>
                  {products.filter(p => p.stockQuantity < 10).length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {products.filter(p => p.stockQuantity < 10).slice(0, 6).map(product => (
                  <div 
                    key={product.id} 
                    className="flex items-center justify-between p-4 rounded-xl border border-border/50 hover-elevate bg-card"
                    data-testid={`low-stock-item-${product.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                        <Package className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-none truncate">{product.name}</p>
                        <p className="text-xs text-muted-foreground mt-1.5">{product.sku}</p>
                      </div>
                    </div>
                    <div 
                      className="counter-badge flex-shrink-0 ml-3"
                      style={{ background: 'hsl(var(--destructive))' }}
                    >
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
