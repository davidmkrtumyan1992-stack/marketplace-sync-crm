import { Layout } from "@/components/Layout";
import { useProducts, useCreateProduct, useDeleteProduct, useSyncProduct } from "@/hooks/use-products";
import { useCreateStockInflow } from "@/hooks/use-stock-inflow";
import { useSyncFboStock } from "@/hooks/use-orders";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Plus, Search, MoreHorizontal, RefreshCw, Trash2, Package, PackagePlus, Upload, ImagePlus, FileSpreadsheet, Percent, Loader2, ShoppingBag, Store, Save, X, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { formatCurrency, formatQuantity } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useRole } from "@/hooks/use-role";
import { useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";

const formSchema = insertProductSchema.extend({
  purchasePrice: z.coerce.number(),
  sellingPrice: z.coerce.number(),
  price: z.coerce.number().optional(),
  stockQuantity: z.coerce.number(),
  centralStock: z.coerce.number().optional(),
  barcode: z.string().optional(),
  weight: z.coerce.number().optional(),
  logisticsCost: z.coerce.number().optional(),
  marketplaceCommission: z.coerce.number().optional(),
  companyId: z.coerce.number().optional().nullable(),
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

  const [importingMarketplace, setImportingMarketplace] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const syncFboStock = useSyncFboStock();

  const syncMutation = useMutation({
    mutationFn: async (marketplace: string) => {
      setImportingMarketplace(marketplace);
      const endpoint = marketplace === "yandex"
        ? `/api/marketplace/import/${marketplace}`
        : `/api/marketplace/sync/${marketplace}`;
      const res = await apiRequest("POST", endpoint);
      return await res.json();
    },
    onSuccess: (data: any) => {
      const label = data.marketplace === "ozon" ? "Ozon" : data.marketplace === "wildberries" ? "Wildberries" : "Yandex Market";
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      if (data.noProductsMessage) {
        toast({
          title: `\u00AB${label}\u00BB — товары не найдены`,
          description: data.noProductsMessage,
          variant: "destructive",
        });
      } else {
        toast({
          title: `\u00ABДанные ${label}\u00BB успешно обновлены`,
          description: data.marketplace === "wildberries"
            ? `Товары: ${formatQuantity((data.created || 0) + (data.updated || 0))}, остатки: ${formatQuantity(data.stocksUpdated || 0)}, фото: ${formatQuantity(data.photosFixed || 0)}`
            : data.marketplace === "ozon"
            ? `Товары: ${formatQuantity((data.created || 0) + (data.updated || 0))}, обогащено: ${formatQuantity(data.enriched || 0)}`
            : `Создано: ${formatQuantity(data.created || 0)}, обновлено: ${formatQuantity(data.updated || 0)}`,
        });
      }
      setImportingMarketplace(null);
    },
    onError: (error: Error) => {
      let msg = error.message;
      try {
        const parsed = JSON.parse(msg.replace(/^\d+:\s*/, ""));
        msg = parsed.message || msg;
      } catch {}
      toast({
        title: "Ошибка синхронизации",
        description: msg,
        variant: "destructive",
      });
      setImportingMarketplace(null);
    },
  });

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
          <div className="flex flex-wrap gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="lg" disabled={syncMutation.isPending} data-testid="button-sync-marketplace">
                  {syncMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  {syncMutation.isPending
                    ? `Синхронизация ${importingMarketplace === "ozon" ? "Ozon" : importingMarketplace === "wildberries" ? "Wildberries" : "Yandex Market"}: загружаем данные и фото...`
                    : "Обновить из маркетплейсов"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => syncMutation.mutate("ozon")}
                  disabled={syncMutation.isPending}
                  data-testid="button-sync-ozon"
                >
                  <ShoppingBag className="w-4 h-4 mr-2" />
                  Обновить Ozon
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => syncMutation.mutate("wildberries")}
                  disabled={syncMutation.isPending}
                  data-testid="button-sync-wildberries"
                >
                  <Store className="w-4 h-4 mr-2" />
                  Обновить Wildberries
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => syncMutation.mutate("yandex")}
                  disabled={syncMutation.isPending}
                  data-testid="button-sync-yandex"
                >
                  <Package className="w-4 h-4 mr-2" />
                  Обновить Yandex Market
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => syncFboStock.mutate()}
                  disabled={syncFboStock.isPending}
                  data-testid="button-sync-fbo-stock"
                >
                  <Package className="w-4 h-4 mr-2" />
                  Обновить FBO остатки (Ozon)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="lg" data-testid="button-import-products">
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Импорт из файла
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg w-[95vw] sm:w-full">
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
              <DialogContent className="max-w-2xl w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto">
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
                <TableHead className="text-center">FBO</TableHead>
                <TableHead>Склад</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={canSeePurchasePrice ? 8 : 7} className="h-24 text-center">Загрузка товаров...</TableCell>
                </TableRow>
              ) : filteredProducts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canSeePurchasePrice ? 8 : 7} className="h-32 text-center text-muted-foreground">
                    Товары не найдены. Добавьте первый товар.
                  </TableCell>
                </TableRow>
              ) : (
                filteredProducts?.map((product: any) => (
                  <ProductRow key={product.id} product={product} onInflow={() => setInflowProduct(product)} canSeePurchasePrice={canSeePurchasePrice} onClick={() => setSelectedProduct(product)} />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Stock Inflow Modal */}
      <Dialog open={!!inflowProduct} onOpenChange={(open) => !open && setInflowProduct(null)}>
        <DialogContent className="max-w-md w-[95vw] sm:w-full">
          <DialogHeader>
            <DialogTitle>Оприходование товара</DialogTitle>
            <DialogDescription>{inflowProduct?.name}</DialogDescription>
          </DialogHeader>
          {inflowProduct && (
            <StockInflowForm product={inflowProduct} onSuccess={() => setInflowProduct(null)} />
          )}
        </DialogContent>
      </Dialog>

      {/* Product Detail Modal */}
      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          canSeePurchasePrice={canSeePurchasePrice}
          onClose={() => setSelectedProduct(null)}
        />
      )}
    </Layout>
  );
}

