import { Layout } from "@/components/Layout";
import { StatsCard } from "@/components/StatsCard";
import { useProducts } from "@/hooks/use-products";
import { useOrders } from "@/hooks/use-orders";
import { useKPI } from "@/hooks/use-kpi";
import { Package, Warehouse, TrendingUp, Coins, Database } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatQuantity } from "@/lib/format";

const COLORS = ['#3b82f6', '#8b5cf6', '#10b981'];

export default function Dashboard() {
  const { data: products } = useProducts();
  const { data: orders } = useOrders();
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
    }
  });

  const totalProducts = products?.length || 0;
  const lowStock = products?.filter(p => p.stockQuantity < 10).length || 0;

  // Pie chart data for stock distribution
  const pieData = kpi ? [
    { name: "На складе", value: kpi.stockDistribution.local },
    { name: "Ozon", value: kpi.stockDistribution.ozon },
    { name: "Wildberries", value: kpi.stockDistribution.wb },
  ].filter(d => d.value > 0) : [];

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-2 border rounded shadow-lg">
          <p className="text-sm font-medium">{payload[0].name}</p>
          <p className="text-sm text-muted-foreground">{formatQuantity(payload[0].value)}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Панель управления</h2>
            <p className="text-muted-foreground mt-1">Финансовые показатели и аналитика склада</p>
          </div>
          {totalProducts === 0 && (
            <Button 
              onClick={() => seedMutation.mutate()} 
              disabled={seedMutation.isPending}
              className="shadow-lg"
            >
              <Database className="w-4 h-4 mr-2" />
              {seedMutation.isPending ? "Создание..." : "Создать демо-данные"}
            </Button>
          )}
        </div>

        {/* KPI Cards - Main Financial Metrics */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="Общий остаток"
            value={kpiLoading ? "..." : formatQuantity(kpi?.totalStock || 0)}
            icon={Warehouse}
            description="Единиц на всех каналах"
          />
          <StatsCard
            title="Капитализация (Закупка)"
            value={kpiLoading ? "..." : formatCurrency(kpi?.capitalization || 0)}
            icon={Coins}
            description="Сумма по закупочной цене"
          />
          <StatsCard
            title="Ожидаемая выручка"
            value={kpiLoading ? "..." : formatCurrency(kpi?.expectedRevenue || 0)}
            icon={TrendingUp}
            description="По продажной цене"
          />
          <StatsCard
            title="Прогноз чистой прибыли"
            value={kpiLoading ? "..." : formatCurrency(kpi?.expectedProfit || 0)}
            icon={Package}
            description="С учётом налогов и комиссий"
            className={kpi && kpi.expectedProfit > 0 ? "border-green-200" : ""}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          {/* Stock Distribution Pie Chart */}
          <Card className="col-span-4 dashboard-card">
            <CardHeader>
              <CardTitle>Распределение остатков</CardTitle>
            </CardHeader>
            <CardContent>
              {pieData.length > 0 ? (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={100}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  Нет данных для отображения
                </div>
              )}
            </CardContent>
          </Card>

          {/* Low Stock Alert */}
          <Card className="col-span-3 dashboard-card">
            <CardHeader>
              <CardTitle>Низкий остаток</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {products?.filter(p => p.stockQuantity < 10).slice(0, 5).map(product => (
                  <div key={product.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-md bg-slate-100 flex items-center justify-center">
                        <Package className="h-5 w-5 text-slate-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium leading-none">{product.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">Артикул: {product.sku}</p>
                      </div>
                    </div>
                    <div className="text-sm font-bold text-red-600">
                      {product.stockQuantity} шт.
                    </div>
                  </div>
                ))}
                {lowStock === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Нет товаров с низким остатком.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Stock Distribution Summary Cards */}
        {kpi && (
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="dashboard-card border-l-4 border-l-blue-500">
              <CardContent className="pt-6">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">На складе</p>
                    <p className="text-2xl font-bold">{formatQuantity(kpi.stockDistribution.local)}</p>
                  </div>
                  <Warehouse className="h-8 w-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>
            <Card className="dashboard-card border-l-4 border-l-purple-500">
              <CardContent className="pt-6">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Ozon</p>
                    <p className="text-2xl font-bold">{formatQuantity(kpi.stockDistribution.ozon)}</p>
                  </div>
                  <div className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs font-bold">OZON</div>
                </div>
              </CardContent>
            </Card>
            <Card className="dashboard-card border-l-4 border-l-green-500">
              <CardContent className="pt-6">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Wildberries</p>
                    <p className="text-2xl font-bold">{formatQuantity(kpi.stockDistribution.wb)}</p>
                  </div>
                  <div className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-bold">WB</div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </Layout>
  );
}
