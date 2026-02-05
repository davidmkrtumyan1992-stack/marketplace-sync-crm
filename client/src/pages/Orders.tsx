import { Layout } from "@/components/Layout";
import { useOrders, useUpdateOrderStatus } from "@/hooks/use-orders";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

export default function Orders() {
  const { data: orders, isLoading } = useOrders();

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "bg-green-100 text-green-800 hover:bg-green-200 border-green-200";
      case "processing": return "bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200";
      case "pending": return "bg-yellow-100 text-yellow-800 hover:bg-yellow-200 border-yellow-200";
      case "shipped": return "bg-indigo-100 text-indigo-800 hover:bg-indigo-200 border-indigo-200";
      case "cancelled": return "bg-slate-100 text-slate-800 hover:bg-slate-200 border-slate-200";
      default: return "bg-gray-100 text-gray-800";
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

  const getSourceLabel = (source: string) => {
    switch (source) {
      case "manual": return "Вручную";
      case "ozon": return "Ozon";
      case "wildberries": return "WB";
      default: return source;
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Заказы</h2>
          <p className="text-muted-foreground mt-1">Отслеживание и выполнение заказов клиентов.</p>
        </div>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/50">
                  <TableHead>Номер заказа</TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Источник</TableHead>
                  <TableHead>Сумма</TableHead>
                  <TableHead>Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">Загрузка заказов...</TableCell>
                  </TableRow>
                ) : orders?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      Заказов пока нет.
                    </TableCell>
                  </TableRow>
                ) : (
                  orders?.map((order: any) => (
                    <OrderRow key={order.id} order={order} getStatusColor={getStatusColor} getStatusLabel={getStatusLabel} getSourceLabel={getSourceLabel} />
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

function OrderRow({ order, getStatusColor, getStatusLabel, getSourceLabel }: { order: any; getStatusColor: (s: string) => string; getStatusLabel: (s: string) => string; getSourceLabel: (s: string) => string }) {
  const { mutate: updateStatus, isPending } = useUpdateOrderStatus();

  return (
    <TableRow>
      <TableCell className="font-mono font-medium">{order.orderNumber}</TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {order.createdAt ? format(new Date(order.createdAt), "d MMM yyyy", { locale: ru }) : "-"}
      </TableCell>
      <TableCell>{order.customer?.name || "Гость"}</TableCell>
      <TableCell>
        <Badge variant="outline" className="uppercase text-[10px] tracking-wider font-semibold">
          {getSourceLabel(order.source)}
        </Badge>
      </TableCell>
      <TableCell className="font-semibold">{Number(order.totalAmount).toLocaleString('ru-RU')} ₽</TableCell>
      <TableCell>
        <Select 
          defaultValue={order.status} 
          onValueChange={(val) => updateStatus({ id: order.id, status: val })}
          disabled={isPending}
        >
          <SelectTrigger className={`w-[140px] h-8 text-xs capitalize border ${getStatusColor(order.status)}`}>
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
      </TableCell>
    </TableRow>
  );
}
