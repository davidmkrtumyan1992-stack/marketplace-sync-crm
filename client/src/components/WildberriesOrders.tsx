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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Loader2, Package, PackageSearch, Printer, FileText, FileSpreadsheet,
  Monitor, XCircle, Truck, CheckCircle, MoreHorizontal, Pencil, AlertTriangle,
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

function CancelReasonLabel({ wbStatus }: { wbStatus: string }) {
  const reasons: Record<string, string> = {
    cancel: "Отменён продавцом",
    user_cancel: "Отменён покупателем",
    declined: "Отклонён системой",
  };
  return <span className="text-sm text-red-600 dark:text-red-400">{reasons[wbStatus] || wbStatus}</span>;
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

function SupplyActionsMenu({
  supply,
  onPrintStickers,
  onPickingListPdf,
  onPickingListExcel,
  onPickingListScreen,
  onRename,
  onClose,
}: {
  supply: any;
  onPrintStickers: () => void;
  onPickingListPdf: () => void;
  onPickingListExcel: () => void;
  onPickingListScreen: () => void;
  onRename: () => void;
  onClose: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8" data-testid={`button-supply-menu-${supply.supply_id}`}>
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={onPrintStickers} data-testid={`menu-print-stickers-${supply.supply_id}`}>
          <Printer className="w-4 h-4 mr-2" /> Печать стикеров
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid={`menu-picking-list-${supply.supply_id}`}>
            <FileText className="w-4 h-4 mr-2" /> Лист подбора
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={onPickingListPdf}>
              <FileText className="w-4 h-4 mr-2" /> PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onPickingListExcel}>
              <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onPickingListScreen}>
              <Monitor className="w-4 h-4 mr-2" /> Экран
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onRename} data-testid={`menu-rename-supply-${supply.supply_id}`}>
          <Pencil className="w-4 h-4 mr-2" /> Переименовать
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onClose}
          className="text-red-600 focus:text-red-600"
          data-testid={`menu-close-supply-${supply.supply_id}`}
        >
          <XCircle className="w-4 h-4 mr-2" /> Закрыть поставку
        </DropdownMenuItem>
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

  const buildPickingListHTML = (items: any[], storeName: string) => {
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
    return `<html><head><style>
      @page { margin: 20mm; }
      body { font-family: Arial, sans-serif; font-size: 12px; color: #111; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      h2 { font-size: 13px; color: #666; margin-bottom: 16px; font-weight: normal; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #f3f4f6; padding: 8px; text-align: left; border-bottom: 2px solid #d1d5db; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    </style></head><body>
      <h1>Лист подбора — ${supplyId}</h1>
      <h2>${storeName} · ${format(new Date(), "d MMMM yyyy", { locale: ru })}</h2>
      <table>
        <thead><tr>
          <th>Фото</th><th>Артикул</th><th>Название</th><th>Штрихкод</th><th>Кол-во</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body></html>`;
  };

  const handlePickingListPdf = async () => {
    try {
      const items = await fetchPickingListItems();
      const html = buildPickingListHTML(items, supply.store_name || "");
      const win = window.open("", "_blank");
      if (win) { win.document.write(html); win.document.close(); win.print(); win.close(); }
    } catch (e: any) {
      toast({ title: "Ошибка листа подбора", description: e.message, variant: "destructive" });
    }
  };

  const handlePickingListScreen = async () => {
    try {
      const items = await fetchPickingListItems();
      const html = buildPickingListHTML(items, supply.store_name || "");
      const win = window.open("", "_blank");
      if (win) { win.document.write(html); win.document.close(); }
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

  return { handlePrintStickers, handlePickingListPdf, handlePickingListScreen, handlePickingListExcel, handleCloseSupply };
}

function AssemblySupplyRow({ supply, onRename }: { supply: any; onRename: (supply: any) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const actions = useSupplyActions(supply, toast, queryClient);
  const ordersCount = Number(supply.orders_count) || 0;

  return (
    <TableRow data-testid={`row-wb-assembly-supply-${supply.supply_id}`}>
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
          onPickingListPdf={actions.handlePickingListPdf}
          onPickingListExcel={actions.handlePickingListExcel}
          onPickingListScreen={actions.handlePickingListScreen}
          onRename={() => onRename(supply)}
          onClose={actions.handleCloseSupply}
        />
      </TableCell>
    </TableRow>
  );
}

function DeliverySupplyRow({ supply }: { supply: any }) {
  const ordersCount = Number(supply.orders_count) || 0;
  return (
    <TableRow data-testid={`row-wb-delivery-supply-${supply.supply_id}`}>
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
    </TableRow>
  );
}

export default function WildberriesOrders({ storeId }: { storeId?: number | null }) {
  const [activeTab, setActiveTab] = useState<WbTab>("new");
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<number>>(new Set());
  const [showCreateSupply, setShowCreateSupply] = useState(false);
  const [renameSupply, setRenameSupply] = useState<any | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isOrdersTab = activeTab === "new" || activeTab === "archive" || activeTab === "cancelled";
  const isSuppliesTab = activeTab === "assembly" || activeTab === "delivery";

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

  const handleTabChange = (tab: WbTab) => {
    setActiveTab(tab);
    setSelectedOrderIds(new Set());
  };

  const handleSupplyCreated = () => {
    setSelectedOrderIds(new Set());
    setActiveTab("assembly");
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
              onClick={() => handleTabChange(tab.key)}
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
                          <DropdownMenuItem data-testid={`menu-print-label-${order.id}`}>
                            <Printer className="w-4 h-4 mr-2" /> Печать этикетки
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-red-600 focus:text-red-600" data-testid={`menu-cancel-order-${order.id}`}>
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

          {/* Sticky панель выбора */}
          {selectedOrderIds.size > 0 && (
            <div
              className="sticky bottom-4 mt-4 flex items-center justify-between gap-4 px-4 py-3 rounded-xl shadow-lg border"
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
        <div className="rounded-xl border overflow-hidden bg-white dark:bg-background" data-testid="wb-assembly-supplies">
          {supplies.length === 0 ? (
            <EmptyState text="У вас пока нет активных поставок" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
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
                    onRename={(s) => setRenameSupply(s)}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* ===== ВКЛАДКА В ДОСТАВКЕ ===== */}
      {activeTab === "delivery" && (
        <div className="rounded-xl border overflow-hidden bg-white dark:bg-background" data-testid="wb-delivery-supplies">
          {supplies.length === 0 ? (
            <EmptyState text="У вас пока нет поставок в доставке" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead>Поставка</TableHead>
                  <TableHead>QR-код поставки</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Время сканирования</TableHead>
                  <TableHead>Заказы / Грузоместа</TableHead>
                  <TableHead>Склад</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {supplies.map((supply: any) => (
                  <DeliverySupplyRow key={supply.supply_id} supply={supply} />
                ))}
              </TableBody>
            </Table>
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
          {/* Предупреждение об остатках */}
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
                      <CancelReasonLabel wbStatus={order.wb_status || ""} />
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
    </div>
  );
}
