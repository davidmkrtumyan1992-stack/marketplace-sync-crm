import { Layout } from "@/components/Layout";
import { useOrders, useUpdateOrderStatus, useCreateDirectSale, useOzonShipOrder, useOzonCancelOrder, useSyncOzonOrders, useOzonPrintLabel, useOzonBulkLabels, useResyncOzonOrders, useSilentSyncOzonOrders, useSyncYandexOrders } from "@/hooks/use-orders";
import { format, isToday, isYesterday } from "date-fns";
import { ru } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShoppingCart, Package, Calendar, User, CreditCard, Plus, Search, Trash2, UserPlus, Store, Eye, FileText, Phone, RefreshCw, Truck, XCircle, Loader2, Printer, Warehouse, Download, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { getMarketplaceStyle } from "@/lib/marketplace";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo } from "react";
import type { Product } from "@shared/schema";
import { useLocation } from "wouter";

interface DirectSaleItem {
  productId: number;
  productName: string;
  quantity: number;
  originalPrice: number;
  salePrice: number;
  maxStock: number;
}

const OZON_STATUS_LABELS: Record<string, string> = {
  awaiting_approve: "Ожидает подтверждения",
  awaiting_packaging: "Ожидает сборки",
  awaiting_deliver: "Ожидает отгрузки",
  arbitration: "Арбитраж",
  delivering: "Доставляется",
  delivered: "Доставлен",
  cancelled: "Отменён",
  not_accepted: "Не принят",
};

type FulfillmentFilter = "all" | "FBS" | "FBO" | "direct" | "yandex";
type FbsSubFilter = "all" | "awaiting_packaging" | "awaiting_deliver" | "delivering" | "dispute" | "delivered" | "cancelled";
type FboSubFilter = "all" | "awaiting_packaging" | "awaiting_deliver" | "delivering" | "delivered" | "cancelled";
type YandexSubFilter = "all" | "NEW" | "PROCESSING" | "READY_TO_SHIP" | "DELIVERY" | "DELIVERED" | "CANCELLED";

function getMarketplaceStatusLabel(ozonStatus: string | null | undefined): string {
  if (!ozonStatus) return "Новый";
  switch (ozonStatus) {
    case "awaiting_packaging":
    case "awaiting_deliver":
    case "awaiting_approve":
      return "Новый";
    case "delivering":
      return "Отправлен";
    case "delivered":
      return "Завершён";
    case "cancelled":
      return "Отменён";
    case "arbitration":
      return "Спорный";
    default:
      return "Новый";
  }
}

function getYandexStatusLabel(yandexStatus: string | null | undefined): string {
  if (!yandexStatus) return "Новый";
  switch (yandexStatus) {
    case "NEW": return "Новый";
    case "PROCESSING": return "Ожидает сборки";
    case "READY_TO_SHIP": return "Ожидает отгрузки";
    case "DELIVERY": return "Доставка";
    case "PICKUP": return "Ожидает получения";
    case "DELIVERED": return "Доставлено";
    case "CANCELLED": return "Отменено";
    case "RETURNED": return "Возвращено";
    case "UNPAID": return "Не оплачено";
    case "RESERVED": return "Зарезервировано";
    default: return yandexStatus;
  }
}

const FBS_SUB_FILTERS: { key: FbsSubFilter; label: string; icon: any }[] = [
  { key: "all", label: "Все", icon: Package },
  { key: "awaiting_packaging", label: "Ожидают сборки", icon: Clock },
  { key: "awaiting_deliver", label: "Ожидают отгрузки", icon: Package },
  { key: "delivering", label: "Доставляются", icon: Truck },
  { key: "dispute", label: "Спорные", icon: AlertTriangle },
  { key: "delivered", label: "Доставлены", icon: CheckCircle },
  { key: "cancelled", label: "Отменены", icon: XCircle },
];

const FBO_SUB_FILTERS: { key: FboSubFilter; label: string; icon: any }[] = [
  { key: "all", label: "Все", icon: Package },
  { key: "awaiting_packaging", label: "Ожидают сборки", icon: Clock },
  { key: "awaiting_deliver", label: "Ожидают отгрузки", icon: Package },
  { key: "delivering", label: "Доставляются", icon: Truck },
  { key: "delivered", label: "Доставлены", icon: CheckCircle },
  { key: "cancelled", label: "Отменены", icon: XCircle },
];

const YANDEX_SUB_FILTERS: { key: YandexSubFilter; label: string; icon: any }[] = [
  { key: "all", label: "Все", icon: Package },
  { key: "NEW", label: "Новые", icon: Clock },
  { key: "PROCESSING", label: "Ожидают сборки", icon: Package },
  { key: "READY_TO_SHIP", label: "Ожидают отгрузки", icon: Package },
  { key: "DELIVERY", label: "Доставляются", icon: Truck },
  { key: "DELIVERED", label: "Доставлены", icon: CheckCircle },
  { key: "CANCELLED", label: "Отменены", icon: XCircle },
];


function getDateGroupLabel(date: Date): string {
  if (isToday(date)) return "Сегодня";
  if (isYesterday(date)) return "Вчера";
  return format(date, "d MMMM yyyy", { locale: ru });
}

function groupOrdersByDate(orders: any[]): { label: string; orders: any[] }[] {
  const groups = new Map<string, { label: string; orders: any[] }>();
  for (const order of orders) {
    const date = order.createdAt ? new Date(order.createdAt) : new Date();
    const dayKey = format(date, "yyyy-MM-dd");
    const label = getDateGroupLabel(date);
    if (!groups.has(dayKey)) {
      groups.set(dayKey, { label, orders: [] });
    }
    groups.get(dayKey)!.orders.push(order);
  }
  return Array.from(groups.values());
}

