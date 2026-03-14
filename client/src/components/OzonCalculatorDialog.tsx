import { useState } from "react";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calculator, AlertCircle } from "lucide-react";
import type { Product } from "@shared/schema";

interface OzonCalculatorProps {
  taxRate: number;
  products: Product[];
}

function formatRubles(value: number): string {
  if (!isFinite(value) || isNaN(value)) return "—";
  const formatted = Math.round(value * 100) / 100;
  return formatted.toLocaleString("ru-RU", { 
    minimumFractionDigits: 0, 
    maximumFractionDigits: 2 
  }).replace(/,/g, " ") + " ₽";
}

function formatPercent(value: number): string {
  if (!isFinite(value) || isNaN(value)) return "—";
  return (Math.round(value * 10) / 10).toLocaleString("ru-RU") + "%";
}

interface CalculatorResult {
  sellingPrice: number;
  cost: number;
  commissionPct: number;
  length: number;
  width: number;
  height: number;
  taxRate: number;
}

function calculateResult(data: CalculatorResult) {
  const { sellingPrice, cost, commissionPct, length, width, height, taxRate } = data;

  // Calculate volume
  const hasAllDimensions = length > 0 && width > 0 && height > 0;
  const volume = hasAllDimensions ? (length * width * height) / 1000 : 0;

  // FBO logistics calculation
  let logisticsFBO = 0;
  if (hasAllDimensions) {
    if (volume <= 1) {
      logisticsFBO = 46;
    } else if (volume <= 3) {
      logisticsFBO = 46 + (volume - 1) * 10;
    } else if (volume <= 190) {
      logisticsFBO = 66 + (volume - 3) * 15;
    } else {
      logisticsFBO = 2871;
    }
  }

  // FBS logistics calculation
  let logisticsFBS = 0;
  if (hasAllDimensions) {
    if (volume <= 1) {
      logisticsFBS = 80;
    } else if (volume <= 3) {
      logisticsFBS = 80 + (volume - 1) * 18;
    } else if (volume <= 190) {
      logisticsFBS = 116 + (volume - 3) * 23;
    } else {
      logisticsFBS = 4417;
    }
  }

  const commission = sellingPrice * (commissionPct / 100);
  const acquiring = sellingPrice * 0.015;
  const lastMile = Math.min(sellingPrice * 0.055, 500);
  const tax = sellingPrice * (taxRate / 100);

  const totalCostsFBO = commission + acquiring + logisticsFBO + lastMile + cost + tax;
  const totalCostsFBS = commission + acquiring + logisticsFBS + lastMile + cost + tax;

  const profitFBO = sellingPrice - totalCostsFBO;
  const profitFBS = sellingPrice - totalCostsFBS;

  const marginFBO = sellingPrice > 0 ? (profitFBO / sellingPrice) * 100 : 0;
  const marginFBS = sellingPrice > 0 ? (profitFBS / sellingPrice) * 100 : 0;

  return {
    sellingPrice,
    commission,
    commissionPct,
    acquiring,
    logisticsFBO: hasAllDimensions ? logisticsFBO : null,
    logisticsFBS: hasAllDimensions ? logisticsFBS : null,
    lastMile,
    cost,
    tax,
    profitFBO,
    profitFBS,
    marginFBO,
    marginFBS,
    hasAllDimensions,
  };
}

