import { Layout } from "@/components/Layout";
import { useOrders, useUpdateOrderStatus, useCreateDirectSale, useOzonShipOrder, useOzonCancelOrder, useSyncOzonOrders, useOzonPrintLabel } from "@/hooks/use-orders";
import { format } from "date-fns";
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
import { ShoppingCart, Package, Calendar, User, CreditCard, Plus, Search, Trash2, UserPlus, Store, Eye, FileText, Phone, RefreshCw, Truck, XCircle, Loader2, Printer, Warehouse } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { getMarketplaceStyle } from "@/lib/marketplace";
import { useQuery } from "@tanstack/react-query";
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

export default function Orders() {
  const { data: orders, isLoading } = useOrders();
  const [isDirectSaleOpen, setIsDirectSaleOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [fulfillmentFilter, setFulfillmentFilter] = useState<"all" | "FBS" | "FBO" | "direct">("all");
  const syncOzonOrders = useSyncOzonOrders();

  const filteredOrders = useMemo(() => {
    if (!orders) return [];
    if (fulfillmentFilter === "all") return orders;
    if (fulfillmentFilter === "direct") return orders.filter((o: any) => o.source === "direct" || o.source === "manual");
    if (fulfillmentFilter === "FBS") return orders.filter((o: any) => o.fulfillmentType === "FBS" || (!o.fulfillmentType && o.source === "ozon"));
    return orders.filter((o: any) => o.fulfillmentType === fulfillmentFilter);
  }, [orders, fulfillmentFilter]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800";
      case "processing": return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800";
      case "pending": return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800";
      case "shipped": return "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800";
      case "cancelled": return "bg-muted text-muted-foreground border-border";
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
          className="no-default-hover-elevate border-0"
          style={{ backgroundColor: mpStyle.bg, color: mpStyle.color }}
        >
          {mpStyle.label}
        </Badge>
      );
    }
    return <Badge variant="outline" className="text-xs">Вручную</Badge>;
  };

  const pendingCount = orders?.filter((o: any) => o.status === "pending").length || 0;
  const totalRevenue = orders?.reduce((sum: number, o: any) => sum + Number(o.totalAmount), 0) || 0;

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
              Загрузить заказы Ozon
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

        <div className="flex flex-wrap gap-3">
          <span className="teal-badge">
            <ShoppingCart className="w-4 h-4 mr-1.5 inline" />
            Всего: {orders?.length || 0}
          </span>
          {pendingCount > 0 && (
            <span className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 px-3 py-1.5 rounded-full text-sm font-medium">
              Новых: {pendingCount}
            </span>
          )}
          <span className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 px-3 py-1.5 rounded-full text-sm font-medium">
            <CreditCard className="w-4 h-4 mr-1.5 inline" />
            {formatCurrency(totalRevenue)}
          </span>
        </div>

        <div className="flex gap-2" data-testid="fulfillment-filter-tabs">
          {([
            { key: "all", label: "Все заказы" },
            { key: "FBS", label: "FBS (со склада продавца)" },
            { key: "FBO", label: "FBO (со склада Ozon)" },
            { key: "direct", label: "Прямые продажи" },
          ] as const).map((tab) => (
            <Button
              key={tab.key}
              variant={fulfillmentFilter === tab.key ? "default" : "outline"}
              size="sm"
              onClick={() => setFulfillmentFilter(tab.key)}
              data-testid={`button-filter-${tab.key}`}
            >
              {tab.key === "FBO" && <Warehouse className="w-3.5 h-3.5 mr-1.5" />}
              {tab.key === "FBS" && <Truck className="w-3.5 h-3.5 mr-1.5" />}
              {tab.key === "direct" && <Store className="w-3.5 h-3.5 mr-1.5" />}
              {tab.label}
            </Button>
          ))}
        </div>

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
          <div className="grid gap-4">
            {filteredOrders.map((order: any) => (
              <OrderCard 
                key={order.id} 
                order={order} 
                getStatusColor={getStatusColor} 
                getStatusLabel={getStatusLabel}
                getSourceBadge={getSourceBadge}
                onClick={() => setSelectedOrder(order)}
              />
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

function OrderCard({ order, getStatusColor, getStatusLabel, getSourceBadge, onClick }: { 
  order: any; 
  getStatusColor: (s: string) => string; 
  getStatusLabel: (s: string) => string;
  getSourceBadge: (s: string) => React.ReactNode;
  onClick: () => void;
}) {
  const { mutate: updateStatus, isPending } = useUpdateOrderStatus();

  return (
    <Card className="kpi-card cursor-pointer hover-elevate" data-testid={`order-card-${order.id}`} onClick={onClick}>
      <CardContent className="py-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-primary/10 rounded-xl flex-shrink-0">
              <Package className="w-6 h-6 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="font-bold text-lg">{order.orderNumber}</h3>
                {getSourceBadge(order.source)}
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
                <div className="mt-1.5 flex gap-1.5">
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
              <p className="text-2xl font-bold">{formatCurrency(Number(order.totalAmount))}</p>
            </div>
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
              {getStatusLabel(order.status)}
            </Badge>
            {order.fulfillmentType && (
              <Badge variant="outline" className={`text-xs ${order.fulfillmentType === "FBO" ? "border-purple-300 text-purple-700 dark:border-purple-700 dark:text-purple-400" : "border-teal-300 text-teal-700 dark:border-teal-700 dark:text-teal-400"}`}>
                {order.fulfillmentType === "FBO" ? "FBO (склад Ozon)" : "FBS (свой склад)"}
              </Badge>
            )}
            {order.ozonStatus && (
              <Badge variant="outline" className="text-xs border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400">
                Ozon: {OZON_STATUS_LABELS[order.ozonStatus] || order.ozonStatus}
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
                    Этикетка
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
                              <span className="text-sm text-muted-foreground line-through">{formatCurrency(originalPrice)}</span>
                            ) : (
                              <span className="text-sm">{formatCurrency(originalPrice)}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {hasOverride ? (
                              <span className="text-sm font-medium">{formatCurrency(salePrice)}</span>
                            ) : (
                              <span className="text-sm text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(salePrice * item.quantity)}
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
            <span className="text-2xl font-bold" data-testid="text-order-total">{formatCurrency(totalAmount)}</span>
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
      notes: notes || undefined,
    };

    if (customerMode === "existing" && selectedCustomerId) {
      payload.customerId = Number(selectedCustomerId);
    } else if (customerMode === "new" && newCustomerName.trim()) {
      payload.newCustomer = {
        name: newCustomerName.trim(),
        phone: newCustomerPhone.trim() || undefined,
      };
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

  const resetDialog = () => {
    setItems([]);
    setProductSearch("");
    setShowProductList(false);
    setCustomerMode("guest");
    setSelectedCustomerId("");
    setNewCustomerName("");
    setNewCustomerPhone("");
    setNotes("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetDialog(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="w-5 h-5" />
            Прямая продажа / Самовывоз
          </DialogTitle>
          <DialogDescription>
            Оформите продажу с выбором товаров, покупателя и ценой
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div>
            <Label className="text-sm font-medium mb-2 block">Товары</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={productSearch}
                onChange={(e) => { setProductSearch(e.target.value); setShowProductList(true); }}
                onFocus={() => setShowProductList(true)}
                placeholder="Поиск по названию, артикулу или штрихкоду..."
                className="pl-10"
                data-testid="input-product-search"
              />
              {showProductList && filteredProducts.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto">
                  {filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      className="w-full text-left px-3 py-2 hover-elevate flex items-center justify-between gap-2"
                      onClick={() => addProduct(product)}
                      data-testid={`button-add-product-${product.id}`}
                    >
                      <div>
                        <p className="font-medium text-sm">{product.name}</p>
                        <p className="text-xs text-muted-foreground">{product.sku}{product.barcode ? ` | ${product.barcode}` : ""}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-medium">{formatCurrency(Number(product.sellingPrice) || Number(product.price))}</p>
                        <p className="text-xs text-muted-foreground">Склад: {product.centralStock}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {items.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Товар</TableHead>
                      <TableHead className="text-center w-24">Кол-во</TableHead>
                      <TableHead className="text-right w-32">Цена</TableHead>
                      <TableHead className="text-right w-28">Сумма</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.productId} data-testid={`row-sale-item-${item.productId}`}>
                        <TableCell>
                          <p className="font-medium text-sm">{item.productName}</p>
                          <p className="text-xs text-muted-foreground">Склад: {item.maxStock} шт.</p>
                        </TableCell>
                        <TableCell className="text-center">
                          <Input
                            type="number"
                            min={1}
                            max={item.maxStock || 999}
                            value={item.quantity}
                            onChange={(e) => updateItem(item.productId, "quantity", parseInt(e.target.value) || 1)}
                            className="w-20 mx-auto text-center"
                            data-testid={`input-quantity-${item.productId}`}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={item.salePrice}
                            onChange={(e) => updateItem(item.productId, "salePrice", parseFloat(e.target.value) || 0)}
                            className="w-28 ml-auto text-right"
                            data-testid={`input-price-${item.productId}`}
                          />
                          {item.salePrice !== item.originalPrice && (
                            <p className="text-xs text-muted-foreground line-through mt-0.5">{formatCurrency(item.originalPrice)}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(item.salePrice * item.quantity)}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => removeItem(item.productId)}
                            data-testid={`button-remove-item-${item.productId}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div>
            <Label className="text-sm font-medium mb-2 block">Покупатель</Label>
            <div className="flex flex-wrap gap-2 mb-3">
              <Button
                variant={customerMode === "guest" ? "default" : "outline"}
                size="sm"
                onClick={() => setCustomerMode("guest")}
                data-testid="button-customer-guest"
              >
                <User className="w-3.5 h-3.5 mr-1.5" />
                Гость
              </Button>
              <Button
                variant={customerMode === "existing" ? "default" : "outline"}
                size="sm"
                onClick={() => setCustomerMode("existing")}
                data-testid="button-customer-existing"
              >
                <Search className="w-3.5 h-3.5 mr-1.5" />
                Из базы
              </Button>
              <Button
                variant={customerMode === "new" ? "default" : "outline"}
                size="sm"
                onClick={() => setCustomerMode("new")}
                data-testid="button-customer-new"
              >
                <UserPlus className="w-3.5 h-3.5 mr-1.5" />
                Новый
              </Button>
            </div>

            {customerMode === "existing" && (
              <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                <SelectTrigger data-testid="select-customer">
                  <SelectValue placeholder="Выберите покупателя" />
                </SelectTrigger>
                <SelectContent>
                  {customers?.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}{c.phone ? ` (${c.phone})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {customerMode === "new" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Имя</Label>
                  <Input
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder="Имя покупателя"
                    data-testid="input-new-customer-name"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Телефон</Label>
                  <Input
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    placeholder="+7 (999) 123-45-67"
                    data-testid="input-new-customer-phone"
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Примечание</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Необязательное примечание к продаже..."
              className="resize-none"
              rows={2}
              data-testid="input-sale-notes"
            />
          </div>

          {items.length > 0 && (
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-md">
              <span className="text-sm font-medium text-muted-foreground">Итого к оплате:</span>
              <span className="text-2xl font-bold" data-testid="text-sale-total">{formatCurrency(totalAmount)}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { resetDialog(); onOpenChange(false); }} data-testid="button-cancel-sale">
            Отмена
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={items.length === 0 || directSale.isPending}
            data-testid="button-confirm-sale"
          >
            {directSale.isPending ? "Оформление..." : "Оформить продажу"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
