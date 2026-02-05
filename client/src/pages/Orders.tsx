import { Layout } from "@/components/Layout";
import { useOrders, useUpdateOrderStatus } from "@/hooks/use-orders";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShoppingCart, Package, Calendar, User, CreditCard } from "lucide-react";
import { formatCurrency } from "@/lib/format";

export default function Orders() {
  const { data: orders, isLoading } = useOrders();

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "bg-green-100 text-green-800 border-green-200";
      case "processing": return "bg-blue-100 text-blue-800 border-blue-200";
      case "pending": return "bg-amber-100 text-amber-800 border-amber-200";
      case "shipped": return "bg-indigo-100 text-indigo-800 border-indigo-200";
      case "cancelled": return "bg-muted text-muted-foreground border-border";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "pending": return "Новый";
      case "processing": return "В обработке";
      case "shipped": return "Отправлен";
      case "completed": return "Завершён";
      case "cancelled": return "Отменён";
      default: return status;
    }
  };

  const getSourceBadge = (source: string) => {
    switch (source) {
      case "ozon": return <Badge className="bg-blue-500/20 text-blue-700 border-blue-300">OZON</Badge>;
      case "wildberries": return <Badge className="bg-purple-500/20 text-purple-700 border-purple-300">WB</Badge>;
      default: return <Badge variant="outline" className="text-xs">Вручную</Badge>;
    }
  };

  const pendingCount = orders?.filter(o => o.status === "pending").length || 0;
  const totalRevenue = orders?.reduce((sum, o) => sum + Number(o.totalAmount), 0) || 0;

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-4xl font-bold tracking-tight" data-testid="text-orders-title">Заказы</h1>
          <p className="text-muted-foreground mt-2 text-lg">Отслеживание и выполнение заказов</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <span className="teal-badge">
            <ShoppingCart className="w-4 h-4 mr-1.5 inline" />
            Всего: {orders?.length || 0}
          </span>
          {pendingCount > 0 && (
            <span className="bg-amber-100 text-amber-800 px-3 py-1.5 rounded-full text-sm font-medium">
              Новых: {pendingCount}
            </span>
          )}
          <span className="bg-green-100 text-green-800 px-3 py-1.5 rounded-full text-sm font-medium">
            <CreditCard className="w-4 h-4 mr-1.5 inline" />
            {formatCurrency(totalRevenue)}
          </span>
        </div>

        {isLoading ? (
          <div className="grid gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="kpi-card animate-pulse">
                <CardContent className="py-6">
                  <div className="h-20 bg-muted rounded-xl" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : orders?.length === 0 ? (
          <Card className="kpi-card">
            <CardContent className="py-16 text-center">
              <ShoppingCart className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
              <p className="text-xl font-medium text-muted-foreground">Заказов пока нет</p>
              <p className="text-sm text-muted-foreground mt-2">Заказы появятся здесь после оформления</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {orders?.map((order: any) => (
              <OrderCard 
                key={order.id} 
                order={order} 
                getStatusColor={getStatusColor} 
                getStatusLabel={getStatusLabel}
                getSourceBadge={getSourceBadge}
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

function OrderCard({ order, getStatusColor, getStatusLabel, getSourceBadge }: { 
  order: any; 
  getStatusColor: (s: string) => string; 
  getStatusLabel: (s: string) => string;
  getSourceBadge: (s: string) => React.ReactNode;
}) {
  const { mutate: updateStatus, isPending } = useUpdateOrderStatus();

  return (
    <Card className="kpi-card" data-testid={`order-card-${order.id}`}>
      <CardContent className="py-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-primary/10 rounded-xl flex-shrink-0">
              <Package className="w-6 h-6 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="font-bold text-lg">{order.orderNumber}</h3>
                {getSourceBadge(order.source)}
              </div>
              <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  {order.createdAt ? format(new Date(order.createdAt), "d MMMM yyyy", { locale: ru }) : "-"}
                </span>
                <span className="flex items-center gap-1.5">
                  <User className="w-4 h-4" />
                  {order.customer?.name || "Гость"}
                </span>
              </div>
              {order.items && order.items.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {order.items.slice(0, 3).map((item: any) => (
                    <Badge key={item.id} variant="secondary" className="text-xs font-normal">
                      {item.product?.name || "Товар"} × {item.quantity}
                    </Badge>
                  ))}
                  {order.items.length > 3 && (
                    <Badge variant="outline" className="text-xs">
                      +{order.items.length - 3}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-4 lg:gap-6">
            <div className="text-right">
              <p className="text-2xl font-bold">{formatCurrency(Number(order.totalAmount))}</p>
            </div>
            <Select 
              defaultValue={order.status} 
              onValueChange={(val) => updateStatus({ id: order.id, status: val })}
              disabled={isPending}
            >
              <SelectTrigger 
                className={`w-[150px] h-10 text-sm font-medium border ${getStatusColor(order.status)}`}
                data-testid={`select-status-${order.id}`}
              >
                <SelectValue>{getStatusLabel(order.status)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Новый</SelectItem>
                <SelectItem value="processing">В обработке</SelectItem>
                <SelectItem value="shipped">Отправлен</SelectItem>
                <SelectItem value="completed">Завершён</SelectItem>
                <SelectItem value="cancelled">Отменён</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
