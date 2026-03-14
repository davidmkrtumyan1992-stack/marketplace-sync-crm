import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calculator, AlertCircle, Search } from "lucide-react";
import type { Product } from "@shared/schema";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface OzonCalculatorProps {
  taxRate: number;
  products: Product[];
}

const OZON_CATEGORIES = [
  { name: "Одежда и обувь", fbo: 15, fbs: 15 },
  { name: "Электроника", fbo: 5, fbs: 7 },
  { name: "Косметика и парфюмерия", fbo: 20, fbs: 22 },
  { name: "Красота и здоровье", fbo: 20, fbs: 22 },
  { name: "Краска для волос", fbo: 39, fbs: 43 },
  { name: "Товары для дома", fbo: 15, fbs: 17 },
  { name: "Детские товары", fbo: 10, fbs: 12 },
  { name: "Спорт и отдых", fbo: 12, fbs: 14 },
  { name: "Продукты питания", fbo: 7, fbs: 9 },
  { name: "Книги", fbo: 15, fbs: 15 },
  { name: "Авто товары", fbo: 10, fbs: 12 },
  { name: "Другое", fbo: 15, fbs: 15 },
];

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
  commissionFBO: number;
  commissionFBS: number;
  commissionFBOPct: number;
  commissionFBSPct: number;
  taxRate: number;
  volume: number;
}

