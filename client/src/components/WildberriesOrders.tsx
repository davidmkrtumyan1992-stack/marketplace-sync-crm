import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Loader2, Package, PackageSearch, Printer, FileText, FileSpreadsheet,
  XCircle, Truck, CheckCircle, MoreHorizontal, AlertTriangle,
  RefreshCw, QrCode,
} from "lucide-react";
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

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffH = Math.floor(diffMs / 3600000);
  const diffM = Math.floor((diffMs % 3600000) / 60000);
  if (diffH >= 24) {
    const days = Math.floor(diffH / 24);
    return `${days} д назад`;
  }
  if (diffH > 0) return `${diffH} ч ${diffM} мин назад`;
  return `${diffM} мин назад`;
}

function pluralOrders(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return `${n} заказов`;
  if (mod10 === 1) return `${n} заказ`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} заказа`;
  return `${n} заказов`;
}

function pluralSupplies(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return `${n} поставок`;
  if (mod10 === 1) return `${n} поставка`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} поставки`;
  return `${n} поставок`;
}

function EmptyState({ text = "У вас пока нет заказов в этом статусе" }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3" data-testid="wb-empty-state">
      <PackageSearch className="w-12 h-12 opacity-40" />
      <span className="text-sm">{text}</span>
    </div>
  );
}

function ProductPhoto({ imageUrl, sku, size = 40 }: { imageUrl?: string | null; sku: string; size?: number }) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={sku}
        className="object-cover rounded flex-shrink-0"
        style={{ width: size, height: size }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    );
  }
  return (
    <div className="rounded bg-muted flex items-center justify-center text-muted-foreground flex-shrink-0" style={{ width: size, height: size }}>
      <Package className="w-5 h-5" />
    </div>
  );
}

function OrderNumCell({ order }: { order: any }) {
  const num = order.order_number || order.wb_order_id || String(order.id);
  const ago = timeAgo(order.created_at);
  return (
    <div className="flex flex-col gap-1 min-w-[120px]">
      <span className="font-semibold text-sm">{num}</span>
      {order.created_at && (
        <span className="text-xs text-muted-foreground">
          {format(new Date(order.created_at), "d MMM, HH:mm", { locale: ru })}
        </span>
      )}
      <div className="flex gap-1 flex-wrap">
        {ago && (
          <Badge className="text-[10px] px-1.5 py-0 h-4 bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 font-normal">
            {ago}
          </Badge>
        )}
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal text-muted-foreground">
          МГТ
        </Badge>
      </div>
    </div>
  );
}

function ProductCell({ order }: { order: any }) {
  return (
    <div className="flex items-center gap-3 min-w-[180px]">
      <ProductPhoto imageUrl={order.image_url} sku={order.sku || ""} size={48} />
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-medium truncate max-w-[200px]">{order.product_name || "WB товар"}</span>
        <span className="text-xs text-muted-foreground truncate">
          {[order.sku].filter(Boolean).join(" / ") || "—"}
        </span>
      </div>
    </div>
  );
}

function WarehouseCell({ order }: { order: any }) {
  const name = order.store_name || order.source_store_name || "—";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm">Мой склад</span>
      <span className="text-xs text-muted-foreground">{name}</span>
    </div>
  );
}

function CancelReasonLabel({ wbStatus, status }: { wbStatus: string; status?: string }) {
  const reasons: Record<string, string> = {
    cancel: "Отменён продавцом",
    user_cancel: "Отменён покупателем",
    declined: "Отклонён системой",
    cancelled: "Отменён",
    cancel_ignore: "Отменён (игнорирован)",
  };
  const label = reasons[wbStatus] || (status === "cancelled" ? "Отменён" : wbStatus);
  return <span className="text-sm text-red-600 dark:text-red-400">{label}</span>;
}

