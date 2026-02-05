import { Layout } from "@/components/Layout";
import { useCustomers, useCreateCustomer } from "@/hooks/use-customers";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { UserPlus, Mail, Phone } from "lucide-react";

export default function Customers() {
  const { data: customers, isLoading } = useCustomers();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Клиенты</h2>
            <p className="text-muted-foreground mt-1">Управление базой клиентов.</p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button size="lg" className="shadow-lg shadow-primary/25">
                <UserPlus className="w-4 h-4 mr-2" />
                Добавить клиента
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Добавить клиента</DialogTitle>
              </DialogHeader>
              <CustomerForm onSuccess={() => setIsCreateOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>

        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/50">
                <TableHead>Имя</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Телефон</TableHead>
                <TableHead>Заметки</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">Загрузка клиентов...</TableCell>
                </TableRow>
              ) : customers?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                    Клиенты не найдены.
                  </TableCell>
                </TableRow>
              ) : (
                customers?.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">{customer.name}</TableCell>
                    <TableCell>
                      {customer.email && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Mail className="w-3 h-3" />
                          {customer.email}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {customer.phone && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Phone className="w-3 h-3" />
                          {customer.phone}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-xs truncate">{customer.notes}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
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
        <Label htmlFor="name">Имя</Label>
        <Input id="name" {...form.register("name")} />
        {form.formState.errors.name && <span className="text-xs text-red-500">{form.formState.errors.name.message}</span>}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" {...form.register("email")} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="phone">Телефон</Label>
        <Input id="phone" {...form.register("phone")} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="notes">Заметки</Label>
        <Input id="notes" {...form.register("notes")} />
      </div>
      <Button type="submit" className="w-full mt-2" disabled={isPending}>
        {isPending ? "Добавление..." : "Добавить клиента"}
      </Button>
    </form>
  );
}
