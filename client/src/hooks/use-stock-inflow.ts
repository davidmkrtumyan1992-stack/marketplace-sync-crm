import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { type InsertStockInflow, type StockInflow } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export function useStockInflows() {
  return useQuery<StockInflow[]>({
    queryKey: [api.stockInflow.list.path],
    queryFn: async () => {
      const res = await fetch(api.stockInflow.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stock inflows");
      return res.json();
    },
  });
}

export function useCreateStockInflow() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertStockInflow) => {
      const res = await fetch(api.stockInflow.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create stock inflow");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.stockInflow.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.products.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.kpi.get.path] });
      toast({ title: "Оприходовано", description: "Товар успешно добавлен на склад" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });
}
