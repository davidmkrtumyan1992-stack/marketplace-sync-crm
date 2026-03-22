import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Package, Printer, List, XCircle, Truck, CheckCircle, ChevronDown, ChevronUp, Store } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { formatCurrency } from "@/lib/format";
import { apiRequest } from "@/lib/queryClient";

const WB_COLOR = "#7631ff";

const WB_TABS = [
  { key: "new",       label: "Новые",       icon: Package },
  { key: "assembly",  label: "На сборке",   icon: Package },
  { key: "delivery",  label: "В доставке",  icon: Truck },
  { key: "archive",   label: "Архив",       icon: CheckCircle },
  { key: "cancelled", label: "Отменённые",  icon: XCircle },
] as const;

type WbTab = (typeof WB_TABS)[number]["key"];

function WbStatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    new: "Новый", waiting: "Ожидает",
    complete: "Выполнен", indelivery: "В доставке", delivering: "Доставляется", delivered: "Доставлен",
    cancel: "Отменён", user_cancel: "Отменён клиентом", declined: "Отклонён",
  };
  const label = labels[status] || status;
  const isCancel = ["cancel", "user_cancel", "declined"].includes(status);
  const isDelivered = ["delivered", "complete", "indelivery", "delivering"].includes(status);
  return (
    <Badge
      variant="outline"
      className={isCancel
        ? "border-red-300 text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-300"
        : isDelivered
          ? "border-green-300 text-green-700 bg-green-50 dark:bg-green-900/20 dark:text-green-300"
          : "border-violet-300 text-violet-700 bg-violet-50 dark:bg-violet-900/20 dark:text-violet-300"}
    >
      {label}
    </Badge>
  );
}

function ProductPhoto({ imageUrl, sku }: { imageUrl: string | null; sku: string }) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={sku}
        className="w-10 h-10 object-cover rounded"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded bg-muted flex items-center justify-center text-muted-foreground">
      <Package className="w-5 h-5" />
    </div>
  );
}

