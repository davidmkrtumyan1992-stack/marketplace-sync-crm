// Russian number formatting utilities

/**
 * Format number with space as thousand separator (Russian style)
 * 1450000 -> "1 450 000"
 */
export function formatNumber(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0";
  return num.toLocaleString("ru-RU", { maximumFractionDigits: 0 }).replace(/,/g, " ");
}

/**
 * Format currency with space separator and ruble sign
 * 1450000 -> "1 450 000 ₽" or "«1 450 000 руб.»"
 */
export function formatCurrency(value: number | string, useAngleQuotes = false): string {
  const formatted = formatNumber(value);
  if (useAngleQuotes) {
    return `«${formatted} руб.»`;
  }
  return `${formatted} ₽`;
}

/**
 * Format quantity with units
 * 1200 -> "1 200 шт."
 */
export function formatQuantity(value: number | string, useAngleQuotes = false): string {
  const formatted = formatNumber(value);
  if (useAngleQuotes) {
    return `«${formatted} шт.»`;
  }
  return `${formatted} шт.`;
}

/**
 * Format percentage
 * 15.5 -> "15,5%"
 */
export function formatPercent(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0%";
  return num.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%";
}

/**
 * Wrap text in angle quotes (Russian typographic convention)
 * "text" -> "«text»"
 */
export function angleQuote(text: string): string {
  return `«${text}»`;
}

/**
 * Format decimal currency (with kopeks)
 * 1450000.50 -> "1 450 000,50 ₽"
 */
export function formatCurrencyDecimal(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0 ₽";
  const formatted = num.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${formatted} ₽`;
}
