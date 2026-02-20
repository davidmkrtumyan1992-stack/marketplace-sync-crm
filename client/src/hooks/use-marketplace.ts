import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type InsertMarketplaceSetting, type MarketplaceSetting } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const SETTINGS_KEY = "/api/marketplace/settings";

export function useMarketplaceSettings() {
  return useQuery<MarketplaceSetting[]>({
    queryKey: [SETTINGS_KEY],
  });
}

export function useSaveMarketplaceSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertMarketplaceSetting) => {
      const res = await apiRequest("POST", SETTINGS_KEY, data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SETTINGS_KEY] });
      toast({ title: "Сохранено", description: "Магазин добавлен" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateMarketplaceSetting() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<InsertMarketplaceSetting> & { id: number }) => {
      const res = await apiRequest("PUT", `${SETTINGS_KEY}/${id}`, data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SETTINGS_KEY] });
      toast({ title: "Сохранено", description: "Настройки магазина обновлены" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteMarketplaceSetting() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `${SETTINGS_KEY}/${id}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SETTINGS_KEY] });
      toast({ title: "Удалено", description: "Магазин удалён" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });
}

export function useSyncAllMarketplaces() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/marketplace/sync");
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Синхронизация", description: "Синхронизация всех маркетплейсов запущена" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });
}