function SupplyCard({
  supplyId,
  orders,
  storeId,
  storeName,
  onClose,
}: {
  supplyId: string;
  orders: any[];
  storeId: number | null;
  storeName: string;
  onClose: (supplyId: string, storeId: number | null) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [printingStickers, setPrintingStickers] = useState(false);
  const [printingList, setPrintingList] = useState(false);
  const [closingSupply, setClosingSupply] = useState(false);

  const createdAt = orders[0]?.created_at ? new Date(orders[0].created_at) : new Date();

  const handlePrintStickers = async () => {
    setPrintingStickers(true);
    try {
      const wbOrderIds = orders.map((o: any) => Number(o.wb_order_id)).filter(Boolean);
      if (wbOrderIds.length === 0) {
        toast({ title: "Нет заказов с WB ID", variant: "destructive" });
        return;
      }
      const data = await apiRequest("POST", "/api/wb/stickers", { storeId, wbOrderIds });
      const result = await data.json();
      const stickers: { orderId: number; file: string }[] = result.stickers || [];
      if (stickers.length === 0) {
        toast({ title: "Стикеры не получены от WB API", variant: "destructive" });
        return;
      }
      const printHTML = `<html><head><style>
        @page { size: 58mm 40mm; margin: 0; }
        body { margin: 0; padding: 0; }
        img { width: 58mm; height: 40mm; display: block; page-break-after: always; }
      </style></head><body>
        ${stickers.map((s) => `<img src="data:image/png;base64,${s.file}" />`).join("")}
      </body></html>`;
      const win = window.open("", "_blank");
      if (win) {
        win.document.write(printHTML);
        win.document.close();
        win.print();
        win.close();
      }
    } catch (e: any) {
      toast({ title: "Ошибка печати стикеров", description: e.message, variant: "destructive" });
    } finally {
      setPrintingStickers(false);
    }
  };

  const handlePickingList = async () => {
    setPrintingList(true);
    try {
      const res = await fetch(`/api/wb/supplies/${supplyId}/picking-list`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: `Ошибка сервера (${res.status})` }));
        toast({ title: "Ошибка листа подбора", description: err.message, variant: "destructive" });
        return;
      }
      const data = await res.json();
      const items: any[] = data.items || [];
      const rows = items.map((item: any) => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">
            ${item.imageUrl ? `<img src="${item.imageUrl}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;" />` : `<div style="width:40px;height:40px;background:#f3f4f6;border-radius:4px;"></div>`}
          </td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-family:monospace;">${item.sku || "—"}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${item.productName || "WB товар"}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-family:monospace;">${item.barcode || "—"}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:600;">${item.quantity}</td>
        </tr>
      `).join("");
      const printHTML = `<html><head><style>
        @page { margin: 20mm; }
        body { font-family: Arial, sans-serif; font-size: 12px; color: #111; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        h2 { font-size: 13px; color: #666; margin-bottom: 16px; font-weight: normal; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f3f4f6; padding: 8px; text-align: left; border-bottom: 2px solid #d1d5db; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
      </style></head><body>
        <h1>Лист подбора — ${supplyId}</h1>
        <h2>${storeName} · ${format(createdAt, "d MMMM yyyy", { locale: ru })}</h2>
        <table>
          <thead><tr>
            <th>Фото</th><th>Артикул</th><th>Название</th><th>Штрихкод</th><th>Кол-во</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </body></html>`;
      const win = window.open("", "_blank");
      if (win) {
        win.document.write(printHTML);
        win.document.close();
        win.print();
        win.close();
      }
    } catch (e: any) {
      toast({ title: "Ошибка листа подбора", description: e.message, variant: "destructive" });
    } finally {
      setPrintingList(false);
    }
  };

  const handleClose = async () => {
    setClosingSupply(true);
    try {
      await onClose(supplyId, storeId);
    } finally {
      setClosingSupply(false);
    }
  };

  return (
    <Card className="mb-4 border-violet-200 dark:border-violet-900/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base font-semibold" data-testid={`text-supply-id-${supplyId}`}>
              Поставка {supplyId}
            </CardTitle>
            <Badge variant="outline" className="border-violet-300 text-violet-700 dark:text-violet-300">
              {orders.length} {orders.length === 1 ? "заказ" : orders.length < 5 ? "заказа" : "заказов"}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {format(createdAt, "d MMM yyyy", { locale: ru })}
            </span>
            {storeName && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Store className="w-3 h-3" />{storeName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={handlePrintStickers}
              disabled={printingStickers}
              style={{ borderColor: WB_COLOR, color: WB_COLOR }}
              data-testid={`button-print-stickers-${supplyId}`}
            >
              {printingStickers ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Printer className="w-3.5 h-3.5 mr-1.5" />}
              Печать стикеров
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handlePickingList}
              disabled={printingList}
              style={{ borderColor: WB_COLOR, color: WB_COLOR }}
              data-testid={`button-picking-list-${supplyId}`}
            >
              {printingList ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <List className="w-3.5 h-3.5 mr-1.5" />}
              Лист подбора
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleClose}
              disabled={closingSupply}
              className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400"
              data-testid={`button-close-supply-${supplyId}`}
            >
              {closingSupply ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5 mr-1.5" />}
              Закрыть поставку
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded(!expanded)}
              data-testid={`button-expand-supply-${supplyId}`}
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Фото</TableHead>
                <TableHead>Артикул</TableHead>
                <TableHead>Название</TableHead>
                <TableHead>Цена</TableHead>
                <TableHead>WB статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order: any) => (
                <TableRow key={order.id} data-testid={`row-wb-assembly-order-${order.id}`}>
                  <TableCell>
                    <ProductPhoto imageUrl={order.image_url} sku={order.sku || ""} />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{order.sku || "—"}</TableCell>
                  <TableCell className="max-w-xs truncate">{order.product_name || "WB товар"}</TableCell>
                  <TableCell>{formatCurrency(Number(order.total_amount))}</TableCell>
                  <TableCell><WbStatusBadge status={order.wb_status || "new"} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      )}
    </Card>
  );
}

function CreateSupplyDialog({
  open,
  onClose,
  selectedOrders,
  storeId,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  selectedOrders: any[];
  storeId: number | null;
  onSuccess: (supplyId: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const createSupply = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/wb/supplies", {
        storeId,
        orderIds: selectedOrders.map((o: any) => o.id),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Ошибка создания поставки" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: `✓ Поставка ${data.supplyId} создана`,
        description: `${data.ordersAdded} заказов добавлено`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wb/orders"] });
      onSuccess(data.supplyId);
      onClose();
    },
    onError: (e: any) => {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg" data-testid="dialog-create-supply">
        <DialogHeader>
          <DialogTitle>Создать поставку WB</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-80 overflow-y-auto">
          <p className="text-sm text-muted-foreground">
            Выбрано {selectedOrders.length} заказ{selectedOrders.length === 1 ? "" : selectedOrders.length < 5 ? "а" : "ов"} для поставки:
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Артикул</TableHead>
                <TableHead>Название</TableHead>
                <TableHead>Сумма</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {selectedOrders.map((order: any) => (
                <TableRow key={order.id} data-testid={`row-supply-dialog-order-${order.id}`}>
                  <TableCell className="font-mono text-sm">{order.sku || "—"}</TableCell>
                  <TableCell className="max-w-xs truncate text-sm">{order.product_name || "WB товар"}</TableCell>
                  <TableCell>{formatCurrency(Number(order.total_amount))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-create-supply">
            Отмена
          </Button>
          <Button
            onClick={() => createSupply.mutate()}
            disabled={createSupply.isPending}
            style={{ backgroundColor: WB_COLOR }}
            className="text-white"
            data-testid="button-confirm-create-supply"
          >
            {createSupply.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Создать поставку
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function WildberriesOrders({ storeId }: { storeId?: number | null }) {
  const [activeTab, setActiveTab] = useState<WbTab>("new");
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<number>>(new Set());
  const [showCreateSupply, setShowCreateSupply] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: orders = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/wb/orders", activeTab, storeId],
    queryFn: async () => {
      const params = new URLSearchParams({ status: activeTab });
      if (storeId) params.set("storeId", String(storeId));
      const res = await fetch(`/api/wb/orders?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Ошибка загрузки заказов WB");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const selectedOrders = orders.filter((o: any) => selectedOrderIds.has(o.id));
  const selectedStoreId = selectedOrders[0]?.store_id || storeId || null;

  const assemblyGroups = useMemo(() => {
    if (activeTab !== "assembly") return {};
    const groups: Record<string, { orders: any[]; storeId: number | null; storeName: string }> = {};
    for (const order of orders) {
      const sid = order.wb_supply_id || "unknown";
      if (!groups[sid]) {
        groups[sid] = { orders: [], storeId: order.store_id || null, storeName: order.store_name || order.source_store_name || "" };
      }
      groups[sid].orders.push(order);
    }
    return groups;
  }, [orders, activeTab]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedOrderIds(new Set(orders.map((o: any) => o.id)));
    } else {
      setSelectedOrderIds(new Set());
    }
  };

  const handleSelectOrder = (id: number, checked: boolean) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleCloseSupply = async (supplyId: string, supplyStoreId: number | null) => {
    try {
      const res = await apiRequest("POST", `/api/wb/supplies/${supplyId}/close`, {
        storeId: supplyStoreId,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Ошибка закрытия поставки" }));
        throw new Error(err.message);
      }
      toast({ title: `✓ Поставка ${supplyId} закрыта` });
      queryClient.invalidateQueries({ queryKey: ["/api/wb/orders"] });
      refetch();
    } catch (e: any) {
      toast({ title: "Ошибка закрытия поставки", description: e.message, variant: "destructive" });
    }
  };

  const handleSupplyCreated = () => {
    setSelectedOrderIds(new Set());
    setActiveTab("assembly");
    refetch();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="wb-orders-loading">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="wb-orders-container">
      {/* Вкладки */}
      <div className="flex gap-1 p-1 bg-muted/50 rounded-xl border" data-testid="wb-fbs-tabs">
        {WB_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                setSelectedOrderIds(new Set());
              }}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
                isActive ? "text-white shadow-sm" : "hover:bg-muted text-muted-foreground"
              }`}
              style={isActive ? { backgroundColor: WB_COLOR } : {}}
              data-testid={`tab-wb-${tab.key}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Вкладка НОВЫЕ */}
      {activeTab === "new" && (
        <div className="relative">
          <div className="rounded-xl border overflow-hidden" data-testid="wb-new-orders-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={orders.length > 0 && selectedOrderIds.size === orders.length}
                      onCheckedChange={(c) => handleSelectAll(!!c)}
                      data-testid="checkbox-select-all-wb"
                    />
                  </TableHead>
                  <TableHead>Фото</TableHead>
                  <TableHead>Артикул</TableHead>
                  <TableHead>Название</TableHead>
                  <TableHead>Сумма</TableHead>
                  <TableHead>Дата заказа</TableHead>
                  <TableHead>Магазин</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                      Нет новых заказов WB
                    </TableCell>
                  </TableRow>
                ) : orders.map((order: any) => (
                  <TableRow
                    key={order.id}
                    className={selectedOrderIds.has(order.id) ? "bg-violet-50 dark:bg-violet-900/10" : ""}
                    data-testid={`row-wb-new-order-${order.id}`}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedOrderIds.has(order.id)}
                        onCheckedChange={(c) => handleSelectOrder(order.id, !!c)}
                        data-testid={`checkbox-wb-order-${order.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <ProductPhoto imageUrl={order.image_url} sku={order.sku || ""} />
                    </TableCell>
                    <TableCell className="font-mono text-sm">{order.sku || "—"}</TableCell>
                    <TableCell className="max-w-xs">
                      <div className="truncate">{order.product_name || "WB товар"}</div>
                    </TableCell>
                    <TableCell>{formatCurrency(Number(order.total_amount))}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {order.created_at ? format(new Date(order.created_at), "d MMM yyyy", { locale: ru }) : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {order.store_name || order.source_store_name || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Sticky панель */}
          {selectedOrderIds.size > 0 && (
            <div
              className="sticky bottom-4 mt-4 flex items-center justify-between gap-4 px-4 py-3 rounded-xl shadow-lg border"
              style={{ backgroundColor: WB_COLOR, borderColor: WB_COLOR }}
              data-testid="wb-sticky-supply-panel"
            >
              <span className="text-white font-medium">
                Выбрано {selectedOrderIds.size} заказ{selectedOrderIds.size === 1 ? "" : selectedOrderIds.size < 5 ? "а" : "ов"}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowCreateSupply(true)}
                data-testid="button-create-supply"
              >
                <Package className="w-4 h-4 mr-1.5" />
                Создать поставку
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Вкладка НА СБОРКЕ */}
      {activeTab === "assembly" && (
        <div data-testid="wb-assembly-supplies">
          {Object.keys(assemblyGroups).length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              Нет активных поставок
            </div>
          ) : (
            Object.entries(assemblyGroups).map(([sid, group]) => (
              <SupplyCard
                key={sid}
                supplyId={sid}
                orders={group.orders}
                storeId={group.storeId}
                storeName={group.storeName}
                onClose={handleCloseSupply}
              />
            ))
          )}
        </div>
      )}

      {/* Вкладки В ДОСТАВКЕ / АРХИВ / ОТМЕНЁННЫЕ */}
      {(activeTab === "delivery" || activeTab === "archive" || activeTab === "cancelled") && (
        <div className="rounded-xl border overflow-hidden" data-testid={`wb-orders-table-${activeTab}`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Фото</TableHead>
                <TableHead>Артикул</TableHead>
                <TableHead>Название</TableHead>
                <TableHead>Сумма</TableHead>
                <TableHead>Статус WB</TableHead>
                <TableHead>Поставка</TableHead>
                <TableHead>Дата</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                    Нет заказов в этой категории
                  </TableCell>
                </TableRow>
              ) : orders.map((order: any) => (
                <TableRow key={order.id} data-testid={`row-wb-${activeTab}-order-${order.id}`}>
                  <TableCell>
                    <ProductPhoto imageUrl={order.image_url} sku={order.sku || ""} />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{order.sku || "—"}</TableCell>
                  <TableCell className="max-w-xs">
                    <div className="truncate">{order.product_name || "WB товар"}</div>
                  </TableCell>
                  <TableCell>{formatCurrency(Number(order.total_amount))}</TableCell>
                  <TableCell><WbStatusBadge status={order.wb_status || "new"} /></TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {order.wb_supply_id || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {order.created_at ? format(new Date(order.created_at), "d MMM yyyy", { locale: ru }) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Диалог создания поставки */}
      <CreateSupplyDialog
        open={showCreateSupply}
        onClose={() => setShowCreateSupply(false)}
        selectedOrders={selectedOrders}
        storeId={selectedStoreId}
        onSuccess={handleSupplyCreated}
      />
    </div>
  );
}
