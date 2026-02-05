import { Layout } from "@/components/Layout";
import { useProducts } from "@/hooks/use-products";
import { useOrders } from "@/hooks/use-orders";
import { useTaxSettings } from "@/hooks/use-tax-settings";
import { useAuditLog } from "@/hooks/use-audit-log";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatQuantity, angleQuote } from "@/lib/format";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { FileText, History, TrendingUp, TrendingDown } from "lucide-react";

export default function Reports() {
  const { data: products } = useProducts();
  const { data: orders } = useOrders();
  const { data: taxSettings } = useTaxSettings();
  const { data: auditLog, isLoading: auditLoading } = useAuditLog();

  // Calculate P&L data
  const calculatePnL = () => {
    if (!products || !orders) return null;

    const taxRate = taxSettings?.taxSystem === "usn_15" ? 0.15 : 0.06;
    const defaultCommission = Number(taxSettings?.defaultMarketplaceCommission || 15) / 100;
    const defaultLogistics = Number(taxSettings?.defaultLogisticsCost || 100);

    let grossRevenue = 0;
    let cogs = 0;
    let marketplaceFees = 0;
    let logistics = 0;

    // Calculate from orders
    orders.forEach(order => {
      const orderRevenue = Number(order.totalAmount);
      grossRevenue += orderRevenue;

      order.items?.forEach(item => {
        const product = products.find(p => p.id === item.productId);
        if (product) {
          cogs += item.quantity * Number(product.purchasePrice || 0);
          const commissionRate = product.marketplaceCommission != null && product.marketplaceCommission !== "" 
            ? Number(product.marketplaceCommission) / 100 
            : defaultCommission;
          marketplaceFees += item.quantity * Number(item.price) * commissionRate;
          const logCost = product.logisticsCost != null && product.logisticsCost !== "" 
            ? Number(product.logisticsCost) 
            : defaultLogistics;
          logistics += item.quantity * logCost;
        }
      });
    });

    let taxes = 0;
    if (taxSettings?.taxSystem === "usn_15") {
      const taxableIncome = grossRevenue - cogs - marketplaceFees - logistics;
      taxes = Math.max(taxableIncome * 0.15, grossRevenue * 0.01);
    } else {
      taxes = grossRevenue * 0.06;
    }

    const netProfit = grossRevenue - cogs - marketplaceFees - logistics - taxes;

    return {
      grossRevenue,
      cogs,
      marketplaceFees,
      logistics,
      taxes,
      netProfit,
    };
  };

  const pnl = calculatePnL();

  const getActionLabel = (action: string) => {
    switch (action) {
      case "stock_inflow": return "Оприходование";
      case "stock_adjustment": return "Корректировка остатка";
      case "product_create": return "Создание товара";
      case "product_update": return "Обновление товара";
      case "order_create": return "Создание заказа";
      default: return action;
    }
  };

  const getEntityTypeLabel = (type: string) => {
    switch (type) {
      case "product": return "Товар";
      case "order": return "Заказ";
      case "customer": return "Клиент";
      default: return type;
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Отчёты</h2>
          <p className="text-muted-foreground mt-1">Финансовая отчётность и история изменений</p>
        </div>

        <Tabs defaultValue="pnl" className="space-y-4">
          <TabsList>
            <TabsTrigger value="pnl" className="gap-2">
              <FileText className="w-4 h-4" />
              P&L отчёт
            </TabsTrigger>
            <TabsTrigger value="audit" className="gap-2">
              <History className="w-4 h-4" />
              Аудит-лог
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pnl">
            <Card className="dashboard-card">
              <CardHeader>
                <CardTitle>Отчёт о прибылях и убытках</CardTitle>
                <CardDescription>
                  Финансовые показатели за период. Система налогообложения: {angleQuote(taxSettings?.taxSystem === "usn_15" ? "УСН 15%" : "УСН 6%")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {pnl ? (
                  <div className="space-y-6">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50/50">
                          <TableHead className="w-1/2">Показатель</TableHead>
                          <TableHead className="text-right">Сумма</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell className="font-medium flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-green-500" />
                            Валовая выручка (Gross Revenue)
                          </TableCell>
                          <TableCell className="text-right font-semibold text-green-600">
                            {formatCurrency(pnl.grossRevenue)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium pl-8 text-muted-foreground">
                            − Себестоимость (COGS)
                          </TableCell>
                          <TableCell className="text-right text-red-600">
                            −{formatCurrency(pnl.cogs)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium pl-8 text-muted-foreground">
                            − Комиссии маркетплейсов
                          </TableCell>
                          <TableCell className="text-right text-red-600">
                            −{formatCurrency(pnl.marketplaceFees)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium pl-8 text-muted-foreground">
                            − Логистика
                          </TableCell>
                          <TableCell className="text-right text-red-600">
                            −{formatCurrency(pnl.logistics)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium pl-8 text-muted-foreground">
                            − Налоги ({taxSettings?.taxSystem === "usn_15" ? "УСН 15%" : "УСН 6%"})
                          </TableCell>
                          <TableCell className="text-right text-red-600">
                            −{formatCurrency(pnl.taxes)}
                          </TableCell>
                        </TableRow>
                        <TableRow className="bg-slate-50 border-t-2">
                          <TableCell className="font-bold flex items-center gap-2">
                            {pnl.netProfit >= 0 ? (
                              <TrendingUp className="w-4 h-4 text-green-500" />
                            ) : (
                              <TrendingDown className="w-4 h-4 text-red-500" />
                            )}
                            Чистая прибыль (Net Profit)
                          </TableCell>
                          <TableCell className={`text-right font-bold text-lg ${pnl.netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {formatCurrency(pnl.netProfit)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
                      <div className="text-center p-4 bg-green-50 rounded-lg">
                        <p className="text-sm text-muted-foreground">Выручка</p>
                        <p className="text-xl font-bold text-green-600">{formatCurrency(pnl.grossRevenue)}</p>
                      </div>
                      <div className="text-center p-4 bg-red-50 rounded-lg">
                        <p className="text-sm text-muted-foreground">Расходы</p>
                        <p className="text-xl font-bold text-red-600">{formatCurrency(pnl.cogs + pnl.marketplaceFees + pnl.logistics)}</p>
                      </div>
                      <div className="text-center p-4 bg-amber-50 rounded-lg">
                        <p className="text-sm text-muted-foreground">Налоги</p>
                        <p className="text-xl font-bold text-amber-600">{formatCurrency(pnl.taxes)}</p>
                      </div>
                      <div className={`text-center p-4 rounded-lg ${pnl.netProfit >= 0 ? "bg-blue-50" : "bg-red-50"}`}>
                        <p className="text-sm text-muted-foreground">Прибыль</p>
                        <p className={`text-xl font-bold ${pnl.netProfit >= 0 ? "text-blue-600" : "text-red-600"}`}>
                          {formatCurrency(pnl.netProfit)}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">Нет данных для отображения</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit">
            <Card className="dashboard-card">
              <CardHeader>
                <CardTitle>История изменений</CardTitle>
                <CardDescription>Журнал всех изменений остатков и данных</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/50">
                      <TableHead>Дата и время</TableHead>
                      <TableHead>Пользователь</TableHead>
                      <TableHead>Действие</TableHead>
                      <TableHead>Объект</TableHead>
                      <TableHead className="text-right">Изменение</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditLoading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8">Загрузка...</TableCell>
                      </TableRow>
                    ) : auditLog?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          Нет записей в журнале
                        </TableCell>
                      </TableRow>
                    ) : (
                      auditLog?.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="text-sm text-muted-foreground">
                            {entry.createdAt ? format(new Date(entry.createdAt), "d MMM yyyy, HH:mm", { locale: ru }) : "-"}
                          </TableCell>
                          <TableCell>{entry.userName || "Система"}</TableCell>
                          <TableCell>
                            <span className="px-2 py-1 bg-slate-100 rounded text-xs font-medium">
                              {getActionLabel(entry.action)}
                            </span>
                          </TableCell>
                          <TableCell>
                            {getEntityTypeLabel(entry.entityType)} #{entry.entityId}
                          </TableCell>
                          <TableCell className="text-right">
                            {entry.delta !== null && entry.delta !== undefined ? (
                              <span className={`font-medium ${entry.delta > 0 ? "text-green-600" : "text-red-600"}`}>
                                {entry.delta > 0 ? "+" : ""}{entry.delta} шт.
                              </span>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
