import type { Store } from "@shared/schema";
import type { MarketplaceAdapter } from "./base";
import { OzonAdapter } from "./ozon";
import { WildberriesAdapter } from "./wildberries";
import { YandexMarketAdapter } from "./yandex";

export function createAdapter(store: Store): MarketplaceAdapter {
  switch (store.marketplace) {
    case "ozon":
      return new OzonAdapter(store);
    case "wildberries":
      return new WildberriesAdapter(store);
    case "yandex":
      return new YandexMarketAdapter(store);
    default:
      throw new Error(`Неизвестный маркетплейс: ${store.marketplace}`);
  }
}
