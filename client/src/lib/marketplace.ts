export const MARKETPLACE_STYLES: Record<string, { label: string; bg: string; color: string; border: string }> = {
  ozon: { label: "Ozon", bg: "#005BFF", color: "#FFFFFF", border: "#0047CC" },
  wildberries: { label: "Wildberries", bg: "#CB11AB", color: "#FFFFFF", border: "#A00E8A" },
  wb: { label: "Wildberries", bg: "#CB11AB", color: "#FFFFFF", border: "#A00E8A" },
  yandex: { label: "Yandex Market", bg: "#FFCC00", color: "#000000", border: "#D4A900" },
  "yandex_market": { label: "Yandex Market", bg: "#FFCC00", color: "#000000", border: "#D4A900" },
};

export function getMarketplaceStyle(marketplace: string) {
  return MARKETPLACE_STYLES[marketplace] || { label: marketplace, bg: "#6B7280", color: "#FFFFFF", border: "#4B5563" };
}

export function detectMarketplaceFromName(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.includes("ozon")) return "ozon";
  if (lower.includes("wildberries") || lower.includes("wb")) return "wildberries";
  if (lower.includes("yandex") || lower.includes("яндекс")) return "yandex";
  return null;
}
