import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import type { Product } from "@shared/schema";
import { useState, useRef, useCallback, useEffect } from "react";
import { Barcode, ScanLine, MinusCircle, Plus, Minus, Trash2, Check } from "lucide-react";
import { useDraftQueue } from "@/contexts/DraftQueueContext";

const WRITEOFF_REASONS = [
  "Брак",
  "Истёк срок годности",
  "Повреждение",
  "Хищение",
  "Инвентаризация",
  "Прочее",
];

interface BatchItem {
  product: Product;
  quantity: number;
  reason: string;
  notes: string;
}

export default function Writeoff() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const lastKeyTime = useRef<number>(0);
  const scanBuffer = useRef<string>("");

  const [barcodeValue, setBarcodeValue] = useState("");
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [globalReason, setGlobalReason] = useState("");
  const [globalNotes, setGlobalNotes] = useState("");

  const { writeoffs, clearWriteoffs } = useDraftQueue();

  useEffect(() => {
    barcodeInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (writeoffs.length === 0) return;
    const drafts = writeoffs;
    clearWriteoffs();
    setBatch(prev => {
      const merged = [...prev];
      for (const d of drafts) {
        const idx = merged.findIndex(item => item.product.id === d.product.id);
        if (idx >= 0) {
          merged[idx] = { ...merged[idx], quantity: merged[idx].quantity + d.quantity };
        } else {
          merged.push({ product: d.product, quantity: d.quantity, reason: d.reason, notes: "" });
        }
      }
      return merged;
    });
    toast({
      title: `Загружено ${drafts.length} ${drafts.length === 1 ? "товар" : drafts.length < 5 ? "товара" : "товаров"} из карточек`,
      description: "Проверьте список и нажмите «Подтвердить списание»",
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addToBatch = useCallback((product: Product) => {
    setBatch((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { product, quantity: 1, reason: globalReason, notes: globalNotes }];
    });
  }, [globalReason, globalNotes]);

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
          if ((product.centralStock || 0) === 0) {
            toast({ title: "Остаток 0", description: `«${product.name}» — на складе 0 штук, списание невозможно`, variant: "destructive" });
          } else {
            addToBatch(product);
            toast({ title: "Товар найден", description: product.name });
          }
        } else if (res.status === 404) {
          toast({ title: "Товар не найден", description: `Штрихкод «${trimmed}» не найден в базе`, variant: "destructive" });
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
        if (value) handleBarcodeScan(value);
        scanBuffer.current = "";
        return;
      }
      if (e.key.length === 1) {
        const timeDiff = now - lastKeyTime.current;
        if (timeDiff > 200) scanBuffer.current = "";
        scanBuffer.current += e.key;
        lastKeyTime.current = now;
      }
    },
    [barcodeValue, handleBarcodeScan]
  );

  const updateQuantity = (productId: number, delta: number) => {
    setBatch((prev) =>
      prev.map((item) => {
        if (item.product.id !== productId) return item;
        const max = item.product.centralStock || 1;
        const newQty = Math.min(max, Math.max(1, item.quantity + delta));
        return { ...item, quantity: newQty };
      })
    );
  };

  const setItemQuantity = (productId: number, qty: number) => {
    setBatch((prev) =>
      prev.map((item) => {
        if (item.product.id !== productId) return item;
        const max = item.product.centralStock || 1;
        return { ...item, quantity: Math.min(max, Math.max(1, qty)) };
      })
    );
  };

  const setItemReason = (productId: number, reason: string) => {
    setBatch((prev) => prev.map((item) => item.product.id === productId ? { ...item, reason } : item));
  };

  const removeFromBatch = (productId: number) => {
    setBatch((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const totalItems = batch.reduce((sum, item) => sum + item.quantity, 0);

  const handleConfirmWriteoff = async () => {
    if (batch.length === 0) return;

    const missingReason = batch.find((item) => !item.reason);
    if (missingReason) {
      toast({ title: "Укажите причину", description: `Не указана причина для «${missingReason.product.name}»`, variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    let successCount = 0, errorCount = 0, totalStoresSynced = 0;
    const syncErrors: string[] = [];

    for (const item of batch) {
      try {
        const res = await apiRequest("POST", "/api/stock-writeoff", {
          productId: item.product.id,
          quantity: item.quantity,
          reason: item.reason,
          notes: item.notes || undefined,
        });
        const data = await res.json();
        if (!res.ok) {
          const msg = data?.message || data?.error || `HTTP ${res.status}`;
          syncErrors.push(`${item.product.name}: ${msg}`);
          errorCount++;
          continue;
        }
        successCount++;
        const results: any[] = data.syncResults ?? [];
        totalStoresSynced += results.filter((r: any) => r.status === "success").length;
        results.filter((r: any) => r.status === "fail")
          .forEach((r: any) => syncErrors.push(`${r.storeName}: ${r.error}`));
      } catch (e: any) {
        syncErrors.push(`${item.product.name}: ${e.message || "Неизвестная ошибка"}`);
        errorCount++;
      }
    }

    setIsSubmitting(false);

    if (successCount > 0) {
      qc.invalidateQueries({ queryKey: ["/api/products"] });
      qc.invalidateQueries({ queryKey: ["/api/kpi"] });
      setBatch([]);
      setGlobalReason("");
      setGlobalNotes("");
      let description = `Списано ${successCount} позиций`;
      if (totalStoresSynced > 0) description += `, остатки обновлены в ${totalStoresSynced} магазинах`;
      if (errorCount > 0) description += `, ошибок: ${errorCount}`;
      toast({ title: "Списание завершено", description });
      if (syncErrors.length > 0)
        toast({ title: "Ошибки синхронизации", description: syncErrors.slice(0, 3).join("; "), variant: "destructive" });
    } else {
      toast({ title: "Ошибка списания", description: syncErrors[0] || "Не удалось списать товары", variant: "destructive" });
    }

    setTimeout(() => barcodeInputRef.current?.focus(), 100);
  };

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Списание товаров</h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Сканируйте штрихкоды, укажите причину — остатки обновятся на всех маркетплейсах
          </p>
        </div>

        <Card className="border-2 border-destructive/30">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-3 text-destructive">
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
                />
              </div>
              <p className="text-sm text-muted-foreground">Сканер автоматически введёт код и нажмёт Enter</p>
            </div>
          </CardContent>
        </Card>

        {batch.length === 0 && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <p className="text-sm font-medium text-muted-foreground">Причина и примечание по умолчанию (для новых товаров в партии):</p>
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1 space-y-1">
                  <Label>Причина списания</Label>
                  <Select value={globalReason} onValueChange={setGlobalReason}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите причину" />
                    </SelectTrigger>
                    <SelectContent>
                      {WRITEOFF_REASONS.map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 space-y-1">
                  <Label>Примечание (необязательно)</Label>
                  <Input value={globalNotes} onChange={(e) => setGlobalNotes(e.target.value)} placeholder="Комментарий..." />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {batch.length > 0 && (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
                <CardTitle className="flex items-center gap-2">
                  <MinusCircle className="w-5 h-5 text-destructive" />
                  Партия на списание
                </CardTitle>
                <span className="counter-badge">{totalItems} шт.</span>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-lg">Название</TableHead>
                        <TableHead className="text-lg">Артикул</TableHead>
                        <TableHead className="text-center text-lg">Остаток</TableHead>
                        <TableHead className="text-center text-lg">Списать</TableHead>
                        <TableHead className="text-lg min-w-[160px]">Причина *</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {batch.map((item) => (
                        <TableRow key={item.product.id}>
                          <TableCell className="font-medium">{item.product.name}</TableCell>
                          <TableCell className="font-mono font-bold text-lg">{item.product.sku}</TableCell>
                          <TableCell className="text-center">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                              {item.product.centralStock || 0} шт.
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="outline"
                                size="icon"
                                className="min-h-10 min-w-10"
                                onClick={() => updateQuantity(item.product.id, -1)}
                                disabled={item.quantity <= 1}
                              >
                                <Minus className="w-4 h-4" />
                              </Button>
                              <Input
                                type="number"
                                min={1}
                                max={item.product.centralStock || 1}
                                value={item.quantity}
                                onChange={(e) => setItemQuantity(item.product.id, parseInt(e.target.value) || 1)}
                                className="w-16 text-center font-mono"
                              />
                              <Button
                                variant="outline"
                                size="icon"
                                className="min-h-10 min-w-10"
                                onClick={() => updateQuantity(item.product.id, 1)}
                                disabled={item.quantity >= (item.product.centralStock || 1)}
                              >
                                <Plus className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Select value={item.reason} onValueChange={(v) => setItemReason(item.product.id, v)}>
                              <SelectTrigger className={!item.reason ? "border-destructive" : ""}>
                                <SelectValue placeholder="Выберите..." />
                              </SelectTrigger>
                              <SelectContent>
                                {WRITEOFF_REASONS.map((r) => (
                                  <SelectItem key={r} value={r}>{r}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeFromBatch(item.product.id)}
                              className="text-destructive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button
                size="lg"
                variant="destructive"
                className="min-h-14 text-lg px-10"
                onClick={handleConfirmWriteoff}
                disabled={isSubmitting || batch.length === 0}
              >
                {isSubmitting ? (
                  <>Списание...</>
                ) : (
                  <>
                    <Check className="w-5 h-5 mr-2" />
                    Списать со склада ({totalItems} шт.)
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