export function OzonCalculatorDialog({ taxRate, products }: OzonCalculatorProps) {
  const [sellingPrice, setSellingPrice] = useState("");
  const [cost, setCost] = useState("");
  const [commissionPct, setCommissionPct] = useState("15");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [result, setResult] = useState<ReturnType<typeof calculateResult> | null>(null);

  const handleCalculate = () => {
    const price = parseFloat(sellingPrice) || 0;
    const c = parseFloat(cost) || 0;
    const comm = parseFloat(commissionPct) || 15;
    const l = parseFloat(length) || 0;
    const w = parseFloat(width) || 0;
    const h = parseFloat(height) || 0;

    if (price <= 0) return;

    const calc = calculateResult({
      sellingPrice: price,
      cost: c,
      commissionPct: comm,
      length: l,
      width: w,
      height: h,
      taxRate,
    });

    setResult(calc);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Calculator className="w-5 h-5" />
          Ozon Калькулятор
        </DialogTitle>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-6 mt-4">
        {/* Left side - Form */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Цена продажи (₽) *</Label>
            <Input
              type="number"
              value={sellingPrice}
              onChange={(e) => setSellingPrice(e.target.value)}
              placeholder="0"
              min="0"
              step="0.01"
              data-testid="input-calc-selling-price"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Себестоимость (₽)</Label>
            <Input
              type="number"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="0"
              min="0"
              step="0.01"
              data-testid="input-calc-cost"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Комиссия Ozon (%)</Label>
            <Input
              type="number"
              value={commissionPct}
              onChange={(e) => setCommissionPct(e.target.value)}
              placeholder="15"
              min="0"
              step="0.1"
              data-testid="input-calc-commission"
            />
          </div>

          <div className="pt-2 border-t">
            <Label className="text-xs font-semibold text-muted-foreground mb-3 block">
              Габариты товара (см)
            </Label>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-2">
                <Label className="text-xs">Длина</Label>
                <Input
                  type="number"
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                  placeholder="0"
                  min="0"
                  step="0.1"
                  data-testid="input-calc-length"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Ширина</Label>
                <Input
                  type="number"
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                  placeholder="0"
                  min="0"
                  step="0.1"
                  data-testid="input-calc-width"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Высота</Label>
                <Input
                  type="number"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  placeholder="0"
                  min="0"
                  step="0.1"
                  data-testid="input-calc-height"
                />
              </div>
            </div>
          </div>

          <Button onClick={handleCalculate} className="w-full mt-4 premium-button">
            Рассчитать
          </Button>
        </div>

        {/* Right side - Results */}
        <div>
          {!result ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Нажмите «Рассчитать» для результатов
            </div>
          ) : (
            <div className="space-y-3">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="border-b">
                    <TableHead className="p-2 text-left font-semibold">Параметр</TableHead>
                    <TableHead className="p-2 text-right font-semibold">FBO</TableHead>
                    <TableHead className="p-2 text-right font-semibold">FBS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="border-b">
                    <TableCell className="p-2">Цена товара</TableCell>
                    <TableCell className="p-2 text-right">{formatRubles(result.sellingPrice)} 100%</TableCell>
                    <TableCell className="p-2 text-right">{formatRubles(result.sellingPrice)} 100%</TableCell>
                  </TableRow>

                  <TableRow className="border-b">
                    <TableCell className="p-2">Вознаграждение Ozon</TableCell>
                    <TableCell className="p-2 text-right text-red-600">-{formatRubles(result.commission)} {result.commissionPct.toFixed(1)}%</TableCell>
                    <TableCell className="p-2 text-right text-red-600">-{formatRubles(result.commission)} {result.commissionPct.toFixed(1)}%</TableCell>
                  </TableRow>

                  <TableRow className="border-b">
                    <TableCell className="p-2">Эквайринг (1.5%)</TableCell>
                    <TableCell className="p-2 text-right text-red-600">-{formatRubles(result.acquiring)}</TableCell>
                    <TableCell className="p-2 text-right text-red-600">-{formatRubles(result.acquiring)}</TableCell>
                  </TableRow>

                  <TableRow className="border-b">
                    <TableCell className="p-2">Логистика</TableCell>
                    <TableCell className="p-2 text-right text-red-600">
                      {result.hasAllDimensions ? `-${formatRubles(result.logisticsFBO!)}` : "—"}
                    </TableCell>
                    <TableCell className="p-2 text-right text-red-600">
                      {result.hasAllDimensions ? `-${formatRubles(result.logisticsFBS!)}` : "—"}
                    </TableCell>
                  </TableRow>

                  <TableRow className="border-b">
                    <TableCell className="p-2">Последняя миля (5.5%)</TableCell>
                    <TableCell className="p-2 text-right text-red-600">-{formatRubles(result.lastMile)}</TableCell>
                    <TableCell className="p-2 text-right text-red-600">-{formatRubles(result.lastMile)}</TableCell>
                  </TableRow>

                  <TableRow className="border-b">
                    <TableCell className="p-2">Себестоимость</TableCell>
                    <TableCell className="p-2 text-right text-red-600">-{formatRubles(result.cost)}</TableCell>
                    <TableCell className="p-2 text-right text-red-600">-{formatRubles(result.cost)}</TableCell>
                  </TableRow>

                  <TableRow className="border-b">
                    <TableCell className="p-2">Налог ({formatPercent(taxRate)})</TableCell>
                    <TableCell className="p-2 text-right text-red-600">-{formatRubles(result.tax)}</TableCell>
                    <TableCell className="p-2 text-right text-red-600">-{formatRubles(result.tax)}</TableCell>
                  </TableRow>

                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell className="p-2">Чистая прибыль</TableCell>
                    <TableCell className={`p-2 text-right ${result.profitFBO >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatRubles(result.profitFBO)}
                    </TableCell>
                    <TableCell className={`p-2 text-right ${result.profitFBS >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatRubles(result.profitFBS)}
                    </TableCell>
                  </TableRow>

                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell className="p-2">Маржинальность</TableCell>
                    <TableCell className={`p-2 text-right ${result.marginFBO >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatPercent(result.marginFBO)}
                    </TableCell>
                    <TableCell className={`p-2 text-right ${result.marginFBS >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatPercent(result.marginFBS)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>

              {!result.hasAllDimensions && (
                <div className="flex gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-yellow-700">Введите все габариты для расчёта логистики</p>
                </div>
              )}

              <p className="text-xs text-muted-foreground mt-3">
                Расчёт приблизительный. Тарифы актуальны на 2025 год и могут измениться.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
