import type { Product } from "@shared/schema";

export interface OzonProfitResult {
  sellingPrice: number;
  purchasePrice: number;
  commissionFBO: number;
  commissionFBS: number;
  commissionFBOPct: number;
  commissionFBSPct: number;
  acquiring: number;
  logisticsFBO: number | null;
  logisticsFBS: number | null;
  lastMile: number;
  processingFBS: number;
  tax: number;
  taxRate: number;
  profitFBO: number;
  profitFBS: number;
  marginFBO: number;
  marginFBS: number;
  hasVolume: boolean;
  volume: number;
}

export function calculateProductProfit(
  price: number,
  purchasePrice: number,
  commissionFBOPct: number,
  taxRate: number,
  length: number,
  width: number,
  height: number,
  commissionFBSPct?: number,
): OzonProfitResult {
  const hasVolume = length > 0 && width > 0 && height > 0;
  const volume = hasVolume ? (length * width * height) / 1000 : 0;

  let logisticsFBO = 0;
  if (hasVolume) {
    if (volume <= 1) logisticsFBO = 46;
    else if (volume <= 3) logisticsFBO = 46 + (volume - 1) * 10;
    else if (volume <= 190) logisticsFBO = 66 + (volume - 3) * 15;
    else logisticsFBO = 2871;
  }

  let logisticsFBS = 0;
  if (hasVolume) {
    if (volume <= 1) logisticsFBS = 80;
    else if (volume <= 3) logisticsFBS = 80 + (volume - 1) * 18;
    else if (volume <= 190) logisticsFBS = 116 + (volume - 3) * 23;
    else logisticsFBS = 4417;
  }

  const finalCommissionFBSPct = commissionFBSPct ?? (commissionFBOPct + 4);
  const commissionFBO = price * (commissionFBOPct / 100);
  const commissionFBS = price * (finalCommissionFBSPct / 100);
  const acquiring = price * 0.01;
  const lastMile = 25;
  const processingFBS = 30;
  const tax = price * (taxRate / 100);

  const totalFBO = commissionFBO + acquiring + logisticsFBO + lastMile + purchasePrice + tax;
  const totalFBS = commissionFBS + acquiring + logisticsFBS + lastMile + processingFBS + purchasePrice + tax;

  const profitFBO = price - totalFBO;
  const profitFBS = price - totalFBS;
  const marginFBO = price > 0 ? (profitFBO / price) * 100 : 0;
  const marginFBS = price > 0 ? (profitFBS / price) * 100 : 0;

  return {
    sellingPrice: price,
    purchasePrice,
    commissionFBO,
    commissionFBS,
    commissionFBOPct,
    commissionFBSPct,
    acquiring,
    logisticsFBO: hasVolume ? logisticsFBO : null,
    logisticsFBS: hasVolume ? logisticsFBS : null,
    lastMile,
    processingFBS,
    tax,
    taxRate,
    profitFBO,
    profitFBS,
    marginFBO,
    marginFBS,
    hasVolume,
    volume,
  };
}

export function calculateFromProduct(
  product: Product,
  taxRate: number,
  defaultCommission: number,
): OzonProfitResult {
  const price = Number(product.sellingPrice || product.price || 0);
  const purchasePrice = Number(product.purchasePrice || 0);
  const commissionFBOPct = Number(product.marketplaceCommission) || defaultCommission;
  const commissionFBSPct = Number(product.marketplaceCommissionFbs) || undefined;
  const length = Number(product.dimensionLength || 0);
  const width = Number(product.dimensionWidth || 0);
  const height = Number(product.dimensionHeight || 0);

  return calculateProductProfit(price, purchasePrice, commissionFBOPct, taxRate, length, width, height, commissionFBSPct);
}

export function getMarginColor(margin: number): string {
  if (margin > 30) return "text-green-600";
  if (margin >= 10) return "text-yellow-600";
  return "text-red-600";
}

export function getMarginBadgeClasses(margin: number): string {
  if (margin > 30) return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
  if (margin >= 10) return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
  return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
}

export function formatRub(value: number): string {
  if (!isFinite(value) || isNaN(value)) return "—";
  return Math.round(value).toLocaleString("ru-RU").replace(/,/g, " ") + " ₽";
}

export function formatPct(value: number): string {
  if (!isFinite(value) || isNaN(value)) return "—";
  return (Math.round(value * 10) / 10).toLocaleString("ru-RU") + "%";
}
