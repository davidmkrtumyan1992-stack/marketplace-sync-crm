import { Layout } from "@/components/Layout";
import { useCustomers, useCreateCustomer } from "@/hooks/use-customers";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertCustomerSchema, type InsertCustomer } from "@shared/schema";
import { UserPlus, Mail, Phone, User, Users, ShoppingCart, Calendar, FileText, CreditCard } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency } from "@/lib/format";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

export default function Customers() {
  const { data: customers, isLoading } = useCustomers();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight" data-testid="text-customers-title">Клиенты</h1>
            <p className="text-muted-foreground mt-2 text-lg">Управление базой клиентов</p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button size="lg" className="premium-button" data-testid="button-add-customer">
                <UserPlus className="w-5 h-5 mr-2" />
                Добавить клиента
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-xl">Добавить клиента</DialogTitle>
                <DialogDescription>Заполните данные нового клиента</DialogDescription>
              </DialogHeader>
              <CustomerForm onSuccess={() => setIsCreateOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex items-center gap-3">
          <span className="teal-badge">
            <Users className="w-4 h-4 mr-1.5 inline" />
            Всего: {customers?.length || 0}
          </span>
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="kpi-card animate-pulse">
                <CardContent className="pt-6">
                  <div className="h-20 bg-muted rounded-xl" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : customers?.length === 0 ? (
          <Card className="kpi-card">
            <CardContent className="py-16 text-center">
              <Users className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
              <p className="text-xl font-medium text-muted-foreground">Клиенты не найдены</p>
              <p className="text-sm text-muted-foreground mt-2">Добавьте первого клиента, чтобы начать работу</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {customers?.map((customer) => (
              <Card
                key={customer.id}
                className="kpi-card cursor-pointer hover-elevate"
                data-testid={`customer-card-${customer.id}`}
                onClick={() => setSelectedCustomer(customer)}
              >
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-primary/10 rounded-xl flex-shrink-0">
                      <User className="w-6 h-6 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-lg truncate">{customer.name}</h3>
                      {customer.email && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                          <Mail className="w-4 h-4 flex-shrink-0" />
                          <span className="truncate">{customer.email}</span>
                        </div>
                      )}
                      {customer.phone && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                          <Phone className="w-4 h-4 flex-shrink-0" />
                          <span>{customer.phone}</span>
                        </div>
                      )}
                      {customer.notes && (
                        <p className="text-sm text-muted-foreground mt-3 line-clamp-2">{customer.notes}</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <CustomerProfileDialog
        customer={selectedCustomer}
        open={!!selectedCustomer}
        onOpenChange={(v) => { if (!v) setSelectedCustomer(null); }}
      />
    </Layout>
  );
}

function CustomerProfileDialog({ customer, open, onOpenChange }: {
  customer: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: customerOrders, isLoading: ordersLoading } = useQuery<any[]>({
    queryKey: ["/api/customers", customer?.id, "orders"],
    queryFn: async () => {
      const res = await fetch(`/api/customers/${customer.id}/orders`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch orders");
      return res.json();
    },
    enabled: !!customer?.id,
  });

  if (!customer) return null;

  const totalSpent = customerOrders?.reduce((sum: number, o: any) => sum + Number(o.totalAmount), 0) || 0;

  const getSourceLabel = (source: string) => {
    switch (source) {
      case "ozon": return "OZON";
      case "wildberries": return "WB";
      case "yandex": return "Yandex";
      case "direct": return "Прямая";
      default: return "Вручную";
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            {customer.name}
          </DialogTitle>
          <DialogDescription>Профиль клиента</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardContent className="py-4">
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Контактная информация
                </h4>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span data-testid="text-profile-name">{customer.name}</span>
                  </div>
                  {customer.phone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span data-testid="text-profile-phone">{customer.phone}</span>
                    </div>
                  )}
                  {customer.email && (
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span data-testid="text-profile-email">{customer.email}</span>
                    </div>
                  )}
                  {customer.notes && (
                    <div className="mt-2">
                      <p className="text-sm text-muted-foreground" data-testid="text-profile-notes">{customer.notes}</p>
                    </div>
                  )}
                  {customer.createdAt && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                      <Calendar className="w-4 h-4 flex-shrink-0" />
                      <span>Клиент с {format(new Date(customer.createdAt), "d MMMM yyyy", { locale: ru })}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-4">
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <CreditCard className="w-4 h-4" />
                  Статистика
                </h4>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Всего заказов</p>
                    <p className="text-2xl font-bold" data-testid="text-profile-orders-count">{customerOrders?.length || 0}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Общая сумма покупок</p>
                    <p className="text-2xl font-bold" data-testid="text-profile-total-spent">{formatCurrency(totalSpent)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" />
              История заказов
            </h4>
            {ordersLoading ? (
              <div className="py-8 text-center text-muted-foreground text-sm">Загрузка...</div>
            ) : customerOrders && customerOrders.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Заказ</TableHead>
                      <TableHead>Дата</TableHead>
                      <TableHead>Источник</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead className="text-right">Сумма</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerOrders.map((order: any) => (
                      <TableRow key={order.id} data-testid={`row-customer-order-${order.id}`}>
                        <TableCell className="font-medium">{order.orderNumber}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {order.createdAt ? format(new Date(order.createdAt), "d MMM yyyy", { locale: ru }) : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">{getSourceLabel(order.source)}</Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{getStatusLabel(order.status)}</span>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(Number(order.totalAmount))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="py-8 text-center">
                <ShoppingCart className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">Нет заказов</p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-profile">
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustomerForm({ onSuccess }: { onSuccess: () => void }) {
  const { mutate, isPending } = useCreateCustomer();
  const form = useForm<InsertCustomer>({
    resolver: zodResolver(insertCustomerSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      notes: "",
      organizationId: "1",
    }
  });

  return (
    <form onSubmit={form.handleSubmit((data) => mutate(data, { onSuccess }))} className="space-y-4 py-4">
      <div className="grid gap-2">
        <Label htmlFor="name">Имя *</Label>
        <Input id="name" placeholder="Иван Иванов" {...form.register("name")} data-testid="input-customer-name" />
        {form.formState.errors.name && <span className="text-xs text-destructive">{form.formState.errors.name.message}</span>}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" placeholder="ivan@example.com" {...form.register("email")} data-testid="input-customer-email" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="phone">Телефон</Label>
        <Input id="phone" placeholder="+7 900 123-45-67" {...form.register("phone")} data-testid="input-customer-phone" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="notes">Заметки</Label>
        <Input id="notes" placeholder="Дополнительная информация" {...form.register("notes")} data-testid="input-customer-notes" />
      </div>
      <Button type="submit" className="w-full mt-4" disabled={isPending} data-testid="button-create-customer">
        {isPending ? "Добавление..." : "Добавить клиента"}
      </Button>
    </form>
  );
}
