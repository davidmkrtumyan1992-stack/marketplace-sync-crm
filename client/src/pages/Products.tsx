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
import { Plus, Search, MoreHorizontal, RefreshCw, Trash2, Package, PackagePlus, Upload, ImagePlus, FileSpreadsheet, Percent, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { formatCurrency, formatQuantity } from "@/lib/format";
import { queryClient } from "@/lib/queryClient";
import { useRole } from "@/hooks/use-role";
import { useQuery } from "@tanstack/react-query";
import type { Company } from "@shared/schema";

const formSchema = insertProductSchema.extend({
  purchasePrice: z.coerce.number(),
  sellingPrice: z.coerce.number(),
  price: z.coerce.number().optional(),
  stockQuantity: z.coerce.number(),
  stockLocal: z.coerce.number().optional(),
  stockOzon: z.coerce.number().optional(),
  stockWb: z.coerce.number().optional(),
  stockYandex: z.coerce.number().optional(),
  barcode: z.string().optional(),
  weight: z.coerce.number().optional(),
  logisticsCost: z.coerce.number().optional(),
  marketplaceCommission: z.coerce.number().optional(),
  companyId: z.coerce.number({ required_error: "Выберите компанию" }).min(1, "Выберите компанию"),
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
  const { canSeePurchasePrice } = useRole();
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [inflowProduct, setInflowProduct] = useState<Product | null>(null);
  const { toast } = useToast();

  const filteredProducts = products?.filter((p: any) => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.sku.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Товары</h1>
            <p className="text-muted-foreground mt-2 text-lg">Управление товарами и остатками</p>
          </div>
          <div className="flex gap-2">
            <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="lg" data-testid="button-import-products">
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Импорт из файла
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Импорт товаров из файла</DialogTitle>
                  <DialogDescription>
                    Загрузите файл Excel (.xlsx), Word (.docx) или PDF с товарами
                  </DialogDescription>
                </DialogHeader>
                <ImportProductsForm onSuccess={() => setIsImportOpen(false)} />
              </DialogContent>
            </Dialog>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button size="lg" className="premium-button" data-testid="button-add-product">
                  <Plus className="w-4 h-4 mr-2" />
                  Добавить товар
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Добавить новый товар</DialogTitle>
                  <DialogDescription>Заполните информацию о товаре</DialogDescription>
                </DialogHeader>
                <ProductForm onSuccess={() => setIsCreateOpen(false)} canSeePurchasePrice={canSeePurchasePrice} />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="flex items-center gap-4 bg-card p-4 rounded-xl border border-border/50 shadow-sm">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Поиск по названию или артикулу..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-products"
            />
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border/50 shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Товар</TableHead>
                <TableHead>Артикул</TableHead>
                {canSeePurchasePrice && <TableHead className="text-right">Закупка</TableHead>}
                <TableHead className="text-right">Продажа</TableHead>
                <TableHead className="text-center">Остаток</TableHead>
                <TableHead>Распределение</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={canSeePurchasePrice ? 7 : 6} className="h-24 text-center">Загрузка товаров...</TableCell>
                </TableRow>
              ) : filteredProducts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canSeePurchasePrice ? 7 : 6} className="h-32 text-center text-muted-foreground">
                    Товары не найдены. Добавьте первый товар.
                  </TableCell>
                </TableRow>
              ) : (
                filteredProducts?.map((product: any) => (
                  <ProductRow key={product.id} product={product} onInflow={() => setInflowProduct(product)} canSeePurchasePrice={canSeePurchasePrice} />
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

function ProductForm({ onSuccess, canSeePurchasePrice = true }: { onSuccess: () => void; canSeePurchasePrice?: boolean }) {
  const { mutate, isPending } = useCreateProduct();
  const { toast } = useToast();
  const [markup, setMarkup] = useState(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });
  
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
      stockYandex: 0,
      barcode: "",
      weight: 0,
      logisticsCost: 0,
      marketplaceCommission: 15,
      companyId: 0,
    }
  });

  useEffect(() => {
    const currentVal = form.getValues("companyId");
    if (companies.length === 1 && (!currentVal || currentVal === 0)) {
      form.setValue("companyId", companies[0].id, { shouldValidate: true });
    }
  }, [companies, form]);

  const stockLocal = form.watch("stockLocal") || 0;
  const stockOzon = form.watch("stockOzon") || 0;
  const stockWb = form.watch("stockWb") || 0;
  const stockYandex = form.watch("stockYandex") || 0;
  const purchasePrice = form.watch("purchasePrice") || 0;

  useEffect(() => {
    form.setValue("stockQuantity", stockLocal + stockOzon + stockWb + stockYandex);
  }, [stockLocal, stockOzon, stockWb, stockYandex, form]);

  // Auto-calculate selling price from markup
  useEffect(() => {
    if (markup > 0 && purchasePrice > 0) {
      const newSellingPrice = purchasePrice * (1 + markup / 100);
      form.setValue("sellingPrice", Math.round(newSellingPrice * 100) / 100);
    }
  }, [markup, purchasePrice, form]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("image", file);

    try {
      const response = await fetch("/api/upload/image", {
        method: "POST",
        body: formData,
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error("Ошибка загрузки");
      }

      const { imageUrl: url } = await response.json();
      setImageUrl(url);
      toast({ title: "Фото загружено" });
    } catch (error) {
      toast({ title: "Ошибка загрузки фото", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

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
        imageUrl: imageUrl,
      };
      mutate(submitData as any, { onSuccess });
    })} className="space-y-4 py-4">
      {/* Image Upload Section */}
      <div className="border rounded-lg p-4 space-y-3 bg-muted">
        <Label className="text-sm font-medium flex items-center gap-2">
          <ImagePlus className="w-4 h-4" />
          Фото товара
        </Label>
        <div className="flex items-center gap-4">
          {imageUrl ? (
            <img src={imageUrl} alt="Preview" className="w-20 h-20 object-cover rounded-lg border" />
          ) : (
            <div className="w-20 h-20 bg-slate-200 rounded-lg flex items-center justify-center">
              <ImagePlus className="w-8 h-8 text-slate-400" />
            </div>
          )}
          <div className="flex-1">
            <Input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              disabled={isUploading}
              className="cursor-pointer"
              data-testid="input-product-image"
            />
            <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WebP до 10 МБ</p>
          </div>
        </div>
      </div>

      <div className="grid gap-2">
        <Label className="flex items-center gap-2">
          <Building2 className="w-4 h-4" />
          Компания (ИП)
        </Label>
        <Select
          value={form.watch("companyId") ? String(form.watch("companyId")) : ""}
          onValueChange={(val) => form.setValue("companyId", Number(val), { shouldValidate: true })}
        >
          <SelectTrigger data-testid="select-company">
            <SelectValue placeholder="Выберите компанию" />
          </SelectTrigger>
          <SelectContent>
            {companies.map((company: Company) => (
              <SelectItem key={company.id} value={String(company.id)} data-testid={`select-company-option-${company.id}`}>
                {company.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {form.formState.errors.companyId && <span className="text-xs text-red-500">{form.formState.errors.companyId.message}</span>}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="name">Название товара</Label>
        <Input id="name" {...form.register("name")} placeholder="например, Беспроводные наушники" data-testid="input-product-name" />
        {form.formState.errors.name && <span className="text-xs text-red-500">{form.formState.errors.name.message}</span>}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="sku">Артикул (SKU)</Label>
          <Input id="sku" {...form.register("sku")} placeholder="WH-001" data-testid="input-product-sku" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="barcode">Штрих-код</Label>
          <Input id="barcode" {...form.register("barcode")} placeholder="4607000000001" className="font-mono" data-testid="input-product-barcode" />
        </div>
        <div className="grid gap-2">
          <Label>Категория</Label>
          <Select onValueChange={(val) => form.setValue("category", val)}>
            <SelectTrigger data-testid="select-category">
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

      {/* Pricing with Markup Calculator */}
      <div className="border rounded-lg p-4 space-y-3 bg-blue-50/50">
        <Label className="text-sm font-medium flex items-center gap-2">
          <Percent className="w-4 h-4" />
          Ценообразование
        </Label>
        <div className={`grid ${canSeePurchasePrice ? 'grid-cols-3' : 'grid-cols-1'} gap-3`}>
          {canSeePurchasePrice ? (
            <>
              <div className="grid gap-1">
                <Label htmlFor="purchasePrice" className="text-xs text-muted-foreground">Закупка, ₽</Label>
                <Input 
                  id="purchasePrice" 
                  type="number" 
                  step="0.01" 
                  {...form.register("purchasePrice")} 
                  data-testid="input-purchase-price"
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="markup" className="text-xs text-muted-foreground">Наценка, %</Label>
                <Input 
                  id="markup" 
                  type="number" 
                  step="1"
                  value={markup}
                  onChange={(e) => setMarkup(Number(e.target.value))}
                  placeholder="50"
                  data-testid="input-markup-percent"
                />
              </div>
            </>
          ) : null}
          <div className="grid gap-1">
            <Label htmlFor="sellingPrice" className="text-xs text-muted-foreground">Продажа, ₽</Label>
            <Input 
              id="sellingPrice" 
              type="number" 
              step="0.01" 
              {...form.register("sellingPrice")} 
              data-testid="input-selling-price"
            />
          </div>
        </div>
        {canSeePurchasePrice && markup > 0 && purchasePrice > 0 && (
          <p className="text-xs text-blue-600">
            Наценка {markup}% от {purchasePrice} ₽ = {Math.round(purchasePrice * (1 + markup / 100) * 100) / 100} ₽
          </p>
        )}
      </div>

      <div className="border rounded-lg p-4 space-y-3 bg-muted">
        <Label className="text-sm font-medium">Распределение остатков</Label>
        <div className="grid grid-cols-4 gap-3">
          <div className="grid gap-1">
            <Label htmlFor="stockLocal" className="text-xs text-muted-foreground">На складе</Label>
            <Input id="stockLocal" type="number" {...form.register("stockLocal")} data-testid="input-stock-local" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="stockOzon" className="text-xs text-muted-foreground">Ozon</Label>
            <Input id="stockOzon" type="number" {...form.register("stockOzon")} data-testid="input-stock-ozon" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="stockWb" className="text-xs text-muted-foreground">Wildberries</Label>
            <Input id="stockWb" type="number" {...form.register("stockWb")} data-testid="input-stock-wb" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="stockYandex" className="text-xs text-muted-foreground">Yandex Market</Label>
            <Input id="stockYandex" type="number" {...form.register("stockYandex")} data-testid="input-stock-yandex" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Итого: {stockLocal + stockOzon + stockWb + stockYandex} шт.</p>
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

      {companies.length === 0 && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          Сначала добавьте компанию (ИП) в разделе «Настройки», чтобы создавать товары.
        </p>
      )}

      <Button type="submit" className="w-full mt-2" disabled={isPending || isUploading || companies.length === 0} data-testid="button-create-product">
        {isPending ? "Создание..." : "Создать товар"}
      </Button>
    </form>
  );
}

function ImportProductsForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const handleImport = async () => {
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/products/import", {
        method: "POST",
        body: formData,
        credentials: "include"
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Ошибка импорта");
      }

      toast({ 
        title: "Импорт завершён", 
        description: result.message 
      });
      
      // Invalidate products query to refresh the list
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      onSuccess();
    } catch (error: any) {
      toast({ 
        title: "Ошибка импорта", 
        description: error.message,
        variant: "destructive" 
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-4 py-4">
      <div className="border-2 border-dashed rounded-lg p-6 text-center bg-muted">
        <Upload className="w-10 h-10 mx-auto text-slate-400 mb-3" />
        <Input
          type="file"
          accept=".xlsx,.xls,.docx,.doc,.pdf"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="cursor-pointer"
          data-testid="input-import-file"
        />
        <p className="text-xs text-muted-foreground mt-2">
          Поддерживаемые форматы: Excel (.xlsx), Word (.docx), PDF
        </p>
      </div>

      {file && (
        <div className="bg-blue-50 p-3 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-blue-600" />
            <span className="text-sm font-medium">{file.name}</span>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setFile(null)}
          >
            Удалить
          </Button>
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-800">
          <strong>Формат файла Excel:</strong> Используйте колонки: Название, Артикул, Закупка, Продажа, Склад, Категория, Описание
        </p>
      </div>

      <Button 
        onClick={handleImport} 
        className="w-full" 
        disabled={!file || isUploading}
        data-testid="button-import-submit"
      >
        {isUploading ? "Импорт..." : "Импортировать товары"}
      </Button>
    </div>
  );
}

function StockInflowForm({ product, onSuccess }: { product: Product; onSuccess: () => void }) {
  const { mutate, isPending } = useCreateStockInflow();
  const [quantity, setQuantity] = useState(0);
  const [toLocal, setToLocal] = useState(0);
  const [toOzon, setToOzon] = useState(0);
  const [toWb, setToWb] = useState(0);
  const [toYandex, setToYandex] = useState(0);
  const [purchasePrice, setPurchasePrice] = useState(Number(product.purchasePrice) || 0);

  const remaining = quantity - toLocal - toOzon - toWb - toYandex;

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
      toYandex,
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

      <div className="border rounded-lg p-4 space-y-3 bg-muted">
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
          <div className="flex items-center justify-between">
            <Label className="text-sm">На Yandex Market</Label>
            <Input 
              type="number" 
              className="w-24"
              value={toYandex} 
              onChange={(e) => setToYandex(Number(e.target.value))}
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

function ProductRow({ product, onInflow, canSeePurchasePrice = true }: { product: Product; onInflow: () => void; canSeePurchasePrice?: boolean }) {
  const { mutate: deleteProduct } = useDeleteProduct();
  const { mutate: syncProduct, isPending: isSyncing } = useSyncProduct();

  return (
    <TableRow className="group hover:bg-muted transition-colors">
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
      {canSeePurchasePrice && <TableCell className="text-right text-sm">{formatCurrency(product.purchasePrice || 0)}</TableCell>}
      <TableCell className="text-right font-medium">{formatCurrency(product.sellingPrice || product.price || 0)}</TableCell>
      <TableCell className="text-center">
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          product.stockQuantity < 10 ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"
        }`}>
          {product.stockQuantity} шт.
        </span>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1 text-xs">
          <span className="px-1.5 py-0.5 rounded bg-muted border border-border">
            С:{product.stockLocal || 0}
          </span>
          <span className="px-1.5 py-0.5 rounded" style={{ background: '#005BFF20', color: '#005BFF', border: '1px solid #005BFF40' }}>
            O:{product.stockOzon || 0}
          </span>
          <span className="px-1.5 py-0.5 rounded" style={{ background: '#CB11AB20', color: '#CB11AB', border: '1px solid #CB11AB40' }}>
            W:{product.stockWb || 0}
          </span>
          <span className="px-1.5 py-0.5 rounded" style={{ background: '#FFCC0020', color: '#B8860B', border: '1px solid #FFCC0040' }}>
            Y:{(product as any).stockYandex || 0}
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
