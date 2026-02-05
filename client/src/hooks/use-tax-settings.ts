import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { type InsertTaxSetting, type TaxSetting } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export function useTaxSettings() {
  return useQuery<TaxSetting | null>({
    queryKey: [api.taxSettings.get.path],
    queryFn: async () => {
      const res = await fetch(api.taxSettings.get.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch tax settings");
      return res.json();
    },
  });
}

export function useSaveTaxSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertTaxSetting) => {
      const res = await fetch(api.taxSettings.save.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to save tax settings");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.taxSettings.get.path] });
      queryClient.invalidateQueries({ queryKey: [api.kpi.get.path] });
      toast({ title: "Сохранено", description: "Налоговые настройки обновлены" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });
}