function ProductForm({ onSuccess, canSeePurchasePrice = true }: { onSuccess: () => void; canSeePurchasePrice?: boolean }) {
  const { mutate, isPending } = useCreateProduct();
  const { toast } = useToast();
  const [markup, setMarkup] = useState(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

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
      centralStock: 0,
      barcode: "",
      weight: 0,
      logisticsCost: 0,
      marketplaceCommission: 15,
    }
  });

  const centralStock = form.watch("centralStock") || 0;
  const purchasePrice = form.watch("purchasePrice") || 0;

  useEffect(() => {
    form.setValue("stockQuantity", centralStock);
  }, [centralStock, form]);

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
        centralStock: data.centralStock || 0,
        stockQuantity: data.centralStock || 0,
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
        <Label className="text-sm font-medium">Остатки на центральном складе</Label>
        <div className="grid gap-1">
          <Label htmlFor="centralStock" className="text-xs text-muted-foreground">Количество, шт.</Label>
          <Input id="centralStock" type="number" {...form.register("centralStock")} data-testid="input-central-stock" />
        </div>
        <p className="text-xs text-muted-foreground">Центральный склад: {centralStock} шт. — зеркалируется на все подключённые магазины</p>
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

      <Button type="submit" className="w-full mt-2" disabled={isPending || isUploading} data-testid="button-create-product">
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
  const [purchasePrice, setPurchasePrice] = useState(Number(product.purchasePrice) || 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (quantity <= 0) return;

    mutate({
      organizationId: "1",
      productId: product.id,
      quantity,
      toLocal: quantity,
      toOzon: 0,
      toWb: 0,
      toYandex: 0,
      purchasePrice: purchasePrice.toString(),
    }, { onSuccess });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-muted rounded-lg p-3">
        <p className="text-sm text-muted-foreground">Текущий остаток на центральном складе: <strong>{product.centralStock || 0} шт.</strong></p>
      </div>

      <div className="grid gap-2">
        <Label>Количество для оприходования</Label>
        <Input 
          type="number" 
          value={quantity} 
          onChange={(e) => setQuantity(Number(e.target.value))}
          min={1}
          data-testid="input-inflow-quantity"
        />
      </div>

      <div className="grid gap-2">
        <Label>Закупочная цена, ₽</Label>
        <Input 
          type="number" 
          step="0.01"
          value={purchasePrice} 
          onChange={(e) => setPurchasePrice(Number(e.target.value))}
          data-testid="input-inflow-purchase-price"
        />
      </div>

      <p className="text-xs text-muted-foreground">Товар будет добавлен на центральный склад и автоматически зеркалирован на все подключённые магазины</p>

      <Button type="submit" className="w-full" disabled={isPending || quantity <= 0} data-testid="button-submit-inflow">
        {isPending ? "Оприходование..." : "Оприходовать"}
      </Button>
    </form>
  );
}

