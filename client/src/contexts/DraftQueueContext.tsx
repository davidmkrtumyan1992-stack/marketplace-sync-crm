import { createContext, useContext, useState, type ReactNode } from "react";
import type { Product } from "@shared/schema";

export interface DraftWriteoffItem {
  product: Product;
  quantity: number;
  reason: string;
}

export interface DraftInflowItem {
  product: Product;
  quantity: number;
}

interface DraftQueueContextType {
  writeoffs: DraftWriteoffItem[];
  inflows: DraftInflowItem[];
  addWriteoff: (item: DraftWriteoffItem) => void;
  removeWriteoff: (productId: number) => void;
  clearWriteoffs: () => void;
  addInflow: (item: DraftInflowItem) => void;
  removeInflow: (productId: number) => void;
  clearInflows: () => void;
}

const DraftQueueContext = createContext<DraftQueueContextType | null>(null);

export function DraftQueueProvider({ children }: { children: ReactNode }) {
  const [writeoffs, setWriteoffs] = useState<DraftWriteoffItem[]>([]);
  const [inflows, setInflows] = useState<DraftInflowItem[]>([]);

  const addWriteoff = (item: DraftWriteoffItem) => {
    setWriteoffs(prev => {
      const idx = prev.findIndex(w => w.product.id === item.product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = item;
        return next;
      }
      return [...prev, item];
    });
  };

  const removeWriteoff = (productId: number) =>
    setWriteoffs(prev => prev.filter(w => w.product.id !== productId));

  const clearWriteoffs = () => setWriteoffs([]);

  const addInflow = (item: DraftInflowItem) => {
    setInflows(prev => {
      const idx = prev.findIndex(i => i.product.id === item.product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = item;
        return next;
      }
      return [...prev, item];
    });
  };

  const removeInflow = (productId: number) =>
    setInflows(prev => prev.filter(i => i.product.id !== productId));

  const clearInflows = () => setInflows([]);

  return (
    <DraftQueueContext.Provider value={{
      writeoffs, inflows,
      addWriteoff, removeWriteoff, clearWriteoffs,
      addInflow, removeInflow, clearInflows,
    }}>
      {children}
    </DraftQueueContext.Provider>
  );
}

export function useDraftQueue() {
  const ctx = useContext(DraftQueueContext);
  if (!ctx) throw new Error("useDraftQueue must be used within DraftQueueProvider");
  return ctx;
}
