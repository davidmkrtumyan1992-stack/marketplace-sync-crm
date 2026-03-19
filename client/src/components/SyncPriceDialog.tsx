import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Store } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ProductStoreStatus } from "@shared/schema";

interface SyncResult {
  storeId: number;
  storeName: string;
  marketplace: string;
  success: boolean;
  error?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  productId: number;
  newPrice: number;
}

function marketplaceColor(mp: string): string {
  if (mp === "ozon") return "bg-blue-500";
  if (mp === "wildberries") return "bg-purple-500";
  if (mp === "yandex") return "bg-yellow-400";
  return "bg-gray-400";
}

function storeStatusLabel(s: ProductStoreStatus): { label: string; canSync: boolean } {
  if (!s.isConnected) return { label: "⚠️ Не подключён", canSync: false };
  if (!s.hasProduct) return { label: "○ Товара нет на МП", canSync: false };
  return { label: "✓ Готов", canSync: true };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

export function SyncPriceDialog({ open, onClose, productId, newPrice }: Props) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [syncResults, setSyncResults] = useState<SyncResult[] | null>(null);

  const { data: stores = [], isLoading } = useQuery<ProductStoreStatus[]>({
    queryKey: [`/api/products/${productId}/stores`],
    enabled: open,
  });

  const syncMutation = useMutation({
    mutationFn: async (storeIds: number[]) => {
      const res = await apiRequest("POST", `/api/products/${productId}/sync-price`, {
        storeIds,
        price: newPrice,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Ошибка синхронизации" }));
        throw new Error(err.message);
      }
      return res.json() as Promise<{ results: SyncResult[] }>;
    },
    onSuccess: (data) => {
      setSyncResults(data.results);
      const failCount = data.results.filter(r => !r.success).length;
      const successCount = data.results.filter(r => r.success).length;
      if (failCount === 0) {
        toast({ title: "Синхронизация завершена", description: `Цена обновлена в ${successCount} магазинах` });
      } else {
        toast({
          title: "Частичная синхронизация",
          description: `Успешно: ${successCount}, ошибок: ${failCount}`,
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => {
      toast({ title: "Ошибка синхронизации", description: err.message, variant: "destructive" });
    },
  });

  const canSyncStores = stores.filter(s => s.isConnected && s.hasProduct);

  const toggleStore = (storeId: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(storeId)) next.delete(storeId);
      else next.add(storeId);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selected.size === canSyncStores.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(canSyncStores.map(s => s.storeId)));
    }
  };

  const handleSync = () => {
    if (selected.size === 0) return;
    setSyncResults(null);
    syncMutation.mutate(Array.from(selected));
  };

  const handleClose = () => {
    setSyncResults(null);
    setSelected(new Set());
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md w-[95vw]" data-testid="sync-price-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="w-5 h-5" />
            Синхронизировать цену
          </DialogTitle>
          <DialogDescription>
            Новая цена: <span className="font-semibold text-foreground">{newPrice.toLocaleString("ru-RU")} ₽</span>.
            Выберите магазины для обновления.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : stores.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <AlertTriangle className="w-4 h-4" />
              Нет подключённых магазинов
            </div>
          ) : (
            <>
              {canSyncStores.length > 1 && !syncResults && (
                <button
                  className="text-xs text-primary hover:underline mb-1"
                  onClick={handleSelectAll}
                  data-testid="sync-select-all"
                >
                  {selected.size === canSyncStores.length ? "Снять все" : "Выбрать все"}
                </button>
              )}

              <div className="space-y-2">
                {stores.map(store => {
                  const { label, canSync } = storeStatusLabel(store);
                  const result = syncResults?.find(r => r.storeId === store.storeId);

                  return (
                    <div
                      key={store.storeId}
                      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                        canSync && !syncResults
                          ? selected.has(store.storeId)
                            ? "border-primary/50 bg-primary/5"
                            : "border-border hover:bg-muted/30"
                          : "border-border/50 bg-muted/20 opacity-70"
                      }`}
                      data-testid={`sync-store-row-${store.storeId}`}
                    >
                      <div className="pt-0.5">
                        {syncResults ? (
                          result?.success ? (
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                          ) : (
                            <XCircle className="w-4 h-4 text-destructive" />
                          )
                        ) : (
                          <Checkbox
                            checked={selected.has(store.storeId)}
                            disabled={!canSync}
                            onCheckedChange={() => canSync && toggleStore(store.storeId)}
                            data-testid={`sync-store-check-${store.storeId}`}
                          />
                        )}
                      </div>

                      <div className="flex items-center gap-2 pt-0.5">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${marketplaceColor(store.marketplace)}`} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{store.storeName}</div>
                        <div className={`text-xs mt-0.5 ${!canSync ? "text-muted-foreground" : "text-muted-foreground"}`}>
                          {syncResults && result ? (
                            result.success ? "✓ Успех" : `✗ ${result.error || "Ошибка"}`
                          ) : (
                            <>
                              <span>{label}</span>
                              {store.lastSyncAt && (
                                <span className="ml-2 opacity-60">· {formatDate(store.lastSyncAt)}</span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          {!syncResults ? (
            <>
              <Button variant="outline" onClick={handleClose} className="flex-1" data-testid="sync-price-cancel">
                Пропустить
              </Button>
              <Button
                onClick={handleSync}
                disabled={selected.size === 0 || syncMutation.isPending}
                className="flex-1"
                data-testid="sync-price-submit"
              >
                {syncMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Отправляем…</>
                ) : (
                  `Синхронизировать (${selected.size})`
                )}
              </Button>
            </>
          ) : (
            <Button onClick={handleClose} className="w-full" data-testid="sync-price-done">
              Закрыть
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
