import { Layout } from "@/components/Layout";
import { StatsCard } from "@/components/StatsCard";
import { useProducts } from "@/hooks/use-products";
import { useOrders } from "@/hooks/use-orders";
import { useCustomers } from "@/hooks/use-customers";
import { Package, ShoppingCart, Users, DollarSign, Database } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const { data: products } = useProducts();
  const { data: orders } = useOrders();
  const { data: customers } = useCustomers();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const seedMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/seed"),
    onSuccess: () => {
      toast({ title: "Готово", description: "Демо-данные успешно созданы" });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось создать демо-данные", variant: "destructive" });
    }
  });

  // Производные статистики
  const totalProducts = products?.length || 0;
  const lowStock = products?.filter(p => p.stockQuantity < 10).length || 0;
  const totalOrders = orders?.length || 0;
  const totalRevenue = orders?.reduce((acc, order) => acc + Number(order.totalAmount), 0) || 0;
  const totalCustomers = customers?.length || 0;

  // Данные для графика
  const chartData = [
    { name: 'Пн', sales: 4000 },
    { name: 'Вт', sales: 3000 },
    { name: 'Ср', sales: 2000 },
    { name: 'Чт', sales: 2780 },
    { name: 'Пт', sales: 1890 },
    { name: 'Сб', sales: 2390 },
    { name: 'Вс', sales: 3490 },
  ];

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Панель управления</h2>
            <p className="text-muted-foreground mt-1">Обзор эффективности вашего бизнеса.</p>
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

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="Общая выручка"
            value={`${totalRevenue.toLocaleString('ru-RU')} ₽`}
            icon={DollarSign}
            trend={{ value: 12, isPositive: true }}
          />
          <StatsCard
            title="Активные заказы"
            value={totalOrders}
            icon={ShoppingCart}
            description="Ожидают отправки"
          />
          <StatsCard
            title="Товаров на складе"
            value={totalProducts}
            icon={Package}
            description={`${lowStock} с низким остатком`}
          />
          <StatsCard
            title="Всего клиентов"
            value={totalCustomers}
            icon={Users}
            trend={{ value: 4, isPositive: true }}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <Card className="col-span-4 dashboard-card">
            <CardHeader>
              <CardTitle>Продажи за неделю</CardTitle>
            </CardHeader>
            <CardContent className="pl-2">
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis 
                      dataKey="name" 
                      stroke="#888888" 
                      fontSize={12} 
                      tickLine={false} 
                      axisLine={false} 
                    />
                    <YAxis 
                      stroke="#888888" 
                      fontSize={12} 
                      tickLine={false} 
                      axisLine={false} 
                      tickFormatter={(value) => `${value} ₽`} 
                    />
                    <Tooltip 
                      cursor={{fill: '#f3f4f6'}}
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      formatter={(value: number) => [`${value.toLocaleString('ru-RU')} ₽`, 'Продажи']}
                    />
                    <Bar dataKey="sales" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

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
      </div>
    </Layout>
  );
}
