import { Layout } from "@/components/Layout";
import { useCustomers, useCreateCustomer } from "@/hooks/use-customers";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertCustomerSchema, type InsertCustomer } from "@shared/schema";
import { UserPlus, Mail, Phone, User, Users } from "lucide-react";

export default function Customers() {
  const { data: customers, isLoading } = useCustomers();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

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
              <Button size="lg" className="shadow-lg" data-testid="button-add-customer">
                <UserPlus className="w-5 h-5 mr-2" />
                Добавить клиента
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-xl">Добавить клиента</DialogTitle>
              </DialogHeader>
              <CustomerForm onSuccess={() => setIsCreateOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex items-center gap-3">
          <span className="yellow-badge">
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
              <Card key={customer.id} className="kpi-card" data-testid={`customer-card-${customer.id}`}>
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
    </Layout>
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
