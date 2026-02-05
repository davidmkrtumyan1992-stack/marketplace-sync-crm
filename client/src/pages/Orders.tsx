import { Layout } from "@/components/Layout";
import { useOrders, useUpdateOrderStatus } from "@/hooks/use-orders";
import { format } from "date-fns";
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
      case "cancelled": return "bg-slate-100 text-slate-800 hover:bg-slate-200 border-slate-200";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Orders</h2>
          <p className="text-muted-foreground mt-1">Track and fulfill customer orders.</p>
        </div>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/50">
                  <TableHead>Order #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">Loading orders...</TableCell>
                  </TableRow>
                ) : orders?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      No orders yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  orders?.map((order: any) => (
                    <OrderRow key={order.id} order={order} getStatusColor={getStatusColor} />
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

function OrderRow({ order, getStatusColor }: { order: any; getStatusColor: (s: string) => string }) {
  const { mutate: updateStatus, isPending } = useUpdateOrderStatus();

  return (
    <TableRow>
      <TableCell className="font-mono font-medium">{order.orderNumber}</TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {order.createdAt ? format(new Date(order.createdAt), "MMM d, yyyy") : "-"}
      </TableCell>
      <TableCell>{order.customer?.name || "Guest"}</TableCell>
      <TableCell>
        <Badge variant="outline" className="uppercase text-[10px] tracking-wider font-semibold">
          {order.source}
        </Badge>
      </TableCell>
      <TableCell className="font-semibold">${Number(order.totalAmount).toFixed(2)}</TableCell>
      <TableCell>
        <Select 
          defaultValue={order.status} 
          onValueChange={(val) => updateStatus({ id: order.id, status: val })}
          disabled={isPending}
        >
          <SelectTrigger className={`w-[130px] h-8 text-xs capitalize border ${getStatusColor(order.status)}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
    </TableRow>
  );
}