function RenameSupplyDialog({
  open,
  supplyId,
  storeId,
  currentName,
  onClose,
  onSuccess,
}: {
  open: boolean;
  supplyId: string;
  storeId: number | null;
  currentName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(currentName);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const rename = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/wb/supplies/${supplyId}/rename`, { name, storeId });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Ошибка переименования" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.wbApiWarning) {
        toast({
          title: "Переименовано локально",
          description: `Название обновлено в системе. Примечание: ${data.wbApiWarning}`,
        });
      } else {
        toast({ title: "Поставка переименована" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/wb/supplies"] });
      onSuccess();
      onClose();
    },
    onError: (e: any) => {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm" data-testid="dialog-rename-supply">
        <DialogHeader>
          <DialogTitle>Переименовать поставку</DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Название поставки"
          data-testid="input-supply-name"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-rename">Отмена</Button>
          <Button
            onClick={() => rename.mutate()}
            disabled={rename.isPending || !name.trim()}
            style={{ backgroundColor: WB_COLOR }}
            className="text-white"
            data-testid="button-confirm-rename"
          >
            {rename.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      queryClient.invalidateQueries({ queryKey: ["/api/wb/supplies"] });
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
            Выбрано {pluralOrders(selectedOrders.length)} для поставки:
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

function SupplyDetailDialog({
  open,
  supply,
  onClose,
}: {
  open: boolean;
  supply: any;
  onClose: () => void;
}) {
  const supplyId = supply?.supply_id;
  const { data: orders = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/wb/orders", "supplyDetail", supplyId],
    queryFn: async () => {
      if (!supplyId) return [];
      const res = await fetch(`/api/wb/orders?supplyId=${supplyId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Ошибка загрузки заказов поставки");
      return res.json();
    },
    enabled: open && !!supplyId,
  });

  const supplyName = supply?.name || (supply?.created_at
    ? `Поставка от ${format(new Date(supply.created_at), "dd.MM.yyyy", { locale: ru })}`
    : supplyId);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl" data-testid="dialog-supply-detail">
        <DialogHeader>
          <DialogTitle>
            Поставка {supplyId} — {orders.length} {orders.length === 1 ? "заказ" : orders.length >= 2 && orders.length <= 4 ? "заказа" : "заказов"}
          </DialogTitle>
          {supplyName !== supplyId && (
            <p className="text-sm text-muted-foreground mt-1">{supplyName}</p>
          )}
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead>Заказ WB</TableHead>
                  <TableHead>Товар</TableHead>
                  <TableHead>Артикул</TableHead>
                  <TableHead>Баркод</TableHead>
                  <TableHead>Кол-во</TableHead>
                  <TableHead>Сумма</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
                      <EmptyState text="Заказы для этой поставки не найдены" />
                    </TableCell>
                  </TableRow>
                ) : orders.map((order: any) => (
                  <TableRow key={order.id} data-testid={`row-detail-order-${order.id}`}>
                    <TableCell>
                      <span className="font-mono text-sm">{order.wb_order_id || order.order_number || order.id}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ProductPhoto imageUrl={order.image_url} sku={order.sku || ""} size={32} />
                        <span className="text-sm truncate max-w-[180px]">{order.product_name || "WB товар"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">{order.sku || "—"}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">{order.barcode || "—"}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{order.quantity || 1}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{formatCurrency(Number(order.total_amount))}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="flex items-center justify-between pt-1">
          <span className="text-sm text-muted-foreground">
            {orders.length > 0 ? pluralOrders(orders.length) : ""}
          </span>
          <Button variant="outline" onClick={onClose} data-testid="button-close-detail-dialog">Закрыть</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SupplyActionsMenu({
  supply,
  onPrintStickers,
  onPrintQr,
  onPickingListPdf,
  onPickingListExcel,
  onDetailDialog,
  showClose = false,
  onClose,
}: {
  supply: any;
  onPrintStickers: () => void;
  onPrintQr: () => void;
  onPickingListPdf: () => void;
  onPickingListExcel: () => void;
  onDetailDialog: () => void;
  showClose?: boolean;
  onClose?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8" data-testid={`button-supply-menu-${supply.supply_id}`}>
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={onPrintStickers} data-testid={`menu-print-stickers-${supply.supply_id}`}>
          <Printer className="w-4 h-4 mr-2" /> Печать стикеров
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onPrintQr} data-testid={`menu-print-qr-${supply.supply_id}`}>
          <QrCode className="w-4 h-4 mr-2" /> Печать QR-кода поставки
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onPickingListPdf} data-testid={`menu-picking-pdf-${supply.supply_id}`}>
          <FileText className="w-4 h-4 mr-2" /> Открыть лист подбора в PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onPickingListExcel} data-testid={`menu-picking-excel-${supply.supply_id}`}>
          <FileSpreadsheet className="w-4 h-4 mr-2" /> Скачать лист подбора в Excel
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDetailDialog} data-testid={`menu-detail-supply-${supply.supply_id}`}>
          <Package className="w-4 h-4 mr-2" /> Детализация поставки
        </DropdownMenuItem>
        {showClose && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onClose}
              className="text-red-600 focus:text-red-600"
              data-testid={`menu-close-supply-${supply.supply_id}`}
            >
              <XCircle className="w-4 h-4 mr-2" /> Закрыть поставку
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useSupplyActions(supply: any, toast: any, queryClient: any) {
  const supplyId = supply.supply_id;
  const storeId = supply.store_id || null;

  const fetchPickingListItems = async (): Promise<any[]> => {
    const res = await fetch(`/api/wb/supplies/${supplyId}/picking-list`, { credentials: "include" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: `Ошибка сервера (${res.status})` }));
      throw new Error(err.message);
    }
    const data = await res.json();
    return data.items || [];
  };

  const handlePrintStickers = async () => {
    try {
      const items = await fetchPickingListItems();
      const wbOrderIds = items.map((i: any) => Number(i.orderId)).filter(Boolean);
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
      if (win) { win.document.write(printHTML); win.document.close(); win.print(); win.close(); }
    } catch (e: any) {
      toast({ title: "Ошибка печати стикеров", description: e.message, variant: "destructive" });
    }
  };

  const handlePrintQr = async () => {
    try {
      const params = storeId ? `?storeId=${storeId}` : "";
      const res = await fetch(`/api/wb/supplies/${supplyId}/barcode-qr${params}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Ошибка получения QR-кода" }));
        throw new Error(err.message);
      }
      const data = await res.json();
      const viewHTML = `<html><head><title>QR-код поставки ${supplyId}</title><style>
        body { margin: 0; background: #f8f9fa; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; font-family: Arial, sans-serif; gap: 16px; }
        h2 { color: #333; font-size: 16px; margin: 0; }
        img { max-width: 400px; max-height: 400px; border: 1px solid #ddd; background: #fff; padding: 16px; border-radius: 8px; }
        button { padding: 8px 20px; background: #7631ff; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
      </style></head><body>
        <h2>QR-код поставки ${supplyId}</h2>
        <img src="data:image/png;base64,${data.file}" />
        <button onclick="window.print()">Печать</button>
      </body></html>`;
      const win = window.open("", "_blank");
      if (win) { win.document.write(viewHTML); win.document.close(); }
    } catch (e: any) {
      toast({ title: "Ошибка QR-кода", description: e.message, variant: "destructive" });
    }
  };

  const handlePickingListPdf = async () => {
    try {
      const res = await fetch(`/api/wb/supplies/${supplyId}/picking-pdf`, { credentials: "include" });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        let msg = `Ошибка сервера (${res.status})`;
        try { msg = JSON.parse(errText).message || msg; } catch {}
        throw new Error(msg);
      }
      const html = await res.text();
      const win = window.open("", "_blank");
      if (win) { win.document.write(html); win.document.close(); win.print(); win.close(); }
    } catch (e: any) {
      toast({ title: "Ошибка листа подбора", description: e.message, variant: "destructive" });
    }
  };

  const handlePickingListExcel = async () => {
    try {
      const items = await fetchPickingListItems();
      const XLSX = await import("xlsx");
      const wsData = [
        ["Артикул", "Название", "Штрихкод", "Кол-во"],
        ...items.map((item: any) => [item.sku || "", item.productName || "WB товар", item.barcode || "", item.quantity]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Лист подбора");
      XLSX.writeFile(wb, `supply_${supplyId}.xlsx`);
    } catch (e: any) {
      toast({ title: "Ошибка экспорта Excel", description: e.message, variant: "destructive" });
    }
  };

  const handleCloseSupply = async () => {
    try {
      const res = await apiRequest("POST", `/api/wb/supplies/${supplyId}/close`, { storeId });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Ошибка закрытия поставки" }));
        throw new Error(err.message);
      }
      toast({ title: `✓ Поставка ${supplyId} закрыта` });
      queryClient.invalidateQueries({ queryKey: ["/api/wb/supplies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wb/orders"] });
    } catch (e: any) {
      toast({ title: "Ошибка закрытия поставки", description: e.message, variant: "destructive" });
    }
  };

  return { handlePrintStickers, handlePrintQr, handlePickingListPdf, handlePickingListExcel, handleCloseSupply };
}

function AssemblySupplyRow({
  supply,
  isSelected,
  onSelect,
  onOpenDetail,
}: {
  supply: any;
  isSelected: boolean;
  onSelect: (supplyId: string, checked: boolean) => void;
  onOpenDetail: (supply: any) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const actions = useSupplyActions(supply, toast, queryClient);
  const ordersCount = Number(supply.orders_count) || 0;

  return (
    <TableRow
      className={isSelected ? "bg-violet-50 dark:bg-violet-900/10" : ""}
      data-testid={`row-wb-assembly-supply-${supply.supply_id}`}
    >
      <TableCell className="w-10">
        <Checkbox
          checked={isSelected}
          onCheckedChange={(c) => onSelect(supply.supply_id, !!c)}
          data-testid={`checkbox-assembly-supply-${supply.supply_id}`}
        />
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">{supply.name || `Поставка от ${format(new Date(supply.created_at), "dd.MM.yyyy", { locale: ru })}`}</span>
          <span className="text-xs text-muted-foreground font-mono">{supply.supply_id}</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 w-fit font-normal text-muted-foreground mt-0.5">МГТ</Badge>
        </div>
      </TableCell>
      <TableCell>
        <span className="font-mono text-xs text-muted-foreground">{supply.supply_id}</span>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{ordersCount}</span>
          <span className="text-xs text-muted-foreground">1 грузоместо</span>
        </div>
      </TableCell>
      <TableCell>
        <Badge className="bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 text-xs font-normal">
          Ждёт передачи в доставку
        </Badge>
      </TableCell>
      <TableCell>
        <span className="text-sm text-muted-foreground">{supply.store_name || "—"}</span>
      </TableCell>
      <TableCell>
        <SupplyActionsMenu
          supply={supply}
          onPrintStickers={actions.handlePrintStickers}
          onPrintQr={actions.handlePrintQr}
          onPickingListPdf={actions.handlePickingListPdf}
          onPickingListExcel={actions.handlePickingListExcel}
          onDetailDialog={() => onOpenDetail(supply)}
          showClose={true}
          onClose={actions.handleCloseSupply}
        />
      </TableCell>
    </TableRow>
  );
}

function DeliverySupplyRow({
  supply,
  isSelected,
  onSelect,
  onOpenDetail,
}: {
  supply: any;
  isSelected: boolean;
  onSelect: (supplyId: string, checked: boolean) => void;
  onOpenDetail: (supply: any) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const actions = useSupplyActions(supply, toast, queryClient);
  const ordersCount = Number(supply.orders_count) || 0;

  return (
    <TableRow
      className={isSelected ? "bg-violet-50 dark:bg-violet-900/10" : ""}
      data-testid={`row-wb-delivery-supply-${supply.supply_id}`}
    >
      <TableCell className="w-10">
        <Checkbox
          checked={isSelected}
          onCheckedChange={(c) => onSelect(supply.supply_id, !!c)}
          data-testid={`checkbox-delivery-supply-${supply.supply_id}`}
        />
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">{supply.name || `Поставка от ${format(new Date(supply.created_at), "dd.MM.yyyy", { locale: ru })}`}</span>
          <span className="text-xs text-muted-foreground font-mono">{supply.supply_id}</span>
        </div>
      </TableCell>
      <TableCell>
        <span className="font-mono text-xs text-muted-foreground">{supply.supply_id}</span>
      </TableCell>
      <TableCell>
        <Badge className="bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 text-xs font-normal">
          Поставка в обработке
        </Badge>
      </TableCell>
      <TableCell>
        <span className="text-sm text-muted-foreground">
          {supply.closed_at ? format(new Date(supply.closed_at), "d MMM yyyy, HH:mm", { locale: ru }) : "—"}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{ordersCount}</span>
          <span className="text-xs text-muted-foreground">1 грузоместо</span>
        </div>
      </TableCell>
      <TableCell>
        <span className="text-sm text-muted-foreground">{supply.store_name || "—"}</span>
      </TableCell>
      <TableCell>
        <SupplyActionsMenu
          supply={supply}
          onPrintStickers={actions.handlePrintStickers}
          onPrintQr={actions.handlePrintQr}
          onPickingListPdf={actions.handlePickingListPdf}
          onPickingListExcel={actions.handlePickingListExcel}
          onDetailDialog={() => onOpenDetail(supply)}
          showClose={false}
        />
      </TableCell>
    </TableRow>
  );
}

export default function WildberriesOrders({ storeId }: { storeId?: number | null }) {
  const [activeTab, setActiveTab] = useState<WbTab>("new");
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<number>>(new Set());
  const [selectedSupplyIds, setSelectedSupplyIds] = useState<Set<string>>(new Set());
  const [showCreateSupply, setShowCreateSupply] = useState(false);
  const [singleOrderForSupply, setSingleOrderForSupply] = useState<any | null>(null);
  const [renameSupply, setRenameSupply] = useState<any | null>(null);
  const [detailSupply, setDetailSupply] = useState<any | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const cancelOrderMutation = useMutation({
    mutationFn: async (orderId: number) => {
      const res = await apiRequest("POST", `/api/wb/orders/${orderId}/cancel`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Ошибка отмены заказа" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Заказ отменён" });
      queryClient.invalidateQueries({ queryKey: ["/api/wb/orders"] });
    },
    onError: (e: any) => {
      toast({ title: "Ошибка отмены заказа", description: e.message, variant: "destructive" });
    },
  });

  const syncSuppliesMutation = useMutation({
    mutationFn: async () => {
      const body: any = {};
      if (storeId) body.storeId = storeId;
      const res = await apiRequest("POST", "/api/wb/supplies/sync", body);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Ошибка синхронизации поставок" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: `✓ Синхронизировано ${data.synced} поставок` });
      queryClient.invalidateQueries({ queryKey: ["/api/wb/supplies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wb/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wb/counts"] });
    },
    onError: (e: any) => {
      toast({ title: "Ошибка синхронизации", description: e.message, variant: "destructive" });
    },
  });

  const isOrdersTab = activeTab === "new" || activeTab === "archive" || activeTab === "cancelled";
  const isSuppliesTab = activeTab === "assembly" || activeTab === "delivery";

  const { data: wbCounts } = useQuery<any>({
    queryKey: ["/api/wb/counts"],
    queryFn: async () => {
      const res = await fetch("/api/wb/counts", { credentials: "include" });
      if (!res.ok) return {};
      return res.json();
    },
    refetchInterval: 120000,
  });

  const ordersQuery = useQuery<any[]>({
    queryKey: ["/api/wb/orders", activeTab, storeId],
    queryFn: async () => {
      if (!isOrdersTab) return [];
      const params = new URLSearchParams({ status: activeTab });
      if (storeId) params.set("storeId", String(storeId));
      const res = await fetch(`/api/wb/orders?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Ошибка загрузки заказов WB");
      return res.json();
    },
    enabled: isOrdersTab,
    refetchInterval: 60000,
  });

  const suppliesQuery = useQuery<any[]>({
    queryKey: ["/api/wb/supplies", activeTab === "delivery" ? "closed" : "open", storeId],
    queryFn: async () => {
      if (!isSuppliesTab) return [];
      const supplyStatus = activeTab === "delivery" ? "closed" : "open";
      const params = new URLSearchParams({ status: supplyStatus });
      if (storeId) params.set("storeId", String(storeId));
      const res = await fetch(`/api/wb/supplies?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Ошибка загрузки поставок WB");
      return res.json();
    },
    enabled: isSuppliesTab,
    refetchInterval: 60000,
  });

  const orders: any[] = ordersQuery.data || [];
  const supplies: any[] = suppliesQuery.data || [];
  const isLoading = isOrdersTab ? ordersQuery.isLoading : suppliesQuery.isLoading;

  const selectedOrders = orders.filter((o: any) => selectedOrderIds.has(o.id));
  const selectedStoreId = selectedOrders[0]?.store_id || storeId || null;

  const handleSelectAll = (checked: boolean) => {
    setSelectedOrderIds(checked ? new Set(orders.map((o: any) => o.id)) : new Set());
  };

  const handleSelectOrder = (id: number, checked: boolean) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const handleSelectSupply = (supplyId: string, checked: boolean) => {
    setSelectedSupplyIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(supplyId); else next.delete(supplyId);
      return next;
    });
  };

  const handleSelectAllSupplies = (checked: boolean) => {
    setSelectedSupplyIds(checked ? new Set(supplies.map((s: any) => s.supply_id)) : new Set());
  };

  const handleTabChange = (tab: WbTab) => {
    setActiveTab(tab);
    setSelectedOrderIds(new Set());
    setSelectedSupplyIds(new Set());
  };

  const handleSupplyCreated = () => {
    setSelectedOrderIds(new Set());
    setActiveTab("assembly");
  };

  const handleBulkPrintQr = async () => {
    const supplyList = supplies.filter((s: any) => selectedSupplyIds.has(s.supply_id));
    if (supplyList.length === 0) return;

    toast({ title: `Загружаем QR-коды для ${pluralSupplies(supplyList.length)}…` });
    const results: { supplyId: string; file: string }[] = [];
    const errors: string[] = [];

    for (const supply of supplyList) {
      try {
        const params = supply.store_id ? `?storeId=${supply.store_id}` : "";
        const res = await fetch(`/api/wb/supplies/${supply.supply_id}/barcode-qr${params}`, { credentials: "include" });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: "Ошибка" }));
          errors.push(`${supply.supply_id}: ${err.message}`);
          continue;
        }
        const data = await res.json();
        results.push({ supplyId: supply.supply_id, file: data.file });
      } catch (e: any) {
        errors.push(`${supply.supply_id}: ${e.message}`);
      }
    }

    if (results.length === 0) {
      toast({ title: "Не удалось загрузить QR-коды", description: errors.join("; "), variant: "destructive" });
      return;
    }

    const printHTML = `<html><head><title>QR-коды поставок</title><style>
      @page { size: 58mm 40mm; margin: 0; }
      body { margin: 0; padding: 0; }
      img { width: 58mm; height: 40mm; display: block; page-break-after: always; }
    </style></head><body>
      ${results.map((r) => `<img src="data:image/png;base64,${r.file}" />`).join("")}
    </body></html>`;

    const win = window.open("", "_blank");
    if (win) { win.document.write(printHTML); win.document.close(); win.print(); win.close(); }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="wb-orders-loading">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const getTabCount = (tabKey: string): number | undefined => {
    if (!wbCounts) return undefined;
    switch (tabKey) {
      case "new":       return wbCounts.new_count || 0;
      case "assembly":  return wbCounts.assembly_count || 0;
      case "delivery":  return wbCounts.delivery_count || 0;
      case "archive":   return wbCounts.archive_count || 0;
      case "cancelled": return wbCounts.cancelled_count || 0;
    }
  };

  return (
    <div className="space-y-4" data-testid="wb-orders-container">
      {/* Вкладки */}
      <div className="flex gap-1 p-1 bg-muted/50 rounded-xl border" data-testid="wb-fbs-tabs">
        {WB_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          const count = getTabCount(tab.key);
          return (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
                isActive ? "text-white shadow-sm" : "hover:bg-muted text-muted-foreground"
              }`}
              style={isActive ? { backgroundColor: WB_COLOR } : {}}
              data-testid={`tab-wb-${tab.key}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {count !== undefined && count > 0 && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
                    isActive ? "bg-white/25 text-white" : "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                  }`}
                  data-testid={`badge-tab-count-${tab.key}`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ===== ВКЛАДКА НОВЫЕ ===== */}
      {activeTab === "new" && (
        <div className="relative">
          <div className="rounded-xl border overflow-hidden bg-white dark:bg-background" data-testid="wb-new-orders-table">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={orders.length > 0 && selectedOrderIds.size === orders.length}
                      onCheckedChange={(c) => handleSelectAll(!!c)}
                      data-testid="checkbox-select-all-wb"
                    />
                  </TableHead>
                  <TableHead>Заказ</TableHead>
                  <TableHead>Товар</TableHead>
                  <TableHead>Стоимость</TableHead>
                  <TableHead>Склад</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
                      <EmptyState />
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
                    <TableCell><OrderNumCell order={order} /></TableCell>
                    <TableCell><ProductCell order={order} /></TableCell>
                    <TableCell>
                      <span className="text-sm font-medium">{formatCurrency(Number(order.total_amount))}</span>
                    </TableCell>
                    <TableCell><WarehouseCell order={order} /></TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8" data-testid={`button-order-menu-${order.id}`}>
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => setSingleOrderForSupply(order)}
                            data-testid={`menu-create-supply-single-${order.id}`}
                          >
                            <Package className="w-4 h-4 mr-2" /> Создать поставку
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600 focus:text-red-600"
                            disabled={cancelOrderMutation.isPending}
                            onClick={() => cancelOrderMutation.mutate(order.id)}
                            data-testid={`menu-cancel-order-${order.id}`}
                          >
                            <XCircle className="w-4 h-4 mr-2" /> Отменить заказ
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Sticky панель выбора заказов */}
          {selectedOrderIds.size > 0 && (
            <div
              className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-4 px-6 py-3 shadow-lg border-t"
              style={{ backgroundColor: WB_COLOR, borderColor: WB_COLOR }}
              data-testid="wb-sticky-supply-panel"
            >
              <span className="text-white font-medium">
                Выбрано {pluralOrders(selectedOrderIds.size)}
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

      {/* ===== ВКЛАДКА НА СБОРКЕ ===== */}
      {activeTab === "assembly" && (
        <div className="space-y-3" data-testid="wb-assembly-supplies">
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => syncSuppliesMutation.mutate()}
              disabled={syncSuppliesMutation.isPending}
              data-testid="button-sync-assembly-supplies"
            >
              {syncSuppliesMutation.isPending
                ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                : <RefreshCw className="w-4 h-4 mr-1.5" />}
              Синхронизировать поставки
            </Button>
          </div>
          {supplies.length === 0 ? (
            <EmptyState text="У вас пока нет активных поставок" />
          ) : (
            <div className="rounded-xl border overflow-hidden bg-white dark:bg-background">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="w-10">
                      <Checkbox
                        checked={supplies.length > 0 && selectedSupplyIds.size === supplies.length}
                        onCheckedChange={(c) => handleSelectAllSupplies(!!c)}
                        data-testid="checkbox-select-all-assembly"
                      />
                    </TableHead>
                    <TableHead>Поставка</TableHead>
                    <TableHead>QR-код поставки</TableHead>
                    <TableHead>Заказы / Грузоместа</TableHead>
                    <TableHead>Этап сборки</TableHead>
                    <TableHead>Склад</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supplies.map((supply: any) => (
                    <AssemblySupplyRow
                      key={supply.supply_id}
                      supply={supply}
                      isSelected={selectedSupplyIds.has(supply.supply_id)}
                      onSelect={handleSelectSupply}
                      onOpenDetail={setDetailSupply}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Sticky панель выбора поставок (сборка) */}
          {selectedSupplyIds.size > 0 && (
            <div
              className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-4 px-6 py-3 shadow-lg border-t"
              style={{ backgroundColor: WB_COLOR, borderColor: WB_COLOR }}
              data-testid="wb-sticky-supplies-panel"
            >
              <span className="text-white font-medium">
                Выбрано {pluralSupplies(selectedSupplyIds.size)}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleBulkPrintQr}
                data-testid="button-bulk-print-qr"
              >
                <QrCode className="w-4 h-4 mr-1.5" />
                Печать QR-кодов поставок
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ===== ВКЛАДКА В ДОСТАВКЕ ===== */}
      {activeTab === "delivery" && (
        <div className="space-y-3" data-testid="wb-delivery-supplies">
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => syncSuppliesMutation.mutate()}
              disabled={syncSuppliesMutation.isPending}
              data-testid="button-sync-delivery-supplies"
            >
              {syncSuppliesMutation.isPending
                ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                : <RefreshCw className="w-4 h-4 mr-1.5" />}
              Синхронизировать поставки
            </Button>
          </div>
          {supplies.length === 0 ? (
            <EmptyState text="У вас пока нет поставок в доставке" />
          ) : (
            <div className="rounded-xl border overflow-hidden bg-white dark:bg-background">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="w-10">
                      <Checkbox
                        checked={supplies.length > 0 && selectedSupplyIds.size === supplies.length}
                        onCheckedChange={(c) => handleSelectAllSupplies(!!c)}
                        data-testid="checkbox-select-all-delivery"
                      />
                    </TableHead>
                    <TableHead>Поставка</TableHead>
                    <TableHead>QR-код поставки</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Время сканирования</TableHead>
                    <TableHead>Заказы / Грузоместа</TableHead>
                    <TableHead>Склад</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supplies.map((supply: any) => (
                    <DeliverySupplyRow
                      key={supply.supply_id}
                      supply={supply}
                      isSelected={selectedSupplyIds.has(supply.supply_id)}
                      onSelect={handleSelectSupply}
                      onOpenDetail={setDetailSupply}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Sticky панель выбора поставок (доставка) */}
          {selectedSupplyIds.size > 0 && (
            <div
              className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-4 px-6 py-3 shadow-lg border-t"
              style={{ backgroundColor: WB_COLOR, borderColor: WB_COLOR }}
              data-testid="wb-sticky-delivery-panel"
            >
              <span className="text-white font-medium">
                Выбрано {pluralSupplies(selectedSupplyIds.size)}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleBulkPrintQr}
                data-testid="button-bulk-print-qr-delivery"
              >
                <QrCode className="w-4 h-4 mr-1.5" />
                Печать QR-кодов поставок
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ===== ВКЛАДКА АРХИВ ===== */}
      {activeTab === "archive" && (
        <div className="rounded-xl border overflow-hidden bg-white dark:bg-background" data-testid="wb-archive-orders">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Заказ</TableHead>
                <TableHead>Товар</TableHead>
                <TableHead>Стоимость</TableHead>
                <TableHead>Склад</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Номер стикера</TableHead>
                <TableHead>Время доставки</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-0">
                    <EmptyState />
                  </TableCell>
                </TableRow>
              ) : orders.map((order: any) => (
                <TableRow key={order.id} data-testid={`row-wb-archive-order-${order.id}`}>
                  <TableCell><OrderNumCell order={order} /></TableCell>
                  <TableCell><ProductCell order={order} /></TableCell>
                  <TableCell>
                    <span className="text-sm font-medium">{formatCurrency(Number(order.total_amount))}</span>
                  </TableCell>
                  <TableCell><WarehouseCell order={order} /></TableCell>
                  <TableCell>
                    <button
                      className="text-blue-600 dark:text-blue-400 text-sm hover:underline flex items-center gap-0.5"
                      data-testid={`status-archive-${order.id}`}
                    >
                      Отсортировано ›
                    </button>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">{order.wb_rid || "—"}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {order.created_at ? format(new Date(order.created_at), "d MMM yyyy", { locale: ru }) : "—"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ===== ВКЛАДКА ОТМЕНЁННЫЕ ===== */}
      {activeTab === "cancelled" && (
        <div className="space-y-3" data-testid="wb-cancelled-orders">
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-700">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-amber-800 dark:text-amber-300">
                Товары из отменённых заказов необходимо вернуть в остатки. Проверьте и обновите остатки вручную.
              </p>
            </div>
            <Link href="/inventory">
              <Button size="sm" style={{ backgroundColor: WB_COLOR }} className="text-white flex-shrink-0" data-testid="button-go-inventory">
                Управление остатками
              </Button>
            </Link>
          </div>

          <div className="rounded-xl border overflow-hidden bg-white dark:bg-background">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead>Заказ</TableHead>
                  <TableHead>Товар</TableHead>
                  <TableHead>Стоимость</TableHead>
                  <TableHead>Склад</TableHead>
                  <TableHead>Баркод</TableHead>
                  <TableHead>Причина отмены</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
                      <EmptyState />
                    </TableCell>
                  </TableRow>
                ) : orders.map((order: any) => (
                  <TableRow key={order.id} data-testid={`row-wb-cancelled-order-${order.id}`}>
                    <TableCell><OrderNumCell order={order} /></TableCell>
                    <TableCell><ProductCell order={order} /></TableCell>
                    <TableCell>
                      <span className="text-sm font-medium">{formatCurrency(Number(order.total_amount))}</span>
                    </TableCell>
                    <TableCell><WarehouseCell order={order} /></TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">{order.barcode || "—"}</span>
                    </TableCell>
                    <TableCell>
                      <CancelReasonLabel wbStatus={order.wb_status || ""} status={order.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Диалоги */}
      <CreateSupplyDialog
        open={showCreateSupply}
        onClose={() => setShowCreateSupply(false)}
        selectedOrders={selectedOrders}
        storeId={selectedStoreId}
        onSuccess={handleSupplyCreated}
      />

      {singleOrderForSupply && (
        <CreateSupplyDialog
          open={!!singleOrderForSupply}
          onClose={() => setSingleOrderForSupply(null)}
          selectedOrders={[singleOrderForSupply]}
          storeId={singleOrderForSupply.store_id || storeId || null}
          onSuccess={() => {
            setSingleOrderForSupply(null);
            setActiveTab("assembly");
          }}
        />
      )}

      {renameSupply && (
        <RenameSupplyDialog
          open={!!renameSupply}
          supplyId={renameSupply.supply_id}
          storeId={renameSupply.store_id || null}
          currentName={renameSupply.name || ""}
          onClose={() => setRenameSupply(null)}
          onSuccess={() => setRenameSupply(null)}
        />
      )}

      {detailSupply && (
        <SupplyDetailDialog
          open={!!detailSupply}
          supply={detailSupply}
          onClose={() => setDetailSupply(null)}
        />
      )}
    </div>
  );
}
