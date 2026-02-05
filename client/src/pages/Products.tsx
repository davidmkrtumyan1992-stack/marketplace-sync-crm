import { Layout } from "@/components/Layout";
import { useProducts, useCreateProduct, useDeleteProduct, useSyncProduct } from "@/hooks/use-products";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertProductSchema, type InsertProduct } from "@shared/schema";
import { Plus, Search, MoreHorizontal, RefreshCw, Trash2, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";

// Расширяем схему для формы
const formSchema = insertProductSchema.extend({
  price: z.coerce.number(),
  stockQuantity: z.coerce.number(),
});

export default function Products() {
  const { data: products, isLoading } = useProducts();
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const { toast } = useToast();

  const filteredProducts = products?.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.sku.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Товары</h2>
            <p className="text-muted-foreground mt-1">Управление товарами и остатками.</p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button size="lg" className="shadow-lg shadow-primary/25">
                <Plus className="w-4 h-4 mr-2" />
                Добавить товар
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Добавить новый товар</DialogTitle>
              </DialogHeader>
              <ProductForm onSuccess={() => setIsCreateOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex items-center gap-4 bg-white p-4 rounded-xl border shadow-sm">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Поиск по названию или артикулу..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-slate-50 border-slate-200"
            />
          </div>
        </div>

        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/50">
                <TableHead>Товар</TableHead>
                <TableHead>Артикул</TableHead>
                <TableHead className="text-right">Цена</TableHead>
                <TableHead className="text-center">Остаток</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">Загрузка товаров...</TableCell>
                </TableRow>
              ) : filteredProducts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    Товары не найдены. Добавьте первый товар.
                  </TableCell>
                </TableRow>
              ) : (
                filteredProducts?.map((product) => (
                  <ProductRow key={product.id} product={product} />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </Layout>
  );
}

function ProductForm({ onSuccess }: { onSuccess: () => void }) {
  const { mutate, isPending } = useCreateProduct();
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      sku: "",
      description: "",
      price: 0,
      stockQuantity: 0,
      organizationId: "1",
    }
  });

  return (
    <form onSubmit={form.handleSubmit((data) => mutate(data as InsertProduct, { onSuccess }))} className="space-y-4 py-4">
      <div className="grid gap-2">
        <Label htmlFor="name">Название товара</Label>
        <Input id="name" {...form.register("name")} placeholder="например, Беспроводная мышь" />
        {form.formState.errors.name && <span className="text-xs text-red-500">{form.formState.errors.name.message}</span>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="sku">Артикул</Label>
          <Input id="sku" {...form.register("sku")} placeholder="WM-001" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="price">Цена</Label>
          <Input id="price" type="number" step="0.01" {...form.register("price")} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="stock">Количество на складе</Label>
        <Input id="stock" type="number" {...form.register("stockQuantity")} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="desc">Описание</Label>
        <Input id="desc" {...form.register("description")} />
      </div>
      <Button type="submit" className="w-full mt-2" disabled={isPending}>
        {isPending ? "Создание..." : "Создать товар"}
      </Button>
    </form>
  );
}

function ProductRow({ product }: { product: any }) {
  const { mutate: deleteProduct } = useDeleteProduct();
  const { mutate: syncProduct, isPending: isSyncing } = useSyncProduct();

  return (
    <TableRow className="group hover:bg-slate-50 transition-colors">
      <TableCell className="font-medium">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded bg-slate-100 flex items-center justify-center text-slate-400">
            {product.imageUrl ? <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover rounded" /> : <Package size={20} />}
          </div>
          {product.name}
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs">{product.sku}</TableCell>
      <TableCell className="text-right font-medium">{Number(product.price).toLocaleString('ru-RU')} ₽</TableCell>
      <TableCell className="text-center">
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          product.stockQuantity < 10 ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"
        }`}>
          {product.stockQuantity} шт.
        </span>
      </TableCell>
      <TableCell>
        <div className="flex gap-2 text-xs">
          <span className={`px-2 py-0.5 rounded border ${product.ozonId ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-400"}`}>
            Ozon
          </span>
          <span className={`px-2 py-0.5 rounded border ${product.wbId ? "border-purple-200 bg-purple-50 text-purple-700" : "border-slate-200 text-slate-400"}`}>
            WB
          </span>
        </div>
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => syncProduct(product.id)} disabled={isSyncing}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Синхронизировать
            </DropdownMenuItem>
            <DropdownMenuItem className="text-red-600" onClick={() => deleteProduct(product.id)}>
              <Trash2 className="w-4 h-4 mr-2" />
              Удалить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