function ProductDetailModal({ product, canSeePurchasePrice, onClose }: { product: Product; canSeePurchasePrice: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [editName, setEditName] = useState(product.name);
  const [editBarcode, setEditBarcode] = useState(product.barcode || "");
  const [editPrice, setEditPrice] = useState(Number(product.sellingPrice || product.price || 0));
  const [editCategory, setEditCategory] = useState(product.category || "");
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const hasOzon = !!product.ozonId;
  const hasWb = !!product.wbId;
  const hasYandex = !!product.yandexId;
  const hasMarketplace = hasOzon || hasWb || hasYandex;
  const marketplaceNames = [hasOzon && "Ozon", hasWb && "Wildberries", hasYandex && "Yandex Market"].filter(Boolean).join(", ");
  const hasChanges = editName !== product.name ||
    editBarcode !== (product.barcode || "") ||
    editPrice !== Number(product.sellingPrice || product.price || 0) ||
    editCategory !== (product.category || "");
  const isValid = editName.trim().length > 0 && !isNaN(editPrice) && editPrice >= 0;

  const handleSaveClick = () => {
    if (!hasChanges) return;
    if (hasMarketplace) {
      setShowConfirm(true);
    } else {
      doSave();
    }
  };

  const doSave = async () => {
    setIsSaving(true);
    setShowConfirm(false);
    try {
      const body = {
        name: editName,
        barcode: editBarcode || null,
        sellingPrice: editPrice,
        category: editCategory || null,
      };

      const endpoint = hasMarketplace
        ? `/api/products/${product.id}/sync-to-marketplace`
        : `/api/products/${product.id}`;
      const method = hasMarketplace ? "POST" : "PUT";

      const res = await apiRequest(method, endpoint, body);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Ошибка сохранения" }));
        const details = err.details?.join("\n") || err.message;
        toast({
          title: "Ошибка сохранения",
          description: details,
          variant: "destructive",
        });
        setIsSaving(false);
        return;
      }

      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Сохранено", description: "Товар обновлён" + (hasMarketplace ? ` и синхронизирован с ${marketplaceNames}` : "") });
      onClose();
    } catch (err: any) {
      toast({
        title: "Ошибка",
        description: err.message || "Не удалось сохранить",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-2xl w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              Карточка товара
            </DialogTitle>
            <DialogDescription>Редактирование информации о товаре</DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-2">
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
              <div className="w-full sm:w-48 h-48 rounded-xl border bg-muted flex items-center justify-center overflow-hidden shrink-0">
                {product.imageUrl ? (
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="w-full h-full object-cover"
                    data-testid="img-product-detail"
                  />
                ) : (
                  <Package className="w-16 h-16 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Артикул (SKU)</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      value={product.sku}
                      readOnly
                      className="font-mono bg-muted cursor-not-allowed"
                      data-testid="input-detail-sku"
                    />
                    <Badge variant="secondary" className="shrink-0 text-xs">Только чтение</Badge>
                  </div>
                </div>
                {hasOzon && (
                  <div className="flex items-center gap-2">
                    <Badge className="text-white" style={{ backgroundColor: "#005BFF" }}>Ozon</Badge>
                    {product.ozonId && <span className="text-xs text-muted-foreground">ID: {product.ozonId}</span>}
                  </div>
                )}
                {hasWb && (
                  <div className="flex items-center gap-2">
                    <Badge className="text-white" style={{ backgroundColor: "#CB11AB" }}>Wildberries</Badge>
                    {product.wbId && <span className="text-xs text-muted-foreground">nmID: {product.wbId}</span>}
                  </div>
                )}
                {hasYandex && (
                  <div className="flex items-center gap-2">
                    <Badge className="text-white" style={{ backgroundColor: "#FFCC00", color: "#000" }}>Yandex Market</Badge>
                    {product.yandexId && <span className="text-xs text-muted-foreground">SKU: {product.yandexId}</span>}
                  </div>
                )}
                <div className="flex items-center gap-4 text-sm">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    (product.centralStock || 0) === 0
                      ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                      : (product.centralStock || 0) <= 5
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                        : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                  }`}>
                    Остаток: {product.centralStock || 0} шт.
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-4 border-t pt-4">
              <div className="grid gap-2">
                <Label htmlFor="detail-name">Название</Label>
                <Input
                  id="detail-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  data-testid="input-detail-name"
                />
                {editName.trim().length === 0 && (
                  <span className="text-xs text-destructive">Название обязательно</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="detail-barcode">Штрих-код</Label>
                  <Input
                    id="detail-barcode"
                    value={editBarcode}
                    onChange={(e) => setEditBarcode(e.target.value)}
                    className="font-mono"
                    data-testid="input-detail-barcode"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="detail-price">Цена продажи, ₽</Label>
                  <Input
                    id="detail-price"
                    type="number"
                    step="0.01"
                    value={editPrice}
                    onChange={(e) => setEditPrice(Number(e.target.value))}
                    data-testid="input-detail-price"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Категория</Label>
                <Select value={editCategory} onValueChange={setEditCategory}>
                  <SelectTrigger data-testid="select-detail-category">
                    <SelectValue placeholder="Выберите категорию" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {canSeePurchasePrice && (
                <div className="bg-muted/50 rounded-lg p-3 text-sm">
                  <span className="text-muted-foreground">Закупочная цена: </span>
                  <span className="font-medium">{formatCurrency(product.purchasePrice || 0)}</span>
                </div>
              )}
            </div>

            {hasMarketplace && hasChanges && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  Изменения будут применены во всех подключённых магазинах ({marketplaceNames})
                </p>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={onClose} data-testid="button-detail-cancel">
                Отмена
              </Button>
              <Button
                onClick={handleSaveClick}
                disabled={!hasChanges || !isValid || isSaving}
                className="premium-button"
                data-testid="button-detail-save"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                {isSaving ? "Сохранение..." : "Сохранить"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Подтверждение синхронизации
            </AlertDialogTitle>
            <AlertDialogDescription>
              Внимание: изменения будут применены во всех подключённых магазинах. Цена, название и атрибуты товара будут обновлены на маркетплейсе {marketplaceNames}. Продолжить?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-sync-cancel">Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={doSave} data-testid="button-sync-confirm">
              Сохранить и синхронизировать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ProductRow({ product, onInflow, canSeePurchasePrice = true, onClick }: { product: Product; onInflow: () => void; canSeePurchasePrice?: boolean; onClick?: () => void }) {
  const { mutate: deleteProduct } = useDeleteProduct();
  const { mutate: syncProduct, isPending: isSyncing } = useSyncProduct();

  return (
    <TableRow className="group hover:bg-muted transition-colors cursor-pointer" onClick={onClick} data-testid={`row-product-${product.id}`}>
      <TableCell className="font-medium">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded bg-slate-100 flex items-center justify-center text-slate-400">
            {product.imageUrl ? <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover rounded" /> : <Package size={20} />}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="block">{product.name}</span>
              {product.ozonId && <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: "#005BFF" }} title="Ozon" />}
              {product.wbId && <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: "#CB11AB" }} title="Wildberries" />}
              {product.yandexId && <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: "#FFCC00" }} title="Yandex Market" />}
            </div>
            {product.category && <span className="text-xs text-muted-foreground">{product.category}</span>}
          </div>
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs">{product.sku}</TableCell>
      {canSeePurchasePrice && <TableCell className="text-right text-sm">{formatCurrency(product.purchasePrice || 0)}</TableCell>}
      <TableCell className="text-right font-medium">{formatCurrency(product.sellingPrice || product.price || 0)}</TableCell>
      <TableCell className="text-center">
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          (product.centralStock || 0) === 0
            ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
            : (product.centralStock || 0) <= 5
              ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
              : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
        }`} data-testid={`text-stock-${product.id}`}>
          {product.centralStock || 0} шт.
        </span>
      </TableCell>
      <TableCell className="text-center">
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          (product.ozonFboStock || 0) === 0
            ? "bg-muted text-muted-foreground"
            : "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400"
        }`} data-testid={`text-fbo-stock-${product.id}`}>
          {product.ozonFboStock || 0} шт.
        </span>
      </TableCell>
      <TableCell>
        <span className="text-xs text-muted-foreground" data-testid={`text-warehouse-${product.id}`}>
          Центральный склад
        </span>
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onInflow(); }}>
              <PackagePlus className="w-4 h-4 mr-2" />
              Оприходовать
            </DropdownMenuItem>
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); syncProduct(product.id); }} disabled={isSyncing}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Синхронизировать
            </DropdownMenuItem>
            <DropdownMenuItem className="text-red-600" onClick={(e) => { e.stopPropagation(); deleteProduct(product.id); }}>
              <Trash2 className="w-4 h-4 mr-2" />
              Удалить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