function calculateResult(data: CalculatorResult) {
  const { sellingPrice, cost, commissionFBO, commissionFBS, taxRate, volume } = data;
  const hasVolume = volume > 0;

  // FBO logistics calculation
  let logisticsFBO = 0;
  if (hasVolume) {
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
  if (hasVolume) {
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

  const acquiring = sellingPrice * 0.01; // 1% acquiring fee
  const lastMile = 25; // Fixed 25 ₽
  const processingFBS = 30; // Processing fee only for FBS
  const tax = sellingPrice * (taxRate / 100);

  const ozonCostsFBO = commissionFBO + acquiring + logisticsFBO;
  const ozonCostsFBS = commissionFBS + acquiring + logisticsFBS;
  
  const totalCostsFBO = ozonCostsFBO + lastMile + cost + tax;
  const totalCostsFBS = ozonCostsFBS + lastMile + processingFBS + cost + tax;

  const profitFBO = sellingPrice - totalCostsFBO;
  const profitFBS = sellingPrice - totalCostsFBS;

  const marginFBO = sellingPrice > 0 ? (profitFBO / sellingPrice) * 100 : 0;
  const marginFBS = sellingPrice > 0 ? (profitFBS / sellingPrice) * 100 : 0;

  return {
    sellingPrice,
    commissionFBO,
    commissionFBS,
    commissionFBOPct: data.commissionFBOPct,
    commissionFBSPct: data.commissionFBSPct,
    acquiring,
    logisticsFBO: hasVolume ? logisticsFBO : null,
    logisticsFBS: hasVolume ? logisticsFBS : null,
    ozonCostsFBO,
    ozonCostsFBS,
    lastMile,
    processingFBS,
    cost,
    tax,
    profitFBO,
    profitFBS,
    marginFBO,
    marginFBS,
    hasVolume,
  };
}

export function OzonCalculatorDialog({ taxRate, products }: OzonCalculatorProps) {
  const [searchInput, setSearchInput] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<(typeof OZON_CATEGORIES)[0] | null>(null);
  const [sellingPrice, setSellingPrice] = useState("");
  const [cost, setCost] = useState("");
  const [dimensionTab, setDimensionTab] = useState(true);
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [volume, setVolume] = useState("");
  const [result, setResult] = useState<ReturnType<typeof calculateResult> | null>(null);

  const filteredProducts = useMemo(() => {
    if (!searchInput) return [];
    return products.filter(p =>
      p.name.toLowerCase().includes(searchInput.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchInput.toLowerCase())
    ).slice(0, 5);
  }, [searchInput, products]);

  const selectProduct = (product: Product) => {
    setSelectedProduct(product);
    setSearchInput(product.name);
    setSearchOpen(false);
    setSellingPrice((product.sellingPrice || 0).toString());
    setCost((product.purchasePrice || 0).toString());
  };

  const selectCategory = (catName: string) => {
    const cat = OZON_CATEGORIES.find(c => c.name === catName);
    if (cat) {
      setSelectedCategory(cat);
    }
  };

  const calculatedVolume = useMemo(() => {
    if (dimensionTab) {
      const l = parseFloat(length) || 0;
      const w = parseFloat(width) || 0;
      const h = parseFloat(height) || 0;
      return l > 0 && w > 0 && h > 0 ? (l * w * h) / 1000 : 0;
    }
    return parseFloat(volume) || 0;
  }, [dimensionTab, length, width, height, volume]);

  const handleCalculate = () => {
    const price = parseFloat(sellingPrice) || 0;
    const c = parseFloat(cost) || 0;
    const cat = selectedCategory || { fbo: 15, fbs: 15 };

    if (price <= 0) return;

    const commFBO = price * (cat.fbo / 100);
    const commFBS = price * (cat.fbs / 100);

    const calc = calculateResult({
      sellingPrice: price,
      cost: c,
      commissionFBO: commFBO,
      commissionFBS: commFBS,
      commissionFBOPct: cat.fbo,
      commissionFBSPct: cat.fbs,
      taxRate,
      volume: calculatedVolume,
    });

    setResult(calc);
  };


  return (
    <>
      <div className="grid grid-cols-2 gap-6">
        {/* Left side - Form */}
        <div className="space-y-4">
          {/* Product Search */}
          <div className="space-y-2 relative">
            <Label className="text-sm font-medium">Поиск товара (по названию или артикулу)</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => searchInput && setSearchOpen(true)}
                placeholder="Введите название или артикул..."
                className="pl-9"
                data-testid="input-calc-product-search"
              />
            </div>
            {searchOpen && filteredProducts.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-card border rounded-md shadow-lg z-10 mt-1">
                {filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => selectProduct(p)}
                    className="w-full text-left px-3 py-2 hover:bg-muted border-b last:border-0 text-sm"
                    data-testid={`product-option-${p.id}`}
                  >
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Артикул: {p.sku} • Цена: {formatRubles(p.sellingPrice || 0)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Category */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Категория товара</Label>
            <Select value={selectedCategory?.name || ""} onValueChange={selectCategory}>
              <SelectTrigger data-testid="select-calc-category">
                <SelectValue placeholder="Выберите категорию..." />
              </SelectTrigger>
              <SelectContent>
                {OZON_CATEGORIES.map((cat) => (
                  <SelectItem key={cat.name} value={cat.name}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Price & Cost */}
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

          {selectedCategory && (
            <div className="text-xs text-muted-foreground p-2 bg-muted/50 rounded">
              <div>Комиссия FBO: {selectedCategory.fbo}%</div>
              <div>Комиссия FBS: {selectedCategory.fbs}%</div>
            </div>
          )}

          {/* Dimensions/Volume Tabs */}
          <div className="pt-2 border-t">
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setDimensionTab(true)}
                className={`text-xs font-medium px-3 py-1.5 rounded border ${
                  dimensionTab
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:bg-muted"
                }`}
                data-testid="tab-dimensions"
              >
                Габариты
              </button>
              <button
                onClick={() => setDimensionTab(false)}
                className={`text-xs font-medium px-3 py-1.5 rounded border ${
                  !dimensionTab
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:bg-muted"
                }`}
                data-testid="tab-volume"
              >
                Объём
              </button>
            </div>

            {dimensionTab ? (
              <>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Длина (см)</Label>
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
                  <div className="space-y-1">
                    <Label className="text-xs">Ширина (см)</Label>
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
                  <div className="space-y-1">
                    <Label className="text-xs">Высота (см)</Label>
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
                <p className="text-xs text-muted-foreground">
                  Объём: {calculatedVolume > 0 ? calculatedVolume.toFixed(2) : "—"} л
                </p>
              </>
            ) : (
              <div className="space-y-1">
                <Label className="text-xs">Объём (л)</Label>
                <Input
                  type="number"
                  value={volume}
                  onChange={(e) => setVolume(e.target.value)}
                  placeholder="0"
                  min="0"
                  step="0.1"
                  data-testid="input-calc-volume"
                />
              </div>
            )}
          </div>

          <Button onClick={handleCalculate} className="w-full mt-4 premium-button" data-testid="button-calc-calculate">
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
                    <TableCell className="p-2 text-right font-medium">{formatRubles(result.sellingPrice)}</TableCell>
                    <TableCell className="p-2 text-right font-medium">{formatRubles(result.sellingPrice)}</TableCell>
                  </TableRow>

                  <TableRow className="border-b bg-red-50">
                    <TableCell className="p-2 font-medium">Затраты на Ozon</TableCell>
                    <TableCell className="p-2 text-right text-red-600 font-medium">-{formatRubles(result.ozonCostsFBO)}</TableCell>
                    <TableCell className="p-2 text-right text-red-600 font-medium">-{formatRubles(result.ozonCostsFBS)}</TableCell>
                  </TableRow>

                  <TableRow className="border-b text-muted-foreground">
                    <TableCell className="p-2 pl-4">  Вознаграждение ({result.commissionFBOPct}%/{result.commissionFBSPct}%)</TableCell>
                    <TableCell className="p-2 text-right text-xs">-{formatRubles(result.commissionFBO)}</TableCell>
                    <TableCell className="p-2 text-right text-xs">-{formatRubles(result.commissionFBS)}</TableCell>
                  </TableRow>

                  <TableRow className="border-b text-muted-foreground">
                    <TableCell className="p-2 pl-4">  Эквайринг (1%)</TableCell>
                    <TableCell className="p-2 text-right text-xs">-{formatRubles(result.acquiring)}</TableCell>
                    <TableCell className="p-2 text-right text-xs">-{formatRubles(result.acquiring)}</TableCell>
                  </TableRow>

                  <TableRow className="border-b text-muted-foreground">
                    <TableCell className="p-2 pl-4">  Логистика</TableCell>
                    <TableCell className="p-2 text-right text-xs">
                      {result.hasVolume ? `-${formatRubles(result.logisticsFBO!)}` : "—"}
                    </TableCell>
                    <TableCell className="p-2 text-right text-xs">
                      {result.hasVolume ? `-${formatRubles(result.logisticsFBS!)}` : "—"}
                    </TableCell>
                  </TableRow>

                  <TableRow className="border-b">
                    <TableCell className="p-2">Последняя миля</TableCell>
                    <TableCell className="p-2 text-right text-red-600">-{formatRubles(result.lastMile)}</TableCell>
                    <TableCell className="p-2 text-right text-red-600">-{formatRubles(result.lastMile)}</TableCell>
                  </TableRow>

                  <TableRow className="border-b">
                    <TableCell className="p-2">Обработка отправления</TableCell>
                    <TableCell className="p-2 text-right text-red-600">—</TableCell>
                    <TableCell className="p-2 text-right text-red-600">-{formatRubles(result.processingFBS)}</TableCell>
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

                  <TableRow className="bg-green-50 font-semibold">
                    <TableCell className="p-2">Чистая прибыль</TableCell>
                    <TableCell className={`p-2 text-right ${result.profitFBO >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatRubles(result.profitFBO)}
                    </TableCell>
                    <TableCell className={`p-2 text-right ${result.profitFBS >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatRubles(result.profitFBS)}
                    </TableCell>
                  </TableRow>

                  <TableRow className="bg-green-50 font-semibold">
                    <TableCell className="p-2">Маржа</TableCell>
                    <TableCell className={`p-2 text-right ${result.marginFBO >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatPercent(result.marginFBO)}
                    </TableCell>
                    <TableCell className={`p-2 text-right ${result.marginFBS >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatPercent(result.marginFBS)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>

              {!result.hasVolume && (
                <div className="flex gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-yellow-700">Введите габариты или объём для расчёта логистики</p>
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