export default function Orders() {
  const { data: orders, isLoading } = useOrders();
  const [isDirectSaleOpen, setIsDirectSaleOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [fulfillmentFilter, setFulfillmentFilter] = useState<FulfillmentFilter>("all");
  const [fbsSubFilter, setFbsSubFilter] = useState<FbsSubFilter>("all");
  const [fboSubFilter, setFboSubFilter] = useState<FboSubFilter>("all");
  const [yandexSubFilter, setYandexSubFilter] = useState<YandexSubFilter>("all");
  const [storeFilter, setStoreFilter] = useState<"all" | number>("all");
  const syncOzonOrders = useSyncOzonOrders();
  const syncYandexOrders = useSyncYandexOrders();
  const resyncOzonOrders = useResyncOzonOrders();
  const silentSync = useSilentSyncOzonOrders();
  const bulkLabels = useOzonBulkLabels();

  const { data: storesList } = useQuery<{ id: number; name: string; marketplace: string; companyId: number }[]>({
    queryKey: ["/api/stores"],
  });

  const storesMap = useMemo(() => {
    const map = new Map<number, string>();
    if (storesList) {
      for (const s of storesList) map.set(s.id, s.name);
    }
    return map;
  }, [storesList]);

  const ozonStores = useMemo(() => {
    if (!storesList) return [];
    return storesList.filter(s => s.marketplace === "ozon");
  }, [storesList]);

  const yandexStores = useMemo(() => {
    if (!storesList) return [];
    return storesList.filter(s => s.marketplace === "yandex");
  }, [storesList]);

  const syncingStores = useMemo(() => {
    if (!ozonStores.length || !orders) return [];
    return ozonStores.filter(store => {
      const storeOrders = orders.filter((o: any) => o.storeId === store.id);
      return storeOrders.length === 0;
    });
  }, [ozonStores, orders]);

  const filteredOrders = useMemo(() => {
    if (!orders) return [];
    let result = orders;

    if (storeFilter !== "all") {
      result = result.filter((o: any) => o.storeId === storeFilter);
    }

    if (fulfillmentFilter === "direct") {
      result = result.filter((o: any) => o.source === "direct" || o.source === "manual");
    } else if (fulfillmentFilter === "FBS") {
      result = result.filter((o: any) => (o.fulfillmentType === "FBS" || (!o.fulfillmentType && o.source === "ozon")) && o.source !== "yandex");
    } else if (fulfillmentFilter === "FBO") {
      result = result.filter((o: any) => o.fulfillmentType === "FBO");
    } else if (fulfillmentFilter === "yandex") {
      result = result.filter((o: any) => o.source === "yandex");
    }

    if (fulfillmentFilter === "yandex" && yandexSubFilter !== "all") {
      if (yandexSubFilter === "DELIVERY") {
        result = result.filter((o: any) => o.yandexStatus === "DELIVERY" || o.yandexStatus === "PICKUP");
      } else if (yandexSubFilter === "CANCELLED") {
        result = result.filter((o: any) => o.yandexStatus === "CANCELLED" || o.yandexStatus === "RETURNED");
      } else {
        result = result.filter((o: any) => o.yandexStatus === yandexSubFilter);
      }
    }

    if (fulfillmentFilter === "FBS" && fbsSubFilter !== "all") {
      switch (fbsSubFilter) {
        case "awaiting_packaging":
          result = result.filter((o: any) => o.ozonStatus === "awaiting_packaging");
          break;
        case "awaiting_deliver":
          result = result.filter((o: any) => o.ozonStatus === "awaiting_deliver");
          break;
        case "delivering":
          result = result.filter((o: any) => o.ozonStatus === "delivering");
          break;
        case "dispute":
          result = result.filter((o: any) => o.ozonStatus === "arbitration");
          break;
        case "delivered":
          result = result.filter((o: any) => o.ozonStatus === "delivered");
          break;
        case "cancelled":
          result = result.filter((o: any) => o.ozonStatus === "cancelled");
          break;
      }
    }

    if (fulfillmentFilter === "FBO" && fboSubFilter !== "all") {
      switch (fboSubFilter) {
        case "awaiting_packaging":
          result = result.filter((o: any) => o.ozonStatus === "awaiting_packaging");
          break;
        case "awaiting_deliver":
          result = result.filter((o: any) => o.ozonStatus === "awaiting_deliver");
          break;
        case "delivering":
          result = result.filter((o: any) => o.ozonStatus === "delivering");
          break;
        case "delivered":
          result = result.filter((o: any) => o.ozonStatus === "delivered");
          break;
        case "cancelled":
          result = result.filter((o: any) => o.ozonStatus === "cancelled");
          break;
      }
    }

    return result;
  }, [orders, fulfillmentFilter, fbsSubFilter, fboSubFilter, yandexSubFilter, storeFilter]);

  const dateGroups = useMemo(() => groupOrdersByDate(filteredOrders), [filteredOrders]);

  const storeFilteredOrders = useMemo(() => {
    if (!orders) return [];
    if (storeFilter === "all") return orders;
    return orders.filter((o: any) => o.storeId === storeFilter);
  }, [orders, storeFilter]);

  const fbsStatusCounts = useMemo(() => {
    const fbsOrders = storeFilteredOrders.filter((o: any) => o.fulfillmentType === "FBS" || (!o.fulfillmentType && o.source === "ozon"));
    return {
      all: fbsOrders.length,
      awaiting_packaging: fbsOrders.filter((o: any) => o.ozonStatus === "awaiting_packaging").length,
      awaiting_deliver: fbsOrders.filter((o: any) => o.ozonStatus === "awaiting_deliver").length,
      delivering: fbsOrders.filter((o: any) => o.ozonStatus === "delivering").length,
      dispute: fbsOrders.filter((o: any) => o.ozonStatus === "arbitration").length,
      delivered: fbsOrders.filter((o: any) => o.ozonStatus === "delivered").length,
      cancelled: fbsOrders.filter((o: any) => o.ozonStatus === "cancelled").length,
    };
  }, [storeFilteredOrders]);

  const awaitingShipmentCount = (fbsStatusCounts.awaiting_packaging || 0) + (fbsStatusCounts.awaiting_deliver || 0);

  const fboStatusCounts = useMemo(() => {
    const fboOrders = storeFilteredOrders.filter((o: any) => o.fulfillmentType === "FBO");
    return {
      all: fboOrders.length,
      awaiting_packaging: fboOrders.filter((o: any) => o.ozonStatus === "awaiting_packaging").length,
      awaiting_deliver: fboOrders.filter((o: any) => o.ozonStatus === "awaiting_deliver").length,
      delivering: fboOrders.filter((o: any) => o.ozonStatus === "delivering").length,
      delivered: fboOrders.filter((o: any) => o.ozonStatus === "delivered").length,
      cancelled: fboOrders.filter((o: any) => o.ozonStatus === "cancelled").length,
    };
  }, [storeFilteredOrders]);

  const yandexStatusCounts = useMemo(() => {
    const yandexOrders = storeFilteredOrders.filter((o: any) => o.source === "yandex");
    return {
      all: yandexOrders.length,
      NEW: yandexOrders.filter((o: any) => o.yandexStatus === "NEW").length,
      PROCESSING: yandexOrders.filter((o: any) => o.yandexStatus === "PROCESSING").length,
      READY_TO_SHIP: yandexOrders.filter((o: any) => o.yandexStatus === "READY_TO_SHIP").length,
      DELIVERY: yandexOrders.filter((o: any) => o.yandexStatus === "DELIVERY" || o.yandexStatus === "PICKUP").length,
      DELIVERED: yandexOrders.filter((o: any) => o.yandexStatus === "DELIVERED").length,
      CANCELLED: yandexOrders.filter((o: any) => o.yandexStatus === "CANCELLED" || o.yandexStatus === "RETURNED").length,
    };
  }, [storeFilteredOrders]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800";
      case "processing": return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800";
      case "pending": return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800";
      case "shipped": return "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800";
      case "cancelled": return "bg-muted text-muted-foreground border-border";
      case "disputed": return "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "pending": return "Новый";
      case "processing": return "В обработке";
      case "shipped": return "Отправлен";
      case "completed": return "Завершён";
      case "cancelled": return "Отменён";
      default: return status;
    }
  };

  const getSourceBadge = (source: string) => {
    if (source === "direct") {
      return <Badge className="bg-emerald-500/20 text-emerald-700 border-emerald-300 dark:text-emerald-300"><Store className="w-3 h-3 mr-1 inline" />Прямая</Badge>;
    }
    const mpStyle = getMarketplaceStyle(source);
    if (["ozon", "wildberries", "wb", "yandex", "yandex_market"].includes(source)) {
      return (
        <Badge
          className="border-0"
          style={{ backgroundColor: mpStyle.bg, color: mpStyle.color }}
        >
          {mpStyle.label}
        </Badge>
      );
    }
    return <Badge variant="outline" className="text-xs">Вручную</Badge>;
  };

  const pendingCount = storeFilteredOrders.filter((o: any) => o.status === "pending").length;
  const totalRevenue = storeFilteredOrders.reduce((sum: number, o: any) => sum + Number(o.totalAmount), 0);

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight" data-testid="text-orders-title">Заказы</h1>
            <p className="text-muted-foreground mt-2 text-lg">Отслеживание и выполнение заказов</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => syncOzonOrders.mutate()}
              disabled={syncOzonOrders.isPending}
              data-testid="button-sync-ozon-orders"
            >
              {syncOzonOrders.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              {syncOzonOrders.isPending && ozonStores.length > 0
                ? `Синхронизация ${ozonStores.length > 1 ? ozonStores.map(s => s.name).join(", ") + "..." : "магазина " + ozonStores[0].name + "..."}`
                : "Загрузить заказы Ozon"}
            </Button>
            <Button
              variant="outline"
              onClick={() => syncYandexOrders.mutate()}
              disabled={syncYandexOrders.isPending}
              data-testid="button-sync-yandex-orders"
            >
              {syncYandexOrders.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              {syncYandexOrders.isPending
                ? `Синхронизация Yandex${yandexStores.length > 0 ? " (" + yandexStores.map(s => s.name).join(", ") + ")..." : "..."}`
                : "Загрузить заказы Yandex"}
            </Button>
            <Button
              variant="outline"
              onClick={() => resyncOzonOrders.mutate()}
              disabled={resyncOzonOrders.isPending}
              data-testid="button-resync-ozon-orders"
            >
              {resyncOzonOrders.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Пересинхронизация
            </Button>
            <Button
              data-testid="button-direct-sale"
              onClick={() => setIsDirectSaleOpen(true)}
            >
              <Store className="w-4 h-4 mr-2" />
              Прямая продажа
            </Button>
          </div>
        </div>

        {syncingStores.length > 0 && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 text-sm" data-testid="sync-status-banner">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            <span>
              Синхронизация товаров для {syncingStores.map(s => `«${s.name}»`).join(", ")}… Заказы появятся после завершения импорта и синхронизации.
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <span className="teal-badge">
            <ShoppingCart className="w-4 h-4 mr-1.5 inline" />
            Всего: {storeFilteredOrders.length}
          </span>
          {pendingCount > 0 && (
            <span className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 px-3 py-1.5 rounded-full text-sm font-medium">
              Новых: {pendingCount}
            </span>
          )}
          <span className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 px-3 py-1.5 rounded-full text-sm font-medium">
            <CreditCard className="w-4 h-4 mr-1.5 inline" />
            {formatCurrency(totalRevenue, true)}
          </span>
        </div>

        {ozonStores.length > 1 && (
          <div className="flex gap-2 flex-wrap items-center" data-testid="store-filter-tabs">
            <span className="text-sm text-muted-foreground mr-1">Магазин:</span>
            <Button
              variant={storeFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setStoreFilter("all")}
              data-testid="button-store-filter-all"
            >
              Все магазины
            </Button>
            {ozonStores.map((store, idx) => {
              const storeColors = [
                "bg-teal-100 text-teal-800 border-teal-300 hover:bg-teal-200 dark:bg-teal-900/40 dark:text-teal-300 dark:border-teal-700",
                "bg-purple-100 text-purple-800 border-purple-300 hover:bg-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-700",
                "bg-orange-100 text-orange-800 border-orange-300 hover:bg-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700",
                "bg-pink-100 text-pink-800 border-pink-300 hover:bg-pink-200 dark:bg-pink-900/40 dark:text-pink-300 dark:border-pink-700",
              ];
              const colorClass = storeColors[idx % storeColors.length];
              return (
                <Button
                  key={store.id}
                  variant={storeFilter === store.id ? "default" : "outline"}
                  size="sm"
                  className={storeFilter !== store.id ? colorClass : ""}
                  onClick={() => setStoreFilter(store.id)}
                  data-testid={`button-store-filter-${store.id}`}
                >
                  <Store className="w-3.5 h-3.5 mr-1.5" />
                  {store.name}
                </Button>
              );
            })}
          </div>
        )}

        <div className="flex gap-2 flex-wrap" data-testid="fulfillment-filter-tabs">
          {([
            { key: "all" as FulfillmentFilter, label: "Все заказы" },
            { key: "FBS" as FulfillmentFilter, label: "FBS (со склада продавца)" },
            { key: "FBO" as FulfillmentFilter, label: "FBO (со склада Ozon)" },
            { key: "yandex" as FulfillmentFilter, label: "Yandex Market" },
            { key: "direct" as FulfillmentFilter, label: "Прямые продажи" },
          ]).map((tab) => (
            <Button
              key={tab.key}
              variant={fulfillmentFilter === tab.key ? "default" : "outline"}
              size="sm"
              onClick={() => { setFulfillmentFilter(tab.key); setFbsSubFilter("all"); setFboSubFilter("all"); setYandexSubFilter("all"); }}
              data-testid={`button-filter-${tab.key}`}
            >
              {tab.key === "FBO" && <Warehouse className="w-3.5 h-3.5 mr-1.5" />}
              {tab.key === "FBS" && <Truck className="w-3.5 h-3.5 mr-1.5" />}
              {tab.key === "yandex" && <ShoppingCart className="w-3.5 h-3.5 mr-1.5" />}
              {tab.key === "direct" && <Store className="w-3.5 h-3.5 mr-1.5" />}
              {tab.label}
              {tab.key === "yandex" && yandexStatusCounts.all > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">{yandexStatusCounts.all}</Badge>
              )}
            </Button>
          ))}
        </div>

        {fulfillmentFilter === "FBS" && (
          <div className="flex flex-wrap items-center gap-2" data-testid="fbs-sub-filter-tabs">
            {FBS_SUB_FILTERS.map((sub) => {
              const Icon = sub.icon;
              const count = fbsStatusCounts[sub.key] || 0;
              return (
                <Button
                  key={sub.key}
                  variant={fbsSubFilter === sub.key ? "default" : "ghost"}
                  size="sm"
                  className={fbsSubFilter === sub.key ? "" : "text-muted-foreground"}
                  onClick={() => {
                    setFbsSubFilter(sub.key);
                    if (!silentSync.isPending) {
                      silentSync.mutate();
                    }
                  }}
                  data-testid={`button-fbs-sub-${sub.key}`}
                >
                  <Icon className="w-3.5 h-3.5 mr-1.5" />
                  {sub.label}
                  {count > 0 && (
                    <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0" data-testid={`badge-fbs-count-${sub.key}`}>
                      {count}
                    </Badge>
                  )}
                </Button>
              );
            })}
            {silentSync.isPending && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" data-testid="fbs-sync-spinner" />}

            {(fbsSubFilter === "awaiting_packaging" || fbsSubFilter === "awaiting_deliver" || fbsSubFilter === "all") && awaitingShipmentCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20"
                onClick={() => bulkLabels.mutate()}
                disabled={bulkLabels.isPending}
                data-testid="button-bulk-labels"
              >
                {bulkLabels.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />}
                Скачать все этикетки ({awaitingShipmentCount})
              </Button>
            )}
          </div>
        )}

        {fulfillmentFilter === "FBO" && (
          <div className="flex flex-wrap items-center gap-2" data-testid="fbo-sub-filter-tabs">
            {FBO_SUB_FILTERS.map((sub) => {
              const Icon = sub.icon;
              const count = fboStatusCounts[sub.key] || 0;
              return (
                <Button
                  key={sub.key}
                  variant={fboSubFilter === sub.key ? "default" : "ghost"}
                  size="sm"
                  className={fboSubFilter === sub.key ? "" : "text-muted-foreground"}
                  onClick={() => {
                    setFboSubFilter(sub.key);
                    if (!silentSync.isPending) {
                      silentSync.mutate();
                    }
                  }}
                  data-testid={`button-fbo-sub-${sub.key}`}
                >
                  <Icon className="w-3.5 h-3.5 mr-1.5" />
                  {sub.label}
                  {count > 0 && (
                    <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0" data-testid={`badge-fbo-count-${sub.key}`}>
                      {count}
                    </Badge>
                  )}
                </Button>
              );
            })}
            {silentSync.isPending && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" data-testid="fbo-sync-spinner" />}
          </div>
        )}

        {fulfillmentFilter === "yandex" && (
          <div className="flex flex-wrap items-center gap-2" data-testid="yandex-sub-filter-tabs">
            {YANDEX_SUB_FILTERS.map((sub) => {
              const Icon = sub.icon;
              const count = yandexStatusCounts[sub.key] || 0;
              return (
                <Button
                  key={sub.key}
                  variant={yandexSubFilter === sub.key ? "default" : "ghost"}
                  size="sm"
                  className={yandexSubFilter === sub.key ? "" : "text-muted-foreground"}
                  onClick={() => setYandexSubFilter(sub.key)}
                  data-testid={`button-yandex-sub-${sub.key}`}
                >
                  <Icon className="w-3.5 h-3.5 mr-1.5" />
                  {sub.label}
                  {count > 0 && (
                    <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0" data-testid={`badge-yandex-count-${sub.key}`}>
                      {count}
                    </Badge>
                  )}
                </Button>
              );
            })}
          </div>
        )}

        {isLoading ? (
          <div className="grid gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="kpi-card animate-pulse">
                <CardContent className="py-6">
                  <div className="h-20 bg-muted rounded-xl" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredOrders.length === 0 ? (
          <Card className="kpi-card">
            <CardContent className="py-16 text-center">
              <ShoppingCart className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
              <p className="text-xl font-medium text-muted-foreground">Заказов пока нет</p>
              <p className="text-sm text-muted-foreground mt-2">Заказы появятся здесь после оформления</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {dateGroups.map((group) => (
              <div key={group.label} data-testid={`date-group-${group.label}`}>
                <div className="flex items-center gap-3 mb-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider" data-testid={`text-date-header-${group.label}`}>
                    {group.label}
                  </h3>
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground">{group.orders.length}</span>
                </div>
                <div className="grid gap-3">
                  {group.orders.map((order: any) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      storeName={order.sourceStoreName || (order.storeId ? storesMap.get(order.storeId) : undefined)}
                      storeId={order.storeId}
                      ozonStores={ozonStores}
                      getStatusColor={getStatusColor}
                      getStatusLabel={getStatusLabel}
                      getSourceBadge={getSourceBadge}
                      onClick={() => setSelectedOrder(order)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <DirectSaleDialog
        open={isDirectSaleOpen}
        onOpenChange={setIsDirectSaleOpen}
      />

      <OrderDetailDialog
        order={selectedOrder}
        open={!!selectedOrder}
        onOpenChange={(v) => { if (!v) setSelectedOrder(null); }}
        getStatusLabel={getStatusLabel}
        getSourceBadge={getSourceBadge}
        getStatusColor={getStatusColor}
      />
    </Layout>
  );
}

function OrderCard({ order, storeName, storeId, ozonStores, getStatusColor, getStatusLabel, getSourceBadge, onClick }: { 
  order: any; 
  storeName?: string;
  storeId?: number | null;
  ozonStores: { id: number; name: string }[];
  getStatusColor: (s: string) => string; 
  getStatusLabel: (s: string) => string;
  getSourceBadge: (s: string) => React.ReactNode;
  onClick: () => void;
}) {
  const { mutate: updateStatus, isPending } = useUpdateOrderStatus();
  const isDirectSale = order.source === "direct" || order.source === "manual";

  const itemImages = useMemo(() => {
    if (!order.items) return [];
    return order.items
      .filter((item: any) => item.product?.imageUrl)
      .map((item: any) => ({ id: item.id, url: item.product.imageUrl, name: item.product?.name || "Товар" }))
      .slice(0, 4);
  }, [order.items]);

  return (
    <Card className="kpi-card cursor-pointer hover-elevate" data-testid={`order-card-${order.id}`} onClick={onClick}>
      <CardContent className="py-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            {itemImages.length > 0 ? (
              <div className="flex-shrink-0 flex gap-1" data-testid={`order-thumbnails-${order.id}`}>
                {itemImages.slice(0, 3).map((img: any) => (
                  <div key={img.id} className="w-12 h-12 rounded-lg overflow-hidden border border-border bg-muted">
                    <img
                      src={img.url}
                      alt={img.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                ))}
                {itemImages.length > 3 && (
                  <div className="w-12 h-12 rounded-lg border border-border bg-muted flex items-center justify-center text-xs text-muted-foreground font-medium">
                    +{itemImages.length - 3}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 bg-primary/10 rounded-xl flex-shrink-0">
                <Package className="w-6 h-6 text-primary" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="font-bold text-lg">{order.orderNumber}</h3>
                {getSourceBadge(order.source)}
                {storeName && (() => {
                  const storeColorStyles = [
                    "bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-900/40 dark:text-teal-300 dark:border-teal-700",
                    "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-700",
                    "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700",
                    "bg-pink-100 text-pink-800 border-pink-300 dark:bg-pink-900/40 dark:text-pink-300 dark:border-pink-700",
                  ];
                  const storeIdx = ozonStores.findIndex(s => s.id === storeId);
                  const colorClass = storeIdx >= 0 ? storeColorStyles[storeIdx % storeColorStyles.length] : storeColorStyles[0];
                  return (
                    <Badge className={`text-xs ${colorClass}`} data-testid={`badge-store-name-${order.id}`}>
                      <Store className="w-3 h-3 mr-1" />
                      {storeName}
                    </Badge>
                  );
                })()}
              </div>
              <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  {order.createdAt ? format(new Date(order.createdAt), "d MMMM yyyy", { locale: ru }) : "-"}
                </span>
                <span className="flex items-center gap-1.5">
                  <User className="w-4 h-4" />
                  {order.customer?.name || "Гость"}
                </span>
                {order.postingNumber && (
                  <span className="flex items-center gap-1.5 font-mono text-xs">
                    <Truck className="w-3.5 h-3.5" />
                    {order.postingNumber}
                  </span>
                )}
              </div>
              {(order.ozonStatus || order.source === "ozon") && (
                <div className="mt-1.5 flex gap-1.5 flex-wrap">
                  {order.source === "ozon" && (
                    <Badge variant="outline" className={`text-xs ${order.fulfillmentType === "FBO" ? "border-purple-300 text-purple-700 dark:border-purple-700 dark:text-purple-400" : "border-teal-300 text-teal-700 dark:border-teal-700 dark:text-teal-400"}`} data-testid={`badge-fulfillment-${order.id}`}>
                      {order.fulfillmentType === "FBO" ? "FBO (склад Ozon)" : "FBS (свой склад)"}
                    </Badge>
                  )}
                  {order.ozonStatus && (
                    <Badge variant="outline" className="text-xs border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400" data-testid={`badge-ozon-status-${order.id}`}>
                      Ozon: {OZON_STATUS_LABELS[order.ozonStatus] || order.ozonStatus}
                    </Badge>
                  )}
                  {order.source === "yandex" && order.yandexStatus && (
                    <Badge variant="outline" className="text-xs border-yellow-300 text-yellow-700 dark:border-yellow-700 dark:text-yellow-400" data-testid={`badge-yandex-status-${order.id}`}>
                      Yandex: {getYandexStatusLabel(order.yandexStatus)}
                    </Badge>
                  )}
                </div>
              )}
              {order.items && order.items.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {order.items.slice(0, 3).map((item: any) => (
                    <Badge key={item.id} variant="secondary" className="text-xs font-normal">
                      {item.product?.name || "Товар"} x {item.quantity}
                    </Badge>
                  ))}
                  {order.items.length > 3 && (
                    <Badge variant="outline" className="text-xs">
                      +{order.items.length - 3}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-4 lg:gap-6">
            <div className="text-right">
              <p className="text-2xl font-bold">{formatCurrency(Number(order.totalAmount), true)}</p>
            </div>
            {isDirectSale ? (
              <div onClick={(e) => e.stopPropagation()}>
                <Select 
                  defaultValue={order.status} 
                  onValueChange={(val) => updateStatus({ id: order.id, status: val })}
                  disabled={isPending}
                >
                  <SelectTrigger 
                    className={`w-[150px] text-sm font-medium border ${getStatusColor(order.status)}`}
                    data-testid={`select-status-${order.id}`}
                  >
                    <SelectValue>{getStatusLabel(order.status)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Новый</SelectItem>
                    <SelectItem value="processing">В обработке</SelectItem>
                    <SelectItem value="shipped">Отправлен</SelectItem>
                    <SelectItem value="completed">Завершён</SelectItem>
                    <SelectItem value="cancelled">Отменён</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <Badge
                className={`text-sm font-medium px-3 py-1.5 ${getStatusColor(order.status)}`}
                data-testid={`badge-status-${order.id}`}
              >
                {order.source === "yandex" ? getYandexStatusLabel(order.yandexStatus) : getMarketplaceStatusLabel(order.ozonStatus)}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OrderDetailDialog({ order, open, onOpenChange, getStatusLabel, getSourceBadge, getStatusColor }: {
  order: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getStatusLabel: (s: string) => string;
  getSourceBadge: (s: string) => React.ReactNode;
  getStatusColor: (s: string) => string;
}) {
  const [, navigate] = useLocation();
  const ozonShip = useOzonShipOrder();
  const ozonCancel = useOzonCancelOrder();
  const ozonLabel = useOzonPrintLabel();

  if (!order) return null;

  const isDirectSale = order.source === "direct" || order.source === "manual";
  const isOzon = order.source === "ozon" && order.postingNumber;
  const isFbs = order.fulfillmentType === "FBS" || (!order.fulfillmentType && order.source === "ozon");
  const canShip = isOzon && isFbs && order.ozonStatus === "awaiting_packaging";
  const canLabel = isOzon && isFbs && ["awaiting_deliver", "awaiting_packaging"].includes(order.ozonStatus || "");
  const canCancel = isOzon && ["awaiting_approve", "awaiting_packaging"].includes(order.ozonStatus || "");

  const getSourceLabel = (source: string) => {
    switch (source) {
      case "ozon": return "OZON";
      case "wildberries": return "Wildberries";
      case "yandex": return "Yandex Market";
      case "direct": return "Прямая продажа";
      default: return "Вручную";
    }
  };

  const items = order.items || [];
  const totalAmount = Number(order.totalAmount) || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            {order.orderNumber}
          </DialogTitle>
          <DialogDescription>
            Детали заказа
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2" data-testid="badge-order-source-prominent">
              {getSourceBadge(order.source)}
              <span className="text-sm font-medium">{getSourceLabel(order.source)}</span>
            </div>
            <Badge className={`${getStatusColor(order.status)}`}>
              {isDirectSale ? getStatusLabel(order.status) : order.source === "yandex" ? getYandexStatusLabel(order.yandexStatus) : getMarketplaceStatusLabel(order.ozonStatus)}
            </Badge>
            {order.source === "ozon" && (
              <Badge variant="outline" className={`text-xs ${order.fulfillmentType === "FBO" ? "border-purple-300 text-purple-700 dark:border-purple-700 dark:text-purple-400" : "border-teal-300 text-teal-700 dark:border-teal-700 dark:text-teal-400"}`}>
                {order.fulfillmentType === "FBO" ? "FBO (склад Ozon)" : "FBS (свой склад)"}
              </Badge>
            )}
            {order.source === "yandex" && (
              <Badge variant="outline" className="text-xs border-yellow-300 text-yellow-700 dark:border-yellow-700 dark:text-yellow-400">
                Yandex Market FBS
              </Badge>
            )}
            {order.ozonStatus && (
              <Badge variant="outline" className="text-xs border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400">
                Ozon: {OZON_STATUS_LABELS[order.ozonStatus] || order.ozonStatus}
              </Badge>
            )}
            {order.source === "yandex" && order.yandexStatus && (
              <Badge variant="outline" className="text-xs border-yellow-300 text-yellow-700 dark:border-yellow-700 dark:text-yellow-400">
                Yandex: {getYandexStatusLabel(order.yandexStatus)}
              </Badge>
            )}
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              {order.createdAt ? format(new Date(order.createdAt), "d MMMM yyyy, HH:mm", { locale: ru }) : "-"}
            </span>
          </div>

          {isOzon && (
            <div className="flex flex-wrap items-center gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">Номер отправления Ozon</p>
                <p className="font-mono font-medium text-sm" data-testid="text-posting-number">{order.postingNumber}</p>
              </div>
              <div className="flex gap-2">
                {canShip && (
                  <Button
                    size="sm"
                    onClick={() => ozonShip.mutate(order.id)}
                    disabled={ozonShip.isPending}
                    data-testid="button-ozon-ship"
                  >
                    {ozonShip.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Truck className="w-4 h-4 mr-1.5" />}
                    Собрать заказ
                  </Button>
                )}
                {canLabel && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => ozonLabel.mutate(order.id)}
                    disabled={ozonLabel.isPending}
                    data-testid="button-ozon-label"
                  >
                    {ozonLabel.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Printer className="w-4 h-4 mr-1.5" />}
                    Этикетка 58x40
                  </Button>
                )}
                {canCancel && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => ozonCancel.mutate({ orderId: order.id })}
                    disabled={ozonCancel.isPending}
                    data-testid="button-ozon-cancel"
                  >
                    {ozonCancel.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <XCircle className="w-4 h-4 mr-1.5" />}
                    Отменить
                  </Button>
                )}
              </div>
            </div>
          )}

          <div>
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Package className="w-4 h-4" />
              Товары
            </h4>
            {items.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Товар</TableHead>
                      <TableHead>Артикул</TableHead>
                      <TableHead className="text-center">Кол-во</TableHead>
                      <TableHead className="text-right">Цена</TableHead>
                      <TableHead className="text-right">Продажа</TableHead>
                      <TableHead className="text-right">Сумма</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item: any) => {
                      const originalPrice = Number(item.originalPrice) || Number(item.price) || 0;
                      const salePrice = Number(item.salePrice) || Number(item.price) || 0;
                      const hasOverride = item.originalPrice && item.salePrice && Number(item.originalPrice) !== Number(item.salePrice);
                      return (
                        <TableRow key={item.id} data-testid={`row-order-item-${item.id}`}>
                          <TableCell>
                            {item.product?.imageUrl ? (
                              <div className="w-10 h-10 rounded-md overflow-hidden border border-border bg-muted">
                                <img
                                  src={item.product.imageUrl}
                                  alt={item.product?.name || "Товар"}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              </div>
                            ) : (
                              <div className="w-10 h-10 rounded-md border border-border bg-muted flex items-center justify-center">
                                <Package className="w-4 h-4 text-muted-foreground" />
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <p className="font-medium text-sm">{item.product?.name || "Товар"}</p>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">{item.product?.sku || "-"}</span>
                          </TableCell>
                          <TableCell className="text-center">
                            {item.quantity}
                          </TableCell>
                          <TableCell className="text-right">
                            {hasOverride ? (
                              <span className="text-sm text-muted-foreground line-through">{formatCurrency(originalPrice, true)}</span>
                            ) : (
                              <span className="text-sm">{formatCurrency(originalPrice, true)}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {hasOverride ? (
                              <span className="text-sm font-medium">{formatCurrency(salePrice, true)}</span>
                            ) : (
                              <span className="text-sm text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(salePrice * item.quantity, true)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Нет позиций</p>
            )}
          </div>

          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-md">
            <span className="text-sm font-medium text-muted-foreground">Итого:</span>
            <span className="text-2xl font-bold" data-testid="text-order-total">{formatCurrency(totalAmount, true)}</span>
          </div>

          {order.source === "direct" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Покупатель
                </h4>
                {order.customer ? (
                  <Card>
                    <CardContent className="py-3">
                      <p className="font-medium" data-testid="text-order-customer-name">{order.customer.name}</p>
                      {order.customer.phone && (
                        <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
                          <Phone className="w-3.5 h-3.5" />
                          {order.customer.phone}
                        </p>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => { onOpenChange(false); navigate("/customers"); }}
                        data-testid="button-view-customer"
                      >
                        <Eye className="w-3.5 h-3.5 mr-1.5" />
                        Профиль клиента
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="text-order-customer-guest">Гость (без привязки)</p>
                )}
              </div>
              <div>
                {order.notes && (
                  <div>
                    <h4 className="text-sm font-medium mb-1">Примечание</h4>
                    <p className="text-sm text-muted-foreground">{order.notes}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {order.notes && (
                <div>
                  <h4 className="text-sm font-medium mb-1">Примечание</h4>
                  <p className="text-sm text-muted-foreground">{order.notes}</p>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-order-detail">
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DirectSaleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: products } = useQuery<Product[]>({ queryKey: ["/api/products"] });
  const { data: customers } = useQuery<any[]>({ queryKey: ["/api/customers"] });
  const directSale = useCreateDirectSale();
  const { toast } = useToast();

  const [items, setItems] = useState<DirectSaleItem[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [showProductList, setShowProductList] = useState(false);
  const [customerMode, setCustomerMode] = useState<"existing" | "new" | "guest">("guest");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");

  const filteredProducts = useMemo(() => {
    if (!products || !productSearch.trim()) return [];
    const q = productSearch.toLowerCase();
    return products
      .filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
      )
      .filter((p) => !items.some((i) => i.productId === p.id))
      .slice(0, 8);
  }, [products, productSearch, items]);

  const addProduct = (product: Product) => {
    setItems((prev) => [
      ...prev,
      {
        productId: product.id,
        productName: product.name,
        quantity: 1,
        originalPrice: Number(product.sellingPrice) || Number(product.price) || 0,
        salePrice: Number(product.sellingPrice) || Number(product.price) || 0,
        maxStock: product.centralStock || 0,
      },
    ]);
    setProductSearch("");
    setShowProductList(false);
  };

  const updateItem = (productId: number, field: keyof DirectSaleItem, value: number) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.productId !== productId) return item;
        if (field === "quantity") {
          return { ...item, quantity: Math.max(1, Math.min(value, item.maxStock || 999)) };
        }
        if (field === "salePrice") {
          return { ...item, salePrice: Math.max(0, value) };
        }
        return item;
      })
    );
  };

  const removeItem = (productId: number) => {
    setItems((prev) => prev.filter((i) => i.productId !== productId));
  };

  const totalAmount = items.reduce((sum, i) => sum + i.salePrice * i.quantity, 0);

  const handleSubmit = () => {
    if (items.length === 0) {
      toast({ title: "Ошибка", description: "Добавьте хотя бы один товар", variant: "destructive" });
      return;
    }

    const overStockItems = items.filter((i) => i.quantity > i.maxStock && i.maxStock > 0);
    if (overStockItems.length > 0) {
      toast({ title: "Недостаточно товара", description: `${overStockItems[0].productName}: на складе ${overStockItems[0].maxStock} шт.`, variant: "destructive" });
      return;
    }

    if (customerMode === "new" && !newCustomerName.trim()) {
      toast({ title: "Ошибка", description: "Укажите имя покупателя", variant: "destructive" });
      return;
    }

    const payload: any = {
      items: items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        originalPrice: i.originalPrice,
        salePrice: i.salePrice,
      })),
      notes,
    };

    if (customerMode === "existing" && selectedCustomerId) {
      payload.customerId = Number(selectedCustomerId);
    } else if (customerMode === "new") {
      payload.newCustomer = { name: newCustomerName, phone: newCustomerPhone || undefined };
    }

    directSale.mutate(payload, {
      onSuccess: () => {
        setItems([]);
        setProductSearch("");
        setCustomerMode("guest");
        setSelectedCustomerId("");
        setNewCustomerName("");
        setNewCustomerPhone("");
        setNotes("");
        onOpenChange(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="w-5 h-5" />
            Оформление прямой продажи
          </DialogTitle>
          <DialogDescription>
            Создайте заказ для клиента в магазине
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div>
            <Label className="text-sm font-medium flex items-center gap-2 mb-2">
              <Package className="w-4 h-4" />
              Товары
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по названию, артикулу или штрихкоду..."
                className="pl-9"
                value={productSearch}
                onChange={(e) => { setProductSearch(e.target.value); setShowProductList(true); }}
                onFocus={() => setShowProductList(true)}
                data-testid="input-product-search"
              />
            </div>
            {showProductList && filteredProducts.length > 0 && (
              <div className="mt-1 border rounded-lg bg-popover shadow-lg max-h-48 overflow-y-auto">
                {filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex justify-between"
                    onClick={() => addProduct(p)}
                    data-testid={`button-add-product-${p.id}`}
                  >
                    <span>{p.name} <span className="text-muted-foreground">({p.sku})</span></span>
                    <span className="text-muted-foreground">{formatCurrency(Number(p.sellingPrice) || Number(p.price) || 0, true)}</span>
                  </button>
                ))}
              </div>
            )}

            {items.length > 0 && (
              <div className="mt-3 space-y-2">
                {items.map((item) => (
                  <div key={item.productId} className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30" data-testid={`direct-sale-item-${item.productId}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.productName}</p>
                      <p className="text-xs text-muted-foreground">Склад: {item.maxStock} шт.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        className="w-16 text-center"
                        value={item.quantity}
                        onChange={(e) => updateItem(item.productId, "quantity", Number(e.target.value))}
                        min={1}
                        max={item.maxStock || 999}
                        data-testid={`input-quantity-${item.productId}`}
                      />
                      <span className="text-xs text-muted-foreground">x</span>
                      <Input
                        type="number"
                        className="w-24"
                        value={item.salePrice}
                        onChange={(e) => updateItem(item.productId, "salePrice", Number(e.target.value))}
                        min={0}
                        data-testid={`input-price-${item.productId}`}
                      />
                      <span className="text-sm font-medium w-24 text-right">
                        {formatCurrency(item.salePrice * item.quantity, true)}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => removeItem(item.productId)} data-testid={`button-remove-${item.productId}`}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
                <div className="flex justify-end pt-2 border-t">
                  <span className="text-lg font-bold" data-testid="text-direct-sale-total">Итого: {formatCurrency(totalAmount, true)}</span>
                </div>
              </div>
            )}
          </div>

          <div>
            <Label className="text-sm font-medium flex items-center gap-2 mb-2">
              <User className="w-4 h-4" />
              Покупатель
            </Label>
            <div className="flex gap-2 mb-3">
              {(["guest", "existing", "new"] as const).map((mode) => (
                <Button
                  key={mode}
                  variant={customerMode === mode ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCustomerMode(mode)}
                  data-testid={`button-customer-mode-${mode}`}
                >
                  {mode === "guest" && "Гость"}
                  {mode === "existing" && "Из базы"}
                  {mode === "new" && <><UserPlus className="w-3.5 h-3.5 mr-1" />Новый</>}
                </Button>
              ))}
            </div>
            {customerMode === "existing" && (
              <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                <SelectTrigger data-testid="select-customer">
                  <SelectValue placeholder="Выберите покупателя" />
                </SelectTrigger>
                <SelectContent>
                  {customers?.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}{c.phone ? ` (${c.phone})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {customerMode === "new" && (
              <div className="space-y-2">
                <Input placeholder="Имя покупателя" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} data-testid="input-new-customer-name" />
                <Input placeholder="Телефон (необязательно)" value={newCustomerPhone} onChange={(e) => setNewCustomerPhone(e.target.value)} data-testid="input-new-customer-phone" />
              </div>
            )}
          </div>

          <div>
            <Label className="text-sm font-medium mb-2 block">Примечание</Label>
            <Textarea placeholder="Примечание к заказу (необязательно)" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-order-notes" />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={directSale.isPending || items.length === 0} data-testid="button-submit-direct-sale">
            {directSale.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CreditCard className="w-4 h-4 mr-2" />}
            Оформить ({formatCurrency(totalAmount, true)})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
