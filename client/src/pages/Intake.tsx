import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatCurrency } from "@/lib/format";
import type { Product, Company } from "@shared/schema";
import { useState, useRef, useCallback, useEffect } from "react";
import { Barcode, ScanLine, Package, Plus, Minus, Trash2, Check, Building2, FileSpreadsheet } from "lucide-react";

interface BatchItem {
  product: Product;
  quantity: number;
  toLocal: number;
  toOzon: number;
  toWb: number;
  toYandex: number;
}

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

export default function Intake() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const lastKeyTime = useRef<number>(0);
  const scanBuffer = useRef<string>("");

  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [barcodeValue, setBarcodeValue] = useState("");
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [pendingBarcode, setPendingBarcode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [newProductName, setNewProductName] = useState("");
  const [newProductSku, setNewProductSku] = useState("");
  const [newProductCategory, setNewProductCategory] = useState("");
  const [newProductPurchasePrice, setNewProductPurchasePrice] = useState("");
  const [newProductSellingPrice, setNewProductSellingPrice] = useState("");

  const { data: companies, isLoading: companiesLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  useEffect(() => {
    barcodeInputRef.current?.focus();
  }, []);

  const addToBatch = useCallback((product: Product) => {
    setBatch((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1, toLocal: item.toLocal + 1 }
            : item
        );
      }
      return [
        ...prev,
        {
          product,
          quantity: 1,
          toLocal: 1,
          toOzon: 0,
          toWb: 0,
          toYandex: 0,
        },
      ];
    });
  }, []);

  const handleBarcodeScan = useCallback(
    async (barcode: string) => {
      const trimmed = barcode.trim();
      if (!trimmed) return;

      try {
        const res = await fetch(`/api/products/barcode/${encodeURIComponent(trimmed)}`, {
          credentials: "include",
        });
        if (res.ok) {
          const product: Product = await res.json();
          addToBatch(product);
          toast({ title: "Товар найден", description: product.name });
        } else if (res.status === 404) {
          setPendingBarcode(trimmed);
          setNewProductName("");
          setNewProductSku("");
          setNewProductCategory("");
          setNewProductPurchasePrice("");
          setNewProductSellingPrice("");
          setIsCreateModalOpen(true);
        } else {
          toast({ title: "Ошибка", description: "Не удалось найти товар", variant: "destructive" });
        }
      } catch {
        toast({ title: "Ошибка сети", description: "Проверьте подключение", variant: "destructive" });
      }

      setBarcodeValue("");
      setTimeout(() => barcodeInputRef.current?.focus(), 100);
    },
    [addToBatch, toast]
  );

  const handleBarcodeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const now = Date.now();
      if (e.key === "Enter") {
        e.preventDefault();
        const value = barcodeValue.trim();
        if (value) {
          handleBarcodeScan(value);
        }
        scanBuffer.current = "";
        return;
      }

      if (e.key.length === 1) {
        const timeDiff = now - lastKeyTime.current;
        if (timeDiff > 200) {
          scanBuffer.current = "";
        }
        scanBuffer.current += e.key;
        lastKeyTime.current = now;
      }
    },
    [barcodeValue, handleBarcodeScan]
  );

  const updateQuantity = (productId: number, delta: number) => {
    setBatch((prev) =>
      prev
        .map((item) => {
          if (item.product.id !== productId) return item;
          const newQty = Math.max(1, item.quantity + delta);
          const diff = newQty - item.quantity;
          return {
            ...item,
            quantity: newQty,
            toLocal: Math.max(0, item.toLocal + diff),
          };
        })
    );
  };

  const setItemQuantity = (productId: number, qty: number) => {
    const newQty = Math.max(1, qty);
    setBatch((prev) =>
      prev.map((item) => {
        if (item.product.id !== productId) return item;
        const diff = newQty - item.quantity;
        return {
          ...item,
          quantity: newQty,
          toLocal: Math.max(0, item.toLocal + diff),
        };
      })
    );
  };

  const removeFromBatch = (productId: number) => {
    setBatch((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const updateDistribution = (
    productId: number,
    field: "toLocal" | "toOzon" | "toWb" | "toYandex",
    value: number
  ) => {
    setBatch((prev) =>
      prev.map((item) => {
        if (item.product.id !== productId) return item;
        return { ...item, [field]: Math.max(0, value) };
      })
    );
  };

  const getDistributionSum = (item: BatchItem) =>
    item.toLocal + item.toOzon + item.toWb + item.toYandex;

  const isDistributionValid = batch.every(
    (item) => getDistributionSum(item) === item.quantity
  );

  const totalItems = batch.reduce((sum, item) => sum + item.quantity, 0);
  const totalCost = batch.reduce(
    (sum, item) => sum + item.quantity * parseFloat(String(item.product.purchasePrice) || "0"),
    0
  );

  const createProductMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/products", data);
      return res.json();
    },
    onSuccess: (product: Product) => {
      qc.invalidateQueries({ queryKey: ["/api/products"] });
      addToBatch(product);
      setIsCreateModalOpen(false);
      toast({ title: "Товар создан", description: product.name });
      setTimeout(() => barcodeInputRef.current?.focus(), 100);
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка создания", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateProduct = () => {
    if (!newProductName.trim() || !newProductSku.trim()) {
      toast({ title: "Ошибка", description: "Название и артикул обязательны", variant: "destructive" });
      return;
    }

    createProductMutation.mutate({
      name: newProductName.trim(),
      sku: newProductSku.trim(),
      barcode: pendingBarcode,
      category: newProductCategory || null,
      purchasePrice: newProductPurchasePrice || "0",
      sellingPrice: newProductSellingPrice || "0",
      price: newProductSellingPrice || "0",
      stockQuantity: 0,
      stockLocal: 0,
      stockOzon: 0,
      stockWb: 0,
      stockYandex: 0,
      organizationId: "1",
      companyId: selectedCompanyId ? Number(selectedCompanyId) : null,
    });
  };

  const handleConfirmReceipt = async () => {
    if (batch.length === 0) return;

    if (!isDistributionValid) {
      toast({
        title: "Ошибка распределения",
        description: "Сумма распределения должна совпадать с количеством для каждого товара",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    let successCount = 0;
    let errorCount = 0;

    for (const item of batch) {
      try {
        await apiRequest("POST", "/api/stock-inflow", {
          productId: item.product.id,
          quantity: item.quantity,
          toLocal: item.toLocal,
          toOzon: item.toOzon,
          toWb: item.toWb,
          toYandex: item.toYandex,
          companyId: selectedCompanyId ? Number(selectedCompanyId) : null,
          organizationId: "1",
        });
        successCount++;
      } catch {
        errorCount++;
      }
    }

    setIsSubmitting(false);

    if (successCount > 0) {
      qc.invalidateQueries({ queryKey: ["/api/products"] });
      qc.invalidateQueries({ queryKey: ["/api/stock-inflow"] });
      qc.invalidateQueries({ queryKey: ["/api/kpi"] });
      setBatch([]);
      toast({
        title: "Приёмка завершена",
        description: `Оприходовано ${successCount} позиций${errorCount > 0 ? `, ошибок: ${errorCount}` : ""}`,
      });
    } else {
      toast({
        title: "Ошибка приёмки",
        description: "Не удалось оприходовать товары",
        variant: "destructive",
      });
    }

    setTimeout(() => barcodeInputRef.current?.focus(), 100);
  };

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight" data-testid="text-page-title">
              Приёмка товаров
            </h1>
            <p className="text-muted-foreground mt-2 text-lg">
              Сканируйте штрихкоды для быстрого оприходования
            </p>
          </div>
          <Button
            variant="outline"
            size="lg"
            data-testid="button-export-products"
            onClick={async () => {
              try {
                const res = await fetch("/api/export/products", { credentials: "include" });
                if (!res.ok) throw new Error("Ошибка экспорта");
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "products.xlsx";
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
              } catch {
                toast({ title: "Ошибка", description: "Не удалось экспортировать товары", variant: "destructive" });
              }
            }}
          >
            <FileSpreadsheet className="w-5 h-5 mr-2" />
            Экспорт товаров
          </Button>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
            <CardTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              Компания
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Select
              value={selectedCompanyId}
              onValueChange={setSelectedCompanyId}
            >
              <SelectTrigger data-testid="select-company" className="max-w-sm">
                <SelectValue placeholder={companiesLoading ? "Загрузка..." : "Выберите компанию"} />
              </SelectTrigger>
              <SelectContent>
                {companies?.map((company) => (
                  <SelectItem
                    key={company.id}
                    value={String(company.id)}
                    data-testid={`select-company-option-${company.id}`}
                  >
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card className="border-2 border-primary/30">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-3 text-primary">
                <ScanLine className="w-8 h-8" />
                <span className="text-xl font-semibold">Сканирование штрихкода</span>
              </div>
              <div className="relative w-full max-w-lg">
                <Barcode className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-muted-foreground" />
                <Input
                  ref={barcodeInputRef}
                  value={barcodeValue}
                  onChange={(e) => setBarcodeValue(e.target.value)}
                  onKeyDown={handleBarcodeKeyDown}
                  placeholder="Наведите сканер или введите штрихкод..."
                  className="pl-14 h-14 text-xl text-center font-mono tracking-widest"
                  autoFocus
                  data-testid="input-barcode"
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Сканер автоматически введёт код и нажмёт Enter
              </p>
            </div>
          </CardContent>
        </Card>

        {batch.length > 0 && (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
                <CardTitle className="flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  Партия на приёмку
                </CardTitle>
                <span className="counter-badge" data-testid="text-batch-count">
                  {totalItems} шт.
                </span>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-lg">Название</TableHead>
                        <TableHead className="text-lg">Артикул</TableHead>
                        <TableHead className="text-lg">Штрихкод</TableHead>
                        <TableHead className="text-center text-lg">Количество</TableHead>
                        <TableHead className="text-right text-lg">Закупка</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {batch.map((item) => (
                        <TableRow key={item.product.id} data-testid={`row-batch-item-${item.product.id}`}>
                          <TableCell className="font-medium" data-testid={`text-product-name-${item.product.id}`}>
                            {item.product.name}
                          </TableCell>
                          <TableCell className="font-mono font-bold text-lg" data-testid={`text-product-sku-${item.product.id}`}>
                            {item.product.sku}
                          </TableCell>
                          <TableCell className="font-mono font-bold text-lg" data-testid={`text-product-barcode-${item.product.id}`}>
                            {item.product.barcode || "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="outline"
                                size="icon"
                                className="min-h-12 min-w-12 text-lg"
                                onClick={() => updateQuantity(item.product.id, -1)}
                                disabled={item.quantity <= 1}
                                data-testid={`button-decrease-qty-${item.product.id}`}
                              >
                                <Minus className="w-4 h-4" />
                              </Button>
                              <Input
                                type="number"
                                min={1}
                                value={item.quantity}
                                onChange={(e) =>
                                  setItemQuantity(item.product.id, parseInt(e.target.value) || 1)
                                }
                                className="w-16 text-center font-mono"
                                data-testid={`input-qty-${item.product.id}`}
                              />
                              <Button
                                variant="outline"
                                size="icon"
                                className="min-h-12 min-w-12 text-lg"
                                onClick={() => updateQuantity(item.product.id, 1)}
                                data-testid={`button-increase-qty-${item.product.id}`}
                              >
                                <Plus className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="text-right" data-testid={`text-purchase-price-${item.product.id}`}>
                            {formatCurrency(item.product.purchasePrice)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeFromBatch(item.product.id)}
                              className="text-destructive"
                              data-testid={`button-remove-${item.product.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center justify-end gap-6 mt-4 pt-4 border-t">
                  <span className="text-muted-foreground">Итого:</span>
                  <span className="text-lg font-semibold" data-testid="text-batch-total">
                    {formatCurrency(totalCost)}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <CardTitle>Распределение по складам</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Укажите, сколько единиц направить на каждый склад / маркетплейс
                </p>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-lg">Товар</TableHead>
                        <TableHead className="text-center text-lg">Всего</TableHead>
                        <TableHead className="text-center text-lg">Склад</TableHead>
                        <TableHead className="text-center text-lg">Ozon</TableHead>
                        <TableHead className="text-center text-lg">Wildberries</TableHead>
                        <TableHead className="text-center text-lg">Yandex Market</TableHead>
                        <TableHead className="text-center text-lg">Сумма</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {batch.map((item) => {
                        const distSum = getDistributionSum(item);
                        const isValid = distSum === item.quantity;
                        return (
                          <TableRow key={item.product.id} data-testid={`row-distribution-${item.product.id}`}>
                            <TableCell className="font-medium">{item.product.name}</TableCell>
                            <TableCell className="text-center font-semibold">{item.quantity}</TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                value={item.toLocal}
                                onChange={(e) =>
                                  updateDistribution(item.product.id, "toLocal", parseInt(e.target.value) || 0)
                                }
                                className="w-20 text-center mx-auto"
                                data-testid={`input-dist-local-${item.product.id}`}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                value={item.toOzon}
                                onChange={(e) =>
                                  updateDistribution(item.product.id, "toOzon", parseInt(e.target.value) || 0)
                                }
                                className="w-20 text-center mx-auto"
                                data-testid={`input-dist-ozon-${item.product.id}`}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                value={item.toWb}
                                onChange={(e) =>
                                  updateDistribution(item.product.id, "toWb", parseInt(e.target.value) || 0)
                                }
                                className="w-20 text-center mx-auto"
                                data-testid={`input-dist-wb-${item.product.id}`}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                value={item.toYandex}
                                onChange={(e) =>
                                  updateDistribution(item.product.id, "toYandex", parseInt(e.target.value) || 0)
                                }
                                className="w-20 text-center mx-auto"
                                data-testid={`input-dist-yandex-${item.product.id}`}
                              />
                            </TableCell>
                            <TableCell className="text-center">
                              <span
                                className={`font-semibold ${isValid ? "text-green-600 dark:text-green-400" : "text-destructive"}`}
                                data-testid={`text-dist-sum-${item.product.id}`}
                              >
                                {distSum} / {item.quantity}
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button
                size="lg"
                className="premium-button h-14 text-lg"
                onClick={handleConfirmReceipt}
                disabled={isSubmitting || !isDistributionValid || batch.length === 0}
                data-testid="button-confirm-receipt"
              >
                {isSubmitting ? (
                  "Оприходование..."
                ) : (
                  <>
                    <Check className="w-5 h-5 mr-2" />
                    Подтвердить приёмку
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </div>

      <Dialog open={isCreateModalOpen} onOpenChange={(open) => {
        setIsCreateModalOpen(open);
        if (!open) setTimeout(() => barcodeInputRef.current?.focus(), 100);
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Новый товар</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="new-name">Название</Label>
              <Input
                id="new-name"
                value={newProductName}
                onChange={(e) => setNewProductName(e.target.value)}
                placeholder="Введите название товара"
                data-testid="input-new-product-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="new-sku">Артикул (SKU)</Label>
                <Input
                  id="new-sku"
                  value={newProductSku}
                  onChange={(e) => setNewProductSku(e.target.value)}
                  placeholder="SKU-001"
                  data-testid="input-new-product-sku"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new-barcode">Штрихкод</Label>
                <Input
                  id="new-barcode"
                  value={pendingBarcode}
                  readOnly
                  className="bg-muted font-mono"
                  data-testid="input-new-product-barcode"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Категория</Label>
              <Select value={newProductCategory} onValueChange={setNewProductCategory}>
                <SelectTrigger data-testid="select-new-product-category">
                  <SelectValue placeholder="Выберите категорию" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="new-purchase-price">Цена закупки</Label>
                <Input
                  id="new-purchase-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={newProductPurchasePrice}
                  onChange={(e) => setNewProductPurchasePrice(e.target.value)}
                  placeholder="0"
                  data-testid="input-new-product-purchase-price"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new-selling-price">Цена продажи</Label>
                <Input
                  id="new-selling-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={newProductSellingPrice}
                  onChange={(e) => setNewProductSellingPrice(e.target.value)}
                  placeholder="0"
                  data-testid="input-new-product-selling-price"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateModalOpen(false)}
              data-testid="button-cancel-create-product"
            >
              Отмена
            </Button>
            <Button
              className="premium-button"
              onClick={handleCreateProduct}
              disabled={createProductMutation.isPending}
              data-testid="button-save-new-product"
            >
              {createProductMutation.isPending ? "Создание..." : "Создать и добавить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
