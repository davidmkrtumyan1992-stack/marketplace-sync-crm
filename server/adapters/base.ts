export interface StockUpdate {
  externalSku: string;
  quantity: number;
  warehouseId?: string;
}

export interface StockInfo {
  externalSku: string;
  available: number;
  reserved: number;
}

export interface AdapterResult {
  success: boolean;
  errors: string[];
  updatedCount?: number;
}

export interface MarketplaceAdapter {
  updateStocks(updates: StockUpdate[]): Promise<AdapterResult>;
  getStocks(skus: string[]): Promise<StockInfo[]>;
  getName(): string;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
