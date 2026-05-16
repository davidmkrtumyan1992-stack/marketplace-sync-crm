import { Layout } from "@/components/Layout";
import { SyncPriceDialog } from "@/components/SyncPriceDialog";
import { useProducts, useCreateProduct, useDeleteProduct, useSyncProduct } from "@/hooks/use-products";
import { useCreateStockInflow } from "@/hooks/use-stock-inflow";
import { useState, useEffect, useRef } from "react";
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
import { Plus, Search, MoreHorizontal, RefreshCw, Trash2, Package, PackagePlus, Upload, ImagePlus, FileSpreadsheet, Percent, Loader2, ShoppingBag, Store, Save, X, AlertTriangle, Calculator, TrendingUp, TrendingDown, Download, Copy } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { calculateFromProduct, calculateProductProfit, getMarginColor, getMarginBadgeClasses, formatRub, formatPct, type OzonProfitResult } from "@/lib/ozon-calc";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { formatCurrency, formatQuantity } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useRole } from "@/hooks/use-role";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { useTaxSettings } from "@/hooks/use-tax-settings";
import { formatNumber } from "@/lib/format";
import { OzonCalculatorDialog } from "@/components/OzonCalculatorDialog";

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
  const { data: taxSettings } = useTaxSettings();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isCalcOpen, setIsCalcOpen] = useState(false);
  const [inflowProduct, setInflowProduct] = useState<Product | null>(null);
  const { toast } = useToast();

  const [importingMarketplace, setImportingMarketplace] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);


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

  const enrichPhotosMutation = useMutation({
    mutationFn: async () => {
      const results = { ozonEnriched: 0, ozonTotal: 0, wbUpdated: 0, wbTotal: 0 };
      // Ozon photos — non-fatal
      try {
        const res = await apiRequest("POST", "/api/marketplace/enrich/ozon");
        if (res.ok) {
          const d = await res.json();
          results.ozonEnriched = d.enriched ?? 0;
          results.ozonTotal = d.total ?? 0;
        }
      } catch {}
      // WB photos — non-fatal
      try {
        const res = await apiRequest("POST", "/api/marketplace/fix-photos/wildberries");
        if (res.ok) {
          const d = await res.json();
          results.wbUpdated = d.photosUpdated ?? 0;
          results.wbTotal = d.total ?? 0;
        }
      } catch {}
      return results;
    },
    onSuccess: (data: { ozonEnriched: number; ozonTotal: number; wbUpdated: number; wbTotal: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      const parts: string[] = [];
      if (data.ozonTotal > 0) parts.push(`Ozon: ${data.ozonEnriched}/${data.ozonTotal}`);
      if (data.wbTotal > 0) parts.push(`WB: ${data.wbUpdated}/${data.wbTotal}`);
      toast({ title: "Фото синхронизированы", description: parts.join(" · ") || "Нет товаров для обновления" });
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка синхронизации фото", description: err.message, variant: "destructive" });
    },
  });

  const taxRate = Number(taxSettings?.taxRate) || 6;
  const defaultCommission = Number(taxSettings?.defaultMarketplaceCommission) || 15;

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
            <Dialog open={isCalcOpen} onOpenChange={setIsCalcOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="lg" data-testid="button-ozon-calculator">
                  <Calculator className="w-4 h-4 mr-2" />
                  Ozon Калькулятор
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Calculator className="w-5 h-5" />
                    Ozon Калькулятор
                  </DialogTitle>
                </DialogHeader>
                <OzonCalculatorDialog taxRate={Number(taxSettings?.taxRate) || 6} products={products || []} />
              </DialogContent>
            </Dialog>
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
                  onClick={() => enrichPhotosMutation.mutate()}
                  disabled={enrichPhotosMutation.isPending}
                >
                  <ImagePlus className="w-4 h-4 mr-2" />
                  {enrichPhotosMutation.isPending ? "Синхронизация фото..." : "Синхронизировать фото"}
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
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
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
                <TableHead className="text-right">FBO</TableHead>
                <TableHead className="text-right">FBS</TableHead>
                <TableHead className="text-right">Маржа</TableHead>
                <TableHead className="text-center">Остаток</TableHead>
                <TableHead>Склад</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={canSeePurchasePrice ? 11 : 10} className="h-24 text-center">Загрузка товаров...</TableCell>
                </TableRow>
              ) : filteredProducts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canSeePurchasePrice ? 11 : 10} className="h-32 text-center text-muted-foreground">
                    Товары не найдены. Добавьте первый товар.
                  </TableCell>
                </TableRow>
              ) : (
                filteredProducts?.map((product: any) => (
                  <ProductRow key={product.id} product={product} onInflow={() => setInflowProduct(product)} canSeePurchasePrice={canSeePurchasePrice} onClick={() => setSelectedProduct(product)} taxRate={taxRate} defaultCommission={defaultCommission} />
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
          taxRate={taxRate}
          defaultCommission={defaultCommission}
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

function copyText(text: string): boolean {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text);
    return true;
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;";
  // Append inside active dialog so Radix focus trap allows focus
  const container = (document.querySelector('[role="dialog"]') ?? document.body) as HTMLElement;
  container.appendChild(el);
  el.focus();
  el.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch {}
  container.removeChild(el);
  return ok;
}

function ProductDetailModal({ product, canSeePurchasePrice, onClose, taxRate, defaultCommission }: { product: Product; canSeePurchasePrice: boolean; onClose: () => void; taxRate: number; defaultCommission: number }) {
  const { toast } = useToast();
  const [editName, setEditName] = useState(product.name);
  const [editBarcode, setEditBarcode] = useState(product.barcode || "");
  const [editPrice, setEditPrice] = useState(Number(product.sellingPrice || product.price || 0));
  const [editCategory, setEditCategory] = useState(product.category || "");
  const [editLength, setEditLength] = useState(Number(product.dimensionLength || 0));
  const [editWidth, setEditWidth] = useState(Number(product.dimensionWidth || 0));
  const [editHeight, setEditHeight] = useState(Number(product.dimensionHeight || 0));
  const [editWeight, setEditWeight] = useState(Number(product.weight || 0));
  const [editCommissionFBO, setEditCommissionFBO] = useState(Number(product.marketplaceCommission || 0));
  const [editCommissionFBS, setEditCommissionFBS] = useState(Number(product.marketplaceCommissionFbs || 0));
  const [editPurchasePrice, setEditPurchasePrice] = useState(Number(product.purchasePrice || 0));
  const [imgError, setImgError] = useState(false);
  useEffect(() => setImgError(false), [product.id]);
  const [isSaving, setIsSaving] = useState(false);
  const [showSyncPrice, setShowSyncPrice] = useState(false);
  const [syncPriceValue, setSyncPriceValue] = useState(0);
  const baselineRef = useRef({
    name: product.name,
    barcode: product.barcode || "",
    price: Number(product.sellingPrice || product.price || 0),
    category: product.category || "",
    length: Number(product.dimensionLength || 0),
    width: Number(product.dimensionWidth || 0),
    height: Number(product.dimensionHeight || 0),
    weight: Number(product.weight || 0),
    commissionFBO: Number(product.marketplaceCommission || 0),
    commissionFBS: Number(product.marketplaceCommissionFbs || 0),
  });

  useEffect(() => {
    const needsEnrich = product?.ozonId &&
      (Number(product.dimensionLength || 0) <= 0 ||
       Number(product.dimensionWidth || 0) <= 0);
    console.log("[enrich-check]", {
      productId: product?.id,
      ozonId: product?.ozonId,
      dimensionLength: product?.dimensionLength,
      dimensionWidth: product?.dimensionWidth,
      needsEnrich,
    });
    if (needsEnrich) {
      const enrichData = async () => {
        try {
          console.log("[enrich] calling /api/products/enrich-from-ozon for productId:", product.id);
          const res = await apiRequest("POST", "/api/products/enrich-from-ozon", { productId: product.id });
          if (res.ok) {
            const data = await res.json();
            console.log("[enrich] response:", data);
            if (data.dimensionLength) {
              setEditLength(Number(data.dimensionLength) || 0);
              setEditWidth(Number(data.dimensionWidth) || 0);
              setEditHeight(Number(data.dimensionHeight) || 0);
              setEditWeight(Number(data.weight) || 0);
              setEditCommissionFBO(Number(data.commissionFbo) || 15);
              setEditCommissionFBS(Number(data.commissionFbs) || 19);
            }
          } else {
            const errData = await res.json().catch(() => ({}));
            console.warn("[enrich] failed:", res.status, errData);
          }
        } catch (err) {
          console.warn("[enrich] error:", err);
        }
      };
      enrichData();
    }
  }, [product?.id]);

  const hasOzon = !!product.ozonId;
  const hasWb = !!product.wbId;
  const hasYandex = !!product.yandexId;
  const hasMarketplace = hasOzon || hasWb || hasYandex;
  const marketplaceNames = [hasOzon && "Ozon", hasWb && "Wildberries", hasYandex && "Yandex Market"].filter(Boolean).join(", ");
  const b = baselineRef.current;
  const hasChanges = editName !== b.name ||
    editBarcode !== b.barcode ||
    editPrice !== b.price ||
    editCategory !== b.category ||
    editPurchasePrice !== b.purchasePrice ||
    editLength !== b.length ||
    editWidth !== b.width ||
    editHeight !== b.height ||
    editWeight !== b.weight ||
    editCommissionFBO !== b.commissionFBO ||
    editCommissionFBS !== b.commissionFBS;
  const isValid = editName.trim().length > 0 && !isNaN(editPrice) && editPrice >= 0;

  const handleSaveClick = () => {
    if (!hasChanges) return;
    doSave();
  };

  const doSave = async () => {
    setIsSaving(true);
    const priceChangedBeforeSave = editPrice !== baselineRef.current.price;
    try {
      const body = {
        name: editName,
        barcode: editBarcode || null,
        sellingPrice: String(editPrice),
        price: String(editPrice),
        category: editCategory || null,
        dimensionLength: String(editLength || 0),
        dimensionWidth: String(editWidth || 0),
        dimensionHeight: String(editHeight || 0),
        weight: String(editWeight || 0),
        marketplaceCommission: String(editCommissionFBO || 0),
        marketplaceCommissionFbs: String(editCommissionFBS || 0),
        purchasePrice: String(editPurchasePrice || 0),
      };

      console.log("SAVING PRODUCT:", JSON.stringify(body, null, 2));

      const res = await apiRequest("PUT", `/api/products/${product.id}`, body);

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

      const responseData = await res.json();
      const savedProduct = responseData.product ?? responseData;
      console.log("SAVE RESULT:", JSON.stringify(savedProduct, null, 2));

      if (savedProduct) {
        const newName = savedProduct.name || editName;
        const newBarcode = savedProduct.barcode || "";
        const newPrice = Number(savedProduct.sellingPrice || savedProduct.price || editPrice);
        const newCategory = savedProduct.category || "";
        const newLength = Number(savedProduct.dimensionLength || 0);
        const newWidth = Number(savedProduct.dimensionWidth || 0);
        const newHeight = Number(savedProduct.dimensionHeight || 0);
        const newWeight = Number(savedProduct.weight || 0);
        const newCommFBO = Number(savedProduct.marketplaceCommission || 0);
        const newCommFBS = Number(savedProduct.marketplaceCommissionFbs || 0);

        setEditName(newName);
        setEditBarcode(newBarcode);
        setEditPrice(newPrice);
        setEditCategory(newCategory);
        setEditLength(newLength);
        setEditWidth(newWidth);
        setEditHeight(newHeight);
        setEditWeight(newWeight);
        setEditCommissionFBO(newCommFBO);
        setEditCommissionFBS(newCommFBS);

        baselineRef.current = {
          name: newName,
          barcode: newBarcode,
          price: newPrice,
          category: newCategory,
          length: newLength,
          width: newWidth,
          height: newHeight,
          weight: newWeight,
          commissionFBO: newCommFBO,
          commissionFBS: newCommFBS,
        };
      }

      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Сохранено", description: "Изменения сохранены в CRM" });

      if (priceChangedBeforeSave) {
        setSyncPriceValue(editPrice);
        setShowSyncPrice(true);
      }
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

          <Tabs defaultValue="info" className="py-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="info">Информация</TabsTrigger>
              <TabsTrigger value="analytics">Аналитика</TabsTrigger>
            </TabsList>

            <TabsContent value="info" className="space-y-6 mt-4">
              <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
                <div className="w-full sm:w-48 h-48 rounded-xl border bg-muted flex items-center justify-center overflow-hidden shrink-0">
                  {product.imageUrl && !imgError ? (
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="w-full h-full object-cover"
                      data-testid="img-product-detail"
                      referrerPolicy="no-referrer"
                      onError={() => setImgError(true)}
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
                        className="font-mono bg-muted cursor-default"
                        data-testid="input-detail-sku"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 h-9 w-9"
                        title="Скопировать артикул"
                        onClick={() => {
                          const ok = copyText(product.sku);
                          toast({ title: ok ? "Артикул скопирован" : "Не удалось скопировать" });
                        }}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
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

                <div className="border-t pt-4">
                  <p className="text-sm font-semibold text-muted-foreground mb-3">Габариты товара (для расчёта логистики)</p>
                  <div className="grid grid-cols-4 gap-3">
                    <div className="grid gap-2">
                      <Label htmlFor="detail-length" className="text-xs">Длина, см</Label>
                      <Input
                        id="detail-length"
                        type="number"
                        step="0.1"
                        value={editLength}
                        onChange={(e) => setEditLength(Number(e.target.value) || 0)}
                        data-testid="input-detail-length"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="detail-width" className="text-xs">Ширина, см</Label>
                      <Input
                        id="detail-width"
                        type="number"
                        step="0.1"
                        value={editWidth}
                        onChange={(e) => setEditWidth(Number(e.target.value) || 0)}
                        data-testid="input-detail-width"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="detail-height" className="text-xs">Высота, см</Label>
                      <Input
                        id="detail-height"
                        type="number"
                        step="0.1"
                        value={editHeight}
                        onChange={(e) => setEditHeight(Number(e.target.value) || 0)}
                        data-testid="input-detail-height"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="detail-weight" className="text-xs">Вес, кг</Label>
                      <Input
                        id="detail-weight"
                        type="number"
                        step="0.01"
                        value={editWeight}
                        onChange={(e) => setEditWeight(Number(e.target.value) || 0)}
                        data-testid="input-detail-weight"
                      />
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <p className="text-sm font-semibold text-muted-foreground mb-3">Комиссии маркетплейса</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="detail-commission-fbo" className="text-xs">FBO, %</Label>
                      <Input
                        id="detail-commission-fbo"
                        type="number"
                        step="0.1"
                        value={editCommissionFBO}
                        onChange={(e) => setEditCommissionFBO(Number(e.target.value) || 0)}
                        data-testid="input-detail-commission-fbo"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="detail-commission-fbs" className="text-xs">FBS, %</Label>
                      <Input
                        id="detail-commission-fbs"
                        type="number"
                        step="0.1"
                        value={editCommissionFBS}
                        onChange={(e) => setEditCommissionFBS(Number(e.target.value) || 0)}
                        data-testid="input-detail-commission-fbs"
                        placeholder="Если не указано, = FBO + 4%"
                      />
                    </div>
                  </div>
                </div>

                {canSeePurchasePrice && (
                  <div className="grid gap-1">
                    <Label className="text-xs text-muted-foreground">Закупочная цена, ₽</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editPurchasePrice}
                      onChange={(e) => setEditPurchasePrice(Number(e.target.value))}
                      data-testid="input-detail-purchase-price"
                    />
                  </div>
                )}
              </div>

              {hasMarketplace && hasChanges && (
                <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-start gap-2">
                  <Store className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-blue-800 dark:text-blue-200">
                    Изменения сохранятся только в CRM. Для синхронизации с {marketplaceNames} используйте отдельную функцию синхронизации.
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
            </TabsContent>

            <TabsContent value="analytics" className="mt-4">
              <ProductAnalyticsTab product={product} taxRate={taxRate} defaultCommission={defaultCommission} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <SyncPriceDialog
        open={showSyncPrice}
        onClose={() => setShowSyncPrice(false)}
        productId={product.id}
        newPrice={syncPriceValue}
      />
    </>
  );
}

function ProductAnalyticsTab({ product, taxRate, defaultCommission }: { product: Product; taxRate: number; defaultCommission: number }) {
  const { toast } = useToast();
  const baseResult = calculateFromProduct(product, taxRate, defaultCommission);
  const currentPrice = Number(product.sellingPrice || product.price || 0);
  const [simPrice, setSimPrice] = useState(currentPrice);
  const [isSavingPrice, setIsSavingPrice] = useState(false);

  const simResult = simPrice !== currentPrice
    ? calculateProductProfit(
        simPrice,
        Number(product.purchasePrice || 0),
        Number(product.marketplaceCommission) || defaultCommission,
        taxRate,
        Number(product.dimensionLength || 0),
        Number(product.dimensionWidth || 0),
        Number(product.dimensionHeight || 0),
      )
    : baseResult;

  const handleApplyPrice = async () => {
    setIsSavingPrice(true);
    try {
      const res = await apiRequest("PUT", `/api/products/${product.id}`, {
        sellingPrice: String(simPrice),
        price: String(simPrice),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Ошибка" }));
        throw new Error(err.message || "Не удалось обновить");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({
        title: "Цена обновлена",
        description: `Новая цена: ${simPrice.toLocaleString("ru-RU")} руб. Для синхронизации с маркетплейсами сохраните карточку товара.`,
      });
      setSimPrice(simPrice);
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message || "Не удалось обновить цену", variant: "destructive" });
    } finally {
      setIsSavingPrice(false);
    }
  };

  const noPurchasePrice = Number(product.purchasePrice || 0) === 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border p-3 text-center">
          <p className="text-xs text-muted-foreground mb-1">Прибыль FBO</p>
          <p className={`text-lg font-bold ${baseResult.profitFBO >= 0 ? "text-green-600" : "text-red-600"}`} data-testid="text-kpi-profit-fbo">
            {formatRub(baseResult.profitFBO)}
          </p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-xs text-muted-foreground mb-1">Прибыль FBS</p>
          <p className={`text-lg font-bold ${baseResult.profitFBS >= 0 ? "text-green-600" : "text-red-600"}`} data-testid="text-kpi-profit-fbs">
            {formatRub(baseResult.profitFBS)}
          </p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-xs text-muted-foreground mb-1">Маржа FBO</p>
          <p className={`text-lg font-bold ${getMarginColor(baseResult.marginFBO)}`} data-testid="text-kpi-margin-fbo">
            {formatPct(baseResult.marginFBO)}
          </p>
        </div>
      </div>

      {!baseResult.hasVolume && (
        <div className="flex gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-yellow-700">Заполните габариты товара (длина, ширина, высота) для расчёта логистики</p>
        </div>
      )}

      {noPurchasePrice && (
        <p className="text-xs text-muted-foreground">Укажите себестоимость для точного расчёта прибыли</p>
      )}

      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className="p-2">Параметр</TableHead>
            <TableHead className="p-2 text-right">FBO</TableHead>
            <TableHead className="p-2 text-right">FBS</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="border-b">
            <TableCell className="p-2">Цена товара</TableCell>
            <TableCell className="p-2 text-right font-medium">{formatRub(simResult.sellingPrice)} 100%</TableCell>
            <TableCell className="p-2 text-right font-medium">{formatRub(simResult.sellingPrice)} 100%</TableCell>
          </TableRow>
          <TableRow className="border-b">
            <TableCell className="p-2">Вознаграждение Ozon ({simResult.commissionFBOPct}%/{simResult.commissionFBSPct}%)</TableCell>
            <TableCell className="p-2 text-right text-red-600">-{formatRub(simResult.commissionFBO)} {simResult.commissionFBOPct}%</TableCell>
            <TableCell className="p-2 text-right text-red-600">-{formatRub(simResult.commissionFBS)} {simResult.commissionFBSPct}%</TableCell>
          </TableRow>
          <TableRow className="border-b">
            <TableCell className="p-2">Эквайринг (1%)</TableCell>
            <TableCell className="p-2 text-right text-red-600">-{formatRub(simResult.acquiring)}</TableCell>
            <TableCell className="p-2 text-right text-red-600">-{formatRub(simResult.acquiring)}</TableCell>
          </TableRow>
          <TableRow className="border-b">
            <TableCell className="p-2">Обработка отправления</TableCell>
            <TableCell className="p-2 text-right text-red-600">—</TableCell>
            <TableCell className="p-2 text-right text-red-600">-{formatRub(simResult.processingFBS)}</TableCell>
          </TableRow>
          <TableRow className="border-b">
            <TableCell className="p-2">Логистика</TableCell>
            <TableCell className="p-2 text-right text-red-600">{simResult.hasVolume ? `-${formatRub(simResult.logisticsFBO!)}` : "—"}</TableCell>
            <TableCell className="p-2 text-right text-red-600">{simResult.hasVolume ? `-${formatRub(simResult.logisticsFBS!)}` : "—"}</TableCell>
          </TableRow>
          <TableRow className="border-b">
            <TableCell className="p-2">Доставка (последняя миля)</TableCell>
            <TableCell className="p-2 text-right text-red-600">-{formatRub(simResult.lastMile)}</TableCell>
            <TableCell className="p-2 text-right text-red-600">-{formatRub(simResult.lastMile)}</TableCell>
          </TableRow>
          <TableRow className="border-b">
            <TableCell className="p-2">Себестоимость</TableCell>
            <TableCell className="p-2 text-right text-red-600">-{formatRub(simResult.purchasePrice)}</TableCell>
            <TableCell className="p-2 text-right text-red-600">-{formatRub(simResult.purchasePrice)}</TableCell>
          </TableRow>
          <TableRow className="border-b">
            <TableCell className="p-2">Налог ({formatPct(simResult.taxRate)})</TableCell>
            <TableCell className="p-2 text-right text-red-600">-{formatRub(simResult.tax)}</TableCell>
            <TableCell className="p-2 text-right text-red-600">-{formatRub(simResult.tax)}</TableCell>
          </TableRow>
          <TableRow className="bg-muted/50 font-semibold">
            <TableCell className="p-2">Чистая прибыль</TableCell>
            <TableCell className={`p-2 text-right ${simResult.profitFBO >= 0 ? "text-green-600" : "text-red-600"}`}>
              {formatRub(simResult.profitFBO)}
              {simPrice !== currentPrice && (
                <span className={`ml-1 text-xs ${simResult.profitFBO - baseResult.profitFBO >= 0 ? "text-green-500" : "text-red-500"}`}>
                  ({simResult.profitFBO - baseResult.profitFBO >= 0 ? "+" : ""}{formatRub(simResult.profitFBO - baseResult.profitFBO)})
                </span>
              )}
            </TableCell>
            <TableCell className={`p-2 text-right ${simResult.profitFBS >= 0 ? "text-green-600" : "text-red-600"}`}>
              {formatRub(simResult.profitFBS)}
              {simPrice !== currentPrice && (
                <span className={`ml-1 text-xs ${simResult.profitFBS - baseResult.profitFBS >= 0 ? "text-green-500" : "text-red-500"}`}>
                  ({simResult.profitFBS - baseResult.profitFBS >= 0 ? "+" : ""}{formatRub(simResult.profitFBS - baseResult.profitFBS)})
                </span>
              )}
            </TableCell>
          </TableRow>
          <TableRow className="bg-muted/50 font-semibold">
            <TableCell className="p-2">Маржинальность</TableCell>
            <TableCell className={`p-2 text-right ${simResult.marginFBO >= 0 ? "text-green-600" : "text-red-600"}`}>{formatPct(simResult.marginFBO)}</TableCell>
            <TableCell className={`p-2 text-right ${simResult.marginFBS >= 0 ? "text-green-600" : "text-red-600"}`}>{formatPct(simResult.marginFBS)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <div className="border rounded-lg p-4 space-y-3">
        <Label className="text-sm font-semibold">Симулятор цены</Label>
        <p className="text-xs text-muted-foreground">Текущая цена: {formatRub(currentPrice)}</p>
        <Slider
          value={[simPrice]}
          onValueChange={(v) => setSimPrice(v[0])}
          min={Math.round(currentPrice * 0.5)}
          max={Math.round(currentPrice * 2)}
          step={1}
          data-testid="slider-price-simulator"
        />
        <div className="flex items-center gap-2">
          <Label className="text-xs whitespace-nowrap">Новая цена:</Label>
          <Input
            type="number"
            value={simPrice}
            onChange={(e) => setSimPrice(Number(e.target.value) || 0)}
            className="w-32 h-8 text-sm"
            data-testid="input-sim-price"
          />
          <span className="text-xs text-muted-foreground">₽</span>
          {simPrice !== currentPrice && (
            <Button size="sm" onClick={handleApplyPrice} disabled={isSavingPrice} className="ml-auto" data-testid="button-apply-price">
              {isSavingPrice ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              Применить цену
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProductRow({ product, onInflow, canSeePurchasePrice = true, onClick, taxRate, defaultCommission }: { product: Product; onInflow: () => void; canSeePurchasePrice?: boolean; onClick?: () => void; taxRate: number; defaultCommission: number }) {
  const { mutate: deleteProduct } = useDeleteProduct();
  const { mutate: syncProduct, isPending: isSyncing } = useSyncProduct();
  const { toast } = useToast();
  const [imgError, setImgError] = useState(false);
  useEffect(() => setImgError(false), [product.imageUrl]);

  const result = calculateFromProduct(product, taxRate, defaultCommission);

  return (
    <TableRow className="group hover:bg-muted transition-colors cursor-pointer" onClick={onClick} data-testid={`row-product-${product.id}`}>
      <TableCell className="font-medium">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded bg-slate-100 flex items-center justify-center text-slate-400">
            {product.imageUrl && !imgError ? (
              <img
                src={product.imageUrl}
                alt={product.name}
                className="h-full w-full object-cover rounded"
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
              />
            ) : <Package size={20} />}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="block">{product.name}</span>
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${getMarginBadgeClasses(result.marginFBO)}`} data-testid={`badge-margin-${product.id}`}>
                {formatPct(result.marginFBO)}
              </span>
              {product.ozonId && <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: "#005BFF" }} title="Ozon" />}
              {product.wbId && <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: "#CB11AB" }} title="Wildberries" />}
              {product.yandexId && <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: "#FFCC00" }} title="Yandex Market" />}
            </div>
            {product.category && <span className="text-xs text-muted-foreground">{product.category}</span>}
          </div>
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs">
        <div className="flex items-center gap-1 group/sku">
          <span>{product.sku}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 opacity-0 group-hover/sku:opacity-100 transition-opacity shrink-0"
            title="Скопировать артикул"
            onClick={(e) => { e.stopPropagation(); const ok = copyText(product.sku); toast({ title: ok ? "Артикул скопирован" : "Не удалось скопировать" }); }}
          >
            <Copy className="w-3 h-3" />
          </Button>
        </div>
      </TableCell>
      {canSeePurchasePrice && <TableCell className="text-right text-sm">{formatCurrency(product.purchasePrice || 0)}</TableCell>}
      <TableCell className="text-right font-medium">{formatCurrency(product.sellingPrice || product.price || 0)}</TableCell>
      <TableCell className={`text-right text-sm ${result.profitFBO >= 0 ? "text-green-600" : "text-red-600"}`} data-testid={`text-profit-fbo-${product.id}`}>
        {formatRub(result.profitFBO)}
      </TableCell>
      <TableCell className={`text-right text-sm ${result.profitFBS >= 0 ? "text-green-600" : "text-red-600"}`} data-testid={`text-profit-fbs-${product.id}`}>
        {formatRub(result.profitFBS)}
      </TableCell>
      <TableCell className={`text-right text-sm font-medium ${getMarginColor(result.marginFBO)}`} data-testid={`text-margin-${product.id}`}>
        {formatPct(result.marginFBO)}
      </TableCell>
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
