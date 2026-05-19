const NBSP = "\u00A0";

export function formatNumber(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0";
  return Math.round(num)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

export function formatCurrency(value: number | string, useAngleQuotes = false): string {
  const formatted = formatNumber(value);
  if (useAngleQuotes) {
    return `${formatted}${NBSP}₽`;
  }
  return `${formatted}${NBSP}₽`;
}

export function formatQuantity(value: number | string, useAngleQuotes = false): string {
  const formatted = formatNumber(value);
  if (useAngleQuotes) {
    return `«${formatted}${NBSP}шт.»`;
  }
  return `${formatted}${NBSP}шт.`;
}

export function formatPercent(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0%";
  const fixed = num.toFixed(1);
  const parts = fixed.split(".");
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const dec = parts[1] === "0" ? "" : `,${parts[1]}`;
  return `${intPart}${dec}%`;
}

export function angleQuote(text: string): string {
  return `«${text}»`;
}

export function formatCurrencyDecimal(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return `0${NBSP}₽`;
  const parts = num.toFixed(2).split(".");
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${intPart},${parts[1]}${NBSP}₽`;
}
