import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useProducts } from "@/hooks/use-products";
import { useOrders } from "@/hooks/use-orders";
import { useTaxSettings } from "@/hooks/use-tax-settings";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { formatCurrency, formatQuantity, angleQuote } from "@/lib/format";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { FileText, History, TrendingUp, TrendingDown, Plus, Trash2, Wallet, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Expense, Company } from "@shared/schema";

const INTERNAL_TYPES = [
  { value: "salary", label: "Зарплата" },
  { value: "rent", label: "Аренда" },
  { value: "supplies", label: "Складские расходы" },
];

const EXTERNAL_TYPES = [
  { value: "taxes", label: "Налоги" },
  { value: "commission", label: "Комиссии МП" },
  { value: "logistics", label: "Логистика" },
];

function getTypeLabel(type: string): string {
  const all = [...INTERNAL_TYPES, ...EXTERNAL_TYPES];
  return all.find(t => t.value === type)?.label || type;
}

export default function Reports() {
  const { data: products } = useProducts();
  const { data: orders } = useOrders();
  const { data: taxSettings } = useTaxSettings();
  const { data: auditLog, isLoading: auditLoading } = useAuditLog();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: expenses, isLoading: expensesLoading } = useQuery<Expense[]>({
    queryKey: ["/api/expenses"],
  });

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [newCategory, setNewCategory] = useState<"internal" | "external">("internal");
  const [newType, setNewType] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newCompanyId, setNewCompanyId] = useState("");

  const createExpenseMutation = useMutation({
    mutationFn: async (data: { companyId: number | null; category: string; type: string; description: string; amount: string; organizationId: string }) => {
      const res = await apiRequest("POST", "/api/expenses", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      toast({ title: "Создано", description: "Расход успешно добавлен" });
      resetForm();
      setDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/expenses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      toast({ title: "Удалено", description: "Расход удалён" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setNewCategory("internal");
    setNewType("");
    setNewDescription("");
    setNewAmount("");
    setNewCompanyId("");
  };

  const handleCreateExpense = () => {
    if (!newType || !newAmount) return;
    createExpenseMutation.mutate({
      companyId: newCompanyId ? Number(newCompanyId) : null,
      category: newCategory,
      type: newType,
      description: newDescription,
      amount: newAmount,
      organizationId: "",
    });
  };

  const internalExpenses = expenses?.filter(e => e.category === "internal") || [];
  const externalExpenses = expenses?.filter(e => e.category === "external") || [];
  const internalTotal = internalExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const externalTotal = externalExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const grandTotal = internalTotal + externalTotal;

  const calculatePnL = () => {
    if (!products || !orders) return null;

    const defaultCommission = Number(taxSettings?.defaultMarketplaceCommission || 15) / 100;
    const defaultLogistics = Number(taxSettings?.defaultLogisticsCost || 100);

    let grossRevenue = 0;
    let cogs = 0;
    let marketplaceFees = 0;
    let logistics = 0;

    orders.forEach(order => {
      const orderRevenue = Number(order.totalAmount);
      grossRevenue += orderRevenue;

      order.items?.forEach((item: any) => {
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

    const expInternalSalary = internalExpenses.filter(e => e.type === "salary").reduce((s, e) => s + Number(e.amount), 0);
    const expInternalRent = internalExpenses.filter(e => e.type === "rent").reduce((s, e) => s + Number(e.amount), 0);
    const expInternalOther = internalExpenses.filter(e => e.type === "supplies").reduce((s, e) => s + Number(e.amount), 0);
    const expExtCommission = externalExpenses.filter(e => e.type === "commission").reduce((s, e) => s + Number(e.amount), 0);
    const expExtLogistics = externalExpenses.filter(e => e.type === "logistics").reduce((s, e) => s + Number(e.amount), 0);
    const expExtTaxes = externalExpenses.filter(e => e.type === "taxes").reduce((s, e) => s + Number(e.amount), 0);

    const totalExpenses = cogs + marketplaceFees + logistics + taxes + internalTotal + externalTotal;
    const netProfit = grossRevenue - totalExpenses;

    return {
      grossRevenue,
      cogs,
      marketplaceFees,
      logistics,
      taxes,
      expInternalSalary,
      expInternalRent,
      expInternalOther,
      expExtCommission,
      expExtLogistics,
      expExtTaxes,
      internalTotal,
      externalTotal,
      totalExpenses,
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

  const typeOptions = newCategory === "internal" ? INTERNAL_TYPES : EXTERNAL_TYPES;

  const renderExpenseTable = (items: Expense[], title: string, categoryLabel: string) => (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        {categoryLabel === "internal" ? <Building2 className="w-5 h-5" /> : <Wallet className="w-5 h-5" />}
        {title}
      </h3>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead>Тип</TableHead>
            <TableHead>Описание</TableHead>
            <TableHead className="text-right">Сумма</TableHead>
            <TableHead>Дата</TableHead>
            <TableHead className="w-12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                Нет расходов
              </TableCell>
            </TableRow>
          ) : (
            items.map((expense) => (
              <TableRow key={expense.id} data-testid={`row-expense-${expense.id}`}>
                <TableCell className="font-medium">{getTypeLabel(expense.type)}</TableCell>
                <TableCell className="text-muted-foreground">{expense.description || "—"}</TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(expense.amount)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {expense.date ? format(new Date(expense.date), "d MMM yyyy", { locale: ru }) : "—"}
                </TableCell>
                <TableCell>
                  <Button
                    size="icon"
                    variant="ghost"
                    data-testid={`button-delete-expense-${expense.id}`}
                    onClick={() => deleteExpenseMutation.mutate(expense.id)}
                    disabled={deleteExpenseMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
          {items.length > 0 && (
            <TableRow className="bg-muted/30 border-t-2">
              <TableCell colSpan={2} className="font-bold">Итого</TableCell>
              <TableCell className="text-right font-bold">
                {formatCurrency(items.reduce((s, e) => s + Number(e.amount), 0))}
              </TableCell>
              <TableCell colSpan={2}></TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Отчёты</h1>
          <p className="text-muted-foreground mt-2 text-lg">Финансовая отчётность и история изменений</p>
        </div>

        <Tabs defaultValue="pnl" className="space-y-4">
          <TabsList>
            <TabsTrigger value="pnl" className="gap-2" data-testid="tab-pnl">
              <FileText className="w-4 h-4" />
              P&L отчёт
            </TabsTrigger>
            <TabsTrigger value="expenses" className="gap-2" data-testid="tab-expenses">
              <Wallet className="w-4 h-4" />
              Расходы
            </TabsTrigger>
            <TabsTrigger value="audit" className="gap-2" data-testid="tab-audit">
              <History className="w-4 h-4" />
              Аудит-лог
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pnl">
            <Card className="kpi-card">
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
                        <TableRow className="bg-muted/30">
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
                          <TableCell className="text-right font-semibold text-green-600" data-testid="text-gross-revenue">
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

                        {(pnl.internalTotal > 0 || pnl.externalTotal > 0) && (
                          <>
                            <TableRow className="bg-muted/20">
                              <TableCell colSpan={2} className="font-semibold text-muted-foreground text-xs uppercase tracking-wider pt-4">
                                Внутренние расходы
                              </TableCell>
                            </TableRow>
                            {pnl.expInternalSalary > 0 && (
                              <TableRow>
                                <TableCell className="font-medium pl-8 text-muted-foreground">− Зарплата</TableCell>
                                <TableCell className="text-right text-red-600">−{formatCurrency(pnl.expInternalSalary)}</TableCell>
                              </TableRow>
                            )}
                            {pnl.expInternalRent > 0 && (
                              <TableRow>
                                <TableCell className="font-medium pl-8 text-muted-foreground">− Аренда</TableCell>
                                <TableCell className="text-right text-red-600">−{formatCurrency(pnl.expInternalRent)}</TableCell>
                              </TableRow>
                            )}
                            {pnl.expInternalOther > 0 && (
                              <TableRow>
                                <TableCell className="font-medium pl-8 text-muted-foreground">− Прочие внутренние</TableCell>
                                <TableCell className="text-right text-red-600">−{formatCurrency(pnl.expInternalOther)}</TableCell>
                              </TableRow>
                            )}

                            <TableRow className="bg-muted/20">
                              <TableCell colSpan={2} className="font-semibold text-muted-foreground text-xs uppercase tracking-wider pt-4">
                                Внешние расходы
                              </TableCell>
                            </TableRow>
                            {pnl.expExtCommission > 0 && (
                              <TableRow>
                                <TableCell className="font-medium pl-8 text-muted-foreground">− Комиссии</TableCell>
                                <TableCell className="text-right text-red-600">−{formatCurrency(pnl.expExtCommission)}</TableCell>
                              </TableRow>
                            )}
                            {pnl.expExtLogistics > 0 && (
                              <TableRow>
                                <TableCell className="font-medium pl-8 text-muted-foreground">− Логистика (расходы)</TableCell>
                                <TableCell className="text-right text-red-600">−{formatCurrency(pnl.expExtLogistics)}</TableCell>
                              </TableRow>
                            )}
                            {pnl.expExtTaxes > 0 && (
                              <TableRow>
                                <TableCell className="font-medium pl-8 text-muted-foreground">− Налоги (расходы)</TableCell>
                                <TableCell className="text-right text-red-600">−{formatCurrency(pnl.expExtTaxes)}</TableCell>
                              </TableRow>
                            )}
                          </>
                        )}

                        <TableRow className="bg-muted border-t-2">
                          <TableCell className="font-bold flex items-center gap-2">
                            {pnl.netProfit >= 0 ? (
                              <TrendingUp className="w-4 h-4 text-green-500" />
                            ) : (
                              <TrendingDown className="w-4 h-4 text-red-500" />
                            )}
                            Чистая прибыль (Net Profit)
                          </TableCell>
                          <TableCell className={`text-right font-bold text-lg ${pnl.netProfit >= 0 ? "text-green-600" : "text-red-600"}`} data-testid="text-net-profit">
                            {formatCurrency(pnl.netProfit)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
                      <div className="text-center p-4 rounded-lg" style={{ background: '#0FC2C020' }}>
                        <p className="text-sm text-muted-foreground">Выручка</p>
                        <p className="text-xl font-bold text-green-600" data-testid="text-summary-revenue">{formatCurrency(pnl.grossRevenue)}</p>
                      </div>
                      <div className="text-center p-4 rounded-lg bg-muted">
                        <p className="text-sm text-muted-foreground">Расходы</p>
                        <p className="text-xl font-bold text-red-600" data-testid="text-summary-expenses">{formatCurrency(pnl.totalExpenses)}</p>
                      </div>
                      <div className="text-center p-4 rounded-lg bg-muted">
                        <p className="text-sm text-muted-foreground">Налоги</p>
                        <p className="text-xl font-bold" data-testid="text-summary-taxes">{formatCurrency(pnl.taxes)}</p>
                      </div>
                      <div className="text-center p-4 rounded-lg" style={{ background: pnl.netProfit >= 0 ? '#0FC2C015' : '#ef444415' }}>
                        <p className="text-sm text-muted-foreground">Прибыль</p>
                        <p className={`text-xl font-bold ${pnl.netProfit >= 0 ? "text-green-600" : "text-red-600"}`} data-testid="text-summary-profit">
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

          <TabsContent value="expenses">
            <Card className="kpi-card">
              <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle>Расходы</CardTitle>
                  <CardDescription>Внутренние и внешние расходы компании</CardDescription>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-add-expense">
                      <Plus className="w-4 h-4 mr-2" />
                      Добавить расход
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Новый расход</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Категория</Label>
                        <Select
                          value={newCategory}
                          onValueChange={(v) => {
                            setNewCategory(v as "internal" | "external");
                            setNewType("");
                          }}
                        >
                          <SelectTrigger data-testid="select-category">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="internal">Внутренние</SelectItem>
                            <SelectItem value="external">Внешние</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Тип расхода</Label>
                        <Select value={newType} onValueChange={setNewType}>
                          <SelectTrigger data-testid="select-type">
                            <SelectValue placeholder="Выберите тип" />
                          </SelectTrigger>
                          <SelectContent>
                            {typeOptions.map((t) => (
                              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Описание</Label>
                        <Input
                          data-testid="input-description"
                          value={newDescription}
                          onChange={(e) => setNewDescription(e.target.value)}
                          placeholder="Описание расхода"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Сумма</Label>
                        <Input
                          data-testid="input-amount"
                          type="number"
                          value={newAmount}
                          onChange={(e) => setNewAmount(e.target.value)}
                          placeholder="0"
                          min="0"
                          step="0.01"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Компания</Label>
                        <Select value={newCompanyId} onValueChange={setNewCompanyId}>
                          <SelectTrigger data-testid="select-company">
                            <SelectValue placeholder="Выберите компанию" />
                          </SelectTrigger>
                          <SelectContent>
                            {companies?.map((c) => (
                              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        data-testid="button-submit-expense"
                        onClick={handleCreateExpense}
                        disabled={!newType || !newAmount || createExpenseMutation.isPending}
                      >
                        {createExpenseMutation.isPending ? "Сохранение..." : "Сохранить"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {expensesLoading ? (
                  <p className="text-center text-muted-foreground py-8">Загрузка...</p>
                ) : (
                  <div className="space-y-8">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div>{renderExpenseTable(internalExpenses, "Внутренние расходы", "internal")}</div>
                      <div>{renderExpenseTable(externalExpenses, "Внешние расходы", "external")}</div>
                    </div>

                    <div className="border-t pt-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="text-center p-4 rounded-lg bg-muted" data-testid="text-internal-total">
                          <p className="text-sm text-muted-foreground">Внутренние</p>
                          <p className="text-xl font-bold">{formatCurrency(internalTotal)}</p>
                        </div>
                        <div className="text-center p-4 rounded-lg bg-muted" data-testid="text-external-total">
                          <p className="text-sm text-muted-foreground">Внешние</p>
                          <p className="text-xl font-bold">{formatCurrency(externalTotal)}</p>
                        </div>
                        <div className="text-center p-4 rounded-lg" style={{ background: '#0FC2C020' }} data-testid="text-grand-total">
                          <p className="text-sm text-muted-foreground">Итого расходы</p>
                          <p className="text-xl font-bold">{formatCurrency(grandTotal)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit">
            <Card className="kpi-card">
              <CardHeader>
                <CardTitle>История изменений</CardTitle>
                <CardDescription>Журнал всех изменений остатков и данных</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
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
                            <span className="px-2 py-1 bg-muted rounded text-xs font-medium">
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
