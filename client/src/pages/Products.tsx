import { Layout } from "@/components/Layout";
import { useProducts, useCreateProduct, useDeleteProduct, useSyncProduct } from "@/hooks/use-products";
import { useCreateStockInflow } from "@/hooks/use-stock-inflow";
import { useState, useEffect } from "react";
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
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertProductSchema, type InsertProduct, type Product } from "@shared/schema";
import { Plus, Search, MoreHorizontal, RefreshCw, Trash2, Package, PackagePlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { formatCurrency, formatQuantity } from "@/lib/format";

const formSchema = insertProductSchema.extend({
  purchasePrice: z.coerce.number(),
  sellingPrice: z.coerce.number(),
  price: z.coerce.number().optional(),
  stockQuantity: z.coerce.number(),
  stockLocal: z.coerce.number().optional(),
  stockOzon: z.coerce.number().optional(),
  stockWb: z.coerce.number().optional(),
  weight: z.coerce.number().optional(),
  logisticsCost: z.coerce.number().optional(),
  marketplaceCommission: z.coerce.number().optional(),
});

const CATEGORIES = [
  "Электроника",
  "Аксессуары",
  "Одежда",
  "Обувь",
  "Дом и сад",
  "Красота и здоровье",
  "Спорт",
  "Детские товары",
  "Продукты питания",
  "Другое",
];

export default function Products() {
  const { data: products, isLoading } = useProducts();
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [inflowProduct, setInflowProduct] = useState<Product | null>(null);
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
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Добавить новый товар</DialogTitle>
                <DialogDescription>Заполните информацию о товаре</DialogDescription>
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
                <TableHead className="text-right">Закупка</TableHead>
                <TableHead className="text-right">Продажа</TableHead>
                <TableHead className="text-center">Остаток</TableHead>
                <TableHead>Распределение</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">Загрузка товаров...</TableCell>
                </TableRow>
              ) : filteredProducts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    Товары не найдены. Добавьте первый товар.
                  </TableCell>
                </TableRow>
              ) : (
                filteredProducts?.map((product) => (
                  <ProductRow key={product.id} product={product} onInflow={() => setInflowProduct(product)} />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Stock Inflow Modal */}
      <Dialog open={!!inflowProduct} onOpenChange={(open) => !open && setInflowProduct(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Оприходование товара</DialogTitle>
            <DialogDescription>{inflowProduct?.name}</DialogDescription>
          </DialogHeader>
          {inflowProduct && (
            <StockInflowForm product={inflowProduct} onSuccess={() => setInflowProduct(null)} />
          )}
        </DialogContent>
      </Dialog>
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
      category: "",
      purchasePrice: 0,
      sellingPrice: 0,
      stockQuantity: 0,
      stockLocal: 0,
      stockOzon: 0,
      stockWb: 0,
      weight: 0,
      logisticsCost: 0,
      marketplaceCommission: 15,
      organizationId: "1",
    }
  });

  const stockLocal = form.watch("stockLocal") || 0;
  const stockOzon = form.watch("stockOzon") || 0;
  const stockWb = form.watch("stockWb") || 0;

  useEffect(() => {
    form.setValue("stockQuantity", stockLocal + stockOzon + stockWb);
  }, [stockLocal, stockOzon, stockWb, form]);

  return (
    <form onSubmit={form.handleSubmit((data) => {
      const submitData = {
        ...data,
        price: data.sellingPrice?.toString() || "0",
        purchasePrice: data.purchasePrice?.toString() || "0",
        sellingPrice: data.sellingPrice?.toString() || "0",
        weight: data.weight?.toString() || null,
        logisticsCost: data.logisticsCost?.toString() || "0",
        marketplaceCommission: data.marketplaceCommission?.toString() || "15",
      };
      mutate(submitData as any, { onSuccess });
    })} className="space-y-4 py-4">
      <div className="grid gap-2">
        <Label htmlFor="name">Название товара</Label>
        <Input id="name" {...form.register("name")} placeholder="например, Беспроводные наушники" />
        {form.formState.errors.name && <span className="text-xs text-red-500">{form.formState.errors.name.message}</span>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="sku">Артикул (SKU)</Label>
          <Input id="sku" {...form.register("sku")} placeholder="WH-001" />
        </div>
        <div className="grid gap-2">
          <Label>Категория</Label>
          <Select onValueChange={(val) => form.setValue("category", val)}>
            <SelectTrigger>
              <SelectValue placeholder="Выберите категорию" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(cat => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="purchasePrice">Закупочная цена, ₽</Label>
          <Input id="purchasePrice" type="number" step="0.01" {...form.register("purchasePrice")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="sellingPrice">Продажная цена, ₽</Label>
          <Input id="sellingPrice" type="number" step="0.01" {...form.register("sellingPrice")} />
        </div>
      </div>

      <div className="border rounded-lg p-4 space-y-3 bg-slate-50">
        <Label className="text-sm font-medium">Распределение остатков</Label>
        <div className="grid grid-cols-3 gap-3">
          <div className="grid gap-1">
            <Label htmlFor="stockLocal" className="text-xs text-muted-foreground">На складе</Label>
            <Input id="stockLocal" type="number" {...form.register("stockLocal")} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="stockOzon" className="text-xs text-muted-foreground">Ozon</Label>
            <Input id="stockOzon" type="number" {...form.register("stockOzon")} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="stockWb" className="text-xs text-muted-foreground">Wildberries</Label>
            <Input id="stockWb" type="number" {...form.register("stockWb")} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Итого: {stockLocal + stockOzon + stockWb} шт.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="weight">Вес, кг</Label>
          <Input id="weight" type="number" step="0.001" {...form.register("weight")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="logisticsCost">Логистика, ₽</Label>
          <Input id="logisticsCost" type="number" {...form.register("logisticsCost")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="marketplaceCommission">Комиссия, %</Label>
          <Input id="marketplaceCommission" type="number" step="0.1" {...form.register("marketplaceCommission")} />
        </div>
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

function StockInflowForm({ product, onSuccess }: { product: Product; onSuccess: () => void }) {
  const { mutate, isPending } = useCreateStockInflow();
  const [quantity, setQuantity] = useState(0);
  const [toLocal, setToLocal] = useState(0);
  const [toOzon, setToOzon] = useState(0);
  const [toWb, setToWb] = useState(0);
  const [purchasePrice, setPurchasePrice] = useState(Number(product.purchasePrice) || 0);

  const remaining = quantity - toLocal - toOzon - toWb;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (remaining !== 0) return;

    mutate({
      organizationId: "1",
      productId: product.id,
      quantity,
      toLocal,
      toOzon,
      toWb,
      purchasePrice: purchasePrice.toString(),
    }, { onSuccess });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-2">
        <Label>Количество для оприходования</Label>
        <Input 
          type="number" 
          value={quantity} 
          onChange={(e) => setQuantity(Number(e.target.value))}
          min={1}
        />
      </div>

      <div className="grid gap-2">
        <Label>Закупочная цена, ₽</Label>
        <Input 
          type="number" 
          step="0.01"
          value={purchasePrice} 
          onChange={(e) => setPurchasePrice(Number(e.target.value))}
        />
      </div>

      <div className="border rounded-lg p-4 space-y-3 bg-slate-50">
        <Label className="text-sm font-medium">Распределить по каналам</Label>
        <div className="grid gap-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm">На склад</Label>
            <Input 
              type="number" 
              className="w-24"
              value={toLocal} 
              onChange={(e) => setToLocal(Number(e.target.value))}
              max={quantity}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">На Ozon</Label>
            <Input 
              type="number" 
              className="w-24"
              value={toOzon} 
              onChange={(e) => setToOzon(Number(e.target.value))}
              max={quantity}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">На Wildberries</Label>
            <Input 
              type="number" 
              className="w-24"
              value={toWb} 
              onChange={(e) => setToWb(Number(e.target.value))}
              max={quantity}
            />
          </div>
        </div>
        <div className={`text-sm font-medium ${remaining === 0 ? "text-green-600" : "text-red-600"}`}>
          {remaining === 0 ? "Распределено полностью" : `Осталось распределить: ${remaining} шт.`}
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={isPending || remaining !== 0 || quantity <= 0}>
        {isPending ? "Оприходование..." : "Оприходовать"}
      </Button>
    </form>
  );
}

function ProductRow({ product, onInflow }: { product: Product; onInflow: () => void }) {
  const { mutate: deleteProduct } = useDeleteProduct();
  const { mutate: syncProduct, isPending: isSyncing } = useSyncProduct();

  return (
    <TableRow className="group hover:bg-slate-50 transition-colors">
      <TableCell className="font-medium">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded bg-slate-100 flex items-center justify-center text-slate-400">
            {product.imageUrl ? <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover rounded" /> : <Package size={20} />}
          </div>
          <div>
            <span className="block">{product.name}</span>
            {product.category && <span className="text-xs text-muted-foreground">{product.category}</span>}
          </div>
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs">{product.sku}</TableCell>
      <TableCell className="text-right text-sm">{formatCurrency(product.purchasePrice || 0)}</TableCell>
      <TableCell className="text-right font-medium">{formatCurrency(product.sellingPrice || product.price || 0)}</TableCell>
      <TableCell className="text-center">
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          product.stockQuantity < 10 ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"
        }`}>
          {product.stockQuantity} шт.
        </span>
      </TableCell>
      <TableCell>
        <div className="flex gap-1 text-xs">
          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
            С:{product.stockLocal || 0}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
            O:{product.stockOzon || 0}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">
            W:{product.stockWb || 0}
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
            <DropdownMenuItem onClick={onInflow}>
              <PackagePlus className="w-4 h-4 mr-2" />
              Оприходовать
            </DropdownMenuItem>
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
